import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "~/test-fixtures";

import { sidebarThreadKey } from "./sidebarHierarchy";
import type { SidebarSpacesState } from "./spaces.logic";
import { buildSpacesView, conciseThreadLabel, type SpacesGroup } from "./spacesView.logic";

const bots = EnvironmentId.make("bots");
const dev = EnvironmentId.make("dev");
const NOW = "2026-11-25T12:00:00.000Z";

function group(name: string, archived = false): SpacesGroup {
  return {
    projectKey: `key:${name}`,
    displayName: name,
    archived,
    memberProjectRefs: [{ environmentId: bots, projectId: ProjectId.make(name) }],
  };
}

function thread(
  id: string,
  project: string,
  options: {
    readonly environmentId?: EnvironmentId;
    readonly delegatedFrom?: string;
    readonly run?: "running" | "completed" | "failed";
    readonly approval?: boolean;
    readonly unread?: boolean;
    readonly archived?: boolean;
    readonly title?: string;
    readonly bot?: boolean;
  } = {},
) {
  const base = makeThreadFixture({
    environmentId: options.environmentId ?? bots,
    id: ThreadId.make(id),
    projectId: ProjectId.make(project),
    title: options.title ?? id,
  });
  return {
    ...base,
    archivedAt: options.archived ? "2026-11-20T00:00:00.000Z" : null,
    hasPendingApprovals: options.approval ?? false,
    lastVisitedAt: options.unread ? "2026-11-24T01:00:00.000Z" : null,
    delegatedFrom:
      options.delegatedFrom === undefined
        ? null
        : { environmentId: bots, threadId: ThreadId.make(options.delegatedFrom), title: "parent" },
    latestRun:
      options.run === undefined && !options.unread
        ? null
        : {
            runId: RunId.make(`${id}-run`),
            status: options.run ?? ("completed" as const),
            requestedAt: null,
            startedAt: null,
            completedAt: options.unread ? "2026-11-24T02:00:00.000Z" : null,
            assistantMessageId: null,
          },
    source: { ...base.source, createdBy: options.bot ? ("agent" as const) : ("user" as const) },
  };
}

type Thread = ReturnType<typeof thread>;
const key = (entry: Thread) => sidebarThreadKey(entry);

const chief = group("chief");
const eagle = group("eagle");
const repo = group("repo");
const max = group("max");
const old = group("old", true);
const groups = [chief, eagle, repo, max, old];

function state(overrides: Partial<SidebarSpacesState> = {}): SidebarSpacesState {
  return {
    spaces: [
      {
        id: "home",
        name: "Home",
        icon: "home",
        tint: "indigo",
        projectKeys: [],
        gridThreadKeys: [],
        gridLabels: {},
      },
      {
        id: "eye",
        name: "Eagle Eye",
        icon: "eye",
        tint: "sky",
        projectKeys: ["key:eagle"],
        gridThreadKeys: [],
        gridLabels: {},
      },
      {
        id: "work",
        name: "Work",
        icon: "briefcase",
        tint: "emerald",
        projectKeys: ["key:max", "key:repo"],
        gridThreadKeys: [],
        gridLabels: {},
      },
    ],
    defaultSpaceId: "home",
    activeSpaceId: "home",
    ...overrides,
  };
}

function view(
  threads: Thread[],
  input: {
    readonly state?: SidebarSpacesState;
    readonly routeThreadKey?: string | null;
    readonly routeChanged?: boolean;
    readonly routeDraftProject?: { environmentId: EnvironmentId; projectId: ProjectId } | null;
    readonly lens?: "all" | "needs-me" | null;
  } = {},
) {
  return buildSpacesView({
    state: input.state ?? state(),
    groups,
    threads,
    routeThreadKey: input.routeThreadKey ?? null,
    routeChanged: input.routeChanged ?? false,
    routeDraftProject: input.routeDraftProject ?? null,
    lens: input.lens ?? "all",
    now: NOW,
    localLastVisitedAt: {},
  });
}

const withGrid = (spaceId: string, gridThreadKeys: string[], labels = {}) => {
  const base = state();
  return {
    ...base,
    spaces: base.spaces.map((entry) =>
      entry.id === spaceId ? { ...entry, gridThreadKeys, gridLabels: labels } : entry,
    ),
  };
};

describe("Space membership", () => {
  it("groups open projects by Space, with unlisted ones in the default", () => {
    const result = view([]);
    const names = (id: string) =>
      result.projects.groupsBySpace.get(id)?.map((entry) => entry.displayName);
    expect(names("home")).toEqual(["chief"]);
    expect(names("eye")).toEqual(["eagle"]);
    expect(names("work")).toEqual(["repo", "max"]);
    expect(result.stats.get("work")?.projectCount).toBe(2);
  });

  it("lists a delegated lane in its own project's Space and its bot's", () => {
    const main = thread("eagle main", "eagle");
    const lane = thread("lane", "repo", { delegatedFrom: "eagle main" });
    const result = view([main, lane]);
    expect(result.spaceIdsByThreadKey.get(key(lane))).toEqual(["work", "eye"]);
    expect(result.spaceIdsByThreadKey.get(key(main))).toEqual(["eye"]);
  });
});

