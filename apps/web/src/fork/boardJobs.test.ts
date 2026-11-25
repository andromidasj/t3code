import { ProjectId, ScheduledTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardProjectKey, boardSearchFromUrl } from "./board.logic";
import {
  boardJobHealth,
  buildBoardJobs,
  countFailedBoardJobs,
  type BoardJobTask,
} from "./boardJobs";

function task(
  id: string,
  overrides: Partial<Omit<BoardJobTask, "id">> & { readonly project?: string } = {},
): BoardJobTask {
  const { project = "desk", ...rest } = overrides;
  return {
    id: ScheduledTaskId.make(id),
    title: id,
    projectId: ProjectId.make(project),
    enabled: true,
    lastRunStatus: "succeeded",
    lastRunAt: null,
    ...rest,
  };
}

const names = new Map([
  [boardProjectKey("env", "desk"), "Chief"],
  [boardProjectKey("env", "media"), "Arlo"],
  [boardProjectKey("other", "desk"), "Chief (work)"],
]);

describe("buildBoardJobs", () => {
  const sources = [
    {
      environmentId: "env",
      timeZone: "America/Chicago",
      tasks: [
        task("old", { lastRunAt: "2026-11-20T00:00:00Z" }),
        task("paused-failed", { enabled: false, lastRunStatus: "failed" }),
        task("recent", { lastRunAt: "2026-11-25T00:00:00Z", project: "media" }),
        task("failed", { lastRunStatus: "failed", lastRunAt: "2026-11-01T00:00:00Z" }),
        task("never", { lastRunStatus: "never" }),
        task("running", { lastRunStatus: "running" }),
      ],
    },
    { environmentId: "other", timeZone: undefined, tasks: [task("work")] },
  ];

  it("puts failed jobs first, then running, then enabled by latest run, then paused", () => {
    const rows = buildBoardJobs(sources, names, null);
    expect(rows.map((row) => row.task.id)).toEqual([
      "failed",
      "running",
      "recent",
      "old",
      "never",
      "work",
      "paused-failed",
    ]);
    expect(rows[0]).toMatchObject({
      key: "env:failed",
      environmentId: "env",
      projectName: "Chief",
      timeZone: "America/Chicago",
    });
    expect(rows.find((row) => row.task.id === "work")?.projectName).toBe("Chief (work)");
  });

  it("keeps only the filtered desk's projects", () => {
    const rows = buildBoardJobs(sources, names, new Set([boardProjectKey("env", "media")]));
    expect(rows.map((row) => row.task.id)).toEqual(["recent"]);
    expect(buildBoardJobs(sources, names, new Set())).toEqual([]);
  });

  it("names no project it does not know", () => {
    const rows = buildBoardJobs(
      [{ environmentId: "env", timeZone: undefined, tasks: [task("x", { project: "gone" })] }],
      names,
      null,
    );
    expect(rows[0]?.projectName).toBeNull();
  });
});

describe("job health", () => {
  it("counts only enabled failed jobs as failed", () => {
    const rows = buildBoardJobs(
      [
        {
          environmentId: "env",
          timeZone: undefined,
          tasks: [
            task("a", { lastRunStatus: "failed" }),
            task("b", { lastRunStatus: "failed", enabled: false }),
            task("c"),
          ],
        },
      ],
      names,
      null,
    );
    expect(countFailedBoardJobs(rows)).toBe(1);
    expect(countFailedBoardJobs([])).toBe(0);
  });

  it("shows paused and never-run jobs as idle", () => {
    expect(boardJobHealth(task("a", { enabled: false, lastRunStatus: "failed" }))).toBe("idle");
    expect(boardJobHealth(task("b", { lastRunStatus: "never" }))).toBe("idle");
    expect(boardJobHealth(task("c", { lastRunStatus: "running" }))).toBe("running");
    expect(boardJobHealth(task("d"))).toBe("succeeded");
    expect(boardJobHealth(task("e", { lastRunStatus: "failed" }))).toBe("failed");
  });

  it("keeps the Jobs view in the URL", () => {
    expect(boardSearchFromUrl({ boardView: "jobs" })).toEqual({ boardView: "jobs" });
  });
});
