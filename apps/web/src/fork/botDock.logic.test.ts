import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "~/test-fixtures";

import {
  buildBotDock,
  botDockGroups,
  resolveBotDockClick,
  scopeForNewThread,
  withoutThreadsShownAbove,
  type BotDockGroup,
} from "./botDock.logic";
import { sidebarThreadKey } from "./sidebarHierarchy";

const bots = EnvironmentId.make("bots");
const dev = EnvironmentId.make("dev");
const NOW = "2026-11-25T12:00:00.000Z";

function group(name: string, overrides: Partial<BotDockGroup> = {}): BotDockGroup {
  const ref: ScopedProjectRef = { environmentId: bots, projectId: ProjectId.make(name) };
  return {
    projectKey: `${bots}:${name}`,
    displayName: name,
    pinned: true,
    archived: false,
    environmentId: bots,
    defaultModelSelection: null,
    memberProjectRefs: [ref],
    ...overrides,
  };
}

type RunStatus = "running" | "completed" | "failed";

function thread(
  id: string,
  project: string,
  options: {
    readonly environmentId?: EnvironmentId;
    readonly pinOrder?: string;
    readonly run?: RunStatus;
    readonly completedAt?: string;
    readonly lastVisitedAt?: string | null;
    readonly bot?: boolean;
    readonly settled?: boolean;
    readonly snoozedUntil?: string;
    readonly subagentOf?: string;
    readonly delegatedFrom?: string;
    readonly approval?: boolean;
    readonly title?: string;
    readonly provider?: string;
    readonly userMessageAt?: string;
  } = {},
) {
  const threadId = ThreadId.make(id);
  const base = makeThreadFixture({
    environmentId: options.environmentId ?? bots,
    id: threadId,
    projectId: ProjectId.make(project),
    title: options.title ?? id,
    ...(options.provider ? { providerInstanceId: ProviderInstanceId.make(options.provider) } : {}),
    ...(options.subagentOf
      ? {
          lineage: {
            rootThreadId: ThreadId.make(options.subagentOf),
            parentThreadId: ThreadId.make(options.subagentOf),
            relationshipToParent: "subagent" as const,
          },
        }
      : {}),
  });
  return {
    ...base,
    pinnedAt: options.pinOrder === undefined ? null : "2026-11-01T00:00:00.000Z",
    pinOrderKey: options.pinOrder ?? null,
    settledOverride: options.settled ? ("settled" as const) : null,
    snoozedUntil: options.snoozedUntil ?? null,
    hasPendingApprovals: options.approval ?? false,
    latestUserMessageAt: options.userMessageAt ?? null,
    lastVisitedAt: options.lastVisitedAt === undefined ? null : options.lastVisitedAt,
    delegatedFrom:
      options.delegatedFrom === undefined
        ? null
        : { environmentId: bots, threadId: ThreadId.make(options.delegatedFrom), title: "parent" },
    latestRun:
      options.run === undefined
        ? null
        : {
            runId: RunId.make(`${id}-run`),
            status: options.run,
            requestedAt: null,
            startedAt: null,
            completedAt: options.completedAt ?? null,
            assistantMessageId: null,
          },
    source: { ...base.source, createdBy: options.bot ? ("agent" as const) : ("user" as const) },
  };
}

type Thread = ReturnType<typeof thread>;

function dock(
  groups: BotDockGroup[],
  threads: Thread[],
  context: {
    readonly routeThreadKey?: string | null;
    readonly projectScopeKeys?: string[];
    readonly lens?: "all" | "needs-me" | null;
  } = {},
) {
  return buildBotDock({
    groups,
    threads,
    routeThreadKey: context.routeThreadKey ?? null,
    projectScopeKeys: context.projectScopeKeys ?? [],
    lens: context.lens ?? "all",
    now: NOW,
    localLastVisitedAt: {},
  });
}

const tileOf = (model: ReturnType<typeof dock>, name: string) =>
  model.tiles.find((tile) => tile.group.displayName === name)!;

