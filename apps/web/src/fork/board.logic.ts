import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isListedThreadLineage } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";

import type { BoardData, BoardDesk, BoardItem, BoardTodayEvent } from "./boardData";

export type BoardThreadInput = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
  | "lineage"
  | "archivedAt"
  | "deletedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "hasActionableProposedPlan"
  | "runtime"
  | "updatedAt"
  | "pinnedAt"
>;

/** Why a thread waits on the user, most urgent first. */
export type BoardUrgency = "approval" | "input" | "plan";

const URGENCY_RANK: Record<BoardUrgency, number> = { approval: 0, input: 1, plan: 2 };

export interface BoardRow<T extends BoardThreadInput = BoardThreadInput> {
  readonly thread: T;
  readonly projectName: string | null;
}

export interface NeedsMeRow<T extends BoardThreadInput = BoardThreadInput> extends BoardRow<T> {
  readonly urgency: BoardUrgency;
}

export interface BoardModel<T extends BoardThreadInput = BoardThreadInput> {
  readonly needsMe: ReadonlyArray<NeedsMeRow<T>>;
  readonly running: ReadonlyArray<BoardRow<T>>;
  readonly pinned: ReadonlyArray<BoardRow<T>>;
  readonly needsMeCount: number;
}

export const boardProjectKey = (environmentId: string, projectId: string) =>
  `${environmentId}\u0000${projectId}`;

export const boardThreadKey = (thread: Pick<BoardThreadInput, "environmentId" | "id">) =>
  `${thread.environmentId}\u0000${thread.id}`;

/** Threads the sidebar would list: live, unarchived, and not a subagent, side chat or workflow step. */
function isBoardCandidate(thread: BoardThreadInput): boolean {
  return (
    thread.archivedAt === null && thread.deletedAt === null && isListedThreadLineage(thread.lineage)
  );
}

/**
 * A parent shows its subagent's open request the way the sidebar does. A proposed plan counts
 * only once the thread stops working; until then it may still change.
 */
function resolveBoardUrgency(thread: BoardThreadInput): BoardUrgency | null {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") return "approval";
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") return "input";
  if (thread.hasActionableProposedPlan && !threadRuntimeIsActive(thread.runtime)) return "plan";
  return null;
}

const timestamp = (iso: string | null | undefined) => {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
};

/** When the running thread's current activity began, falling back to its last update. */
export function boardRunningSince(thread: BoardThreadInput): string {
  return thread.runtime?.activityStartedAt ?? thread.updatedAt;
}

export function buildBoardModel<T extends BoardThreadInput>(
  threads: ReadonlyArray<T>,
  projectNames: ReadonlyMap<string, string>,
): BoardModel<T> {
  const needsMe: NeedsMeRow<T>[] = [];
  const running: BoardRow<T>[] = [];
  const pinned: BoardRow<T>[] = [];
  for (const thread of threads) {
    if (!isBoardCandidate(thread)) continue;
    const projectName =
      projectNames.get(boardProjectKey(thread.environmentId, thread.projectId)) ?? null;
    const urgency = resolveBoardUrgency(thread);
    if (urgency !== null) needsMe.push({ thread, projectName, urgency });
    else if (threadRuntimeIsActive(thread.runtime)) running.push({ thread, projectName });
    if (thread.pinnedAt !== null) pinned.push({ thread, projectName });
  }
  needsMe.sort(
    (a, b) =>
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
      timestamp(b.thread.updatedAt) - timestamp(a.thread.updatedAt),
  );
  running.sort(
    (a, b) =>
      timestamp(boardRunningSince(b.thread)) - timestamp(boardRunningSince(a.thread)) ||
      timestamp(b.thread.updatedAt) - timestamp(a.thread.updatedAt),
  );
  pinned.sort((a, b) => timestamp(b.thread.pinnedAt) - timestamp(a.thread.pinnedAt));
  return { needsMe, running, pinned, needsMeCount: needsMe.length };
}

/** The number the sidebar's Board button shows, without building the rows. */
export function countNeedsMe(threads: ReadonlyArray<BoardThreadInput>): number {
  let count = 0;
  for (const thread of threads) {
    if (isBoardCandidate(thread) && resolveBoardUrgency(thread) !== null) count += 1;
  }
  return count;
}

export type BoardView = "all" | "needs-me" | "running" | "today" | "jobs" | "web";

/**
 * The board's URL state: its view and desk filter. Keys carry a `board` prefix because the router
 * merges every route's search into one type for `navigate`. The right panel's selection is
 * session state (boardPanelStore), so opening and closing it adds no history entries.
 */
