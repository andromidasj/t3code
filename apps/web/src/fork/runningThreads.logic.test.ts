import { EnvironmentId, RunId, ThreadId, type EnvironmentMachineKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRunningThreads,
  runningThreadsBreakdown,
  type RunningThreadInput,
} from "./runningThreads.logic";

const dev = EnvironmentId.make("dev");
const bots = EnvironmentId.make("bots");
const mac = EnvironmentId.make("mac");

type RunStatus = NonNullable<RunningThreadInput["latestRun"]>["status"];

function thread(
  environmentId: EnvironmentId,
  id: string,
  options: {
    readonly run?: RunStatus | null;
    readonly turnEnded?: boolean;
    readonly since?: string;
    readonly archived?: boolean;
    readonly deleted?: boolean;
    readonly createdBy?: "user" | "agent";
    readonly lane?: boolean;
    readonly subagent?: boolean;
  } = {},
): RunningThreadInput {
  const run = options.run === undefined ? "running" : options.run;
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId: "project" as RunningThreadInput["projectId"],
    title: id,
    archivedAt: options.archived ? "2026-01-02T00:00:00.000Z" : null,
    deletedAt: options.deleted ? "2026-01-02T00:00:00.000Z" : null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    runtime: null,
    delegatedFrom: options.lane
      ? { environmentId, threadId: ThreadId.make("parent"), title: "parent" }
      : null,
    lineage: {
      rootThreadId: ThreadId.make(id),
      parentThreadId: options.subagent ? ThreadId.make("parent") : null,
      relationshipToParent: options.subagent ? "subagent" : null,
    },
    workflowRun: null,
    worktreePath: null,
    latestUserAuthoredMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingSubagentRequest: null,
    latestRun:
      run === null
        ? null
        : {
            runId: RunId.make(`${id}-run`),
            status: run,
            requestedAt: null,
            startedAt: options.since ?? null,
            completedAt: null,
            assistantMessageId: null,
            ...(options.turnEnded === undefined ? {} : { turnEnded: options.turnEnded }),
          },
    source: { createdBy: options.createdBy ?? "user" },
  } as RunningThreadInput;
}

const labels = new Map<EnvironmentId, string | null>([
  [dev, "dev"],
  [bots, "bots"],
  [mac, "Josh-MacBook-Pro"],
]);
const machines = new Map<EnvironmentId, EnvironmentMachineKind>([
  [dev, "linux"],
  [bots, "server"],
  [mac, "laptop"],
]);

function build(
  threads: RunningThreadInput[],
  extra: { primary?: EnvironmentId | null; labels?: Map<EnvironmentId, string | null> } = {},
) {
  return buildRunningThreads({
    threads,
    labelByEnvironmentId: extra.labels ?? labels,
    machineByEnvironmentId: machines,
    primaryEnvironmentId: extra.primary ?? null,
    fallbackLabel: "Remote",
  });
}

const ids = (group: { readonly threads: ReadonlyArray<{ readonly thread: { id: string } }> }) =>
  group.threads.map((row) => row.thread.id as string);

describe("buildRunningThreads", () => {
  it("counts every active run status and skips finished, failed and idle threads", () => {
    const statuses: RunStatus[] = ["preparing", "queued", "starting", "running", "waiting"];
    const live = statuses.map((status) => thread(dev, `live-${status}`, { run: status }));
    const model = build([
      ...live,
      thread(dev, "done", { run: "completed" }),
      thread(dev, "failed", { run: "failed" }),
      thread(dev, "never-ran", { run: null }),
      thread(dev, "ended", { run: "running", turnEnded: true }),
    ]);
    expect(model.totalCount).toBe(5);
    expect(ids(model.groups[0]!)).toHaveLength(5);
  });

  it("leaves out archived, deleted and subagent threads", () => {
    const model = build([
      thread(dev, "main"),
      thread(dev, "archived", { archived: true }),
      thread(dev, "deleted", { deleted: true }),
      thread(dev, "subagent", { subagent: true }),
    ]);
    expect(model.groups.flatMap(ids)).toEqual(["main"]);
    expect(model.totalCount).toBe(1);
  });

  it("is empty when nothing runs", () => {
    expect(build([thread(dev, "done", { run: "completed" })])).toEqual({
      totalCount: 0,
      groups: [],
    });
  });

  it("groups by environment with its label and machine kind, whatever the input order", () => {
    const model = build([
      thread(bots, "b1"),
      thread(dev, "d1"),
      thread(bots, "b2"),
      thread(mac, "m1"),
    ]);
    expect(model.totalCount).toBe(4);
    expect(model.groups.map((group) => [group.label, group.machine, group.threads.length])).toEqual(
      [
        ["bots", "server", 2],
        ["dev", "linux", 1],
        ["Josh-MacBook-Pro", "laptop", 1],
      ],
    );
  });

  it("puts the primary environment first, then the others by name", () => {
    const threads = [thread(dev, "d1"), thread(mac, "m1"), thread(bots, "b1")];
    expect(build(threads, { primary: dev }).groups.map((group) => group.label)).toEqual([
      "dev",
      "bots",
      "Josh-MacBook-Pro",
    ]);
    // A primary with nothing running leaves the rest alphabetical.
    expect(
      build([thread(dev, "d1"), thread(bots, "b1")], { primary: mac }).groups.map(
        (group) => group.label,
      ),
    ).toEqual(["bots", "dev"]);
  });

  it("lists the newest run first within a machine", () => {
    const model = build([
      thread(dev, "old", { since: "2026-01-01T10:00:00.000Z" }),
      thread(dev, "new", { since: "2026-01-01T12:00:00.000Z" }),
      thread(dev, "mid", { since: "2026-01-01T11:00:00.000Z" }),
    ]);
    expect(ids(model.groups[0]!)).toEqual(["new", "mid", "old"]);
    expect(model.groups[0]!.threads[0]!.since).toBe("2026-01-01T12:00:00.000Z");
  });

  it("falls back to a name for an environment with no label or machine", () => {
    const unknown = EnvironmentId.make("unknown");
    const model = buildRunningThreads({
      threads: [thread(unknown, "u1")],
      labelByEnvironmentId: new Map(),
      machineByEnvironmentId: new Map(),
      primaryEnvironmentId: null,
      fallbackLabel: "Remote",
    });
    expect(model.groups[0]).toMatchObject({ label: "Remote", machine: "server" });
  });

  it("tags bot lanes as background and the user's own threads as not", () => {
    const model = build([
      thread(dev, "mine", { createdBy: "user" }),
      thread(dev, "lane", { createdBy: "agent", lane: true }),
      thread(dev, "report", { createdBy: "agent" }),
    ]);
    const background = Object.fromEntries(
      model.groups[0]!.threads.map((row) => [row.thread.id, row.background]),
    );
    expect(background).toEqual({ mine: false, lane: true, report: false });
  });

  it("honors a placement override for the background tag", () => {
    const mine = thread(dev, "mine", { createdBy: "user" });
    const model = buildRunningThreads({
      threads: [mine],
      labelByEnvironmentId: labels,
      machineByEnvironmentId: machines,
      primaryEnvironmentId: null,
      fallbackLabel: "Remote",
      placementOverrides: { "dev:mine": "background" },
    });
    expect(model.groups[0]!.threads[0]!.background).toBe(true);
  });
});

describe("runningThreadsBreakdown", () => {
  it("names each machine's count", () => {
    const model = build([thread(dev, "d1"), thread(dev, "d2"), thread(bots, "b1")]);
    expect(runningThreadsBreakdown(model)).toBe("bots: 1, dev: 2");
  });
});