describe("bot dock tiles", () => {
  it("shows pinned open projects in the project menu's order", () => {
    const groups = [
      group("chief"),
      group("loose", { pinned: false }),
      group("old", { archived: true }),
      group("penny"),
    ];
    expect(botDockGroups(groups).map((entry) => entry.displayName)).toEqual(["chief", "penny"]);
    expect(dock(groups, []).tiles.map((tile) => tile.key)).toEqual([
      `${bots}:chief`,
      `${bots}:penny`,
    ]);
    expect(dock([group("loose", { pinned: false })], []).tiles).toEqual([]);
  });

  it("stands for the project's top pinned thread and hides only that one", () => {
    const main = thread("main", "penny", { pinOrder: "a" });
    const second = thread("second", "penny", { pinOrder: "b" });
    const model = dock([group("penny")], [second, main]);
    const tile = tileOf(model, "penny");
    expect(tile.mainThread?.id).toBe("main");
    expect(tile.featuredThread?.id).toBe("main");
    expect(tile.topicCount).toBeNull();
    expect([...model.mainThreadKeys]).toEqual([sidebarThreadKey(main)]);
  });

  it("counts a topic desk's live threads and features the latest", () => {
    const threads = [
      thread("old", "chief", { userMessageAt: "2026-11-20T00:00:00.000Z" }),
      thread("new", "chief", { userMessageAt: "2026-11-24T00:00:00.000Z" }),
      thread("settled", "chief", { settled: true }),
      thread("snoozed", "chief", { snoozedUntil: "2026-11-26T00:00:00.000Z" }),
      thread("woke", "chief", { snoozedUntil: "2026-11-24T00:00:00.000Z" }),
      thread("subagent", "chief", { subagentOf: "new" }),
      thread("job", "chief", { bot: true }),
    ];
    const tile = tileOf(dock([group("chief")], threads), "chief");
    expect(tile.mainThread).toBeNull();
    expect(tile.topicCount).toBe(3);
    expect(tile.featuredThread?.id).toBe("new");
    expect(tile.status).toBe("idle");
  });

  it("has no count on a topic desk with nothing live", () => {
    expect(tileOf(dock([group("chief")], []), "chief").topicCount).toBeNull();
  });

  it("rolls needs, working and unread up across the project and its delegated lanes", () => {
    const main = thread("ee-main", "eagle", { pinOrder: "a" });
    const lane = thread("lane", "eer", {
      environmentId: dev,
      delegatedFrom: "ee-main",
      run: "running",
    });
    expect(tileOf(dock([group("eagle")], [main, lane]), "eagle").status).toBe("working");
    const failedJob = thread("job", "eagle", { bot: true, run: "failed" });
    expect(tileOf(dock([group("eagle")], [main, lane, failedJob]), "eagle").status).toBe("needs");
    const waiting = thread("ask", "eagle", { approval: true });
    expect(tileOf(dock([group("eagle")], [main, waiting]), "eagle").status).toBe("needs");

    const read = thread("read", "chief", {
      run: "completed",
      completedAt: "2026-11-24T00:00:00.000Z",
      lastVisitedAt: "2026-11-24T01:00:00.000Z",
    });
    expect(tileOf(dock([group("chief")], [read]), "chief").unread).toBe(false);
    const unread = thread("unread", "chief", {
      run: "completed",
      completedAt: "2026-11-24T02:00:00.000Z",
      lastVisitedAt: "2026-11-24T01:00:00.000Z",
    });
    expect(tileOf(dock([group("chief")], [read, unread]), "chief").unread).toBe(true);
  });

  it("is selected for its open main thread or an exclusive scope, and hides outside a filter", () => {
    const main = thread("main", "penny", { pinOrder: "a" });
    const groups = [group("penny"), group("chief")];
    const open = dock(groups, [main], { routeThreadKey: sidebarThreadKey(main) });
    expect(tileOf(open, "penny").selected).toBe(true);
    expect(tileOf(open, "chief").selected).toBe(false);

    const scoped = dock(groups, [main], { projectScopeKeys: [`${bots}:chief`] });
    expect(tileOf(scoped, "chief").selected).toBe(true);
    expect(tileOf(scoped, "chief").hidden).toBe(false);
    expect(tileOf(scoped, "penny").hidden).toBe(true);

    const both = dock(groups, [main], { projectScopeKeys: [`${bots}:chief`, `${bots}:penny`] });
    expect(tileOf(both, "chief").selected).toBe(false);
    expect(tileOf(both, "penny").hidden).toBe(false);

    const waiting = thread("ask", "chief", { approval: true });
    const needs = dock(groups, [main, waiting], { lens: "needs-me" });
    expect(tileOf(needs, "chief").hidden).toBe(false);
    expect(tileOf(needs, "penny").hidden).toBe(true);
    expect(tileOf(dock(groups, [main], { lens: null }), "penny").hidden).toBe(false);
  });

  it("badges the featured thread's provider, else the project's default", () => {
    const main = thread("main", "penny", { pinOrder: "a", provider: "claudeAgent" });
    expect(tileOf(dock([group("penny")], [main]), "penny").provider).toEqual({
      environmentId: bots,
      instanceId: "claudeAgent",
    });
    const withDefault = group("chief", {
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
    });
    expect(tileOf(dock([withDefault], []), "chief").provider).toEqual({
      environmentId: bots,
      instanceId: "codex",
    });
    expect(tileOf(dock([group("bare")], []), "bare").provider).toBeNull();
  });
});

