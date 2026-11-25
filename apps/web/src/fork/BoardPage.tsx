import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ExternalLinkIcon, Maximize2Icon, XIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import SideThreadPane from "~/components/chat/SideThreadPane";
import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { RelativeTime } from "~/components/RelativeTime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects, useThreadShell, useVisibleThreadShells } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironments } from "~/state/environments";

import {
  boardProjectKey,
  boardRunningSince,
  boardThreadKey,
  buildBoardModel,
  opensFullThread,
  type BoardRow,
  type BoardSearch,
  type BoardThreadInput,
  type BoardUrgency,
  type BoardView,
} from "./board.logic";
import { normalizeBoardUrl, useForkSettings } from "./forkSettings";

// The board's panel has no thread of its own; side panes need a host ref in the shown
// thread's environment, so each environment gets this sentinel thread id.
const BOARD_PANEL_THREAD_ID = ThreadId.make("fork-board-panel");

type ThreadOpener = (thread: BoardThreadInput, full: boolean) => void;

export function BoardPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_chat/board" });
  const { boardUrl } = useForkSettings();
  const webUrl = normalizeBoardUrl(boardUrl);
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const connectedCount = useConnectedEnvironmentIds().length;

  const projectNames = new Map(
    projects.map((project) => [boardProjectKey(project.environmentId, project.id), project.title]),
  );
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId as string, environment.label]),
  );
  const showEnvironment = environments.length > 1;
  const model = buildBoardModel(threads, projectNames);

  const view: BoardView =
    search.boardView === "web" && webUrl === null ? "all" : (search.boardView ?? "all");
  const selectedRef =
    search.boardEnvironmentId !== undefined && search.boardThreadId !== undefined
      ? scopeThreadRef(
          EnvironmentId.make(search.boardEnvironmentId),
          ThreadId.make(search.boardThreadId),
        )
      : null;
  const selectedKey =
    selectedRef === null
      ? null
      : boardThreadKey({ environmentId: selectedRef.environmentId, id: selectedRef.threadId });

  const updateSearch = (patch: Partial<BoardSearch>) =>
    void navigate({ to: "/board", search: (previous) => ({ ...previous, ...patch }) });

  const openFullThread = (ref: ScopedThreadRef) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: ref.environmentId, threadId: ref.threadId },
    });

  const openThread: ThreadOpener = (thread, full) => {
    if (full) {
      openFullThread(scopeThreadRef(thread.environmentId, thread.id));
      return;
    }
    updateSearch({ boardEnvironmentId: thread.environmentId, boardThreadId: thread.id });
  };

  const closePanel = () =>
    updateSearch({ boardEnvironmentId: undefined, boardThreadId: undefined });

  const rowProps = { showEnvironment, environmentLabels, selectedKey, onOpen: openThread };

  const needsMeSection = (
    <BoardSection
      title={gt("Needs me")}
      count={model.needsMe.length}
      empty={gt("Nothing is waiting on you.")}
    >
      {model.needsMe.map((row) => (
        <BoardThreadRow
          key={boardThreadKey(row.thread)}
          row={row}
          {...rowProps}
          leading={<UrgencyDot urgency={row.urgency} />}
          status={<UrgencyBadge urgency={row.urgency} />}
          timestamp={row.thread.updatedAt}
        />
      ))}
    </BoardSection>
  );

  const runningSection = (
    <BoardSection
      title={gt("Running now")}
      count={model.running.length}
      empty={gt("No threads are running.")}
    >
      {model.running.map((row) => (
        <BoardThreadRow
          key={boardThreadKey(row.thread)}
          row={row}
          {...rowProps}
          leading={<Spinner size="sm" tone="muted" />}
          timestamp={boardRunningSince(row.thread)}
        />
      ))}
    </BoardSection>
  );

  const pinnedSection =
    model.pinned.length === 0 ? null : (
      <BoardSection title={gt("Pinned")} count={model.pinned.length} empty={null}>
        {model.pinned.map((row) => (
          <BoardThreadRow
            key={boardThreadKey(row.thread)}
            row={row}
            {...rowProps}
            timestamp={row.thread.updatedAt}
          />
        ))}
      </BoardSection>
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            electron={isElectron}
            reserveNativeControls={selectedRef === null}
            className="relative bg-background"
          >
            <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")}>
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">
                  <T context="page title, board of threads that need the user">Board</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <Badge variant="secondary" size="sm" className="hidden sm:inline-flex">
              {connectedCount === 1
                ? gt("1 environment")
                : gt("{count} environments", { count: connectedCount })}
            </Badge>
            <div className="min-w-0 flex-1" />
            <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
              <ToggleGroup
                aria-label={gt("Board view")}
                value={[view]}
                onValueChange={(next) => {
                  const value = next[0] as BoardView | undefined;
                  if (value === undefined) return;
                  updateSearch({ boardView: value === "all" ? undefined : value });
                }}
              >
                <Toggle value="all">
                  <T context="board filter">All</T>
                </Toggle>
                <Toggle value="needs-me">
                  <T>Needs me</T>
                  <CountBadge count={model.needsMe.length} warn />
                </Toggle>
                <Toggle value="running">
                  <T context="board filter">Running</T>
                  <CountBadge count={model.running.length} />
                </Toggle>
                {webUrl === null ? null : (
                  <Toggle value="web">
                    <T>Web board</T>
                  </Toggle>
                )}
              </ToggleGroup>
              {webUrl === null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hidden md:inline-flex"
                  onClick={() => void navigate({ to: "/settings/labs" })}
                >
                  <T>Add web board</T>
                </Button>
              ) : null}
            </div>
          </WorkspacePageHeader>

          {view === "web" && webUrl !== null ? (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <WebBoardFrame url={webUrl} className="flex-1" />
            </div>
          ) : (
            <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
              <WorkspacePageContainer width="expanded" className="min-h-full gap-6">
                {view !== "running" ? needsMeSection : null}
                {view !== "needs-me" ? runningSection : null}
                {view === "all" ? pinnedSection : null}
                {view === "all" && webUrl !== null ? (
                  <WebBoardFrame url={webUrl} className="h-160 shrink-0" />
                ) : null}
              </WorkspacePageContainer>
            </div>
          )}
        </div>

        {selectedRef !== null ? (
          <BoardThreadPanel
            key={selectedKey}
            threadRef={selectedRef}
            onClose={closePanel}
            onOpenFull={() => openFullThread(selectedRef)}
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}

function CountBadge({ count, warn = false }: { count: number; warn?: boolean }) {
  if (count === 0) return null;
  return (
    <Badge size="sm" variant={warn ? "warning" : "secondary"}>
      {count}
    </Badge>
  );
}

function BoardSection(props: {
  title: string;
  count: number;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 px-3 font-medium text-sm">
        {props.title}
        <span className="text-muted-foreground tabular-nums">{props.count}</span>
      </h2>
      {props.count === 0 ? (
        <p className="px-3 text-muted-foreground text-sm">{props.empty}</p>
      ) : (
        <div className="flex flex-col gap-0.5">{props.children}</div>
      )}
    </section>
  );
}

function BoardThreadRow(props: {
  row: BoardRow;
  showEnvironment: boolean;
  environmentLabels: ReadonlyMap<string, string>;
  selectedKey: string | null;
  onOpen: ThreadOpener;
  leading?: ReactNode;
  status?: ReactNode;
  timestamp: string;
}) {
  const gt = useGT();
  const { thread, projectName } = props.row;
  const selected = props.selectedKey === boardThreadKey(thread);
  const environmentLabel = props.showEnvironment
    ? (props.environmentLabels.get(thread.environmentId) ?? null)
    : null;
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-accent",
      )}
      onClick={(event: MouseEvent) => props.onOpen(thread, opensFullThread(event))}
      onDoubleClick={() => props.onOpen(thread, true)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{props.leading}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-sm">
          {thread.title.trim() === "" ? gt("Untitled thread") : thread.title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          {projectName === null ? null : <span className="truncate">{projectName}</span>}
          {environmentLabel === null ? null : (
            <Badge size="sm" variant="outline" className="shrink-0">
              {environmentLabel}
            </Badge>
          )}
        </span>
      </span>
      {props.status}
      <span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
        <RelativeTime timestamp={props.timestamp} />
      </span>
    </button>
  );
}

