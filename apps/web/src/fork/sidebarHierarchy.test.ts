import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarListItem } from "~/components/Sidebar.logic";

import { normalizeSidebarFilterPresets, type SidebarFilterPreset } from "./forkSettings";
import {
  addSidebarFilterPreset,
  applySidebarHierarchy,
  findSidebarFilterPreset,
  isProjectScopeMultiSelectClick,
  isBackgroundBotThread,
  isHumanThread,
  removeSidebarFilterPreset,
  renameSidebarFilterPreset,
  sidebarBotRows,
  sidebarDrawerCount,
  sidebarThreadKey,
  splitBotDrawerRows,
  threadNeedsMe,
  toggledPresetScope,
  toggleThreadPlacementOverride,
  withBotDrawerMarker,
  withoutBotRows,
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
    /** A lane delegated from another thread, the usual background bot thread. */
    readonly lane?: boolean;
  } = {},
): Thread {
  const { createdBy = "agent", run, lane = false, ...rest } = overrides;
  return {
    environmentId: EnvironmentId.make("env"),
    id: ThreadId.make(id),
    title: id,
    delegatedFrom: lane
      ? { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("parent"), title: "p" }
      : null,
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    workflowRun: null,
    worktreePath: null,
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

  it("leaves bots' background lanes the user never wrote in to the drawer", () => {
    const parent = ThreadId.make("parent");
    expect(isBackgroundBotThread(thread("delegated", { lane: true }))).toBe(true);
    expect(isBackgroundBotThread(thread("system", { createdBy: "system", lane: true }))).toBe(true);
    expect(
      isBackgroundBotThread(
        thread("subagent", {
          lineage: { rootThreadId: parent, parentThreadId: parent, relationshipToParent: null },
        }),
      ),
    ).toBe(true);
    expect(
      isBackgroundBotThread(
        thread("workflow", { workflowRun: {} as NonNullable<Thread["workflowRun"]> }),
      ),
    ).toBe(true);
    expect(isBackgroundBotThread(thread("worktree", { worktreePath: "/worktrees/lane" }))).toBe(
      true,
    );
    expect(isBackgroundBotThread(thread("jobs", { title: "Chief · scheduled jobs" }))).toBe(true);
    expect(
      isBackgroundBotThread(thread("mid-pointer", { lane: true, title: "Status 👉 later" })),
    ).toBe(true);
    expect(isHumanThread(thread("lane", { lane: true }))).toBe(false);
  });

  it("keeps lanes that need the user, and every other thread, in the sidebar", () => {
    expect(isHumanThread(thread("failed", { lane: true, run: "failed" }))).toBe(true);
    expect(isHumanThread(thread("waiting", { lane: true, hasPendingUserInput: true }))).toBe(true);
    expect(isHumanThread(thread("pointer", { lane: true, title: "👉 Review" }))).toBe(true);
    expect(isHumanThread(thread("mine", { lane: true, createdBy: "user" }))).toBe(true);
    expect(
      isHumanThread(
        thread("answered", { lane: true, latestUserAuthoredMessageAt: "2026-11-25T00:00:00Z" }),
      ),
    ).toBe(true);
    // A report a bot opened on its own is no lane.
    expect(isHumanThread(thread("digest", { title: "Chief · inbox digest · Nov 26" }))).toBe(true);
    expect(isHumanThread(thread("system", { createdBy: "system" }))).toBe(true);
  });

  it("needs the user when waiting on them, opened for them, or the last run failed", () => {
    expect(threadNeedsMe(thread("failed", { lane: true, run: "failed" }))).toBe(true);
    expect(threadNeedsMe(thread("pointer", { lane: true, title: "👉 Choose" }))).toBe(true);
    expect(threadNeedsMe(thread("approval", { lane: true, hasPendingApprovals: true }))).toBe(true);
    expect(threadNeedsMe(thread("done", { run: "completed", createdBy: "user" }))).toBe(false);
    expect(threadNeedsMe(thread("lane", { lane: true, run: "completed" }))).toBe(false);
    expect(threadNeedsMe(thread("jobs", { title: "Chief · scheduled jobs" }))).toBe(false);
  });

  it("needs the user for a bot's own report until they answer it or mark it done", () => {
    const digest = { title: "Chief · inbox digest · Nov 26", run: "completed" as const };
    expect(threadNeedsMe(thread("digest", digest))).toBe(true);
    expect(
      threadNeedsMe(
        thread("answered", { ...digest, latestUserAuthoredMessageAt: "2026-11-26T15:00:00Z" }),
      ),
    ).toBe(false);
    expect(threadNeedsMe(thread("done", { ...digest, title: "✅ Inbox digest read" }))).toBe(false);
    expect(threadNeedsMe(thread("mine", { ...digest, createdBy: "user" }))).toBe(false);
  });
});