describe("bot dock clicks", () => {
  const main = thread("main", "penny", { pinOrder: "a" });
  const topic = thread("topic", "chief");
  const groups = [group("penny"), group("chief")];
  const model = dock(groups, [main, topic]);
  const penny = tileOf(model, "penny");
  const chief = tileOf(model, "chief");

  it("opens a main thread, clearing a scope that would hide it", () => {
    expect(resolveBotDockClick(penny, { projectScopeKeys: [], routeThreadKey: null })).toEqual({
      scope: null,
      open: main,
    });
    expect(
      resolveBotDockClick(penny, { projectScopeKeys: [chief.key], routeThreadKey: null }),
    ).toEqual({ scope: [], open: main });
    expect(
      resolveBotDockClick(penny, { projectScopeKeys: [penny.key], routeThreadKey: null }).scope,
    ).toBeNull();
  });

  it("scopes to a topic desk and opens its latest thread, then toggles back", () => {
    expect(resolveBotDockClick(chief, { projectScopeKeys: [], routeThreadKey: null })).toEqual({
      scope: [chief.key],
      open: topic,
    });
    expect(
      resolveBotDockClick(chief, {
        projectScopeKeys: [],
        routeThreadKey: sidebarThreadKey(topic),
      }),
    ).toEqual({ scope: [chief.key], open: null });
    expect(
      resolveBotDockClick(chief, { projectScopeKeys: [chief.key], routeThreadKey: null }),
    ).toEqual({ scope: [], open: null });
  });

  it("clears a scope that hides a new thread's project", () => {
    expect(scopeForNewThread(chief.key, [])).toBeNull();
    expect(scopeForNewThread(chief.key, [chief.key])).toBeNull();
    expect(scopeForNewThread(chief.key, [penny.key])).toEqual([]);
  });
});

describe("threads shown above the list", () => {
  it("leaves them out of every section and the drawer, and keeps them searchable", () => {
    const main = thread("main", "penny", { pinOrder: "a" });
    const second = thread("second", "penny", { pinOrder: "b" });
    const active = thread("active", "chief");
    const lane = thread("lane", "chief", { bot: true, run: "running" });
    const otherBot = thread("other bot", "chief", { bot: true, run: "failed" });
    const settled = thread("settled", "chief", { settled: true });
    const partition = {
      pinnedThreads: [main, second],
      activeThreads: [active, lane],
      workingThreads: [],
      snoozedThreads: [],
      settledThreads: [settled],
      forkHierarchy: {
        lens: "all" as const,
        needsMeCount: 0,
        drawer: {
          threads: [lane, otherBot],
          listed: [lane],
          expanded: true,
          failedCount: 1,
          runningCount: 1,
        },
        botRowKeys: new Set([sidebarThreadKey(lane)]),
        hiddenThreads: [otherBot] as Thread[],
      },
    };
    const shown = new Set([main, lane, settled].map(sidebarThreadKey));
    const result = withoutThreadsShownAbove(partition, shown);
    expect(result.pinnedThreads.map((entry) => entry.id)).toEqual(["second"]);
    expect(result.activeThreads.map((entry) => entry.id)).toEqual(["active"]);
    expect(result.settledThreads).toEqual([]);
    expect(result.forkHierarchy.drawer?.threads.map((entry) => entry.id)).toEqual(["other bot"]);
    expect(result.forkHierarchy.drawer?.listed).toEqual([]);
    expect(result.forkHierarchy.drawer?.runningCount).toBe(0);
    expect(result.forkHierarchy.drawer?.failedCount).toBe(1);
    expect(result.forkHierarchy.botRowKeys.size).toBe(0);
    expect(result.forkHierarchy.hiddenThreads.map((entry) => entry.id)).toEqual([
      "other bot",
      "main",
      "lane",
      "settled",
    ]);
    expect(withoutThreadsShownAbove(partition, new Set())).toBe(partition);
  });

  it("drops the drawer when the grid holds all its threads", () => {
    const lane = thread("lane", "chief", { bot: true });
    const partition = {
      pinnedThreads: [],
      activeThreads: [],
      workingThreads: [],
      snoozedThreads: [],
      settledThreads: [],
      forkHierarchy: {
        lens: "all" as const,
        needsMeCount: 0,
        drawer: { threads: [lane], listed: [], expanded: false, failedCount: 0, runningCount: 0 },
        botRowKeys: new Set<string>(),
        hiddenThreads: [lane] as Thread[],
      },
    };
    const result = withoutThreadsShownAbove(partition, new Set([sidebarThreadKey(lane)]));
    expect(result.forkHierarchy.drawer).toBeNull();
  });
});
