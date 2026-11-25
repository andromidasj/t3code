import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type {
  OrchestrationV2LinkedSender,
  OrchestrationV2ProjectedTurnItem,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";

import type {
  MessagesTimelineRow,
  TimelineLatestRun,
} from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";

/**
 * Routine agent-to-agent and automation turns in a thread fold into one strip, so the
 * conversation with the user stays readable. Works on the rows MessagesTimeline already derived.
 */

export type AgentTurnSender =
  | {
      readonly kind: "automation";
      readonly key: string;
      readonly scheduledTaskId: ScheduledTaskId | undefined;
    }
  | {
      readonly kind: "agent";
      readonly key: string;
      readonly senderThreadId: ThreadId | undefined;
      readonly linkedSender: OrchestrationV2LinkedSender | undefined;
    };

export interface AgentTurnFoldRow {
  readonly kind: "agent-turn-fold";
  readonly id: string;
  /** When the first folded turn started. */
  readonly createdAt: string;
  /** The newest row in the group. */
  readonly latestAt: string;
  readonly expanded: boolean;
  readonly turnCount: number;
  /** Distinct senders, newest first. */
  readonly senders: ReadonlyArray<AgentTurnSender>;
  /** First line of the newest update. */
  readonly preview: string;
  /** Opens or closes this strip; stable across renders. */
  readonly onToggle: (foldId: string) => void;
}

export interface AgentTurnFoldingContext {
  readonly expandedGroupIds: ReadonlySet<string>;
  readonly pendingApprovalRequestIds?: ReadonlySet<string> | undefined;
  readonly latestRun?: TimelineLatestRun | null | undefined;
  readonly runningRunId?: RunId | null | undefined;
  readonly usageLimitRunId?: RunId | null | undefined;
  readonly isWorking?: boolean | undefined;
  /** Message or row ids that must stay visible, such as a cited response. */
  readonly pinnedIds?: ReadonlySet<string> | undefined;
  readonly onToggle?: ((foldId: string) => void) | undefined;
}

type MessageRow = Extract<MessagesTimelineRow, { kind: "message" }>;

export interface TimelineTurn {
  readonly opener: MessageRow;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
}

const FOLD_ID_PREFIX = "agent-turn-fold:";

export function agentTurnFoldId(firstRowId: string): string {
  return `${FOLD_ID_PREFIX}${firstRowId}`;
}

function isUserMessageRow(row: MessagesTimelineRow): row is MessageRow {
  return row.kind === "message" && row.message.role === "user";
}

/** Rows before the first user message, then one turn per user message. */
export function splitTimelineTurns(rows: ReadonlyArray<MessagesTimelineRow>): {
  readonly lead: ReadonlyArray<MessagesTimelineRow>;
  readonly turns: ReadonlyArray<TimelineTurn>;
} {
  const lead: MessagesTimelineRow[] = [];
  const turns: Array<{ opener: MessageRow; rows: MessagesTimelineRow[] }> = [];
  for (const row of rows) {
    if (isUserMessageRow(row)) {
      turns.push({ opener: row, rows: [row] });
    } else if (turns.length === 0) {
      lead.push(row);
    } else {
      turns.at(-1)!.rows.push(row);
    }
  }
  return { lead, turns };
}

/** The bot that opened the turn, or null for the user's own and guests' turns. */
function agentTurnSender(opener: MessageRow): AgentTurnSender | null {
  const { attribution, scheduledTaskId } = resolveUserMessagePresentation(opener.message);
  if (attribution === "automation") {
    return { kind: "automation", key: `automation:${scheduledTaskId ?? ""}`, scheduledTaskId };
  }
  if (attribution === "agent") {
    const linked = opener.message.linkedSender;
    const senderThreadId = opener.message.senderThreadId;
    return {
      kind: "agent",
      key: linked
        ? `agent:${linked.environmentId}:${linked.threadId}`
        : `agent:${senderThreadId ?? ""}`,
      senderThreadId,
      linkedSender: linked,
    };
  }
  return null;
}

function rowWorkEntries(row: MessagesTimelineRow): ReadonlyArray<WorkLogEntry> {
  if (row.kind === "work") return row.groupedEntries;
  if (row.kind === "work-live") return [row.entry, ...row.groupedEntries];
  return [];
}

function rowProjectedItems(
  row: MessagesTimelineRow,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem["item"]> {
  const items: Array<OrchestrationV2ProjectedTurnItem["item"]> = [];
  if ((row.kind === "event" || row.kind === "message") && row.projectedItem) {
    items.push(row.projectedItem.item);
  }
  for (const entry of rowWorkEntries(row)) {
    if (entry.projectedItem) items.push(entry.projectedItem.item);
  }
  return items;
}

function rowRunIds(row: MessagesTimelineRow): ReadonlyArray<RunId> {
  const ids: RunId[] = [];
  if (row.kind === "message" || row.kind === "assistant-meta") {
    if (row.message.runId) ids.push(row.message.runId);
  }
  if (row.kind === "turn-fold" || row.kind === "attempt-fold") ids.push(row.runId);
  if (row.kind === "work-toggle" && row.runId) ids.push(row.runId);
  for (const entry of rowWorkEntries(row)) if (entry.runId) ids.push(entry.runId);
  for (const item of rowProjectedItems(row)) if (item.runId) ids.push(item.runId);
  return ids;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function isActive(turn: TimelineTurn, isLast: boolean, context: AgentTurnFoldingContext): boolean {
  if (isLast && context.isWorking) return true;
  const runIds = new Set(turn.rows.flatMap(rowRunIds));
  if (context.runningRunId && runIds.has(context.runningRunId)) return true;
  const latest = context.latestRun;
  if (latest && runIds.has(latest.runId) && ACTIVE_RUN_STATUSES.has(latest.status)) return true;
  // A queued or unanswered prompt still waits for its run.
  const openerStatus = turn.opener.projectedItem?.item.status;
  if (openerStatus === "pending" || openerStatus === "waiting" || openerStatus === "running") {
    return true;
  }
  return turn.rows.some(
    (row) =>
      row.kind === "working" ||
      row.kind === "thinking" ||
      (row.kind === "work-live" && row.active) ||
      (row.kind === "context-compaction" && row.active) ||
      (row.kind === "message" && row.message.streaming),
  );
}

function entryFailed(entry: WorkLogEntry): boolean {
  return (
    entry.tone === "error" ||
    entry.sourceActivityKind === "runtime.error" ||
    (entry.itemType === "error" && entry.toolLifecycleStatus !== "completed")
  );
}

function isFailed(turn: TimelineTurn, context: AgentTurnFoldingContext): boolean {
  const runIds = new Set(turn.rows.flatMap(rowRunIds));
  if (context.usageLimitRunId && runIds.has(context.usageLimitRunId)) return true;
  const latest = context.latestRun;
  if (latest && runIds.has(latest.runId) && latest.status === "failed") return true;
  if (turn.opener.projectedItem?.item.status === "failed") return true;
  return turn.rows.some(
    (row) =>
      (row.kind === "context-compaction" && row.failed === true) ||
      rowWorkEntries(row).some(entryFailed) ||
      rowProjectedItems(row).some((item) => item.type === "error" && item.status === "failed"),
  );
}

function itemAsksUser(
  item: OrchestrationV2ProjectedTurnItem["item"],
  pendingApprovals: ReadonlySet<string> | undefined,
): boolean {
  switch (item.type) {
    case "approval_request":
      return pendingApprovals?.has(item.requestId) === true;
    case "user_input_request":
      return (
        item.questionAnswer === undefined &&
        (item.status === "pending" || item.status === "waiting" || item.status === "running")
      );
    case "secret_request":
      return item.secretStatus === "pending";
    case "link_request":
      return item.linkStatus === "pending";
    case "feedback_request":
      return item.feedbackStatus === "pending";
    default:
      return false;
  }
}

function needsUser(turn: TimelineTurn, context: AgentTurnFoldingContext): boolean {
  return turn.rows.some(
    (row) =>
      (row.kind === "proposed-plan" &&
        (row.proposedPlan.status === "draft" || row.proposedPlan.status === "active")) ||
      rowProjectedItems(row).some((item) => itemAsksUser(item, context.pendingApprovalRequestIds)),
  );
}

/** A bot reply that starts with 👉 or says "👉 Needs you" is meant for the user. */
export function flagsUser(text: string): boolean {
  return text.trimStart().startsWith("👉") || text.includes("👉 Needs you");
}

function isPinned(turn: TimelineTurn, pinnedIds: ReadonlySet<string> | undefined): boolean {
  if (!pinnedIds || pinnedIds.size === 0) return false;
  return turn.rows.some(
    (row) =>
      pinnedIds.has(row.id) ||
      ((row.kind === "message" || row.kind === "assistant-meta") && pinnedIds.has(row.message.id)),
  );
}

/** Whether an agent or automation turn can fold away; the user's own turns never do. */
function isRoutineAgentTurn(
  turn: TimelineTurn,
  isLast: boolean,
  context: AgentTurnFoldingContext,
): boolean {
  if (agentTurnSender(turn.opener) === null) return false;
  if (isActive(turn, isLast, context)) return false;
  if (isFailed(turn, context)) return false;
  if (needsUser(turn, context)) return false;
  if (
    turn.rows.some(
      (row) =>
        row.kind === "message" && row.message.role === "assistant" && flagsUser(row.message.text),
    )
  ) {
    return false;
  }
  return !isPinned(turn, context.pinnedIds);
}

const noop = () => {};

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

function turnPreview(turn: TimelineTurn): string {
  const reply = turn.rows.findLast(
    (row): row is MessageRow =>
      row.kind === "message" && row.message.role === "assistant" && row.message.text.trim() !== "",
  );
  if (reply) return firstLine(reply.message.text);
  return firstLine(resolveUserMessagePresentation(turn.opener.message).text);
}

function rowTime(row: MessagesTimelineRow): string | null {
  return row.createdAt;
}

function buildFoldRow(
  turns: ReadonlyArray<TimelineTurn>,
  context: AgentTurnFoldingContext,
): AgentTurnFoldRow {
  const first = turns[0]!;
  const last = turns.at(-1)!;
  const id = agentTurnFoldId(first.opener.id);
  const senders: AgentTurnSender[] = [];
  for (const turn of turns.toReversed()) {
    const sender = agentTurnSender(turn.opener);
    if (sender && !senders.some((known) => known.key === sender.key)) senders.push(sender);
  }
  const latestAt =
    last.rows
      .map(rowTime)
      .filter((value): value is string => value !== null)
      .toSorted()
      .at(-1) ?? last.opener.createdAt;
  return {
    kind: "agent-turn-fold",
    id,
    createdAt: first.opener.createdAt,
    latestAt,
    expanded: context.expandedGroupIds.has(id),
    turnCount: turns.length,
    senders,
    preview: turnPreview(last),
    onToggle: context.onToggle ?? noop,
  };
}

/**
 * The rows with each run of consecutive routine agent and automation turns replaced by one fold
 * row, or headed by it while expanded. Returns `rows` itself when nothing folds.
 */
export function foldAgentTurns(
  rows: ReadonlyArray<MessagesTimelineRow>,
  context: AgentTurnFoldingContext,
): ReadonlyArray<MessagesTimelineRow> {
  const { lead, turns } = splitTimelineTurns(rows);
  if (turns.length === 0) return rows;
  const out: MessagesTimelineRow[] = [...lead];
  let group: TimelineTurn[] = [];
  let folded = false;
  const flush = () => {
    if (group.length === 0) return;
    const fold = buildFoldRow(group, context);
    folded = true;
    out.push(fold);
    if (fold.expanded) for (const turn of group) out.push(...turn.rows);
    group = [];
  };
  turns.forEach((turn, index) => {
    if (isRoutineAgentTurn(turn, index === turns.length - 1, context)) {
      group.push(turn);
      return;
    }
    flush();
    out.push(...turn.rows);
  });
  flush();
  return folded ? out : rows;
}

function sameFoldRow(a: AgentTurnFoldRow, b: AgentTurnFoldRow): boolean {
  return (
    a.onToggle === b.onToggle &&
    a.id === b.id &&
    a.createdAt === b.createdAt &&
    a.latestAt === b.latestAt &&
    a.expanded === b.expanded &&
    a.turnCount === b.turnCount &&
    a.preview === b.preview &&
    a.senders.length === b.senders.length &&
    a.senders.every((sender, index) => sender.key === b.senders[index]?.key)
  );
}

/** Keeps unchanged fold rows the same objects, so memoized rows and the list skip them. */
export function reuseFoldRows(
  rows: ReadonlyArray<MessagesTimelineRow>,
  previous: ReadonlyMap<string, AgentTurnFoldRow>,
): {
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  readonly byId: Map<string, AgentTurnFoldRow>;
} {
  const byId = new Map<string, AgentTurnFoldRow>();
  const next = rows.map((row) => {
    if (row.kind !== "agent-turn-fold") return row;
    const prior = previous.get(row.id);
    const kept = prior && sameFoldRow(prior, row) ? prior : row;
    byId.set(kept.id, kept);
    return kept;
  });
  return { rows: next, byId };
}