describe("following the route", () => {
  const main = thread("eagle main", "eagle");
  const lane = thread("lane", "repo", { delegatedFrom: "eagle main" });

  it("opens the Space of a thread the shown Space does not list, only on a route change", () => {
    const opened = view([main], { routeThreadKey: key(main), routeChanged: true });
    expect(opened.routeSpaceId).toBe("eye");
    expect(opened.shownSpace.id).toBe("eye");
    expect(opened.routeOwnerKnown).toBe(true);

    const switchedAway = view([main], { routeThreadKey: key(main), routeChanged: false });
    expect(switchedAway.routeSpaceId).toBeNull();
    expect(switchedAway.shownSpace.id).toBe("home");
  });

  it("stays put when the shown Space lists the thread through its lineage", () => {
    const result = view([main, lane], {
      state: state({ activeSpaceId: "eye" }),
      routeThreadKey: key(lane),
      routeChanged: true,
    });
    expect(result.routeSpaceId).toBeNull();
    expect(result.shownSpace.id).toBe("eye");
  });

  it("follows a draft by its project, and waits on a thread it cannot place yet", () => {
    const draft = view([], {
      routeThreadKey: "bots:draft-thread",
      routeChanged: true,
      routeDraftProject: { environmentId: bots, projectId: ProjectId.make("max") },
    });
    expect(draft.routeSpaceId).toBe("work");
    const unknown = view([], { routeThreadKey: "bots:nope", routeChanged: true });
    expect(unknown.routeSpaceId).toBeNull();
    expect(unknown.routeOwnerKnown).toBe(false);
  });
});

describe("the pinned grid", () => {
  it("shows the shown Space's live pins in order, and leaves out the rest", () => {
    const a = thread("a", "eagle");
    const b = thread("b", "eagle", { archived: true });
    const c = thread("c", "chief");
    const result = view([a, b, c], {
      state: { ...withGrid("eye", [key(c), key(b), key(a), "bots:missing"]), activeSpaceId: "eye" },
    });
    expect(result.tiles.map((tile) => tile.thread.id)).toEqual(["a"]);
    expect([...result.gridThreadKeys]).toEqual([key(a)]);
  });

  it("labels a project's only tile by project, several by thread, and custom labels win", () => {
    const solo = thread("solo", "chief", { title: "Morning brief" });
    const one = thread("one", "eagle", { title: "👉 EER-412 fix the export" });
    const two = thread("two", "eagle", { title: "Review queue" });
    const home = view([solo], { state: withGrid("home", [key(solo)]) });
    expect(home.tiles[0]!.label).toBe("chief");
    const eye = view([one, two], {
      state: {
        ...withGrid("eye", [key(one), key(two)], { [key(two)]: "Queue" }),
        activeSpaceId: "eye",
      },
    });
    expect(eye.tiles.map((tile) => [tile.label, tile.defaultLabel])).toEqual([
      ["EER-412", "EER-412"],
      ["Queue", "Review queue"],
    ]);
    expect(conciseThreadLabel("  👉 Pick a flight")).toBe("Pick a flight");
  });

  it("rolls up its lanes' status, marks unread and the open thread, and filters by Needs me", () => {
    const main = thread("eagle main", "eagle");
    const lane = thread("lane", "repo", { delegatedFrom: "eagle main", approval: true });
    const busy = thread("busy", "eagle", { run: "running" });
    const quiet = thread("quiet", "eagle", { unread: true });
    const gridState = {
      ...withGrid("eye", [key(main), key(busy), key(quiet)]),
      activeSpaceId: "eye",
    };
    const all = view([main, lane, busy, quiet], {
      state: gridState,
      routeThreadKey: key(busy),
    });
    expect(
      all.tiles.map((tile) => [tile.thread.id, tile.status, tile.unread, tile.selected]),
    ).toEqual([
      ["eagle main", "needs", false, false],
      ["busy", "working", false, true],
      ["quiet", "idle", true, false],
    ]);
    const needs = view([main, lane, busy, quiet], { state: gridState, lens: "needs-me" });
    expect(needs.tiles.map((tile) => tile.thread.id)).toEqual(["eagle main"]);
    // Filtered tiles still stay out of the list below.
    expect(needs.gridThreadKeys.size).toBe(3);
  });
});

describe("cross-Space badges", () => {
  it("counts threads that need the user and unread threads the user is in, per Space", () => {
    const ask = thread("ask", "max", { approval: true });
    const reply = thread("reply", "eagle", { unread: true });
    const botReply = thread("bot reply", "chief", { unread: true, bot: true });
    const lane = thread("lane", "repo", { delegatedFrom: "reply", run: "failed", bot: true });
    const result = view([ask, reply, botReply, lane]);
    expect(result.stats.get("work")).toMatchObject({ needsCount: 2, unreadCount: 0 });
    expect(result.stats.get("eye")).toMatchObject({ needsCount: 1, unreadCount: 1 });
    expect(result.stats.get("home")).toMatchObject({ needsCount: 0, unreadCount: 0 });
  });

  it("places threads across environments through delegatedFrom", () => {
    const main = thread("eagle main", "eagle");
    const remote = {
      ...thread("remote lane", "elsewhere", { environmentId: dev }),
      delegatedFrom: { environmentId: bots, threadId: ThreadId.make("eagle main"), title: "main" },
    };
    const result = view([main, remote]);
    expect(result.spaceIdsByThreadKey.get(key(remote))).toEqual(["eye"]);
  });
});
