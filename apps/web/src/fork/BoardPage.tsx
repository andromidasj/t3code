import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MessageSquareIcon,
  PlugIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { PanelLayoutControls } from "~/components/chat/PanelLayoutControls";
import ChatMarkdown from "~/components/ChatMarkdown";
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
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { usePrimarySettings } from "~/hooks/useSettings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { usePanelAnimationSettings, usePanelPresence } from "~/panelAnimations";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironments } from "~/state/environments";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { formatShortTimestamp } from "~/timestampFormat";

import {
  boardDeskColors,
  boardDeskCounts,
  boardProjectKey,
  boardRunningSince,
  boardThreadKey,
  buildBoardModel,
  collectBoardToday,
  deskProjectKeys,
  findBoardItem,
  findDeskThreadRef,
  opensFullThread,
  plainBoardText,
  rankBoardItems,
  rewriteBoardThreadLinks,
  type BoardItemRow,
  type BoardRow,
  type BoardSearch,
  type BoardThreadInput,
  type BoardThreadRef,
  type BoardTodayRow,
  type BoardUrgency,
  type BoardView,
} from "./board.logic";
import { DeskBadge, ItemTypeBadge, NotReadyBadge, WhenBadge } from "./boardBadges";
import { useBoardData, type BoardDataHandle } from "./boardData";
import {
  BoardJobsCountBadge,
  BoardScheduledJobsSection,
  useBoardScheduledJobs,
} from "./BoardScheduledJobsSection";
import { BoardItemDetailPanel } from "./BoardItemDetailPanel";
import { useLeaveBoard } from "./boardNavigation";
import {
  BOARD_CHAT_TAB,
  BOARD_DETAILS_TAB,
  BOARD_THREAD_TAB,
  boardOverlayOpen,
  boardPanelShortcutAction,
  shouldEscapeCloseBoardPanel,
  type BoardPanelSelection,
} from "./boardPanel.logic";
import {
  BoardRightPanel,
  BoardSideThread,
  IconAction,
  boardPanelHostRef,
  boardShortcutContext,
  useBoardPanelModel,
} from "./boardPanels";
import {
  closeBoardPanel,
  openBoardPanel,
  reopenBoardPanel,
  useBoardPanelStore,
} from "./boardPanelStore";
import { normalizeBoardUrl, useForkSettings } from "./forkSettings";

type ThreadOpener = (thread: BoardThreadInput, full: boolean) => void;

