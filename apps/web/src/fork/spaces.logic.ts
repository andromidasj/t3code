import type { ScopedProjectRef } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

// The repo's lint bans sparkles icons, so the fourth icon is a star.
export const SPACE_ICON_IDS = [
  "home",
  "eye",
  "briefcase",
  "star",
  "terminal",
  "layers",
  "folder",
  "globe",
] as const;
export type SpaceIconId = (typeof SPACE_ICON_IDS)[number];

export const SPACE_TINT_IDS = ["none", "indigo", "sky", "emerald", "amber", "rose"] as const;
export type SpaceTintId = (typeof SPACE_TINT_IDS)[number];

/**
 * A named set of projects the sidebar shows at once, with its own grid of pinned threads.
 * Project keys are the project menu's group keys; a project listed in no Space is in the default.
 */
export interface SidebarSpace {
  readonly id: string;
  readonly name: string;
  readonly icon: SpaceIconId;
  readonly tint: SpaceTintId;
  readonly projectKeys: ReadonlyArray<string>;
  readonly gridThreadKeys: ReadonlyArray<string>;
  readonly gridLabels: Readonly<Record<string, string>>;
}

export interface SidebarSpacesState {
  readonly spaces: ReadonlyArray<SidebarSpace>;
  readonly defaultSpaceId: string | null;
  readonly activeSpaceId: string | null;
}

export const HOME_SPACE: SidebarSpace = {
  id: "space-home",
  name: "Home",
  icon: "home",
  tint: "indigo",
  projectKeys: [],
  gridThreadKeys: [],
  gridLabels: {},
};

const isSpaceIconId = (value: unknown): value is SpaceIconId =>
  SPACE_ICON_IDS.includes(value as SpaceIconId);
const isSpaceTintId = (value: unknown): value is SpaceTintId =>
  SPACE_TINT_IDS.includes(value as SpaceTintId);

const uniqueStrings = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.filter((value): value is string => typeof value === "string"))]
    : [];

/**
 * Stored Spaces with an id; repeated ids dropped, unknown icons and tints replaced. A project
 * listed in two Spaces stays in the first, so each project has exactly one.
 */
export function normalizeSidebarSpaces(raw: unknown): ReadonlyArray<SidebarSpace> {
  const spaces: SidebarSpace[] = [];
  const claimed = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const { id } = record;
    if (typeof id !== "string" || id === "" || spaces.some((space) => space.id === id)) continue;
    const projectKeys = uniqueStrings(record.projectKeys).filter((key) => !claimed.has(key));
    for (const key of projectKeys) claimed.add(key);
    const gridLabels: Record<string, string> = {};
    if (typeof record.gridLabels === "object" && record.gridLabels !== null) {
      for (const [key, label] of Object.entries(record.gridLabels)) {
        if (typeof label === "string" && label.trim() !== "") gridLabels[key] = label;
      }
    }
    spaces.push({
      id,
      name: typeof record.name === "string" ? record.name : "",
      icon: isSpaceIconId(record.icon) ? record.icon : "folder",
      tint: isSpaceTintId(record.tint) ? record.tint : "none",
      projectKeys,
      gridThreadKeys: uniqueStrings(record.gridThreadKeys),
      gridLabels,
    });
  }
  return spaces;
}

export interface ResolvedSpaces {
  /** Never empty: a Mac with no Spaces saved has one Home Space. */
  readonly spaces: ReadonlyArray<SidebarSpace>;
  readonly defaultSpace: SidebarSpace;
  readonly activeSpace: SidebarSpace;
}

export function resolveSpaces(state: SidebarSpacesState): ResolvedSpaces {
  const spaces = state.spaces.length > 0 ? state.spaces : [HOME_SPACE];
  const defaultSpace = spaces.find((space) => space.id === state.defaultSpaceId) ?? spaces[0]!;
  const activeSpace = spaces.find((space) => space.id === state.activeSpaceId) ?? defaultSpace;
  return { spaces, defaultSpace, activeSpace };
}

