import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import type { MouseEvent, ReactNode } from "react";

import SideThreadPane from "~/components/chat/SideThreadPane";
import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { PullRequestMarkdownPanelContext } from "~/components/pullRequest/PullRequestMarkdown";
import { Button } from "~/components/ui/button";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { isTerminalFocused } from "~/lib/terminalFocus";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";

import {
  boardBaseTabs,
  boardPanelHostThreadId,
  resolveBoardActiveTab,
  type BoardPanelSelection,
} from "./boardPanel.logic";
import { chooseBoardTab, useBoardPanelStore } from "./boardPanelStore";

export type BoardPullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function boardShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

export function IconAction(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              props.onClick();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

// Side panes and pull request tabs need a stable ref per selection; a new object each render
// would re-host the side chat on every render.
const hostRefs = new Map<string, ScopedThreadRef>();

/** The right panel store entry that holds a selection's pull request tabs and hosts its chats. */
export function boardPanelHostRef(
  environmentId: string,
  selection: BoardPanelSelection,
): ScopedThreadRef {
  const ref = scopeThreadRef(
    EnvironmentId.make(environmentId),
    ThreadId.make(boardPanelHostThreadId(selection)),
  );
  const key = scopedThreadKey(ref);
  const cached = hostRefs.get(key);
  if (cached !== undefined) return cached;
  hostRefs.set(key, ref);
  return ref;
}

export interface BoardPanelModel {
  readonly selection: BoardPanelSelection;
  readonly hostRef: ScopedThreadRef | null;
  readonly tabIds: ReadonlyArray<string>;
  readonly pullRequests: ReadonlyArray<BoardPullRequestSurface>;
  readonly activeTabId: string | null;
  /** Shows a tab and remembers the pick for this selection. */
  readonly activate: (tabId: string) => void;
  readonly closePullRequest: (surfaceId: string) => void;
}

/** The tabs of the Board's panel: the selection's own, then the pull requests opened from it. */
export function useBoardPanelModel(
  selection: BoardPanelSelection,
  hostRef: ScopedThreadRef | null,
  hasDeskThread: boolean,
): BoardPanelModel {
  const panelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, hostRef),
  );
  const revision = useRightPanelStore((state) =>
    hostRef === null ? 0 : (state.userActionRevisionByThreadKey[scopedThreadKey(hostRef)] ?? 0),
  );
  const choice = useBoardPanelStore((state) => state.choices[boardPanelHostThreadId(selection)]);
  const pullRequests = panelState.surfaces.filter(
    (surface): surface is BoardPullRequestSurface => surface.kind === "pull-request",
  );
  const baseTabs = boardBaseTabs(selection, hasDeskThread);
  const tabIds = [...baseTabs, ...pullRequests.map((surface) => surface.id)];
  const activeTabId = resolveBoardActiveTab({
    tabIds,
    choice,
    storeActiveId: panelState.activeSurfaceId,
    storeRevision: revision,
  });
  const currentRevision = () =>
    hostRef === null
      ? 0
      : (useRightPanelStore.getState().userActionRevisionByThreadKey[scopedThreadKey(hostRef)] ??
        0);
  const activate = (tabId: string) => {
    if (hostRef !== null && !baseTabs.includes(tabId)) {
      useRightPanelStore.getState().activateSurface(hostRef, tabId);
    }
    chooseBoardTab(selection, { tabId, revision: currentRevision() });
  };
  const closePullRequest = (surfaceId: string) => {
    if (hostRef === null) return;
    useRightPanelStore.getState().closeSurface(hostRef, surfaceId);
    // Closing a background tab keeps the one in view, as browser tabs do.
    if (activeTabId !== null && activeTabId !== surfaceId) {
      chooseBoardTab(selection, { tabId: activeTabId, revision: currentRevision() });
    }
  };
  return { selection, hostRef, tabIds, pullRequests, activeTabId, activate, closePullRequest };
}

export interface BoardTabLabel {
  readonly title: string;
  readonly tooltip?: string;
  readonly icon: ReactNode;
}

/**
 * The Board's right panel, drawn like T3's own: a tab strip in the title bar row, then the
 * active tab. `labels` and `renderTab` cover the selection's own tabs; pull request tabs render
 * T3's pull request panel.
 */