function UrgencyDot({ urgency }: { urgency: BoardUrgency }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        urgency === "approval" ? "bg-warning" : urgency === "input" ? "bg-info" : "bg-success",
      )}
    />
  );
}

function UrgencyBadge({ urgency }: { urgency: BoardUrgency }) {
  switch (urgency) {
    case "approval":
      return (
        <Badge variant="warning" className="shrink-0">
          <T>Approval needed</T>
        </Badge>
      );
    case "input":
      return (
        <Badge variant="info" className="shrink-0">
          <T>Input needed</T>
        </Badge>
      );
    case "plan":
      return (
        <Badge variant="success" className="shrink-0">
          <T>Plan ready</T>
        </Badge>
      );
  }
}

function WebBoardFrame({ url, className }: { url: string; className?: string }) {
  const gt = useGT();
  const [reloads, setReloads] = useState(0);
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <h2 className="shrink-0 font-medium text-xs">
          <T>Web board</T>
        </h2>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{url}</span>
        <IconAction label={gt("Reload web board")} onClick={() => setReloads((count) => count + 1)}>
          <RefreshIcon size="sm" refreshing={false} />
        </IconAction>
        <IconAction
          label={gt("Open in browser")}
          onClick={() => void readLocalApi()?.shell.openExternal(url)}
        >
          <ExternalLinkIcon />
        </IconAction>
      </div>
      <iframe
        key={reloads}
        src={url}
        title={gt("Web board")}
        referrerPolicy="no-referrer"
        // oxlint-disable-next-line react/iframe-missing-sandbox -- the board is a page this Mac chose on its own origin; it needs its own storage and API calls
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </section>
  );
}

