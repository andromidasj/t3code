import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type ProviderInstanceId,
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveThreadLastVisitedAt,
  sortPinnedThreadsForSidebar,
} from "~/components/Sidebar.logic";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

import {
  isHumanThread,
  isThreadRunning,
  sidebarThreadKey,
  threadNeedsMe,
  type SidebarFilterLens,
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
  readonly dimmed: boolean;
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
function isLiveThread(thread: BotDockThread, now: string): boolean {
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
  /** Null when the sidebar filter is off. */
  readonly lens: SidebarFilterLens | null;
  readonly now: string;
  readonly localLastVisitedAt: Readonly<Record<string, string>>;
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
    const yours = rolled.filter((thread) => thread === mainThread || isHumanThread(thread));
    const featuredThread = mainThread ?? yours[0] ?? live[0] ?? null;
    if (mainThread !== undefined) mainThreadKeys.add(sidebarThreadKey(mainThread));
    const status: BotDockStatus = rolled.some(threadNeedsMe)
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
      dimmed:
        (input.lens === "needs-me" && status !== "needs") ||
        (input.projectScopeKeys.length > 0 && !input.projectScopeKeys.includes(group.projectKey)),
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

/** The Pinned list without the main threads the dock already shows; search still finds them. */
export function withoutDockedPinnedThreads<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
  P extends Pick<SidebarPartitionLists<T>, "pinnedThreads">,
  V extends Pick<SidebarHierarchyView<T>, "hiddenThreads">,
>(partition: P & { readonly forkHierarchy: V }, mainThreadKeys: ReadonlySet<string>) {
  if (mainThreadKeys.size === 0) return partition;
  const docked = (thread: T) => mainThreadKeys.has(sidebarThreadKey(thread));
  const hidden = partition.pinnedThreads.filter(docked);
  if (hidden.length === 0) return partition;
  return {
    ...partition,
    pinnedThreads: partition.pinnedThreads.filter((thread) => !docked(thread)),
    forkHierarchy: {
      ...partition.forkHierarchy,
      hiddenThreads: [...partition.forkHierarchy.hiddenThreads, ...hidden],
    },
  };
}
