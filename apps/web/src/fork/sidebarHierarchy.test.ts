import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarListItem } from "~/components/Sidebar.logic";

import { normalizeSidebarFilterPresets, type SidebarFilterPreset } from "./forkSettings";
import {
  addSidebarFilterPreset,
  applySidebarHierarchy,
  findSidebarFilterPreset,
  isHumanThread,
  removeSidebarFilterPreset,
  renameSidebarFilterPreset,
  sidebarBotRows,
  sidebarDrawerCount,
  sidebarFolderThreads,
  sidebarSettledCount,
  sidebarThreadKey,
  splitBotDrawerRows,
  threadNeedsMe,
  toggledPresetScope,
  withBotDrawerMarker,
  type SidebarHierarchyThread,
  type SidebarPartitionLists,
} from "./sidebarHierarchy";

type Thread = SidebarHierarchyThread;
type RunStatus = NonNullable<Thread["latestRun"]>["status"];

function thread(
  id: string,
  overrides: Partial<Omit<Thread, "latestRun" | "source">> & {
    readonly createdBy?: "user" | "agent" | "system";
    readonly run?: RunStatus;
  } = {},
): Thread {
  const { createdBy = "agent", run, ...rest } = overrides;
  return {
    environmentId: EnvironmentId.make("env"),
    id: ThreadId.make(id),
    title: id,
    latestUserAuthoredMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingSubagentRequest: null,
    latestRun:
      run === undefined
        ? null
        : {
            runId: RunId.make(`${id}-run`),
            status: run,
            requestedAt: null,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
    source: { createdBy },
    ...rest,
  };
}

const ids = (threads: ReadonlyArray<Thread>) => threads.map((entry) => entry.id as string);

function partition(lists: Partial<SidebarPartitionLists<Thread>>) {
  return {
    pinnedThreads: [],
    activeThreads: [],
    workingThreads: [],
    snoozedThreads: [],
    settledThreads: [],
    visibleThreads: [] as Thread[],
    ...lists,
  };
}

const options = {
  enabled: true,
  lens: "all" as const,
  botExpanded: false,
  routeThreadKey: null,
};

describe("classification", () => {
  it("counts a thread as the user's when they started it, wrote in it or are needed in it", () => {
    expect(isHumanThread(thread("mine", { createdBy: "user" }))).toBe(true);
    expect(
      isHumanThread(thread("replied", { latestUserAuthoredMessageAt: "2026-11-25T00:00:00Z" })),
    ).toBe(true);
    expect(isHumanThread(thread("approval", { hasPendingApprovals: true }))).toBe(true);
    expect(isHumanThread(thread("input", { hasPendingUserInput: true }))).toBe(true);
    expect(isHumanThread(thread("plan", { hasActionableProposedPlan: true }))).toBe(true);
    expect(
      isHumanThread(
        thread("subagent", {
          pendingSubagentRequest: {} as NonNullable<Thread["pendingSubagentRequest"]>,
        }),
      ),
    ).toBe(true);
    expect(isHumanThread(thread("pointer", { title: "  👉 Pick a flight" }))).toBe(true);
  });

  it("leaves bot-started threads the user never wrote in to the background", () => {
    expect(isHumanThread(thread("jobs"))).toBe(false);
    expect(isHumanThread(thread("system", { createdBy: "system" }))).toBe(false);
    expect(isHumanThread(thread("mid-pointer", { title: "Status 👉 later" }))).toBe(false);
    expect(isHumanThread(thread("failed", { run: "failed" }))).toBe(false);
  });

  it("needs the user when waiting on them, opened for them, or the last run failed", () => {
    expect(threadNeedsMe(thread("failed", { run: "failed" }))).toBe(true);
    expect(threadNeedsMe(thread("pointer", { title: "👉 Choose" }))).toBe(true);
    expect(threadNeedsMe(thread("approval", { hasPendingApprovals: true }))).toBe(true);
    expect(threadNeedsMe(thread("done", { run: "completed", createdBy: "user" }))).toBe(false);
  });
});

describe("applySidebarHierarchy", () => {
  const human = thread("human", { createdBy: "user" });
  const bot = thread("bot", { run: "completed" });
  const botFailed = thread("bot-failed", { run: "failed" });
  const botRunning = thread("bot-running", { run: "running" });
  const humanRunning = thread("human-running", { createdBy: "user", run: "running" });
  const pinned = thread("pinned", { createdBy: "user", pinnedAt: "x" } as never);
  const pinnedWaiting = thread("pinned-waiting", { hasPendingUserInput: true });
  const snoozed = thread("snoozed", { createdBy: "user" });
  const settled = thread("settled", { createdBy: "user" });
  const base = partition({
    pinnedThreads: [pinned, pinnedWaiting],
    activeThreads: [human, bot, botFailed],
    workingThreads: [humanRunning, botRunning],
    snoozedThreads: [snoozed],
    settledThreads: [settled],
  });

  it("returns upstream's partition when off", () => {
    const result = applySidebarHierarchy(base, { ...options, enabled: false });
    expect(ids(result.activeThreads)).toEqual(["human", "bot", "bot-failed"]);
    expect(ids(result.workingThreads)).toEqual(["human-running", "bot-running"]);
    expect(result.forkHierarchy.lens).toBeNull();
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(result.visibleThreads).toBe(base.visibleThreads);
  });

  it("folds bot threads into a closed drawer under All", () => {
    const result = applySidebarHierarchy(base, options);
    expect(ids(result.pinnedThreads)).toEqual(["pinned", "pinned-waiting"]);
    expect(ids(result.activeThreads)).toEqual(["human"]);
    expect(ids(result.workingThreads)).toEqual(["human-running"]);
    expect(ids(result.snoozedThreads)).toEqual(["snoozed"]);
    expect(ids(result.settledThreads)).toEqual(["settled"]);
    const drawer = result.forkHierarchy.drawer!;
    expect(ids(drawer.threads)).toEqual(["bot-running", "bot", "bot-failed"]);
    expect(drawer.listed).toEqual([]);
    expect(drawer).toMatchObject({ expanded: false, failedCount: 1, runningCount: 1 });
    expect(ids(result.forkHierarchy.hiddenThreads)).toEqual(["bot-running", "bot", "bot-failed"]);
    expect(sidebarDrawerCount(result.forkHierarchy)).toBe(3);
  });

  it("lists the drawer's rows after the user's threads when open", () => {
    const result = applySidebarHierarchy(base, { ...options, botExpanded: true });
    expect(ids(result.activeThreads)).toEqual(["human", "bot-running", "bot", "bot-failed"]);
    expect([...result.forkHierarchy.botRowKeys]).toEqual(
      [botRunning, bot, botFailed].map(sidebarThreadKey),
    );
    expect(result.forkHierarchy.hiddenThreads).toEqual([]);
  });

  it("keeps the open bot thread listed while the drawer is closed or left out", () => {
    const routeThreadKey = sidebarThreadKey(bot);
    for (const lens of ["all", "mine"] as const) {
      const result = applySidebarHierarchy(base, { ...options, lens, routeThreadKey });
      expect(ids(result.activeThreads)).toEqual(["human", "bot"]);
      expect([...result.forkHierarchy.botRowKeys]).toEqual([routeThreadKey]);
    }
  });

  it("leaves the drawer out under Mine but keeps the shelves", () => {
    const result = applySidebarHierarchy(base, { ...options, lens: "mine", botExpanded: true });
    expect(ids(result.activeThreads)).toEqual(["human"]);
    expect(ids(result.workingThreads)).toEqual(["human-running"]);
    expect(ids(result.snoozedThreads)).toEqual(["snoozed"]);
    expect(ids(result.settledThreads)).toEqual(["settled"]);
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(ids(result.forkHierarchy.hiddenThreads)).toEqual(["bot-running", "bot", "bot-failed"]);
  });

  it("has no drawer when no bot threads are active", () => {
    const result = applySidebarHierarchy(partition({ activeThreads: [human] }), options);
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(
      withBotDrawerMarker([{ kind: "marker", marker: "settled-header" }], result.forkHierarchy),
    ).toEqual([{ kind: "marker", marker: "settled-header" }]);
  });

  it("lists only what needs the user under Needs me, plus the open thread", () => {
    const routeThreadKey = sidebarThreadKey(settled);
    const result = applySidebarHierarchy(base, { ...options, lens: "needs-me", routeThreadKey });
    expect(ids(result.pinnedThreads)).toEqual(["pinned-waiting"]);
    expect(ids(result.activeThreads)).toEqual(["bot-failed"]);
    expect(ids(result.workingThreads)).toEqual([]);
    const working = applySidebarHierarchy(
      partition({ workingThreads: [botFailed, botRunning], activeThreads: [human] }),
      { ...options, lens: "needs-me" },
    );
    expect(ids(working.activeThreads)).toEqual(["bot-failed"]);
    expect(ids(working.workingThreads)).toEqual([]);
    expect(ids(working.forkHierarchy.hiddenThreads)).toEqual(["bot-running", "human"]);
    expect(ids(result.snoozedThreads)).toEqual([]);
    expect(ids(result.settledThreads)).toEqual(["settled"]);
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(result.forkHierarchy.needsMeCount).toBe(2);
    expect(sidebarSettledCount(result.forkHierarchy, 1, 40)).toBe(1);
    expect(sidebarSettledCount(applySidebarHierarchy(base, options).forkHierarchy, 1, 40)).toBe(40);
  });

  it("counts what needs the user across pinned, active and working whatever the filter", () => {
    for (const lens of ["all", "mine", "needs-me"] as const) {
      expect(applySidebarHierarchy(base, { ...options, lens }).forkHierarchy.needsMeCount).toBe(2);
    }
  });

  it("keeps drawer rows out of boring mode's folders", () => {
    const result = applySidebarHierarchy(base, { ...options, botExpanded: true });
    expect(ids(sidebarFolderThreads(result.activeThreads, result.forkHierarchy))).toEqual([
      "human",
    ]);
    expect(ids(sidebarBotRows(result.activeThreads, result.forkHierarchy))).toEqual([
      "bot-running",
      "bot",
      "bot-failed",
    ]);
  });
});

describe("drawer marker", () => {
  const human = thread("human", { createdBy: "user" });
  const bot = thread("bot");
  const row = (entry: Thread): SidebarListItem => ({
    kind: "thread",
    key: sidebarThreadKey(entry),
    section: "active",
  });
  const shelves: SidebarListItem[] = [
    { kind: "marker", marker: "settled-header" },
    { kind: "marker", marker: "settled-placeholder" },
  ];
  const head: SidebarListItem[] = [
    { kind: "marker", marker: "pinned-header" },
    { kind: "marker", marker: "pinned-divider" },
    { kind: "marker", marker: "active-placeholder" },
  ];

  it("goes before the first drawer row when open", () => {
    const view = applySidebarHierarchy(partition({ activeThreads: [human, bot] }), {
      ...options,
      botExpanded: true,
    }).forkHierarchy;
    const items = withBotDrawerMarker([...head, row(human), row(bot), ...shelves], view);
    expect(items.map((item) => (item.kind === "marker" ? item.marker : item.key))).toEqual([
      "pinned-header",
      "pinned-divider",
      "active-placeholder",
      sidebarThreadKey(human),
      "bot-header",
      sidebarThreadKey(bot),
      "settled-header",
      "settled-placeholder",
    ]);
    const split = splitBotDrawerRows(items, [row(human), row(bot)] as Array<{ key: string }>);
    expect(split?.human.map((entry) => entry.key)).toEqual([sidebarThreadKey(human)]);
    expect(split?.bot.map((entry) => entry.key)).toEqual([sidebarThreadKey(bot)]);
  });

  it("goes before the shelves when closed", () => {
    const view = applySidebarHierarchy(
      partition({ activeThreads: [human, bot] }),
      options,
    ).forkHierarchy;
    const items = withBotDrawerMarker([...head, row(human), ...shelves], view);
    expect(items.findIndex((item) => item.kind === "marker" && item.marker === "bot-header")).toBe(
      4,
    );
  });

  it("leaves drag previews alone without a drawer", () => {
    expect(splitBotDrawerRows([...head, ...shelves], [])).toBeNull();
  });
});

describe("saved project views", () => {
  const presets: SidebarFilterPreset[] = [
    { id: "a", name: "Bots", projectKeys: ["env:1", "env:2"] },
    { id: "b", name: "Work", projectKeys: ["env:3"] },
  ];
  let next = 0;
  const makeId = () => `new-${++next}`;

  it("matches a scope regardless of order", () => {
    expect(findSidebarFilterPreset(presets, ["env:2", "env:1"])?.id).toBe("a");
    expect(findSidebarFilterPreset(presets, ["env:1"])).toBeNull();
    expect(findSidebarFilterPreset(presets, [])).toBeNull();
  });

  it("adds a view, and renames the existing one for a set already saved", () => {
    expect(
      addSidebarFilterPreset(presets, { name: " Home ", projectKeys: ["env:4"] }, makeId),
    ).toEqual([...presets, { id: "new-1", name: "Home", projectKeys: ["env:4"] }]);
    expect(
      addSidebarFilterPreset(presets, { name: "Desk", projectKeys: ["env:3"] }, makeId),
    ).toEqual([presets[0], { id: "b", name: "Desk", projectKeys: ["env:3"] }]);
    expect(addSidebarFilterPreset(presets, { name: " ", projectKeys: ["env:4"] }, makeId)).toBe(
      presets,
    );
    expect(addSidebarFilterPreset(presets, { name: "Empty", projectKeys: [] }, makeId)).toBe(
      presets,
    );
  });

  it("removes and renames views", () => {
    expect(removeSidebarFilterPreset(presets, "a")).toEqual([presets[1]]);
    expect(renameSidebarFilterPreset(presets, "a", "Desks")[0]?.name).toBe("Desks");
    expect(renameSidebarFilterPreset(presets, "a", "   ")).toBe(presets);
  });

  it("toggles a view's scope on and off", () => {
    expect(toggledPresetScope(presets[0]!, [])).toEqual(["env:1", "env:2"]);
    expect(toggledPresetScope(presets[0]!, ["env:2", "env:1"])).toEqual([]);
    expect(toggledPresetScope(presets[0]!, ["env:3"])).toEqual(["env:1", "env:2"]);
  });
});

describe("stored views", () => {
  it("keeps well-formed views once each", () => {
    expect(
      normalizeSidebarFilterPresets([
        { id: "a", name: "Bots", projectKeys: ["env:1", "env:1", 3] },
        { id: "a", name: "Again", projectKeys: ["env:2"] },
        { id: "", name: "No id", projectKeys: ["env:2"] },
        { id: "c", name: "No projects", projectKeys: [] },
        "junk",
      ]),
    ).toEqual([{ id: "a", name: "Bots", projectKeys: ["env:1"] }]);
    expect(normalizeSidebarFilterPresets(undefined)).toEqual([]);
  });
});