/** The Space a project is in: the one that lists it, else the default. */
export function spaceIdForProject(resolved: ResolvedSpaces, projectKey: string): string {
  return (
    resolved.spaces.find((space) => space.projectKeys.includes(projectKey))?.id ??
    resolved.defaultSpace.id
  );
}

// Mutations. Each returns the whole state with the Home Space written out, so the first change a
// Mac makes saves what it was showing.

interface WrittenSpacesState extends SidebarSpacesState {
  readonly defaultSpaceId: string;
  readonly activeSpaceId: string;
}

function written(state: SidebarSpacesState): WrittenSpacesState {
  const resolved = resolveSpaces(state);
  return {
    spaces: resolved.spaces,
    defaultSpaceId: resolved.defaultSpace.id,
    activeSpaceId: resolved.activeSpace.id,
  };
}

const mapSpace = (
  state: SidebarSpacesState,
  id: string,
  update: (space: SidebarSpace) => SidebarSpace,
): SidebarSpacesState => {
  const base = written(state);
  return { ...base, spaces: base.spaces.map((space) => (space.id === id ? update(space) : space)) };
};

export function setActiveSpace(state: SidebarSpacesState, id: string): SidebarSpacesState {
  const base = written(state);
  return base.spaces.some((space) => space.id === id) ? { ...base, activeSpaceId: id } : base;
}

/** The Space `offset` places from the shown one, or null past either end. */
export function neighborSpaceId(resolved: ResolvedSpaces, offset: -1 | 1): string | null {
  const index = resolved.spaces.indexOf(resolved.activeSpace);
  return resolved.spaces[index + offset]?.id ?? null;
}

export function createSpace(
  state: SidebarSpacesState,
  input: Pick<SidebarSpace, "id" | "name" | "icon" | "tint">,
): SidebarSpacesState {
  const base = written(state);
  if (base.spaces.some((space) => space.id === input.id)) return base;
  return {
    ...base,
    spaces: [...base.spaces, { ...input, projectKeys: [], gridThreadKeys: [], gridLabels: {} }],
    activeSpaceId: input.id,
  };
}

/** The first icon and tint no Space uses yet, so a new Space looks different from the rest. */
export function nextSpaceLook(
  spaces: ReadonlyArray<Pick<SidebarSpace, "icon" | "tint">>,
): Pick<SidebarSpace, "icon" | "tint"> {
  const icon = SPACE_ICON_IDS.find((id) => !spaces.some((space) => space.icon === id)) ?? "folder";
  const tint =
    SPACE_TINT_IDS.find((id) => id !== "none" && !spaces.some((space) => space.tint === id)) ??
    "none";
  return { icon, tint };
}

export function updateSpace(
  state: SidebarSpacesState,
  id: string,
  patch: Partial<Pick<SidebarSpace, "name" | "icon" | "tint">>,
): SidebarSpacesState {
  return mapSpace(state, id, (space) => ({ ...space, ...patch }));
}

/**
 * Removes a Space; its projects return to the default (the first Space left when it was the
 * default) and the sidebar shows that default if it was showing this one. The last Space stays.
 */
export function deleteSpace(state: SidebarSpacesState, id: string): SidebarSpacesState {
  const base = written(state);
  if (base.spaces.length <= 1 || !base.spaces.some((space) => space.id === id)) return base;
  const spaces = base.spaces.filter((space) => space.id !== id);
  const defaultSpaceId = base.defaultSpaceId === id ? spaces[0]!.id : base.defaultSpaceId;
  return {
    spaces,
    defaultSpaceId,
    activeSpaceId: base.activeSpaceId === id ? defaultSpaceId : base.activeSpaceId,
  };
}

export function moveSpace(
  state: SidebarSpacesState,
  id: string,
  direction: -1 | 1,
): SidebarSpacesState {
  const base = written(state);
  const from = base.spaces.findIndex((space) => space.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= base.spaces.length) return base;
  const spaces = [...base.spaces];
  [spaces[from], spaces[to]] = [spaces[to]!, spaces[from]!];
  return { ...base, spaces };
}

