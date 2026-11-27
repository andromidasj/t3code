import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type ProviderInstanceId,
  type ScopedProjectRef,
} from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveThreadLastVisitedAt,
  sortPinnedThreadsForSidebar,
} from "~/components/Sidebar.logic";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

import type { ThreadPlacementOverrides } from "./forkSettings";
import {
  isHumanThread,
  isThreadRunning,
  sidebarThreadKey,
  threadNeedsMe,
  type SidebarHierarchyThread,
  type SidebarHierarchyView,
  type SidebarPartitionLists,
} from "./sidebarHierarchy";
import { indexLineageThreads, lineageProjectKey, lineageProjectKeys } from "./sidebarLineage";

export type BotDockThread = EnvironmentThreadShell;

export type BotDockGroup = Pick<
  SidebarProjectSnapshot,
  "projectKey" | "displayName" | "pinned" | "archived" | "environmentId" | "defaultModelSelection"
> & { readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef> };

export type BotDockStatus = "needs" | "working" | "idle";

export interface BotDockTile<T extends BotDockThread, G extends BotDockGroup> {
  readonly key: string;
  readonly group: G;
  /** The project's top pinned thread, which the tile stands for; null for a topic desk. */
  readonly mainThread: T | null;
  /** What the tooltip and the badge describe: the main thread, else the latest live one. */
  readonly featuredThread: T | null;
  /** The provider the badge shows. */
  readonly provider: {
    readonly environmentId: EnvironmentId;
    readonly instanceId: ProviderInstanceId;
  } | null;
  readonly status: BotDockStatus;
  readonly unread: boolean;
  /** A topic desk's live threads; null for a main-thread bot or a desk with none. */
  readonly topicCount: number | null;
  readonly selected: boolean;
  /** Outside Needs me or the project scope; the dock leaves it out. */
  readonly hidden: boolean;
  /** Every live thread the tile rolls up, its delegated lanes included. */
  readonly threadKeys: ReadonlySet<string>;
}

export interface BotDockModel<T extends BotDockThread, G extends BotDockGroup> {
  readonly tiles: ReadonlyArray<BotDockTile<T, G>>;
  /** Main threads the dock shows, which the Pinned list leaves out. */
  readonly mainThreadKeys: ReadonlySet<string>;
}

const EMPTY_KEYS: ReadonlySet<string> = new Set();

export function emptyBotDock<T extends BotDockThread, G extends BotDockGroup>(): BotDockModel<
  T,
  G
> {
  return { tiles: [], mainThreadKeys: EMPTY_KEYS };
}

/** Pinned open projects, in the project menu's order. */
export function botDockGroups<G extends BotDockGroup>(groups: ReadonlyArray<G>): G[] {
  return groups.filter((group) => group.pinned && !group.archived);
}

function activityMs(thread: BotDockThread): number {
  const at = resolveThreadActivityTimestamp(thread) ?? thread.updatedAt;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Listed in the sidebar's Pinned, Active or Working: not archived, settled or snoozed. */
export function isLiveThread(thread: BotDockThread, now: string): boolean {
  return (
    thread.archivedAt === null &&
    thread.settledOverride !== "settled" &&
    isListedThreadLineage(thread.lineage) &&
    !effectiveSnoozed(thread, { now })
  );
}

export function buildBotDock<T extends BotDockThread, G extends BotDockGroup>(input: {
  readonly groups: ReadonlyArray<G>;
  readonly threads: ReadonlyArray<T>;
  readonly routeThreadKey: string | null;
  readonly projectScopeKeys: ReadonlyArray<string>;
  readonly now: string;
  readonly localLastVisitedAt: Readonly<Record<string, string>>;
  readonly placementOverrides?: ThreadPlacementOverrides;
}): BotDockModel<T, G> {
  const groups = botDockGroups(input.groups);
  if (groups.length === 0) return emptyBotDock();
  const groupKeyByProjectKey = new Map<string, string>();
  for (const group of groups) {
    for (const ref of group.memberProjectRefs) {
      groupKeyByProjectKey.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
    }
  }
  const index = indexLineageThreads(input.threads);
  const liveByGroup = new Map<string, T[]>();
  const pinnedByGroup = new Map<string, T[]>();
  for (const thread of input.threads) {
    const ownGroup = groupKeyByProjectKey.get(lineageProjectKey(thread));
    if (ownGroup !== undefined && thread.pinnedAt != null && thread.archivedAt === null) {
      pinnedByGroup.set(ownGroup, [...(pinnedByGroup.get(ownGroup) ?? []), thread]);
    }
    if (!isLiveThread(thread, input.now)) continue;
    const groupKeys = new Set<string>();
    for (const projectKey of lineageProjectKeys(thread, index)) {
      const groupKey = groupKeyByProjectKey.get(projectKey);
      if (groupKey !== undefined) groupKeys.add(groupKey);
    }
    for (const groupKey of groupKeys) {
      liveByGroup.set(groupKey, [...(liveByGroup.get(groupKey) ?? []), thread]);
    }
  }
  const isUnread = (thread: T) =>
    hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        input.localLastVisitedAt[sidebarThreadKey(thread)],
      ),
    });
  const scopedOnly = input.projectScopeKeys.length === 1 ? input.projectScopeKeys[0] : null;
  const mainThreadKeys = new Set<string>();
  const tiles = groups.map((group): BotDockTile<T, G> => {
    const mainThread = sortPinnedThreadsForSidebar(pinnedByGroup.get(group.projectKey) ?? [])[0];
    const live = (liveByGroup.get(group.projectKey) ?? []).toSorted(
      (left, right) => activityMs(right) - activityMs(left),
    );
    const rolled =
      mainThread === undefined || live.includes(mainThread) ? live : [mainThread, ...live];
    const yours = rolled.filter(
      (thread) => thread === mainThread || isHumanThread(thread, input.placementOverrides),
    );
    const featuredThread = mainThread ?? yours[0] ?? live[0] ?? null;
    if (mainThread !== undefined) mainThreadKeys.add(sidebarThreadKey(mainThread));
    const status: BotDockStatus = rolled.some((thread) =>
      threadNeedsMe(thread, input.placementOverrides),
    )
      ? "needs"
      : rolled.some(isThreadRunning)
        ? "working"
        : "idle";
    const topicThreads = yours.length;
    const defaultInstanceId = group.defaultModelSelection?.instanceId;
    return {
      key: group.projectKey,
      group,
      mainThread: mainThread ?? null,
      featuredThread,
      provider:
        featuredThread !== null
          ? {
              environmentId: featuredThread.environmentId,
              instanceId: featuredThread.providerInstanceId,
            }
          : defaultInstanceId !== undefined
            ? { environmentId: group.environmentId, instanceId: defaultInstanceId }
            : null,
      status,
      unread: yours.some(isUnread),
      topicCount: mainThread === undefined && topicThreads > 0 ? topicThreads : null,
      selected:
        (mainThread !== undefined &&
          input.routeThreadKey !== null &&
          sidebarThreadKey(mainThread) === input.routeThreadKey) ||
        scopedOnly === group.projectKey,
      hidden:
        input.projectScopeKeys.length > 0 && !input.projectScopeKeys.includes(group.projectKey),
      threadKeys: new Set(rolled.map(sidebarThreadKey)),
    };
  });
  return { tiles, mainThreadKeys };
}