export function BoardRightPanel(props: {
  model: BoardPanelModel;
  open: boolean;
  labels: Readonly<Record<string, BoardTabLabel>>;
  actions: ReactNode;
  renderTab: (tabId: string) => ReactNode;
}) {
  const gt = useGT();
  const { model } = props;
  const activePullRequest =
    model.pullRequests.find((surface) => surface.id === model.activeTabId) ?? null;
  const tabLabel = (tabId: string): BoardTabLabel => {
    const own = props.labels[tabId];
    if (own !== undefined) return own;
    const surface = model.pullRequests.find((entry) => entry.id === tabId);
    return {
      title: surface === undefined ? tabId : `#${surface.number}`,
      ...(surface === undefined ? {} : { tooltip: `${surface.repository}#${surface.number}` }),
      icon: <PullRequestGlyph.pullRequest />,
    };
  };
  return (
    <PreviewPanelShell
      mode="inline"
      open={props.open}
      workspaceArea
      workspaceLabel={gt("Board panel")}
      widthStorageKey="t3code:fork:board-panel-width"
      defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pr-2 pl-2",
          isElectron && "drag-region",
        )}
        data-right-panel-tabbar
      >
        <div
          role="tablist"
          aria-label={gt("Board panel tabs")}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {model.tabIds.map((tabId) => {
            const label = tabLabel(tabId);
            const closable = !(tabId in props.labels);
            return (
              <BoardPanelTab
                key={tabId}
                label={label}
                active={tabId === model.activeTabId}
                onActivate={() => model.activate(tabId)}
                onClose={closable ? () => model.closePullRequest(tabId) : null}
              />
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {props.actions}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activePullRequest !== null && model.hostRef !== null ? (
          <BoardPullRequestTab surface={activePullRequest} hostRef={model.hostRef} />
        ) : model.activeTabId === null ? null : (
          props.renderTab(model.activeTabId)
        )}
      </div>
    </PreviewPanelShell>
  );
}

function BoardPanelTab(props: {
  label: BoardTabLabel;
  active: boolean;
  onActivate: () => void;
  onClose: (() => void) | null;
}) {
  const gt = useGT();
  const { label, onClose } = props;
  return (
    <div
      data-active-tab={props.active}
      onAuxClick={(event) => {
        if (event.button !== 1 || onClose === null) return;
        event.preventDefault();
        onClose();
      }}
      className={cn(
        "group/tab flex h-6 max-w-44 shrink-0 cursor-pointer items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs [-webkit-app-region:no-drag]",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {onClose === null ? (
        <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3">
          {label.icon}
        </span>
      ) : (
        <PanelTabCloseButton label={gt("Close {title}", { title: label.title })} onClick={onClose}>
          <span className="flex items-center justify-center [&_svg]:size-3">{label.icon}</span>
        </PanelTabCloseButton>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              role="tab"
              aria-selected={props.active}
              className="flex min-w-0 cursor-pointer items-center outline-none"
              onClick={props.onActivate}
            />
          }
        >
          <span className="truncate">{label.title}</span>
        </TooltipTrigger>
        <TooltipPopup>{label.tooltip ?? label.title}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function BoardPullRequestTab(props: {
  surface: BoardPullRequestSurface;
  hostRef: ScopedThreadRef;
}) {
  const { surface, hostRef } = props;
  const environmentId =
    surface.environmentId === undefined
      ? hostRef.environmentId
      : EnvironmentId.make(surface.environmentId);
  return (
    <PullRequestMarkdownPanelContext value={hostRef}>
      <PullRequestDetailPanel
        key={`${environmentId}:${surface.id}`}
        getShortcutContext={boardShortcutContext}
        shortcutsEnabled
        environmentId={environmentId}
        reference={{
          projectId: surface.projectId as ProjectId,
          repository: surface.repository,
          number: surface.number,
          ...(surface.host === undefined ? {} : { host: surface.host }),
        }}
        initialTab={surface.detailTab ?? "summary"}
        revealUrl={surface.revealUrl}
        onRevealSettled={(revealUrl) =>
          useRightPanelStore.getState().settlePullRequestReveal(hostRef, surface.id, revealUrl)
        }
        onTabChange={(tab) =>
          useRightPanelStore.getState().setPullRequestDetailTab(hostRef, surface.id, tab)
        }
        onSelectPullRequest={(reference) =>
          useRightPanelStore.getState().openPullRequest(hostRef, {
            environmentId,
            projectId: reference.projectId,
            repository: reference.repository,
            number: reference.number,
            ...(reference.host === undefined ? {} : { host: reference.host }),
          })
        }
      />
    </PullRequestMarkdownPanelContext>
  );
}

/** A thread drawn by the same pane side chats use, hosted by the Board's panel. */
export function BoardSideThread(props: {
  hostRef: ScopedThreadRef;
  threadId: string;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { hostRef } = props;
  // The Board has no diff panel or terminal, so those open the thread full screen.
  const parentPanel: SideChatParentPanel = {
    hostRef,
    openToolDiff: props.onOpenFull,
    runShellCommand: props.onOpenFull,
  };
  const threadId = ThreadId.make(props.threadId);
  return (
    <SideThreadPane
      key={`${hostRef.environmentId}/${threadId}`}
      parentRef={hostRef}
      surface={{ id: `thread:${threadId}`, kind: "thread", threadId }}
      parentPanel={parentPanel}
      onClose={props.onClose}
    />
  );
}