describe("placement overrides", () => {
  const lane = thread("lane", { lane: true, run: "completed" });
  const mine = thread("mine", { createdBy: "user", run: "completed" });
  const digest = thread("digest", { title: "Chief · inbox digest", run: "completed" });
  const key = (entry: Thread) => sidebarThreadKey(entry);

  it("keeps a delegated lane in the main sidebar when forced to main", () => {
    expect(isBackgroundBotThread(lane, { [key(lane)]: "main" })).toBe(false);
    expect(isHumanThread(lane, { [key(lane)]: "main" })).toBe(true);
  });

  it("moves a thread the user started, or a bot's report, to Bot / Background when forced", () => {
    expect(isBackgroundBotThread(mine, { [key(mine)]: "background" })).toBe(true);
    expect(isBackgroundBotThread(digest, { [key(digest)]: "background" })).toBe(true);
    expect(isBackgroundBotThread(mine)).toBe(false);
  });

  it("never hides a thread that waits on the user or failed, whatever the override", () => {
    for (const waiting of [
      thread("approval", { hasPendingApprovals: true }),
      thread("input", { hasPendingUserInput: true }),
      thread("plan", { hasActionableProposedPlan: true }),
      thread("failed", { run: "failed" }),
      thread("pointer", { title: "👉 Pick" }),
    ]) {
      expect(isBackgroundBotThread(waiting, { [key(waiting)]: "background" })).toBe(false);
    }
  });

  it("ignores overrides for other threads", () => {
    expect(isBackgroundBotThread(lane, { [key(mine)]: "main" })).toBe(true);
  });

  it("leaves a forced-background report out of Needs me", () => {
    expect(threadNeedsMe(digest)).toBe(true);
    expect(threadNeedsMe(digest, { [key(digest)]: "background" })).toBe(false);
    expect(threadNeedsMe(digest, { [key(digest)]: "main" })).toBe(true);
  });

  it("sets an override only when it differs from the automatic placement", () => {
    expect(toggleThreadPlacementOverride({}, lane, "main")).toEqual({ [key(lane)]: "main" });
    expect(toggleThreadPlacementOverride({}, mine, "background")).toEqual({
      [key(mine)]: "background",
    });
    expect(toggleThreadPlacementOverride({}, lane, "background")).toEqual({});
    expect(toggleThreadPlacementOverride({}, mine, "main")).toEqual({});
  });

  it("clears the override when the thread returns to its automatic placement", () => {
    const other = { [key(mine)]: "background" as const };
    expect(
      toggleThreadPlacementOverride({ [key(lane)]: "main", ...other }, lane, "background"),
    ).toEqual(other);
    expect(toggleThreadPlacementOverride({ [key(mine)]: "background" }, mine, "main")).toEqual({});
  });

  it("moves overridden threads between the list and the drawer", () => {
    const result = applySidebarHierarchy(partition({ activeThreads: [lane, mine, digest] }), {
      ...options,
      botExpanded: true,
      placementOverrides: { [key(lane)]: "main", [key(mine)]: "background" },
    });
    expect(ids(result.activeThreads)).toEqual(["lane", "digest", "mine"]);
    expect(ids(result.forkHierarchy.drawer?.threads ?? [])).toEqual(["mine"]);
  });

  it("no longer counts a forced-background report as needing the user", () => {
    expect(threadNeedsMe(digest)).toBe(true);
    expect(threadNeedsMe(digest, { [key(digest)]: "background" })).toBe(false);
  });
});

