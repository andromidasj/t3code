import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { SidebarListItem } from "~/components/Sidebar.logic";

import type { SidebarFilterPreset } from "./forkSettings";

/**
 * The sidebar's quick filter. `all` lists the user's threads and folds bots' background lanes into
 * a Bot / Background drawer; `needs-me` lists only threads waiting on the user.
 */
export type SidebarFilterLens = "all" | "needs-me";

export const SIDEBAR_FILTER_LENSES: ReadonlyArray<SidebarFilterLens> = ["all", "needs-me"];

export function isSidebarFilterLens(value: unknown): value is SidebarFilterLens {
  return SIDEBAR_FILTER_LENSES.includes(value as SidebarFilterLens);
}

/** A stored lens; `mine`, dropped since, and anything unknown read as All. */
export function parseSidebarFilterLens(value: unknown): SidebarFilterLens {
  return isSidebarFilterLens(value) ? value : "all";
}

export type SidebarHierarchyThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "latestUserAuthoredMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "pendingSubagentRequest"
  | "latestRun"
  | "delegatedFrom"
  | "lineage"
  | "workflowRun"
  | "worktreePath"
> & { readonly source: { readonly createdBy: string } };

export function sidebarThreadKey(thread: Pick<SidebarHierarchyThread, "environmentId" | "id">) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** A title a bot opened for the user: it starts with 👉. */
function isPointedAtUser(thread: Pick<SidebarHierarchyThread, "title">): boolean {
  return thread.title.trim().startsWith("👉");
}

/** An approval, question, plan or subagent request is waiting on the user. */
function isWaitingOnUser(thread: SidebarHierarchyThread): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan ||
    thread.pendingSubagentRequest != null
  );
}

/** A bot started it and the user never wrote in it. */
function isBotOpened(thread: SidebarHierarchyThread): boolean {
  return thread.source.createdBy !== "user" && thread.latestUserAuthoredMessageAt == null;
}

const SCHEDULED_JOBS_TITLE = /·\s*scheduled jobs\b/i;

/**
 * Work a bot runs out of the user's sight: a delegated or subagent lane, a workflow step, an
 * agent's worktree, or a desk's scheduled-jobs thread (`Chief · scheduled jobs`).
 */
function isBackgroundLane(thread: SidebarHierarchyThread): boolean {
  return (
    thread.delegatedFrom != null ||
    thread.lineage.parentThreadId != null ||
    thread.lineage.relationshipToParent === "subagent" ||
    thread.workflowRun != null ||
    thread.worktreePath != null ||
    SCHEDULED_JOBS_TITLE.test(thread.title)
  );
}

/**
 * What the Bot / Background drawer holds: a bot's background lane the user never wrote in, with
 * nothing waiting on them and no failed run.
 */
export function isBackgroundBotThread(thread: SidebarHierarchyThread): boolean {
  return (
    isBotOpened(thread) &&
    !isWaitingOnUser(thread) &&
    !isPointedAtUser(thread) &&
    thread.latestRun?.status !== "failed" &&
    isBackgroundLane(thread)
  );
}

/**
 * Listed in the sidebar itself: everything but background lanes, so a report a bot opened on its
 * own (`Chief · inbox digest · Nov 26`) stays in view.
 */
export function isHumanThread(thread: SidebarHierarchyThread): boolean {
  return !isBackgroundBotThread(thread);
}

/**
 * What the Needs me filter lists: waiting on the user, opened for them (👉), its last run failed,
 * or a report a bot opened outside its lanes that the user has not answered or marked ✅ done.
 */
export function threadNeedsMe(thread: SidebarHierarchyThread): boolean {
  return (
    isWaitingOnUser(thread) ||
    isPointedAtUser(thread) ||
    thread.latestRun?.status === "failed" ||
    (isBotOpened(thread) && !isBackgroundLane(thread) && !thread.title.trim().startsWith("✅"))
  );
}

const RUNNING_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** A run is underway: queued, starting, running or waiting on another thread. */
export function isThreadRunning(thread: SidebarHierarchyThread): boolean {
  const run = thread.latestRun;
  return run != null && RUNNING_RUN_STATUSES.has(run.status) && run.turnEnded !== true;
}

export interface SidebarPartitionLists<T> {
  readonly pinnedThreads: readonly T[];
  readonly activeThreads: readonly T[];
  readonly workingThreads: readonly T[];
  readonly snoozedThreads: readonly T[];
  readonly settledThreads: readonly T[];
}

export interface SidebarBotDrawer<T> {
  /** Every thread in the drawer, running ones first. */
  readonly threads: readonly T[];
  /** The rows the sidebar lists under the drawer's header. */
  readonly listed: readonly T[];
  readonly expanded: boolean;
  readonly runningCount: number;
}

