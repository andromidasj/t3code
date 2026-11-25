import type { EnvironmentId, ScheduledTask, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { serverEnvironment } from "~/state/server";

import {
  parseScheduledDeliveryMode,
  quietsCompletion,
  type ScheduledDeliveryMode,
} from "./scheduledDelivery";

/**
 * Keeps the completion of a run a quiet scheduled task started from notifying. Approvals,
 * questions, failures and usage limits are not completions, so they always notify.
 */

export interface ScheduledRunThread {
  readonly id: ThreadId;
  readonly latestRun: {
    readonly runId: string;
    readonly requestedAt: string | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
}

type TaskFields = Pick<ScheduledTask, "id" | "threadId" | "prompt" | "enabled" | "lastRunAt">;

export interface ScheduledRunMatch {
  /** Null when no fire time matched and the thread's tasks all share one mode. */
  readonly taskId: ScheduledTaskId | null;
  readonly lastRunAt: string | null;
  readonly mode: ScheduledDeliveryMode | null;
}

/** A queued prompt waits for the run before it; longer gaps are another run. */
export const MAX_QUEUE_WAIT_MS = 2 * 60 * 60_000;
/** Clock skew between the server stamping the fire and the run's request. */
const FIRE_SKEW_MS = 60_000;

/**
 * The scheduled task whose fire started the thread's latest run. A fire matches the run requested
 * at or soon after it, once: `consumed` holds the fire each task's earlier run already used, so a
 * message sent after a scheduled run is never mistaken for it. Without run timing (older
 * servers), the thread's enabled tasks decide only when they all share one mode.
 */
export function matchScheduledRun(
  tasks: ReadonlyArray<TaskFields>,
  thread: ScheduledRunThread,
  consumed: ReadonlyMap<ScheduledTaskId, string>,
): ScheduledRunMatch | null {
  const bound = tasks.filter((task) => task.threadId === thread.id);
  if (bound.length === 0 || thread.latestRun === null) return null;
  const anchor = Date.parse(thread.latestRun.requestedAt ?? thread.latestRun.startedAt ?? "");
  if (Number.isFinite(anchor)) {
    let best: { task: TaskFields; firedAt: number } | null = null;
    for (const task of bound) {
      if (task.lastRunAt === null || consumed.get(task.id) === task.lastRunAt) continue;
      const firedAt = Date.parse(task.lastRunAt);
      if (!Number.isFinite(firedAt)) continue;
      if (firedAt > anchor + FIRE_SKEW_MS || firedAt < anchor - MAX_QUEUE_WAIT_MS) continue;
      if (best === null || firedAt > best.firedAt) best = { task, firedAt };
    }
    return best === null
      ? null
      : {
          taskId: best.task.id,
          lastRunAt: best.task.lastRunAt,
          mode: parseScheduledDeliveryMode(best.task.prompt),
        };
  }
  const modes = new Set(
    bound.filter((task) => task.enabled).map((task) => parseScheduledDeliveryMode(task.prompt)),
  );
  if (modes.size !== 1) return null;
  return { taskId: null, lastRunAt: null, mode: [...modes][0] ?? null };
}

/** Fires older than this when the task list first loads finished before the app was watching. */
const SEED_SETTLED_FIRE_MS = 10 * 60_000;

/** Decides per run, once, whether its completion stays quiet; tracks which fires were used. */
export function createScheduledCompletionFilter(now: () => number = Date.now) {
  let tasks: ReadonlyArray<TaskFields> | null = null;
  const consumed = new Map<ScheduledTaskId, string>();
  const decided = new Map<string, boolean>();
  return {
    setTasks(next: ReadonlyArray<TaskFields>): void {
      if (tasks === null) {
        const cutoff = now() - SEED_SETTLED_FIRE_MS;
        for (const task of next) {
          const firedAt = task.lastRunAt === null ? NaN : Date.parse(task.lastRunAt);
          if (task.lastRunAt !== null && firedAt < cutoff) consumed.set(task.id, task.lastRunAt);
        }
      }
      tasks = next;
    },
    /** Whether the thread's latest run, once ended, should finish without a completion notice. */
    quietCompletion(thread: ScheduledRunThread): boolean {
      const run = thread.latestRun;
      if (tasks === null || run === null || run.completedAt === null) return false;
      const known = decided.get(run.runId);
      if (known !== undefined) return known;
      const match = matchScheduledRun(tasks, thread, consumed);
      if (match?.taskId != null && match.lastRunAt !== null) {
        consumed.set(match.taskId, match.lastRunAt);
      }
      const quiet = quietsCompletion(match?.mode ?? null);
      decided.set(run.runId, quiet);
      // Runs are decided once; old decisions only need to outlive the run's observations.
      if (decided.size > 500) decided.delete(decided.keys().next().value!);
      return quiet;
    },
  };
}

/** Follows the environment's scheduled tasks for ThreadNotificationCoordinator. */
export function watchScheduledDelivery(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
): {
  readonly quietCompletion: (thread: ScheduledRunThread) => boolean;
  readonly unsubscribe: () => void;
} {
  const filter = createScheduledCompletionFilter();
  const unsubscribe = registry.subscribe(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
    (result) => {
      const data = AsyncResult.getOrElse(result, () => null);
      if (data !== null) filter.setTasks(data.tasks);
    },
    { immediate: true },
  );
  return { quietCompletion: filter.quietCompletion, unsubscribe };
}
