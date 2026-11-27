import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { isListedThreadLineage } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { ThreadPlacementOverrides } from "./forkSettings";
import {
  isBackgroundBotThread,
  isThreadRunning,
  sidebarThreadKey,
  type SidebarHierarchyThread,
} from "./sidebarHierarchy";

export type RunningThreadInput = SidebarHierarchyThread &
  Pick<EnvironmentThreadShell, "projectId" | "archivedAt" | "deletedAt" | "runtime" | "updatedAt">;

export interface RunningThreadRow<T extends RunningThreadInput = RunningThreadInput> {
  readonly thread: T;
  readonly key: string;
  /** A bot's lane that the Bot / Background drawer holds. */
  readonly background: boolean;
  /** When the current run began, falling back to the thread's last update. */
  readonly since: string;
}

export interface RunningThreadGroup<T extends RunningThreadInput = RunningThreadInput> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
  /** Newest run first. */
  readonly threads: ReadonlyArray<RunningThreadRow<T>>;
}

export interface RunningThreadsModel<T extends RunningThreadInput = RunningThreadInput> {
  readonly totalCount: number;
  /** The primary environment first, then the others A–Z by name. */
  readonly groups: ReadonlyArray<RunningThreadGroup<T>>;
}

const timestamp = (iso: string | null | undefined) => {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
};

function runningSince(thread: RunningThreadInput): string {
  return (
    thread.runtime?.activityStartedAt ??
    thread.latestRun?.startedAt ??
    thread.latestRun?.requestedAt ??
    thread.updatedAt
  );
}

/**
 * The threads working right now across every connected environment, grouped by machine. Counts
 * what the sidebar would list (live, not archived, not a subagent, side chat or workflow step),
 * so the total agrees with the Bot / Background header's running count plus the Working shelf.
 */
export function buildRunningThreads<T extends RunningThreadInput>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly labelByEnvironmentId: ReadonlyMap<EnvironmentId, string | null>;
  readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly fallbackLabel: string;
  readonly placementOverrides?: ThreadPlacementOverrides;
}): RunningThreadsModel<T> {
  const rowsByEnvironment = new Map<EnvironmentId, RunningThreadRow<T>[]>();
  for (const thread of input.threads) {
    if (
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      !isListedThreadLineage(thread.lineage) ||
      !isThreadRunning(thread)
    ) {
      continue;
    }
    const rows = rowsByEnvironment.get(thread.environmentId) ?? [];
    rows.push({
      thread,
      key: sidebarThreadKey(thread),
      background: isBackgroundBotThread(thread, input.placementOverrides),
      since: runningSince(thread),
    });
    rowsByEnvironment.set(thread.environmentId, rows);
  }
  const groups: RunningThreadGroup<T>[] = [...rowsByEnvironment].map(([environmentId, rows]) => ({
    environmentId,
    label: input.labelByEnvironmentId.get(environmentId) ?? input.fallbackLabel,
    machine: input.machineByEnvironmentId.get(environmentId) ?? "server",
    threads: rows.toSorted(
      (a, b) => timestamp(b.since) - timestamp(a.since) || a.key.localeCompare(b.key),
    ),
  }));
  groups.sort((a, b) => {
    const aPrimary = a.environmentId === input.primaryEnvironmentId;
    const bPrimary = b.environmentId === input.primaryEnvironmentId;
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return a.label.localeCompare(b.label) || a.environmentId.localeCompare(b.environmentId);
  });
  return {
    totalCount: groups.reduce((sum, group) => sum + group.threads.length, 0),
    groups,
  };
}

/** `dev: 2, bots: 1` for the pill's tooltip. */
export function runningThreadsBreakdown(model: RunningThreadsModel): string {
  return model.groups.map((group) => `${group.label}: ${group.threads.length}`).join(", ");
}