export interface SidebarHierarchyView<T> {
  /** Null when the hierarchy is off and the sidebar is upstream's. */
  readonly lens: SidebarFilterLens | null;
  readonly needsMeCount: number;
  /** Shown under All while bots have background threads. */
  readonly drawer: SidebarBotDrawer<T> | null;
  /** Bot threads listed in `activeThreads`: the drawer's rows, or the open thread. */
  readonly botRowKeys: ReadonlySet<string>;
  /** Threads the filter or the closed drawer leaves out, which search still finds. */
  readonly hiddenThreads: readonly T[];
}

const NO_KEYS: ReadonlySet<string> = new Set();

function disabledSidebarHierarchy<T>(): SidebarHierarchyView<T> {
  return { lens: null, needsMeCount: 0, drawer: null, botRowKeys: NO_KEYS, hiddenThreads: [] };
}

/**
 * Applies the filter to the sidebar's sections. Bot threads, active or working, move below the
 * user's own active threads as the drawer's rows; the open thread always stays listed.
 */
export function applySidebarHierarchy<
  T extends SidebarHierarchyThread,
  P extends SidebarPartitionLists<T>,
>(
  partition: P & SidebarPartitionLists<T>,
  options: {
    readonly enabled: boolean;
    readonly lens: SidebarFilterLens;
    readonly botExpanded: boolean;
    readonly routeThreadKey: string | null;
  },
): P & { readonly forkHierarchy: SidebarHierarchyView<T> } {
  if (!options.enabled) {
    return { ...partition, forkHierarchy: disabledSidebarHierarchy<T>() };
  }
  const { lens, routeThreadKey } = options;
  const isRoute = (thread: T) =>
    routeThreadKey !== null && sidebarThreadKey(thread) === routeThreadKey;
  const needsMeCount = [
    ...partition.pinnedThreads,
    ...partition.activeThreads,
    ...partition.workingThreads,
  ].filter(threadNeedsMe).length;
  const hidden: T[] = [];
  const keep = (threads: readonly T[], test: (thread: T) => boolean): T[] => {
    const kept: T[] = [];
    for (const thread of threads) (test(thread) || isRoute(thread) ? kept : hidden).push(thread);
    return kept;
  };

  if (lens === "needs-me") {
    // One flat list: a match on the Working shelf would sit behind its closed header.
    const workingThreads = keep(partition.workingThreads, () => false);
    const workingMatches = hidden.filter(threadNeedsMe);
    hidden.splice(0, hidden.length, ...hidden.filter((thread) => !threadNeedsMe(thread)));
    return {
      ...partition,
      pinnedThreads: keep(partition.pinnedThreads, threadNeedsMe),
      activeThreads: [...workingMatches, ...keep(partition.activeThreads, threadNeedsMe)],
      workingThreads,
      snoozedThreads: keep(partition.snoozedThreads, () => false),
      settledThreads: keep(partition.settledThreads, () => false),
      forkHierarchy: {
        lens,
        needsMeCount,
        drawer: null,
        botRowKeys: NO_KEYS,
        hiddenThreads: hidden,
      },
    };
  }

  const humanActive = partition.activeThreads.filter(isHumanThread);
  const humanWorking = partition.workingThreads.filter(isHumanThread);
  const bots = [
    ...partition.workingThreads.filter((thread) => !isHumanThread(thread)),
    ...partition.activeThreads.filter((thread) => !isHumanThread(thread)),
  ];
  const showDrawer = bots.length > 0;
  const listedBots = keep(bots, () => showDrawer && options.botExpanded);
  return {
    ...partition,
    activeThreads: [...humanActive, ...listedBots],
    workingThreads: humanWorking,
    forkHierarchy: {
      lens,
      needsMeCount,
      drawer: showDrawer
        ? {
            threads: bots,
            listed: listedBots,
            expanded: options.botExpanded,
            runningCount: bots.filter(isThreadRunning).length,
          }
        : null,
      botRowKeys: new Set(listedBots.map(sidebarThreadKey)),
      hiddenThreads: hidden,
    },
  };
}

/** The user's own active rows: what the active list and boring mode's folders hold. */
export function withoutBotRows<T extends SidebarHierarchyThread>(
  threads: readonly T[],
  view: SidebarHierarchyView<T>,
): readonly T[] {
  if (view.botRowKeys.size === 0) return threads;
  return threads.filter((thread) => !view.botRowKeys.has(sidebarThreadKey(thread)));
}