function IconAction(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={props.label} onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The selected thread beside the board, drawn by the same pane side chats use. */
function BoardThreadPanel(props: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const gt = useGT();
  const { threadRef } = props;
  const shell = useThreadShell(threadRef);
  const [hostRef] = useState(() => scopeThreadRef(threadRef.environmentId, BOARD_PANEL_THREAD_ID));
  // The board has no diff panel or terminal, so those open the thread full screen.
  const parentPanel: SideChatParentPanel = {
    hostRef,
    openToolDiff: props.onOpenFull,
    runShellCommand: props.onOpenFull,
  };
  const [surface] = useState(() => ({
    id: `thread:${threadRef.threadId}` as const,
    kind: "thread" as const,
    threadId: threadRef.threadId,
  }));
  return (
    <PreviewPanelShell
      mode="inline"
      widthStorageKey="t3code:fork:board-panel-width"
      defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
      workspaceLabel={gt("Board thread panel")}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border pr-2 pl-3",
          isElectron && "drag-region",
        )}
      >
        <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
          {shell?.title ?? gt("Thread")}
        </h2>
        <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
          <IconAction label={gt("Open full thread")} onClick={props.onOpenFull}>
            <Maximize2Icon />
          </IconAction>
          <IconAction label={gt("Close thread panel")} onClick={props.onClose}>
            <XIcon />
          </IconAction>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SideThreadPane
          parentRef={hostRef}
          surface={surface}
          parentPanel={parentPanel}
          onClose={props.onClose}
        />
      </div>
    </PreviewPanelShell>
  );
}
