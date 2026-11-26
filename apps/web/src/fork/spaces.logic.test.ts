import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createSpace,
  deleteSpace,
  HOME_SPACE,
  moveProjectToSpace,
  moveSpace,
  neighborSpaceId,
  nextSpaceLook,
  normalizeSidebarSpaces,
  removeProjectFromSpace,
  resolveSpaceNewThreadProjectRef,
  resolveSpaces,
  setActiveSpace,
  setDefaultSpace,
  setGridLabel,
  setGridThread,
  spaceIdForProject,
  updateSpace,
  type SidebarSpace,
  type SidebarSpacesState,
} from "./spaces.logic";

const EMPTY: SidebarSpacesState = { spaces: [], defaultSpaceId: null, activeSpaceId: null };

function space(id: string, projectKeys: string[] = [], extra: Partial<SidebarSpace> = {}) {
  return {
    id,
    name: id,
    icon: "folder" as const,
    tint: "none" as const,
    projectKeys,
    gridThreadKeys: [],
    gridLabels: {},
    ...extra,
  };
}

const three: SidebarSpacesState = {
  spaces: [space("home", ["chief"]), space("eye", ["eagle"]), space("work", ["max"])],
  defaultSpaceId: "home",
  activeSpaceId: "eye",
};

const ids = (state: SidebarSpacesState) => state.spaces.map((entry) => entry.id);
const keysOf = (state: SidebarSpacesState, id: string) =>
  state.spaces.find((entry) => entry.id === id)?.projectKeys;

describe("stored Spaces", () => {
  it("keeps valid Spaces, repairs looks, and gives each project one Space", () => {
    const spaces = normalizeSidebarSpaces([
      { id: "a", name: "A", icon: "home", tint: "sky", projectKeys: ["p", "p", "q", 3] },
      { id: "a", name: "duplicate" },
      { id: "", name: "no id" },
      "junk",
      {
        id: "b",
        name: 7,
        icon: "rocket",
        tint: "plaid",
        projectKeys: ["q", "r"],
        gridThreadKeys: ["t1", "t1", 2],
        gridLabels: { t1: "One", t2: "  ", t3: 4 },
      },
    ]);
    expect(spaces).toEqual([
      {
        id: "a",
        name: "A",
        icon: "home",
        tint: "sky",
        projectKeys: ["p", "q"],
        gridThreadKeys: [],
        gridLabels: {},
      },
      {
        id: "b",
        name: "",
        icon: "folder",
        tint: "none",
        projectKeys: ["r"],
        gridThreadKeys: ["t1"],
        gridLabels: { t1: "One" },
      },
    ]);
    expect(normalizeSidebarSpaces("nope")).toEqual([]);
  });

  it("shows one Home Space holding every project before any change", () => {
    const resolved = resolveSpaces(EMPTY);
    expect(resolved.spaces).toEqual([HOME_SPACE]);
    expect(resolved.defaultSpace).toBe(HOME_SPACE);
    expect(resolved.activeSpace).toBe(HOME_SPACE);
    expect(spaceIdForProject(resolved, "anything")).toBe("space-home");
  });

  it("falls back to the first Space for a missing default, and to the default when showing none", () => {
    const resolved = resolveSpaces({ ...three, defaultSpaceId: "gone", activeSpaceId: "gone" });
    expect(resolved.defaultSpace.id).toBe("home");
    expect(resolved.activeSpace.id).toBe("home");
    expect(resolveSpaces({ ...three, activeSpaceId: null }).activeSpace.id).toBe("home");
  });

  it("puts a project in the Space that lists it, else the default", () => {
    const resolved = resolveSpaces(three);
    expect(spaceIdForProject(resolved, "eagle")).toBe("eye");
    expect(spaceIdForProject(resolved, "brand new")).toBe("home");
  });
});