/** The drawer's rows, listed after the Working shelf. */
export function sidebarBotRows<T extends SidebarHierarchyThread>(
  threads: readonly T[],
  view: SidebarHierarchyView<T>,
): readonly T[] {
  if (view.botRowKeys.size === 0) return [];
  return threads.filter((thread) => view.botRowKeys.has(sidebarThreadKey(thread)));
}

/** In the needs-me filter the Settled shelf counts only what it lists. */
export function sidebarSettledCount(
  view: SidebarHierarchyView<unknown>,
  listed: number,
  total: number,
): number {
  return view.lens === "needs-me" ? listed : total;
}

/** Whether the list has anything to show beyond what upstream counts: a closed drawer. */
export function sidebarDrawerCount(view: SidebarHierarchyView<unknown>): number {
  return view.drawer?.threads.length ?? 0;
}

const LOWER_SHELF_HEADERS: ReadonlySet<string> = new Set(["snoozed-header", "settled-header"]);

/**
 * The list with the drawer below the Working shelf: its header, then its rows, right above
 * Snoozed and Settled.
 */
export function withBotDrawerMarker(
  items: readonly SidebarListItem[],
  view: SidebarHierarchyView<unknown>,
): readonly SidebarListItem[] {
  if (view.drawer === null || items.length === 0) return items;
  const isBotRow = (item: SidebarListItem) =>
    item.kind === "thread" && item.section === "active" && view.botRowKeys.has(item.key);
  const rest = items.filter((item) => !isBotRow(item));
  let index = rest.findIndex(
    (item) => item.kind === "marker" && LOWER_SHELF_HEADERS.has(item.marker),
  );
  if (index < 0) index = rest.length;
  return [
    ...rest.slice(0, index),
    { kind: "marker", marker: "bot-header" },
    ...items.filter(isBotRow),
    ...rest.slice(index),
  ];
}

/**
 * For the drag preview: splits the active rows into the user's and the drawer's (those after the
 * drawer's header in `items`). Null when the list has no drawer.
 */
export function splitBotDrawerRows<I extends { readonly key: string }>(
  items: readonly SidebarListItem[],
  activeRows: readonly I[],
): { readonly human: I[]; readonly bot: I[] } | null {
  const header = items.findIndex((item) => item.kind === "marker" && item.marker === "bot-header");
  if (header < 0) return null;
  const botKeys = new Set(
    items
      .slice(header + 1)
      .flatMap((item) => (item.kind === "thread" && item.section === "active" ? [item.key] : [])),
  );
  const human: I[] = [];
  const bot: I[] = [];
  for (const row of activeRows) (botKeys.has(row.key) ? bot : human).push(row);
  return { human, bot };
}

// Saved project views.

/** A click that adds or removes a project in the project menu instead of picking only it. */
export function isProjectScopeMultiSelectClick(event: {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

export function sameProjectKeys(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((key) => b.has(key));
}

export function findSidebarFilterPreset(
  presets: ReadonlyArray<SidebarFilterPreset>,
  projectKeys: ReadonlyArray<string>,
): SidebarFilterPreset | null {
  if (projectKeys.length === 0) return null;
  return presets.find((preset) => sameProjectKeys(preset.projectKeys, projectKeys)) ?? null;
}

/** Saves the scope as a view; a set already saved is renamed instead of saved twice. */
export function addSidebarFilterPreset(
  presets: ReadonlyArray<SidebarFilterPreset>,
  input: { readonly name: string; readonly projectKeys: ReadonlyArray<string> },
  makeId: () => string,
): ReadonlyArray<SidebarFilterPreset> {
  const name = input.name.trim();
  const projectKeys = [...new Set(input.projectKeys)];
  if (name === "" || projectKeys.length === 0) return presets;
  const existing = findSidebarFilterPreset(presets, projectKeys);
  if (existing !== null) return renameSidebarFilterPreset(presets, existing.id, name);
  return [...presets, { id: makeId(), name, projectKeys }];
}

export function removeSidebarFilterPreset(
  presets: ReadonlyArray<SidebarFilterPreset>,
  id: string,
): ReadonlyArray<SidebarFilterPreset> {
  return presets.filter((preset) => preset.id !== id);
}

export function renameSidebarFilterPreset(
  presets: ReadonlyArray<SidebarFilterPreset>,
  id: string,
  name: string,
): ReadonlyArray<SidebarFilterPreset> {
  const trimmed = name.trim();
  if (trimmed === "") return presets;
  return presets.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset));
}

/** Clicking a view's chip: the view's projects, or every project when it is already on. */
export function toggledPresetScope(
  preset: SidebarFilterPreset,
  projectKeys: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return sameProjectKeys(preset.projectKeys, projectKeys) ? [] : preset.projectKeys;
}
