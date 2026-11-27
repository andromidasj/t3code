import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef } from "@t3tools/contracts";

import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

import type { ThreadPlacementOverrides } from "./forkSettings";
import { isLiveThread } from "./botDock.logic";
import {
  isHumanThread,
  isThreadRunning,
  sidebarThreadKey,
  threadNeedsMe,
} from "./sidebarHierarchy";
import {
  indexLineageThreads,
  lineageAncestorKeys,
  lineageProjectKey,
  lineageProjectKeys,
  type LineageIndex,
} from "./sidebarLineage";
import {
  resolveSpaces,
  spaceIdForProject,
  type ResolvedSpaces,
  type SidebarSpace,
  type SidebarSpacesState,
} from "./spaces.logic";

export type SpacesThread = EnvironmentThreadShell;
export type SpacesGroup = Pick<
  SidebarProjectSnapshot,
  "projectKey" | "displayName" | "archived" | "memberProjectRefs"
>;

const refKey = (ref: Pick<ScopedProjectRef, "environmentId" | "projectId">) =>
  `${ref.environmentId}:${ref.projectId}`;

export interface SpaceProjectIndex<G extends SpacesGroup> {
  /** Open project groups by Space, in the project menu's order. */
  readonly groupsBySpace: ReadonlyMap<string, ReadonlyArray<G>>;
  readonly spaceByRefKey: ReadonlyMap<string, string>;
  readonly groupByRefKey: ReadonlyMap<string, G>;
}

function indexSpaceProjects<G extends SpacesGroup>(
  resolved: ResolvedSpaces,
  groups: ReadonlyArray<G>,
): SpaceProjectIndex<G> {
  const groupsBySpace = new Map<string, G[]>(resolved.spaces.map((space) => [space.id, []]));
  const spaceByRefKey = new Map<string, string>();
  const groupByRefKey = new Map<string, G>();
  for (const group of groups) {
    if (group.archived) continue;
    const spaceId = spaceIdForProject(resolved, group.projectKey);
    groupsBySpace.get(spaceId)!.push(group);
    for (const ref of group.memberProjectRefs) {
      spaceByRefKey.set(refKey(ref), spaceId);
      groupByRefKey.set(refKey(ref), group);
    }
  }
  return { groupsBySpace, spaceByRefKey, groupByRefKey };
}

/**
 * The Spaces that list a thread: its own project's first, then those of the threads it was
 * delegated or spawned from, so a coding lane stays with the bot that started it.
 */
function threadSpaceIds<T extends SpacesThread>(
  thread: T,
  lineage: LineageIndex<T>,
  spaceByRefKey: ReadonlyMap<string, string>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  for (const projectKey of lineageProjectKeys(thread, lineage)) {
    const spaceId = spaceByRefKey.get(projectKey);
    if (spaceId !== undefined && !ids.includes(spaceId)) ids.push(spaceId);
  }
  return ids;
}

export type SpaceTileStatus = "needs" | "working" | "idle";

export interface SpaceGridTile<T extends SpacesThread, G extends SpacesGroup> {
  readonly key: string;
  readonly thread: T;
  /** The thread's own project; null when it is archived or not loaded. */
  readonly group: G | null;
  readonly label: string;
  readonly defaultLabel: string;
  /** Rolls up the lanes delegated or spawned from it. */
  readonly status: SpaceTileStatus;
  readonly unread: boolean;
  readonly selected: boolean;
}

export interface SpaceStats {
  readonly projectCount: number;
  readonly needsCount: number;
  readonly unreadCount: number;
}

export interface SpacesView<T extends SpacesThread, G extends SpacesGroup> {
  readonly resolved: ResolvedSpaces;
  /** The Space the sidebar shows this render: the active one, or the one a new route opened in. */
  readonly shownSpace: SidebarSpace;
  /** Set when the route just opened a thread the shown Space does not list. */
  readonly routeSpaceId: string | null;
  /** The open thread or draft has a project in some Space. */
  readonly routeOwnerKnown: boolean;
  readonly projects: SpaceProjectIndex<G>;
  /** The shown Space's tiles, in pin order; under Needs me, only those waiting on the user. */
  readonly tiles: ReadonlyArray<SpaceGridTile<T, G>>;
  /** Every thread the shown Space's grid holds, which the list below leaves out. */
  readonly gridThreadKeys: ReadonlySet<string>;
  readonly stats: ReadonlyMap<string, SpaceStats>;
  /** The Spaces each loaded thread lists in. */
  readonly spaceIdsByThreadKey: ReadonlyMap<string, ReadonlyArray<string>>;
}

const TICKET_ID = /^[A-Z][A-Z0-9]+-\d+/u;

/** A short tile label from a thread title: a leading ticket id, else the title without its 👉. */
export function conciseThreadLabel(title: string): string {
  const cleaned = title.replace(/^\s*👉\s*/u, "").trim();
  return cleaned.match(TICKET_ID)?.[0] ?? cleaned;
}

