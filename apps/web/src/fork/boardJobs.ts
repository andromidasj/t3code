import type { ScheduledTask } from "@t3tools/contracts";

import { boardProjectKey } from "./board.logic";

/** One environment's scheduled tasks, as its live subscription last sent them. */
export interface BoardJobsSource<Task extends BoardJobTask = ScheduledTask> {
  readonly environmentId: string;
  readonly tasks: ReadonlyArray<Task>;
  readonly timeZone: string | undefined;
}

export type BoardJobTask = Pick<
  ScheduledTask,
  "id" | "title" | "projectId" | "enabled" | "lastRunStatus" | "lastRunAt"
>;

export interface BoardJobRow<Task extends BoardJobTask = ScheduledTask> {
  readonly key: string;
  readonly environmentId: string;
  readonly task: Task;
  readonly projectName: string | null;
  readonly timeZone: string | undefined;
}

export type BoardJobHealth = "failed" | "running" | "succeeded" | "idle";

/** What the job's dot shows: a paused job is idle whatever its last run did. */
export function boardJobHealth(task: BoardJobTask): BoardJobHealth {
  if (!task.enabled) return "idle";
  if (task.lastRunStatus === "failed") return "failed";
  if (task.lastRunStatus === "running") return "running";
  if (task.lastRunStatus === "succeeded") return "succeeded";
  return "idle";
}

const runTime = (task: BoardJobTask) => {
  const time = task.lastRunAt === null ? Number.NaN : Date.parse(task.lastRunAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

const rank = (task: BoardJobTask) => {
  if (!task.enabled) return 3;
  if (task.lastRunStatus === "failed") return 0;
  if (task.lastRunStatus === "running") return 1;
  return 2;
};

/**
 * Every environment's jobs, limited to the desk filter's projects when one is set: enabled failed
 * jobs first, then running ones, then the other enabled jobs by latest run, then paused jobs.
 */
export function buildBoardJobs<Task extends BoardJobTask>(
  sources: ReadonlyArray<BoardJobsSource<Task>>,
  projectNames: ReadonlyMap<string, string>,
  filterProjectKeys: ReadonlySet<string> | null,
): ReadonlyArray<BoardJobRow<Task>> {
  const rows: BoardJobRow<Task>[] = [];
  for (const source of sources) {
    for (const task of source.tasks) {
      const projectKey = boardProjectKey(source.environmentId, task.projectId);
      if (filterProjectKeys !== null && !filterProjectKeys.has(projectKey)) continue;
      rows.push({
        key: `${source.environmentId}:${task.id}`,
        environmentId: source.environmentId,
        task,
        projectName: projectNames.get(projectKey) ?? null,
        timeZone: source.timeZone,
      });
    }
  }
  return rows.toSorted(
    (left, right) =>
      rank(left.task) - rank(right.task) ||
      runTime(right.task) - runTime(left.task) ||
      left.task.title.localeCompare(right.task.title),
  );
}

/** Enabled jobs whose latest run failed. */
export function countFailedBoardJobs(rows: ReadonlyArray<BoardJobRow<BoardJobTask>>): number {
  return rows.filter((row) => boardJobHealth(row.task) === "failed").length;
}