export interface BoardSearch {
  readonly boardView?: BoardView | undefined;
  readonly boardDesk?: string | undefined;
}

const BOARD_VIEWS: ReadonlySet<string> = new Set<BoardView>([
  "all",
  "needs-me",
  "running",
  "today",
  "jobs",
  "web",
]);

const boundedId = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export function boardSearchFromUrl(search: Record<string, unknown>): BoardSearch {
  const view =
    typeof search.boardView === "string" && BOARD_VIEWS.has(search.boardView)
      ? (search.boardView as BoardView)
      : undefined;
  const desk = boundedId(search.boardDesk);
  return {
    ...(view === undefined || view === "all" ? {} : { boardView: view }),
    ...(desk === undefined ? {} : { boardDesk: desk }),
  };
}

/** Whether a click on a board row should open the thread full screen instead of beside the board. */
export function opensFullThread(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}

/** A Board item's key in the URL and in lists: `<desk slug>/<item id>`. */
export const boardItemKey = (deskSlug: string, itemId: string) => `${deskSlug}/${itemId}`;

export function parseBoardItemKey(key: string): { deskSlug: string; itemId: string } | null {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return null;
  return { deskSlug: key.slice(0, slash), itemId: key.slice(slash + 1) };
}

export interface BoardItemRow {
  readonly key: string;
  readonly desk: BoardDesk;
  readonly item: BoardItem;
}

export interface BoardItemLists {
  /** What Josh can act on now (not later, no banner), best next step first. */
  readonly ready: ReadonlyArray<BoardItemRow>;
  /** Items with a banner: open, but nothing for Josh to do yet. */
  readonly notReady: ReadonlyArray<BoardItemRow>;
  /** `when: later` items, folded away below the rest. */
  readonly later: ReadonlyArray<BoardItemRow>;
}

const WHEN_RANK: Readonly<Record<string, number>> = { now: 0, anytime: 1 };

const isBoardItemLater = (item: Pick<BoardItem, "when">) => item.when === "later";

/** Something Josh can act on now: not parked for later and not marked not ready. */
const isBoardItemReady = (item: Pick<BoardItem, "when" | "banner">) =>
  !isBoardItemLater(item) && item.banner === null;

const deskVisible = (desk: BoardDesk, deskFilter: string | null | undefined) =>
  deskFilter === null || deskFilter === undefined || desk.slug === deskFilter;

/**
 * board.py's order across desks: `now` before `anytime`, then the items that unblock the most,
 * then each desk's own rank. Ready, not-ready and later items are listed apart, so a count of
 * ready items always matches the rows under it.
 */
export function rankBoardItems(data: BoardData | null, deskFilter?: string | null): BoardItemLists {
  if (data === null) return { ready: [], notReady: [], later: [] };
  const deskOrder = new Map(data.desks.map((desk, index) => [desk.slug, index]));
  const ready: BoardItemRow[] = [];
  const notReady: BoardItemRow[] = [];
  const later: BoardItemRow[] = [];
  for (const desk of data.desks) {
    if (!deskVisible(desk, deskFilter)) continue;
    for (const item of desk.items) {
      const row = { key: boardItemKey(desk.slug, item.id), desk, item };
      (isBoardItemLater(item) ? later : item.banner !== null ? notReady : ready).push(row);
    }
  }
  const compare = (a: BoardItemRow, b: BoardItemRow) =>
    (WHEN_RANK[a.item.when] ?? 0) - (WHEN_RANK[b.item.when] ?? 0) ||
    b.item.reach - a.item.reach ||
    (a.item.rank ?? 999) - (b.item.rank ?? 999) ||
    (deskOrder.get(a.desk.slug) ?? 0) - (deskOrder.get(b.desk.slug) ?? 0) ||
    a.item.id.localeCompare(b.item.id);
  return {
    ready: ready.sort(compare),
    notReady: notReady.sort(compare),
    later: later.sort(compare),
  };
}

/** How the Board groups its ready items under Needs me. */
export type BoardGrouping = "priority" | "type" | "bot" | "flat";

export const BOARD_GROUPINGS: ReadonlyArray<BoardGrouping> = ["priority", "type", "bot", "flat"];

export interface BoardItemGroup {
  /** `now`/`anytime`, `send`/`decide`/`do`, or a desk slug; null for one unheaded list. */
  readonly id: string | null;
  readonly desk: BoardDesk | null;
  readonly rows: ReadonlyArray<BoardItemRow>;
}

const TYPE_ORDER: Readonly<Record<string, number>> = { send: 0, decide: 1, do: 2 };

/**
 * Ready items split into the grouping's sub-lists, each keeping the board's order. A grouping
 * that leaves one group, or none, is one unheaded list.
 */