/** What a tile's click does: the project scope to set (null leaves it) and the thread to open. */
export function resolveBotDockClick<T extends BotDockThread, G extends BotDockGroup>(
  tile: BotDockTile<T, G>,
  context: {
    readonly projectScopeKeys: ReadonlyArray<string>;
    readonly routeThreadKey: string | null;
  },
): { readonly scope: ReadonlyArray<string> | null; readonly open: T | null } {
  const { projectScopeKeys, routeThreadKey } = context;
  if (tile.mainThread !== null) {
    // A scope without this project would hide the thread it opens.
    const hides = projectScopeKeys.length > 0 && !projectScopeKeys.includes(tile.key);
    return { scope: hides ? [] : null, open: tile.mainThread };
  }
  if (isScopedToTile(tile.key, projectScopeKeys)) return { scope: [], open: null };
  const viewingOne = routeThreadKey !== null && tile.threadKeys.has(routeThreadKey);
  return { scope: [tile.key], open: viewingOne ? null : tile.featuredThread };
}

export function isScopedToTile(key: string, projectScopeKeys: ReadonlyArray<string>): boolean {
  return projectScopeKeys.length === 1 && projectScopeKeys[0] === key;
}

/** A new thread in a project the scope hides clears the scope, so its draft stays in view. */
export function scopeForNewThread(
  key: string,
  projectScopeKeys: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  return projectScopeKeys.length > 0 && !projectScopeKeys.includes(key) ? [] : null;
}

/**
 * The list without the threads the dock or a Space's grid already shows, from every section and
 * the Bot / Background drawer; search still finds them.
 */
export function withoutThreadsShownAbove<
  T extends SidebarHierarchyThread,
  P extends SidebarPartitionLists<T>,
  V extends SidebarHierarchyView<T>,
>(partition: P & { readonly forkHierarchy: V }, shownKeys: ReadonlySet<string>) {
  if (shownKeys.size === 0) return partition;
  const shown = (thread: T) => shownKeys.has(sidebarThreadKey(thread));
  const hidden: T[] = [];
  const strip = (threads: readonly T[]): readonly T[] => {
    if (!threads.some(shown)) return threads;
    hidden.push(...threads.filter(shown));
    return threads.filter((thread) => !shown(thread));
  };
  const view = partition.forkHierarchy;
  const drawerThreads = view.drawer?.threads.filter((thread) => !shown(thread)) ?? [];
  const drawer =
    view.drawer === null || drawerThreads.length === 0
      ? null
      : {
          ...view.drawer,
          threads: drawerThreads,
          listed: view.drawer.listed.filter((thread) => !shown(thread)),
          runningCount: drawerThreads.filter(isThreadRunning).length,
        };
  return {
    ...partition,
    pinnedThreads: strip(partition.pinnedThreads),
    activeThreads: strip(partition.activeThreads),
    workingThreads: strip(partition.workingThreads),
    snoozedThreads: strip(partition.snoozedThreads),
    settledThreads: strip(partition.settledThreads),
    forkHierarchy: {
      ...view,
      drawer,
      botRowKeys:
        view.botRowKeys.size === 0
          ? view.botRowKeys
          : new Set([...view.botRowKeys].filter((key) => !shownKeys.has(key))),
      hiddenThreads: [...view.hiddenThreads, ...hidden],
    },
  };
}