export function BoardPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const leaveBoard = useLeaveBoard();
  const search = useSearch({ from: "/_chat/board" });
  const { boardUrl } = useForkSettings();
  const board = useBoardData(boardUrl);
  const webUrl = normalizeBoardUrl(boardUrl);
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const connectedIds = useConnectedEnvironmentIds();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const panel = useBoardPanelStore();

  const data = board.data;
  const deskColors = boardDeskColors(data);
  const deskCounts = boardDeskCounts(data);
  const deskThreads = new Map(
    (data?.desks ?? []).map((desk) => [desk.slug, findDeskThreadRef(desk, projects, threads)]),
  );
  const filterDesk =
    search.boardDesk === undefined
      ? null
      : (data?.desks.find((desk) => desk.slug === search.boardDesk) ?? null);
  const filterProjectKeys = filterDesk === null ? null : deskProjectKeys(filterDesk, projects);
  const listedThreads =
    filterProjectKeys === null
      ? threads
      : threads.filter((thread) =>
          filterProjectKeys.has(boardProjectKey(thread.environmentId, thread.projectId)),
        );

  const projectNames = new Map(
    projects.map((project) => [boardProjectKey(project.environmentId, project.id), project.title]),
  );
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId as string, environment.label]),
  );
  const showEnvironment = environments.length > 1;
  const model = buildBoardModel(listedThreads, projectNames);
  const jobs = useBoardScheduledJobs(connectedIds, projectNames, filterProjectKeys);
  const items = rankBoardItems(data, filterDesk?.slug ?? null);
  const today = collectBoardToday(data, filterDesk?.slug ?? null);
  const readyItemCount = items.ranked.filter((row) => row.item.banner === null).length;
  const needsMeCount = model.needsMe.length + readyItemCount;
  const primaryConnectedId = connectedIds[0] ?? null;

  const view: BoardView =
    search.boardView === "web" && webUrl === null ? "all" : (search.boardView ?? "all");

  // The panel: the selection, the environment its tabs live in, and its tabs.
  const selection = panel.selection;
  const selectedThreadKey =
    selection?.kind === "thread"
      ? boardThreadKey({
          environmentId: EnvironmentId.make(selection.environmentId),
          id: ThreadId.make(selection.threadId),
        })
      : null;
  const selectedItemKey = selection?.kind === "item" ? selection.key : null;
  const selectedItem = selectedItemKey === null ? null : findBoardItem(data, selectedItemKey);
  const selectedDeskThread =
    selectedItem === null ? null : (deskThreads.get(selectedItem.desk.slug) ?? null);
  const hostEnvironmentFor = (target: BoardPanelSelection): string | null => {
    if (target.kind === "thread") return target.environmentId;
    if (target.kind === "item") {
      const found = findBoardItem(data, target.key);
      const deskThread = found === null ? null : (deskThreads.get(found.desk.slug) ?? null);
      if (deskThread !== null) return deskThread.environmentId;
    }
    return primaryConnectedId;
  };
  const hostRefFor = (target: BoardPanelSelection) => {
    const environmentId = hostEnvironmentFor(target);
    return environmentId === null ? null : boardPanelHostRef(environmentId, target);
  };
  const hostRef = selection === null ? null : hostRefFor(selection);
  const linksRef = hostRefFor(BOARD_LINKS_SELECTION);
  const panelModel = useBoardPanelModel(
    selection ?? BOARD_LINKS_SELECTION,
    hostRef,
    selectedDeskThread !== null,
  );
  // A Today selection whose pull request tabs were all closed has nothing left to show.
  const panelAvailable = selection !== null && panelModel.tabIds.length > 0;
  const panelOpen = panel.open && panelAvailable;
  const { active: panelAnimationsActive, durationMs } = usePanelAnimationSettings();
  const presence = usePanelPresence(
    panelOpen,
    selection,
    panelAnimationsActive,
    "board",
    durationMs,
  );

  const updateSearch = (patch: Partial<BoardSearch>) =>
    void navigate({ to: "/board", search: (previous) => ({ ...previous, ...patch }) });

  const openFullThread = (ref: BoardThreadRef) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: EnvironmentId.make(ref.environmentId),
        threadId: ThreadId.make(ref.threadId),
      },
    });

  // A pick from the list starts on the selection's first tab.
  const openSelection = (target: BoardPanelSelection, tabId: string) => {
    const ref = hostRefFor(target);
    const revision =
      ref === null
        ? 0
        : (useRightPanelStore.getState().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0);
    openBoardPanel(target, { tabId, revision });
  };

  const openThread: ThreadOpener = (thread, full) => {
    if (full) {
      openFullThread({ environmentId: thread.environmentId, threadId: thread.id });
      return;
    }
    openSelection(
      { kind: "thread", environmentId: thread.environmentId, threadId: thread.id },
      BOARD_THREAD_TAB,
    );
  };

  const openItem = (key: string) => openSelection({ kind: "item", key }, BOARD_DETAILS_TAB);
  const deskOpener = (row: BoardItemRow) => {
    const ref = deskThreads.get(row.desk.slug) ?? null;
    return ref === null ? null : () => openFullThread(ref);
  };

  const togglePanel = () => {
    if (panelOpen) closeBoardPanel();
    else reopenBoardPanel();
  };

  const onPanelKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isCommandPaletteOpen()) return;
    if (
      panelOpen &&
      shouldEscapeCloseBoardPanel(
        event,
        event.target instanceof Element ? event.target : null,
        boardOverlayOpen(document),
      )
    ) {
      event.preventDefault();
      closeBoardPanel();
      return;
    }
    if (event.defaultPrevented) return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: { ...boardShortcutContext(), rightPanelOpen: panelOpen },
    });
    const action = boardPanelShortcutAction(command, {
      open: panelOpen,
      canOpen: panelAvailable,
      tabIds: panelModel.tabIds,
      activeId: panelModel.activeTabId,
    });
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (action.type === "toggle") togglePanel();
    else if (action.type === "activate") panelModel.activate(action.tabId);
    else if (panelModel.pullRequests.some((surface) => surface.id === panelModel.activeTabId)) {
      // Like the Issues page, closing takes the pull request tab first.
      panelModel.closePullRequest(panelModel.activeTabId ?? "");
    } else closeBoardPanel();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the document right panel shortcuts and Escape while the Board is shown
  useEffect(() => {
    document.addEventListener("keydown", onPanelKeyDown);
    return () => document.removeEventListener("keydown", onPanelKeyDown);
  }, []);

  // A pull request link in Today opens in the panel's Today entry; show it there.
  const onLinksAction = useEffectEvent(() => {
    const state =
      linksRef === null
        ? null
        : selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, linksRef);
    if (state === null || state.activeSurfaceId === null) return;
    openBoardPanel(BOARD_LINKS_SELECTION);
  });
  const linksKey = linksRef === null ? null : scopedThreadKey(linksRef);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the right panel store so a pull request opened from Today shows in the Board's panel
  useEffect(() => {
    if (linksKey === null) return;
    return useRightPanelStore.subscribe((state, previous) => {
      if (
        state.userActionRevisionByThreadKey[linksKey] !==
        previous.userActionRevisionByThreadKey[linksKey]
      ) {
        onLinksAction();
      }
    });
  }, [linksKey]);

  const rowProps = {
    showEnvironment,
    environmentLabels,
    selectedKey: panelOpen ? selectedThreadKey : null,
    onOpen: openThread,
  };
  const activeItemKey = panelOpen ? selectedItemKey : null;
  const itemRowProps = (row: BoardItemRow) => ({
    row,
    color: deskColors.get(row.desk.slug),
    showDesk: filterDesk === null,
    selected: row.key === activeItemKey,
    onOpen: () => openItem(row.key),
    onOpenDesk: deskOpener(row),
  });

  const needsMeSection = (
    <BoardSection
      title={gt("Needs me")}
      count={needsMeCount}
      empty={
        model.needsMe.length + items.ranked.length + items.later.length === 0
          ? gt("Nothing is waiting on you.")
          : null
      }
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
      {items.ranked.map((row) => (
        <BoardItemListRow key={row.key} {...itemRowProps(row)} />
      ))}
      {items.later.length === 0 ? null : (
        <LaterItems rows={items.later} selectedKey={activeItemKey} rowProps={itemRowProps} />
      )}
    </BoardSection>
  );

  const runningSection = (
    <BoardSection
      title={gt("Running now")}
      count={model.running.length}
      empty={model.running.length === 0 ? gt("No threads are running.") : null}
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

  const todaySection =
    board.source === null ? null : (
      <BoardSection
        title={gt("Today", { $context: "board section, what the bots did today" })}
        count={today.length}
        empty={today.length === 0 ? gt("Nothing logged today yet.") : null}
      >
        {today.map((row) => (
          <TodayRow
            key={row.key}
            row={row}
            color={deskColors.get(row.desk.slug)}
            showDesk={filterDesk === null}
            time={formatShortTimestamp(row.event.t, timestampFormat)}
            environmentId={primaryConnectedId}
            panelRef={linksRef}
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
        <div className="@container/board flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            electron={isElectron}
            reserveNativeControls={!panelOpen}
            className="relative bg-background"
          >
            <Button
              size="sm"
              variant="ghost"
              className="-ml-1.5 shrink-0 [-webkit-app-region:no-drag]"
              onClick={() => void leaveBoard()}
            >
              <ArrowLeftIcon />
              <T context="leaves the board for the last open thread">Back</T>
            </Button>
            <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")} className="shrink-0">
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">
                  <T context="page title, board of threads that need the user">Board</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <Badge variant="secondary" size="sm" className="hidden shrink-0 @4xl/board:inline-flex">
              {connectedIds.length === 1
                ? gt("1 environment")
                : gt("{count} environments", { count: connectedIds.length })}
            </Badge>
            <BoardSyncStatus
              board={board}
              onConnect={() => void navigate({ to: "/settings/labs" })}
            />
            <div className="min-w-0 flex-1" />
            <div
              className="flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag]"
              data-workspace-titlebar-controls
            >
              {/* The views scroll when the panel narrows the header; the panel toggle stays put. */}
              <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
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
                    <CountBadge count={needsMeCount} warn={model.needsMe.length > 0} />
                  </Toggle>
                  <Toggle value="running">
                    <T context="board filter">Running</T>
                    <CountBadge count={model.running.length} />
                  </Toggle>
                  {board.source === null ? null : (
                    <Toggle value="today">
                      <T context="board filter, what the bots did today">Today</T>
                      <CountBadge count={today.length} />
                    </Toggle>
                  )}
                  {jobs.total === 0 && view !== "jobs" ? null : (
                    <Toggle value="jobs">
                      <T context="board filter, scheduled tasks">Jobs</T>
                      <BoardJobsCountBadge rows={jobs.rows} />
                    </Toggle>
                  )}
                  {webUrl === null ? null : (
                    <Toggle value="web">
                      <T context="board filter, the bot board's own web page">Web</T>
                    </Toggle>
                  )}
                </ToggleGroup>
              </div>
              <PanelLayoutControls
                showTerminalControl={false}
                showThreadPanelControl={false}
                terminalAvailable={false}
                terminalOpen={false}
                terminalShortcutLabel={null}
                threadPanelOpen={false}
                threadPanelPresentation="inline"
                threadPanelShortcutLabel={null}
                onToggleThreadPanel={() => undefined}
                rightPanelAvailable={panelAvailable}
                rightPanelOpen={panelOpen}
                rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
                rightPanelUnavailableLabel={gt("Select an item or thread first")}
                onToggleTerminal={() => undefined}
                onToggleRightPanel={togglePanel}
              />
            </div>
          </WorkspacePageHeader>

          {view === "web" && webUrl !== null ? (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <WebBoardFrame url={webUrl} className="flex-1" />
            </div>
          ) : (
            <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
              <WorkspacePageContainer width="expanded" className="min-h-full gap-6">
                {deskCounts.length > 1 ? (
                  <ToggleGroup
                    aria-label={gt("Filter by bot")}
                    variant="default"
                    size="xs"
                    className="mx-2 flex-wrap"
                    value={[filterDesk?.slug ?? "all"]}
                    onValueChange={(next) => {
                      const value = next[0];
                      if (value === undefined) return;
                      updateSearch({ boardDesk: value === "all" ? undefined : value });
                    }}
                  >
                    <Toggle value="all" variant="pill">
                      <T context="board filter for every bot's items">All bots</T>
                    </Toggle>
                    {deskCounts.map(({ desk, count }) => (
                      <Toggle key={desk.slug} value={desk.slug} variant="pill">
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ background: deskColors.get(desk.slug) }}
                        />
                        {desk.name}
                        <span className="text-muted-foreground tabular-nums">{count}</span>
                      </Toggle>
                    ))}
                  </ToggleGroup>
                ) : null}
                {view === "all" || view === "needs-me" ? needsMeSection : null}
                {view === "all" || view === "running" ? runningSection : null}
                {view === "all" || view === "today" ? todaySection : null}
                {view === "all" ? pinnedSection : null}
                {view === "all" || view === "jobs" ? (
                  <BoardScheduledJobsSection rows={jobs.rows} collapsible={view === "all"} />
                ) : null}
              </WorkspacePageContainer>
            </div>
          )}
        </div>

        {presence.present && selection !== null ? (
          <BoardRightPanel
            model={panelModel}
            open={panelOpen}
            labels={{
              [BOARD_DETAILS_TAB]: {
                title: gt("Details", { $context: "board item panel tab" }),
                ...(selectedItem === null
                  ? {}
                  : { tooltip: plainBoardText(selectedItem.item.ask) }),
                icon: <FileTextIcon />,
              },
              [BOARD_CHAT_TAB]: {
                title: gt("Bot chat", { $context: "board item panel tab, the desk bot's thread" }),
                ...(selectedItem === null
                  ? {}
                  : { tooltip: gt("{desk}'s thread", { desk: selectedItem.desk.name }) }),
                icon: <MessageSquareIcon />,
              },
              [BOARD_THREAD_TAB]: {
                title: selectedThreadTitle(selection, threads) ?? gt("Thread"),
                icon: <MessageSquareIcon />,
              },
            }}
            actions={
              <>
                {selection.kind === "thread" ||
                (panelModel.activeTabId === BOARD_CHAT_TAB && selectedDeskThread !== null) ? (
                  <IconAction
                    label={gt("Open full thread")}
                    onClick={() => {
                      if (selection.kind === "thread") openFullThread(selection);
                      else if (selectedDeskThread !== null) openFullThread(selectedDeskThread);
                    }}
                  >
                    <ArrowUpRightIcon />
                  </IconAction>
                ) : null}
                <IconAction label={gt("Close panel")} onClick={closeBoardPanel}>
                  <XIcon />
                </IconAction>
              </>
            }
            renderTab={(tabId) => {
              if (tabId === BOARD_THREAD_TAB && selection.kind === "thread" && hostRef !== null) {
                return (
                  <BoardSideThread
                    hostRef={hostRef}
                    threadId={selection.threadId}
                    onClose={closeBoardPanel}
                    onOpenFull={() => openFullThread(selection)}
                  />
                );
              }
              if (tabId === BOARD_CHAT_TAB && selectedDeskThread !== null && hostRef !== null) {
                return (
                  <BoardSideThread
                    hostRef={hostRef}
                    threadId={selectedDeskThread.threadId}
                    onClose={() => panelModel.activate(BOARD_DETAILS_TAB)}
                    onOpenFull={() => openFullThread(selectedDeskThread)}
                  />
                );
              }
              if (tabId === BOARD_DETAILS_TAB && selectedItemKey !== null) {
                return (
                  <BoardItemDetailPanel
                    itemKey={selectedItemKey}
                    row={selectedItem}
                    data={data}
                    deskColor={selectedItem ? deskColors.get(selectedItem.desk.slug) : undefined}
                    onOpenDesk={
                      selectedDeskThread === null ? null : () => openFullThread(selectedDeskThread)
                    }
                    markdownEnvironmentId={hostRef?.environmentId ?? null}
                    panelRef={hostRef}
                    onSelectItem={openItem}
                  />
                );
              }
              return null;
            }}
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}

const BOARD_LINKS_SELECTION: BoardPanelSelection = { kind: "links" };

function selectedThreadTitle(
  selection: BoardPanelSelection,
  threads: ReadonlyArray<BoardThreadInput>,
): string | null {
  if (selection.kind !== "thread") return null;
  const thread = threads.find(
    (candidate) =>
      candidate.environmentId === selection.environmentId && candidate.id === selection.threadId,
  );
  const title = thread?.title.trim() ?? "";
  return title === "" ? null : title;
}

function CountBadge({ count, warn = false }: { count: number; warn?: boolean }) {
  if (count === 0) return null;
  return (
    <Badge size="sm" variant={warn ? "warning" : "secondary"}>
      {count}
    </Badge>
  );
}

/** Where the bot board stands: not set up, loading, failing, or when it was last built. */
function BoardSyncStatus(props: { board: BoardDataHandle; onConnect: () => void }) {
  const gt = useGT();
  const { board } = props;
  if (board.source === null) {
    return (
      <Button
        size="xs"
        variant="outline"
        className="hidden shrink-0 @xl/board:inline-flex [-webkit-app-region:no-drag]"
        onClick={props.onConnect}
      >
        <PlugIcon />
        <T context="opens settings to point the board at a bot board">Connect Board</T>
      </Button>
    );
  }
  const failing = board.error !== null;
  const details = [
    board.error,
    board.data?.built
      ? gt("Built {when}", { when: new Date(board.data.built).toLocaleString() })
      : null,
    board.resolvedUrl,
  ]
    .filter((line): line is string => line !== null && line !== "")
    .join("\n");
  // Hidden when the panel leaves the header too narrow for it, as the view toggles matter more.
  return (
    <div className="hidden shrink-0 items-center gap-0.5 @2xl/board:flex [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge size="sm" variant={failing ? "warning" : "secondary"} className="max-w-56" />
          }
        >
          <span className="truncate">
            {board.data === null ? (
              board.loading ? (
                <T context="board data status">Loading board…</T>
              ) : (
                <T context="board data status">Board unavailable</T>
              )
            ) : board.data.built ? (
              <>
                {failing ? (
                  <T context="board data status, followed by when it was last built">
                    Stale, built
                  </T>
                ) : (
                  <T context="board data status, followed by when it was last built">Updated</T>
                )}{" "}
                <RelativeTime timestamp={board.data.built} />
              </>
            ) : (
              <T context="board data status">Board loaded</T>
            )}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom" className="max-w-96 whitespace-pre-wrap break-all">
          {details || gt("Bot board")}
        </TooltipPopup>
      </Tooltip>
      <IconAction label={gt("Refresh bot board")} onClick={board.refresh}>
        <RefreshIcon size="sm" refreshing={board.loading} />
      </IconAction>
    </div>
  );
}

function BoardSection(props: {
  title: string;
  count: number;
  /** Shown instead of the rows; null when there are rows. */
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 px-3 font-medium text-sm">
        {props.title}
        <span className="text-muted-foreground tabular-nums">{props.count}</span>
      </h2>
      {props.empty !== null ? (
        <p className="px-3 text-muted-foreground text-sm">{props.empty}</p>
      ) : (
        <div className="flex flex-col gap-0.5">{props.children}</div>
      )}
    </section>
  );
}

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

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
      className={cn(ROW_CLASS, selected && "bg-accent")}
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

interface BoardItemListRowProps {
  row: BoardItemRow;
  color: string | undefined;
  showDesk: boolean;
  selected: boolean;
  onOpen: () => void;
  /** Opens the desk's bot thread full screen; null when the desk has no thread here. */
  onOpenDesk: (() => void) | null;
}

function BoardItemListRow(props: BoardItemListRowProps) {
  const gt = useGT();
  const { item, desk } = props.row;
  const { onOpenDesk } = props;
  return (
    <div
      className={cn(
        "group/row flex min-w-0 items-center rounded-md hover:bg-accent",
        props.selected && "bg-accent",
      )}
    >
      <button
        type="button"
        aria-current={props.selected || undefined}
        className={cn(
          ROW_CLASS,
          "hover:bg-transparent",
          item.banner !== null && "opacity-75",
          onOpenDesk !== null && "pr-1",
        )}
        onClick={(event: MouseEvent) => {
          if (onOpenDesk !== null && opensFullThread(event)) onOpenDesk();
          else props.onOpen();
        }}
        onDoubleClick={onOpenDesk ?? undefined}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: props.color } as CSSProperties}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium text-sm">{plainBoardText(item.ask)}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            {props.showDesk ? <DeskBadge desk={desk} color={props.color} /> : null}
            <ItemTypeBadge type={item.type} />
            <span className="truncate font-mono">{item.id}</span>
          </span>
        </span>
        {item.banner === null ? null : <NotReadyBadge />}
        <WhenBadge when={item.when} />
        <span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {item.checked === null ? null : <RelativeTime timestamp={item.checked} />}
        </span>
      </button>
      {onOpenDesk === null ? null : (
        <span className="mr-2 flex shrink-0 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
          <IconAction label={gt("Open in {desk}", { desk: desk.name })} onClick={onOpenDesk}>
            <ArrowUpRightIcon />
          </IconAction>
        </span>
      )}
    </div>
  );
}

function LaterItems(props: {
  rows: ReadonlyArray<BoardItemRow>;
  selectedKey: string | null;
  rowProps: (row: BoardItemRow) => BoardItemListRowProps;
}) {
  const gt = useGT();
  const holdsSelection = props.rows.some((row) => row.key === props.selectedKey);
  const [open, setOpen] = useState(false);
  const expanded = open || holdsSelection;
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        className={cn(ROW_CLASS, "py-1.5 text-muted-foreground text-xs")}
        onClick={() => setOpen(!expanded)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </span>
        <span>{gt("{count} later", { count: props.rows.length })}</span>
      </button>
      {expanded
        ? props.rows.map((row) => <BoardItemListRow key={row.key} {...props.rowProps(row)} />)
        : null}
    </>
  );
}

function TodayRow(props: {
  row: BoardTodayRow;
  color: string | undefined;
  showDesk: boolean;
  time: string;
  environmentId: EnvironmentId | null;
  /** The Board panel's entry that pull request links open in. */
  panelRef: ScopedThreadRef | null;
}) {
  const { row } = props;
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md px-3 py-1.5 text-sm">
      <span className="w-16 shrink-0 pt-px text-muted-foreground text-xs tabular-nums">
        {props.time}
      </span>
      {props.showDesk ? <DeskBadge desk={row.desk} color={props.color} className="mt-px" /> : null}
      <div className="min-w-0 flex-1 leading-snug">
        <ChatMarkdown
          inline
          text={rewriteBoardThreadLinks(row.event.text)}
          cwd={undefined}
          environmentId={props.environmentId ?? undefined}
          pullRequestPanelRef={props.panelRef ?? undefined}
        />
      </div>
    </div>
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
          <T context="a live thread waits on the user's approval">Live approval</T>
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