export function groupBoardItems(
  rows: ReadonlyArray<BoardItemRow>,
  grouping: BoardGrouping,
  data: BoardData | null,
): ReadonlyArray<BoardItemGroup> {
  if (rows.length === 0) return [];
  const flat: ReadonlyArray<BoardItemGroup> = [{ id: null, desk: null, rows }];
  if (grouping === "flat") return flat;
  const idOf = (row: BoardItemRow) =>
    grouping === "priority" ? row.item.when : grouping === "type" ? row.item.type : row.desk.slug;
  const groups = new Map<string, BoardItemRow[]>();
  for (const row of rows) {
    const id = idOf(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  if (groups.size === 1) return flat;
  const deskOrder = new Map((data?.desks ?? []).map((desk, index) => [desk.slug, index]));
  const rankOf = (id: string, first: BoardItemRow) =>
    grouping === "priority"
      ? (WHEN_RANK[id] ?? 2)
      : grouping === "type"
        ? (TYPE_ORDER[id] ?? 3)
        : (deskOrder.get(first.desk.slug) ?? 0);
  return [...groups.entries()]
    .map(([id, members]) => ({
      id,
      desk: grouping === "bot" ? members[0]!.desk : null,
      rows: members,
      rank: rankOf(id, members[0]!),
    }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map(({ id, desk, rows: members }) => ({ id, desk, rows: members }));
}

/** Ready items for the sidebar's count. */
export function countReadyBoardItems(data: BoardData | null): number {
  if (data === null) return 0;
  let count = 0;
  for (const desk of data.desks) {
    for (const item of desk.items) if (isBoardItemReady(item)) count += 1;
  }
  return count;
}

export function findBoardItem(data: BoardData | null, key: string): BoardItemRow | null {
  const parsed = parseBoardItemKey(key);
  if (data === null || parsed === null) return null;
  const desk = data.desks.find((entry) => entry.slug === parsed.deskSlug);
  const item = desk?.items.find((entry) => entry.id === parsed.itemId);
  return desk && item ? { key, desk, item } : null;
}

/** An item another item unblocks, looked up in the same desk first, then in any desk. */
export function findBoardItemById(
  data: BoardData | null,
  itemId: string,
  preferDesk: string,
): BoardItemRow | null {
  if (data === null) return null;
  const desks = [...data.desks].sort(
    (a, b) => Number(b.slug === preferDesk) - Number(a.slug === preferDesk),
  );
  for (const desk of desks) {
    const item = desk.items.find((entry) => entry.id === itemId);
    if (item) return { key: boardItemKey(desk.slug, item.id), desk, item };
  }
  return null;
}

export interface BoardTodayRow {
  readonly key: string;
  readonly desk: BoardDesk;
  readonly event: BoardTodayEvent;
}

/** Every desk's Today events, newest first. */
export function collectBoardToday(
  data: BoardData | null,
  deskFilter?: string | null,
): ReadonlyArray<BoardTodayRow> {
  if (data === null) return [];
  const rows: BoardTodayRow[] = [];
  for (const desk of data.desks) {
    if (!deskVisible(desk, deskFilter)) continue;
    desk.today.forEach((event, index) => {
      rows.push({ key: `${desk.slug}\u0000${index}`, desk, event });
    });
  }
  return rows.sort(
    (a, b) => timestamp(b.event.t) - timestamp(a.event.t) || a.key.localeCompare(b.key),
  );
}

export interface BoardDeskCount {
  readonly desk: BoardDesk;
  /** Ready items, the count Needs me and the sidebar's Board button add up. */
  readonly count: number;
}

/** Desks with open items, in the board's order; a desk with only later or not-ready ones counts 0. */
export function boardDeskCounts(data: BoardData | null): ReadonlyArray<BoardDeskCount> {
  if (data === null) return [];
  return data.desks
    .filter((desk) => desk.items.length > 0)
    .map((desk) => ({ desk, count: desk.items.filter(isBoardItemReady).length }));
}

export type BoardProjectInput = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "workspaceRoot" | "archivedAt"
>;

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
const baseName = (path: string) => trimSlash(path).split("/").at(-1) ?? "";

/** The desk folders an item's path names: board.py items live at `<desk>/open/<file>.md`. */
function deskRoots(desk: BoardDesk): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const item of desk.items) {
    const match = /^(.*)\/open\/[^/]+$/.exec(item.path);
    if (match?.[1]) roots.add(trimSlash(match[1]));
  }
  return roots;
}

/**
 * The projects that belong to a desk, best evidence only: the desk's own folder, then a folder
 * named after its slug, then a project titled after its name or slug.
 */
export function matchDeskProjects<P extends BoardProjectInput>(
  desk: BoardDesk,
  projects: ReadonlyArray<P>,
): ReadonlyArray<P> {
  const roots = deskRoots(desk);
  const slug = desk.slug.toLowerCase();
  const name = desk.name.toLowerCase();
  const score = (project: P) => {
    const root = trimSlash(project.workspaceRoot);
    if (roots.has(root)) return 3;
    if (baseName(root).toLowerCase() === slug) return 2;
    const title = project.title.trim().toLowerCase();
    return title === name || title === slug ? 1 : 0;
  };
  let best = 0;
  let matches: P[] = [];
  for (const project of projects) {
    if (project.archivedAt) continue;
    const value = score(project);
    if (value === 0 || value < best) continue;
    if (value > best) {
      best = value;
      matches = [];
    }
    matches.push(project);
  }
  return matches;
}

export interface BoardThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

/**
 * The thread to talk to a desk's bot in: its project's most recently pinned thread, else its
 * most recently updated listed thread.
 */
export function findDeskThreadRef(
  desk: BoardDesk,
  projects: ReadonlyArray<BoardProjectInput>,
  threads: ReadonlyArray<BoardThreadInput>,
): BoardThreadRef | null {
  const keys = new Set(
    matchDeskProjects(desk, projects).map((project) =>
      boardProjectKey(project.environmentId, project.id),
    ),
  );
  if (keys.size === 0) return null;
  let best: BoardThreadInput | null = null;
  const better = (a: BoardThreadInput, b: BoardThreadInput) => {
    const pinned = Number(a.pinnedAt !== null) - Number(b.pinnedAt !== null);
    if (pinned !== 0) return pinned > 0;
    if (a.pinnedAt !== null && b.pinnedAt !== null && a.pinnedAt !== b.pinnedAt) {
      return timestamp(a.pinnedAt) > timestamp(b.pinnedAt);
    }
    return timestamp(a.updatedAt) > timestamp(b.updatedAt);
  };
  for (const thread of threads) {
    if (!isBoardCandidate(thread)) continue;
    if (!keys.has(boardProjectKey(thread.environmentId, thread.projectId))) continue;
    if (best === null || better(thread, best)) best = thread;
  }
  return best === null ? null : { environmentId: best.environmentId, threadId: best.id };
}

/** Keys of the projects that belong to a desk, for filtering live threads by desk. */
export function deskProjectKeys(
  desk: BoardDesk,
  projects: ReadonlyArray<BoardProjectInput>,
): ReadonlySet<string> {
  return new Set(
    matchDeskProjects(desk, projects).map((project) =>
      boardProjectKey(project.environmentId, project.id),
    ),
  );
}

const T3CODE_THREAD_PREFIX = "t3code://threads/";

/**
 * A thread a Board link points at: `t3-thread://v2/<environment>/<thread>` (what bots write) or
 * `t3code://threads/<environment>/<thread>` (the desktop app's own link).
 */
export function parseBoardThreadHref(href: string): BoardThreadRef | null {
  if (href.startsWith(T3CODE_THREAD_PREFIX)) {
    const [environmentId, threadId, ...rest] = href.slice(T3CODE_THREAD_PREFIX.length).split("/");
    if (!environmentId || !threadId || rest.length > 0) return null;
    try {
      return {
        environmentId: decodeURIComponent(environmentId),
        threadId: decodeURIComponent(threadId),
      };
    } catch {
      return null;
    }
  }
  const link = parseThreadLinkHref(href);
  return link?.environmentId
    ? { environmentId: link.environmentId, threadId: link.threadId }
    : null;
}

/** Board Markdown with `t3code://threads/…` links rewritten as the thread links T3 renders. */
export function rewriteBoardThreadLinks(markdown: string): string {
  return markdown.replace(/t3code:\/\/threads\/[^\s)>\]]+/g, (href) => {
    const ref = parseBoardThreadHref(href);
    return ref === null ? href : `t3-thread://v2/${ref.environmentId}/${ref.threadId}`;
  });
}

/** A Board headline without its Markdown, for a row that is itself a button. */
export function plainBoardText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}

// board.html's desk colors, so a desk looks the same on the Board page and the web board.
const DESK_COLORS = ["#6b7cff", "#22a37a", "#e08a2c", "#a368e8", "#e0567a", "#1fa2b8", "#8b8b93"];

export function boardDeskColors(data: BoardData | null): ReadonlyMap<string, string> {
  return new Map(
    (data?.desks ?? []).map((desk, index) => [
      desk.slug,
      DESK_COLORS[index % DESK_COLORS.length] ?? "#8b8b93",
    ]),
  );
}