export function buildSpacesView<T extends SpacesThread, G extends SpacesGroup>(input: {
  readonly state: SidebarSpacesState;
  readonly groups: ReadonlyArray<G>;
  readonly threads: ReadonlyArray<T>;
  readonly routeThreadKey: string | null;
  /** True on the render a route opens a thread; a Space switch never sets it. */
  readonly routeChanged: boolean;
  /** The open draft's project, for a route with no thread yet. */
  readonly routeDraftProject: Pick<ScopedProjectRef, "environmentId" | "projectId"> | null;
  readonly now: string;
  readonly localLastVisitedAt: Readonly<Record<string, string>>;
  readonly placementOverrides?: ThreadPlacementOverrides;
}): SpacesView<T, G> {
  const resolved = resolveSpaces(input.state);
  const projects = indexSpaceProjects(resolved, input.groups);
  const lineage = indexLineageThreads(input.threads);
  const spaceIdsByThreadKey = new Map<string, ReadonlyArray<string>>();
  for (const [key, thread] of lineage) {
    spaceIdsByThreadKey.set(key, threadSpaceIds(thread, lineage, projects.spaceByRefKey));
  }

  const routeOwners =
    input.routeThreadKey === null
      ? []
      : (spaceIdsByThreadKey.get(input.routeThreadKey) ??
        (input.routeDraftProject === null
          ? []
          : [projects.spaceByRefKey.get(refKey(input.routeDraftProject))].filter(
              (id): id is string => id !== undefined,
            )));
  const routeSpaceId =
    input.routeChanged && routeOwners.length > 0 && !routeOwners.includes(resolved.activeSpace.id)
      ? routeOwners[0]!
      : null;
  const shownSpace =
    resolved.spaces.find((space) => space.id === routeSpaceId) ?? resolved.activeSpace;

  const isUnread = (thread: T) =>
    hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        input.localLastVisitedAt[sidebarThreadKey(thread)],
      ),
    });
  const counts = new Map(resolved.spaces.map((space) => [space.id, { needs: 0, unread: 0 }]));
  const lanesNeedMe = new Set<string>();
  const lanesRunning = new Set<string>();
  for (const [key, thread] of lineage) {
    if (!isLiveThread(thread, input.now)) continue;
    const needs = threadNeedsMe(thread, input.placementOverrides);
    const unread = isHumanThread(thread, input.placementOverrides) && isUnread(thread);
    for (const spaceId of spaceIdsByThreadKey.get(key) ?? []) {
      const count = counts.get(spaceId)!;
      if (needs) count.needs += 1;
      if (unread) count.unread += 1;
    }
    const running = isThreadRunning(thread);
    if (!needs && !running) continue;
    for (const ancestor of lineageAncestorKeys(thread, lineage)) {
      if (needs) lanesNeedMe.add(ancestor);
      if (running) lanesRunning.add(ancestor);
    }
  }
  const stats = new Map<string, SpaceStats>(
    resolved.spaces.map((space) => {
      const count = counts.get(space.id)!;
      return [
        space.id,
        {
          projectCount: projects.groupsBySpace.get(space.id)?.length ?? 0,
          needsCount: count.needs,
          unreadCount: count.unread,
        },
      ];
    }),
  );

  const gridThreads = shownSpace.gridThreadKeys.flatMap((key) => {
    const thread = lineage.get(key);
    return thread !== undefined &&
      thread.archivedAt === null &&
      (spaceIdsByThreadKey.get(key) ?? []).includes(shownSpace.id)
      ? [{ key, thread, group: projects.groupByRefKey.get(lineageProjectKey(thread)) ?? null }]
      : [];
  });
  const tilesPerGroup = new Map<string, number>();
  for (const { group } of gridThreads) {
    if (group !== null) {
      tilesPerGroup.set(group.projectKey, (tilesPerGroup.get(group.projectKey) ?? 0) + 1);
    }
  }
  const tiles = gridThreads.map(({ key, thread, group }): SpaceGridTile<T, G> => {
    const defaultLabel =
      group !== null && tilesPerGroup.get(group.projectKey) === 1
        ? group.displayName
        : conciseThreadLabel(thread.title);
    const status: SpaceTileStatus =
      threadNeedsMe(thread, input.placementOverrides) || lanesNeedMe.has(key)
        ? "needs"
        : isThreadRunning(thread) || lanesRunning.has(key)
          ? "working"
          : "idle";
    return {
      key,
      thread,
      group,
      label: shownSpace.gridLabels[key] ?? defaultLabel,
      defaultLabel,
      status,
      unread: isUnread(thread),
      selected: input.routeThreadKey === key,
    };
  });

  return {
    resolved,
    shownSpace,
    routeSpaceId,
    routeOwnerKnown: routeOwners.length > 0,
    projects,
    tiles,
    gridThreadKeys: new Set(gridThreads.map(({ key }) => key)),
    stats,
    spaceIdsByThreadKey,
  };
}