describe("applySidebarHierarchy", () => {
  const human = thread("human", { createdBy: "user" });
  const bot = thread("bot", { lane: true, run: "completed" });
  const botFailed = thread("bot-failed", { lane: true, run: "failed" });
  const botRunning = thread("bot-running", { lane: true, run: "running" });
  const report = thread("report", { title: "Chief · inbox digest", run: "completed" });
  const humanRunning = thread("human-running", { createdBy: "user", run: "running" });
  const pinned = thread("pinned", { createdBy: "user", pinnedAt: "x" } as never);
  const pinnedWaiting = thread("pinned-waiting", { lane: true, hasPendingUserInput: true });
  const snoozed = thread("snoozed", { createdBy: "user" });
  const settled = thread("settled", { createdBy: "user" });
  const base = partition({
    pinnedThreads: [pinned, pinnedWaiting],
    activeThreads: [human, report, bot, botFailed],
    workingThreads: [humanRunning, botRunning],
    snoozedThreads: [snoozed],
    settledThreads: [settled],
  });

  it("returns upstream's partition when off", () => {
    const result = applySidebarHierarchy(base, { ...options, enabled: false });
    expect(ids(result.activeThreads)).toEqual(["human", "report", "bot", "bot-failed"]);
    expect(ids(result.workingThreads)).toEqual(["human-running", "bot-running"]);
    expect(result.forkHierarchy.enabled).toBe(false);
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(result.visibleThreads).toBe(base.visibleThreads);
  });

  it("folds bots' quiet lanes into a closed drawer, keeping reports and failures", () => {
    const result = applySidebarHierarchy(base, options);
    expect(ids(result.pinnedThreads)).toEqual(["pinned", "pinned-waiting"]);
    expect(ids(result.activeThreads)).toEqual(["human", "report", "bot-failed"]);
    expect(ids(result.workingThreads)).toEqual(["human-running"]);
    expect(ids(result.snoozedThreads)).toEqual(["snoozed"]);
    expect(ids(result.settledThreads)).toEqual(["settled"]);
    const drawer = result.forkHierarchy.drawer!;
    expect(ids(drawer.threads)).toEqual(["bot-running", "bot"]);
    expect(drawer.listed).toEqual([]);
    expect(drawer).toMatchObject({ expanded: false, runningCount: 1 });
    expect(ids(result.forkHierarchy.hiddenThreads)).toEqual(["bot-running", "bot"]);
    expect(sidebarDrawerCount(result.forkHierarchy)).toBe(2);
  });

  it("lists the drawer's rows after the user's threads when open", () => {
    const result = applySidebarHierarchy(base, { ...options, botExpanded: true });
    expect(ids(result.activeThreads)).toEqual([
      "human",
      "report",
      "bot-failed",
      "bot-running",
      "bot",
    ]);
    expect([...result.forkHierarchy.botRowKeys]).toEqual([botRunning, bot].map(sidebarThreadKey));
    expect(result.forkHierarchy.hiddenThreads).toEqual([]);
  });

  it("keeps the open bot thread listed while the drawer is closed", () => {
    const routeThreadKey = sidebarThreadKey(bot);
    const result = applySidebarHierarchy(base, { ...options, routeThreadKey });
    expect(ids(result.activeThreads)).toEqual(["human", "report", "bot-failed", "bot"]);
    expect([...result.forkHierarchy.botRowKeys]).toEqual([routeThreadKey]);
  });

  it("has no drawer when no bot threads are active", () => {
    const result = applySidebarHierarchy(partition({ activeThreads: [human] }), options);
    expect(result.forkHierarchy.drawer).toBeNull();
    expect(
      withBotDrawerMarker([{ kind: "marker", marker: "settled-header" }], result.forkHierarchy),
    ).toEqual([{ kind: "marker", marker: "settled-header" }]);
  });

  it("keeps drawer rows out of boring mode's folders", () => {
    const result = applySidebarHierarchy(base, { ...options, botExpanded: true });
    expect(ids(withoutBotRows(result.activeThreads, result.forkHierarchy))).toEqual([
      "human",
      "report",
      "bot-failed",
    ]);
    expect(ids(sidebarBotRows(result.activeThreads, result.forkHierarchy))).toEqual([
      "bot-running",
      "bot",
    ]);
  });
});

describe("drawer marker", () => {
  const human = thread("human", { createdBy: "user" });
  const bot = thread("bot", { lane: true });
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

  const working: SidebarListItem[] = [
    { kind: "marker", marker: "working-header" },
    { kind: "thread", key: "working", section: "working" },
  ];
  const snoozed: SidebarListItem[] = [
    { kind: "marker", marker: "snoozed-header" },
    { kind: "thread", key: "snoozed", section: "snoozed" },
  ];
  const names = (items: readonly SidebarListItem[]) =>
    items.map((item) => (item.kind === "marker" ? item.marker : item.key));

  it("lists the open drawer below Working, right above Snoozed and Settled", () => {
    const view = applySidebarHierarchy(partition({ activeThreads: [human, bot] }), {
      ...options,
      botExpanded: true,
    }).forkHierarchy;
    const items = withBotDrawerMarker(
      [...head, row(human), row(bot), ...working, ...snoozed, ...shelves],
      view,
    );
    expect(names(items)).toEqual([
      "pinned-header",
      "pinned-divider",
      "active-placeholder",
      sidebarThreadKey(human),
      "working-header",
      "working",
      "bot-header",
      sidebarThreadKey(bot),
      "snoozed-header",
      "snoozed",
      "settled-header",
      "settled-placeholder",
    ]);
    const split = splitBotDrawerRows(items, [row(human), row(bot)] as Array<{ key: string }>);
    expect(split?.human.map((entry) => entry.key)).toEqual([sidebarThreadKey(human)]);
    expect(split?.bot.map((entry) => entry.key)).toEqual([sidebarThreadKey(bot)]);
  });

  it("goes right above Settled when closed and nothing works or sleeps", () => {
    const view = applySidebarHierarchy(
      partition({ activeThreads: [human, bot] }),
      options,
    ).forkHierarchy;
    const items = withBotDrawerMarker([...head, row(human), ...shelves], view);
    expect(names(items).slice(3)).toEqual([
      sidebarThreadKey(human),
      "bot-header",
      "settled-header",
      "settled-placeholder",
    ]);
  });

  it("leaves drag previews alone without a drawer", () => {
    expect(splitBotDrawerRows([...head, ...shelves], [])).toBeNull();
  });
});

describe("project menu multi-select", () => {
  it("toggles a project on Shift-, ⌘- or Ctrl-click and picks only it otherwise", () => {
    const click = { shiftKey: false, metaKey: false, ctrlKey: false };
    expect(isProjectScopeMultiSelectClick(click)).toBe(false);
    expect(isProjectScopeMultiSelectClick({ ...click, shiftKey: true })).toBe(true);
    expect(isProjectScopeMultiSelectClick({ ...click, metaKey: true })).toBe(true);
    expect(isProjectScopeMultiSelectClick({ ...click, ctrlKey: true })).toBe(true);
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