/** Moves a project into one Space and out of every other. */
export function moveProjectToSpace(
  state: SidebarSpacesState,
  projectKey: string,
  spaceId: string,
): SidebarSpacesState {
  const base = written(state);
  if (!base.spaces.some((space) => space.id === spaceId)) return base;
  return {
    ...base,
    spaces: base.spaces.map((space) => {
      const others = space.projectKeys.filter((key) => key !== projectKey);
      return { ...space, projectKeys: space.id === spaceId ? [...others, projectKey] : others };
    }),
  };
}

/** Takes a project out of a Space, back to the default one. */
export function removeProjectFromSpace(
  state: SidebarSpacesState,
  projectKey: string,
  spaceId: string,
): SidebarSpacesState {
  return mapSpace(state, spaceId, (space) => ({
    ...space,
    projectKeys: space.projectKeys.filter((key) => key !== projectKey),
  }));
}

/**
 * Makes a Space the one new projects land in. Projects the old default held only by being the
 * default are written into it first, so they stay where they were.
 */
export function setDefaultSpace(
  state: SidebarSpacesState,
  id: string,
  allProjectKeys: ReadonlyArray<string>,
): SidebarSpacesState {
  const base = written(state);
  if (base.defaultSpaceId === id || !base.spaces.some((space) => space.id === id)) return base;
  const listed = new Set(base.spaces.flatMap((space) => space.projectKeys));
  const implicit = allProjectKeys.filter((key) => !listed.has(key));
  return {
    ...base,
    defaultSpaceId: id,
    spaces: base.spaces.map((space) =>
      space.id === base.defaultSpaceId && implicit.length > 0
        ? { ...space, projectKeys: [...space.projectKeys, ...implicit] }
        : space,
    ),
  };
}

export function setGridThread(
  state: SidebarSpacesState,
  spaceId: string,
  threadKey: string,
  pinned: boolean,
): SidebarSpacesState {
  return mapSpace(state, spaceId, (space) => {
    const rest = space.gridThreadKeys.filter((key) => key !== threadKey);
    const { [threadKey]: _label, ...gridLabels } = space.gridLabels;
    return pinned
      ? { ...space, gridThreadKeys: [...rest, threadKey] }
      : { ...space, gridThreadKeys: rest, gridLabels };
  });
}

/** A tile's own label; an empty one goes back to the default. */
export function setGridLabel(
  state: SidebarSpacesState,
  spaceId: string,
  threadKey: string,
  label: string,
): SidebarSpacesState {
  const trimmed = label.trim();
  return mapSpace(state, spaceId, (space) => {
    const { [threadKey]: _previous, ...rest } = space.gridLabels;
    return { ...space, gridLabels: trimmed === "" ? rest : { ...rest, [threadKey]: trimmed } };
  });
}

/**
 * Where a new thread from the toolbar goes in a Space: the open thread's project when the Space
 * has it, else the Space's only project. Null when the Space has none or several to pick from.
 */
export function resolveSpaceNewThreadProjectRef<
  G extends Pick<SidebarProjectSnapshot, "environmentId" | "id" | "memberProjectRefs">,
>(
  groups: ReadonlyArray<G>,
  viewed: Pick<ScopedProjectRef, "environmentId" | "projectId"> | null | undefined,
): ScopedProjectRef | null {
  if (viewed != null) {
    for (const group of groups) {
      const member = group.memberProjectRefs.find(
        (ref) => ref.environmentId === viewed.environmentId && ref.projectId === viewed.projectId,
      );
      if (member !== undefined) return member;
    }
  }
  if (groups.length !== 1) return null;
  const [group] = groups;
  return (
    group!.memberProjectRefs.find(
      (ref) => ref.environmentId === group!.environmentId && ref.projectId === group!.id,
    ) ??
    group!.memberProjectRefs[0] ??
    null
  );
}
