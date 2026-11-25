import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, ChevronRightIcon, ExternalLinkIcon, PlugIcon } from "lucide-react";
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

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
import { isElectron } from "~/env";
import { usePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironments } from "~/state/environments";
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
  type BoardItemPane,
  type BoardItemRow,
  type BoardRow,
  type BoardSearch,
  type BoardThreadInput,
  type BoardTodayRow,
  type BoardUrgency,
  type BoardView,
} from "./board.logic";
import { DeskBadge, ItemTypeBadge, NotReadyBadge, WhenBadge } from "./boardBadges";
import { useBoardData, type BoardDataHandle } from "./boardData";
import { BoardItemDetailPanel } from "./BoardItemDetailPanel";
import { useLeaveBoard } from "./boardNavigation";
import { BoardThreadPanel, IconAction } from "./boardPanels";
import { normalizeBoardUrl, useForkSettings } from "./forkSettings";

type ThreadOpener = (thread: BoardThreadInput, full: boolean) => void;

const NO_SELECTION: Partial<BoardSearch> = {
  boardItem: undefined,
  boardPane: undefined,
  boardEnvironmentId: undefined,
  boardThreadId: undefined,
};

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

  const data = board.data;
  const deskColors = boardDeskColors(data);
  const deskCounts = boardDeskCounts(data);
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
  const items = rankBoardItems(data, filterDesk?.slug ?? null);
  const today = collectBoardToday(data, filterDesk?.slug ?? null);
  const readyItemCount = items.ranked.filter((row) => row.item.banner === null).length;
  const needsMeCount = model.needsMe.length + readyItemCount;
  const markdownEnvironmentId = connectedIds[0] ?? null;

  const view: BoardView =
    search.boardView === "web" && webUrl === null ? "all" : (search.boardView ?? "all");

  const selectedRef =
    search.boardEnvironmentId !== undefined && search.boardThreadId !== undefined
      ? scopeThreadRef(
          EnvironmentId.make(search.boardEnvironmentId),
          ThreadId.make(search.boardThreadId),
        )
      : null;
  const selectedThreadKey =
    selectedRef === null
      ? null
      : boardThreadKey({ environmentId: selectedRef.environmentId, id: selectedRef.threadId });
  const selectedItemKey = selectedRef === null ? (search.boardItem ?? null) : null;
  const selectedItem = selectedItemKey === null ? null : findBoardItem(data, selectedItemKey);
  const selectedDeskThread =
    selectedItem === null ? null : findDeskThreadRef(selectedItem.desk, projects, threads);
  const selectedDeskThreadRef =
    selectedDeskThread === null
      ? null
      : scopeThreadRef(
          EnvironmentId.make(selectedDeskThread.environmentId),
          ThreadId.make(selectedDeskThread.threadId),
        );

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
    updateSearch({
      ...NO_SELECTION,
      boardEnvironmentId: thread.environmentId,
      boardThreadId: thread.id,
    });
  };

  const openItem = (key: string) => updateSearch({ ...NO_SELECTION, boardItem: key });
  const closePanel = () => updateSearch(NO_SELECTION);

  const rowProps = {
    showEnvironment,
    environmentLabels,
    selectedKey: selectedThreadKey,
    onOpen: openThread,
  };

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
        <BoardItemListRow
          key={row.key}
          row={row}
          color={deskColors.get(row.desk.slug)}
          showDesk={filterDesk === null}
          selected={row.key === selectedItemKey}
          onOpen={() => openItem(row.key)}
        />
      ))}
      {items.later.length === 0 ? null : (
        <LaterItems
          rows={items.later}
          deskColors={deskColors}
          showDesk={filterDesk === null}
          selectedKey={selectedItemKey}
          onOpen={openItem}
        />
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
            environmentId={markdownEnvironmentId}
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

  const panelOpen = selectedRef !== null || selectedItemKey !== null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
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
            <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")}>
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">
                  <T context="page title, board of threads that need the user">Board</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <Badge variant="secondary" size="sm" className="hidden shrink-0 lg:inline-flex">
              {connectedIds.length === 1
                ? gt("1 environment")
                : gt("{count} environments", { count: connectedIds.length })}
            </Badge>
            <BoardSyncStatus
              board={board}
              onConnect={() => void navigate({ to: "/settings/labs" })}
            />
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
                {webUrl === null ? null : (
                  <Toggle value="web">
                    <T context="board filter, the bot board's own web page">Web</T>
                  </Toggle>
                )}
              </ToggleGroup>
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
              </WorkspacePageContainer>
            </div>
          )}
        </div>

        {selectedRef !== null ? (
          <BoardThreadPanel
            key={selectedThreadKey}
            threadRef={selectedRef}
            onClose={closePanel}
            onOpenFull={() => openFullThread(selectedRef)}
          />
        ) : selectedItemKey !== null ? (
          <BoardItemDetailPanel
            itemKey={selectedItemKey}
            row={selectedItem}
            data={data}
            deskColor={selectedItem ? deskColors.get(selectedItem.desk.slug) : undefined}
            deskThreadRef={selectedDeskThreadRef}
            pane={search.boardPane ?? "details"}
            markdownEnvironmentId={markdownEnvironmentId}
            onPaneChange={(pane: BoardItemPane) =>
              updateSearch({ boardPane: pane === "chat" ? "chat" : undefined })
            }
            onSelectItem={openItem}
            onOpenThread={openFullThread}
            onClose={closePanel}
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

/** Where the bot board stands: not set up, loading, failing, or when it was last built. */
function BoardSyncStatus(props: { board: BoardDataHandle; onConnect: () => void }) {
  const gt = useGT();
  const { board } = props;
  if (board.source === null) {
    return (
      <Button
        size="xs"
        variant="outline"
        className="hidden shrink-0 sm:inline-flex [-webkit-app-region:no-drag]"
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
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              size="sm"
              variant={failing ? "warning" : "secondary"}
              className="hidden max-w-56 sm:inline-flex"
            />
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

function BoardItemListRow(props: {
  row: BoardItemRow;
  color: string | undefined;
  showDesk: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const { item, desk } = props.row;
  return (
    <button
      type="button"
      aria-current={props.selected || undefined}
      className={cn(ROW_CLASS, props.selected && "bg-accent", item.banner !== null && "opacity-75")}
      onClick={props.onOpen}
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
  );
}

function LaterItems(props: {
  rows: ReadonlyArray<BoardItemRow>;
  deskColors: ReadonlyMap<string, string>;
  showDesk: boolean;
  selectedKey: string | null;
  onOpen: (key: string) => void;
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
        ? props.rows.map((row) => (
            <BoardItemListRow
              key={row.key}
              row={row}
              color={props.deskColors.get(row.desk.slug)}
              showDesk={props.showDesk}
              selected={row.key === props.selectedKey}
              onOpen={() => props.onOpen(row.key)}
            />
          ))
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
