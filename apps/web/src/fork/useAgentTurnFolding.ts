import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

import {
  foldAgentTurns,
  reuseFoldRows,
  type AgentTurnFoldRow,
  type AgentTurnFoldingContext,
} from "./agentTurnFolding";
import { useForkSettings } from "./forkSettings";
import { parseScheduledDeliveryMode } from "./scheduledDelivery";

const NO_IDS: ReadonlySet<string> = new Set();

interface FoldingInput extends Omit<AgentTurnFoldingContext, "expandedGroupIds" | "alwaysTaskIds"> {
  /** Reads the thread's scheduled tasks, so `always` jobs stay visible. */
  readonly environmentId?: EnvironmentId | undefined;
  /** Folds reset when the timeline shows another thread. */
  readonly threadKey: string;
  /** Thread find reads every row, so folding steps aside while it is open. */
  readonly disabled: boolean;
  /** Runs before a strip opens or closes, so the timeline can hold the strip in place. */
  readonly onBeforeToggle?: (foldId: string) => void;
}

function idsKey(ids: ReadonlySet<string> | undefined): string {
  return ids && ids.size > 0 ? [...ids].toSorted().join("\n") : "";
}

/** Everything that changes the folded rows besides the rows themselves, as one string. */
function inputKey(
  input: FoldingInput,
  expanded: ReadonlySet<string>,
  alwaysTaskIds: ReadonlySet<string>,
): string {
  const latest = input.latestRun;
  return [
    input.threadKey,
    idsKey(expanded),
    idsKey(input.pendingApprovalRequestIds),
    idsKey(input.pinnedIds),
    idsKey(alwaysTaskIds),
    latest ? `${latest.runId}:${latest.status}` : "",
    input.runningRunId ?? "",
    input.usageLimitRunId ?? "",
    input.isWorking ? "1" : "0",
  ].join("\0");
}

/** The timeline's rows with routine bot turns folded; each strip carries its own toggle. */
export function useAgentTurnFolding(
  rows: MessagesTimelineRow[],
  input: FoldingInput,
): MessagesTimelineRow[] {
  const { collapseAgentTurns } = useForkSettings();
  const tasksQuery = useEnvironmentQuery(
    input.environmentId
      ? serverEnvironment.scheduledTasksLive({ environmentId: input.environmentId, input: {} })
      : null,
  );
  const tasks = tasksQuery.data?.tasks;
  const alwaysTaskIds = new Set<string>(
    (tasks ?? [])
      .filter((task) => parseScheduledDeliveryMode(task.prompt) === "always")
      .map((task) => task.id),
  );
  const enabled = collapseAgentTurns && !input.disabled;
  const [expandedState, setExpandedState] = useState<{
    readonly threadKey: string;
    readonly ids: ReadonlySet<string>;
  }>({ threadKey: input.threadKey, ids: NO_IDS });
  const expanded = expandedState.threadKey === input.threadKey ? expandedState.ids : NO_IDS;
  const [derived, setDerived] = useState<{
    readonly source: MessagesTimelineRow[] | null;
    readonly key: string;
    readonly rows: MessagesTimelineRow[];
    readonly byId: ReadonlyMap<string, AgentTurnFoldRow>;
  }>({ source: null, key: "", rows, byId: new Map() });

  const toggle = useStableCallback((foldId: string) => {
    input.onBeforeToggle?.(foldId);
    setExpandedState((current) => {
      const ids = new Set(current.threadKey === input.threadKey ? current.ids : NO_IDS);
      if (ids.has(foldId)) ids.delete(foldId);
      else ids.add(foldId);
      return { threadKey: input.threadKey, ids };
    });
  });

  if (!enabled) return rows;
  const key = inputKey(input, expanded, alwaysTaskIds);
  if (derived.source === rows && derived.key === key) return derived.rows;
  const folded = foldAgentTurns(rows, {
    ...input,
    alwaysTaskIds,
    expandedGroupIds: expanded,
    onToggle: toggle,
  });
  const reused =
    folded === rows
      ? { rows, byId: new Map<string, AgentTurnFoldRow>() }
      : reuseFoldRows(folded, derived.byId);
  const nextRows = reused.rows === rows ? rows : [...reused.rows];
  setDerived({ source: rows, key, rows: nextRows, byId: reused.byId });
  return nextRows;
}
