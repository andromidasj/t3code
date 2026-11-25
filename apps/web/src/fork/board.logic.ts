import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isListedThreadLineage } from "@t3tools/contracts";

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

export type BoardView = "all" | "needs-me" | "running" | "web";

/**
 * The board's URL state. Keys carry a `board` prefix because the router merges every route's
 * search into one type for `navigate`.
 */
export interface BoardSearch {
  readonly boardView?: BoardView | undefined;
  readonly boardEnvironmentId?: string | undefined;
  readonly boardThreadId?: string | undefined;
}

const BOARD_VIEWS: ReadonlySet<string> = new Set<BoardView>(["all", "needs-me", "running", "web"]);

const boundedId = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export function boardSearchFromUrl(search: Record<string, unknown>): BoardSearch {
  const view =
    typeof search.boardView === "string" && BOARD_VIEWS.has(search.boardView)
      ? (search.boardView as BoardView)
      : undefined;
  const environmentId = boundedId(search.boardEnvironmentId);
  const threadId = boundedId(search.boardThreadId);
  return {
    ...(view === undefined || view === "all" ? {} : { boardView: view }),
    ...(environmentId !== undefined && threadId !== undefined
      ? { boardEnvironmentId: environmentId, boardThreadId: threadId }
      : {}),
  };
}

/** Whether a click on a board row should open the thread full screen instead of beside the board. */
export function opensFullThread(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}