describe("changing Spaces", () => {
  it("writes the Home Space out on the first change", () => {
    const next = setActiveSpace(EMPTY, "space-home");
    expect(next).toEqual({
      spaces: [HOME_SPACE],
      defaultSpaceId: "space-home",
      activeSpaceId: "space-home",
    });
  });

  it("switches only to a Space that exists, and finds neighbors", () => {
    expect(setActiveSpace(three, "work").activeSpaceId).toBe("work");
    expect(setActiveSpace(three, "gone").activeSpaceId).toBe("eye");
    const resolved = resolveSpaces(three);
    expect(neighborSpaceId(resolved, -1)).toBe("home");
    expect(neighborSpaceId(resolved, 1)).toBe("work");
    expect(neighborSpaceId(resolveSpaces({ ...three, activeSpaceId: "work" }), 1)).toBeNull();
  });

  it("adds a Space after the others and shows it, with a look not yet taken", () => {
    const look = nextSpaceLook([
      { icon: "home", tint: "indigo" },
      { icon: "eye", tint: "sky" },
    ]);
    expect(look).toEqual({ icon: "briefcase", tint: "emerald" });
    const next = createSpace(EMPTY, { id: "new", name: "New", ...look });
    expect(ids(next)).toEqual(["space-home", "new"]);
    expect(next.activeSpaceId).toBe("new");
    expect(next.defaultSpaceId).toBe("space-home");
    expect(createSpace(next, { id: "new", name: "Again", ...look })).toEqual(next);
  });

  it("renames and restyles one Space", () => {
    const next = updateSpace(three, "eye", { name: "Eagle", tint: "sky", icon: "eye" });
    expect(next.spaces[1]).toMatchObject({ name: "Eagle", tint: "sky", icon: "eye" });
    expect(next.spaces[0]).toBe(three.spaces[0]);
  });

  it("moves a project into one Space and out of the rest", () => {
    const next = moveProjectToSpace(three, "eagle", "work");
    expect(keysOf(next, "eye")).toEqual([]);
    expect(keysOf(next, "work")).toEqual(["max", "eagle"]);
    // An unlisted project is written into the default explicitly, which is unambiguous.
    expect(keysOf(moveProjectToSpace(three, "loose", "home"), "home")).toEqual(["chief", "loose"]);
    expect(moveProjectToSpace(three, "eagle", "gone").spaces).toEqual(three.spaces);
  });

  it("returns a project taken out of a Space to the default", () => {
    const next = removeProjectFromSpace(three, "eagle", "eye");
    expect(keysOf(next, "eye")).toEqual([]);
    expect(spaceIdForProject(resolveSpaces(next), "eagle")).toBe("home");
  });

  it("keeps unassigned projects where they were when the default changes", () => {
    const next = setDefaultSpace(three, "work", ["chief", "eagle", "max", "loose"]);
    expect(next.defaultSpaceId).toBe("work");
    expect(keysOf(next, "home")).toEqual(["chief", "loose"]);
    const resolved = resolveSpaces(next);
    expect(spaceIdForProject(resolved, "loose")).toBe("home");
    expect(spaceIdForProject(resolved, "brand new")).toBe("work");
    expect(setDefaultSpace(three, "home", ["loose"])).toEqual({ ...three });
  });

  it("deletes a Space into the default, never the last one", () => {
    const shown = deleteSpace(three, "eye");
    expect(ids(shown)).toEqual(["home", "work"]);
    expect(shown.activeSpaceId).toBe("home");
    expect(spaceIdForProject(resolveSpaces(shown), "eagle")).toBe("home");

    const defaultGone = deleteSpace({ ...three, activeSpaceId: "work" }, "home");
    expect(defaultGone.defaultSpaceId).toBe("eye");
    expect(defaultGone.activeSpaceId).toBe("work");
    expect(spaceIdForProject(resolveSpaces(defaultGone), "chief")).toBe("eye");

    const only = { spaces: [space("solo")], defaultSpaceId: "solo", activeSpaceId: "solo" };
    expect(deleteSpace(only, "solo")).toEqual(only);
  });

  it("reorders Spaces one place at a time", () => {
    expect(ids(moveSpace(three, "eye", -1))).toEqual(["eye", "home", "work"]);
    expect(ids(moveSpace(three, "work", 1))).toEqual(["home", "eye", "work"]);
  });

  it("pins threads to a Space's grid in order, and unpinning drops the label", () => {
    let next = setGridThread(three, "eye", "t1", true);
    next = setGridThread(next, "eye", "t2", true);
    next = setGridThread(next, "eye", "t1", true);
    expect(next.spaces[1]!.gridThreadKeys).toEqual(["t2", "t1"]);
    next = setGridLabel(next, "eye", "t1", "  Lane  ");
    expect(next.spaces[1]!.gridLabels).toEqual({ t1: "Lane" });
    expect(setGridLabel(next, "eye", "t1", " ").spaces[1]!.gridLabels).toEqual({});
    next = setGridThread(next, "eye", "t1", false);
    expect(next.spaces[1]!.gridThreadKeys).toEqual(["t2"]);
    expect(next.spaces[1]!.gridLabels).toEqual({});
  });
});

describe("new threads in a Space", () => {
  const env = EnvironmentId.make("bots");
  const ref = (id: string): ScopedProjectRef => ({
    environmentId: env,
    projectId: ProjectId.make(id),
  });
  const group = (id: string, members = [ref(id)]) => ({
    environmentId: env,
    id: ProjectId.make(id),
    memberProjectRefs: members,
  });

  it("uses the open thread's project when the Space has it, else its only project", () => {
    const groups = [group("chief"), group("penny", [ref("penny"), ref("penny-dev")])];
    expect(resolveSpaceNewThreadProjectRef(groups, ref("penny-dev"))).toEqual(ref("penny-dev"));
    expect(resolveSpaceNewThreadProjectRef(groups, ref("elsewhere"))).toBeNull();
    expect(resolveSpaceNewThreadProjectRef([group("chief")], ref("elsewhere"))).toEqual(
      ref("chief"),
    );
    expect(resolveSpaceNewThreadProjectRef([], null)).toBeNull();
  });
});
