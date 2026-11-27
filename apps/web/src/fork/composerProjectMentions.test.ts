import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

import {
  composerProjectMentionText,
  matchComposerProjectMentionItems,
  splitComposerProjectMentions,
} from "./composerProjectMentions";

const BOTS = EnvironmentId.make("env-bots");
const MAC = EnvironmentId.make("env-mac");

function project(
  name: string,
  overrides: Partial<SidebarProjectSnapshot> = {},
  environments: ReadonlyArray<{ id: EnvironmentId; label: string }> = [
    { id: BOTS, label: "Bots VM" },
  ],
): SidebarProjectSnapshot {
  return {
    id: `project-${name}`,
    environmentId: environments[0]!.id,
    title: name,
    workspaceRoot: `/desks/${name}`,
    faviconPath: null,
    projectIcon: null,
    isScratch: false,
    projectKey: `key:${name}`,
    displayName: name,
    pinned: false,
    archived: false,
    memberProjects: environments.map((environment) => ({
      environmentId: environment.id,
      environmentLabel: environment.label,
    })),
    ...overrides,
  } as unknown as SidebarProjectSnapshot;
}

const labels = (items: ReadonlyArray<{ label: string }>) => items.map((item) => item.label);

const PROJECTS = [
  project("Penny"),
  project("Eagle Eye"),
  project("Chief", { pinned: true }),
  project("Arlo"),
  project("Mortie"),
];

describe("matchComposerProjectMentionItems", () => {
  it("lists every project for an empty query, pinned first, then alphabetically", () => {
    expect(labels(matchComposerProjectMentionItems({ projects: PROJECTS, query: "" }))).toEqual([
      "Chief",
      "Arlo",
      "Eagle Eye",
      "Mortie",
      "Penny",
    ]);
  });

  it("ranks prefix matches before word starts and word starts before substrings", () => {
    const projects = [project("Eye Doctor"), project("Eagle Eye"), project("Abeyance")];
    expect(labels(matchComposerProjectMentionItems({ projects, query: "ey" }))).toEqual([
      "Eye Doctor",
      "Eagle Eye",
      "Abeyance",
    ]);
  });

  it("matches case-insensitively and drops projects that do not match", () => {
    expect(labels(matchComposerProjectMentionItems({ projects: PROJECTS, query: "PEN" }))).toEqual([
      "Penny",
    ]);
    expect(matchComposerProjectMentionItems({ projects: PROJECTS, query: "zzz" })).toEqual([]);
  });

  it("boosts the shown Space's projects within a tier", () => {
    const items = matchComposerProjectMentionItems({
      projects: PROJECTS,
      query: "",
      activeSpaceProjectKeys: new Set(["key:Mortie", "key:Penny"]),
    });
    expect(labels(items)).toEqual(["Mortie", "Penny", "Chief", "Arlo", "Eagle Eye"]);
    // A better match still wins over the Space boost.
    expect(
      labels(
        matchComposerProjectMentionItems({
          projects: PROJECTS,
          query: "e",
          activeSpaceProjectKeys: new Set(["key:Penny"]),
        }),
      ),
    ).toEqual(["Eagle Eye", "Penny", "Chief", "Mortie"]);
  });

  it("leaves out archived projects and the No project group", () => {
    const projects = [
      project("Penny", { archived: true }),
      project("No project", { isScratch: true }),
      project("Arlo"),
    ];
    expect(labels(matchComposerProjectMentionItems({ projects, query: "" }))).toEqual(["Arlo"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) => project(`Bot ${index}`));
    expect(matchComposerProjectMentionItems({ projects: many, query: "bot" })).toHaveLength(10);
    expect(
      matchComposerProjectMentionItems({ projects: many, query: "bot", limit: 3 }),
    ).toHaveLength(3);
  });

  it("gives one item per project group and names its machines only when projects span several", () => {
    const both = [
      { id: BOTS, label: "Bots VM" },
      { id: MAC, label: "MacBook" },
    ];
    const grouped = [project("Penny", {}, both), project("Arlo")];
    const items = matchComposerProjectMentionItems({ projects: grouped, query: "" });
    expect(items.map((item) => [item.id, item.description])).toEqual([
      ["fork-project:key:Arlo", "Bots VM"],
      ["fork-project:key:Penny", "Bots VM, MacBook"],
    ]);
    const single = matchComposerProjectMentionItems({ projects: PROJECTS, query: "pen" });
    expect(single[0]!.description).toBe("");
    expect(single[0]!.project).toEqual({
      environmentId: BOTS,
      workspaceRoot: "/desks/Penny",
      title: "Penny",
      faviconPath: null,
      projectIcon: null,
    });
  });
});

describe("composerProjectMentionText", () => {
  it("is the plain display name with a trailing space", () => {
    expect(composerProjectMentionText({ label: "Penny" })).toBe("@Penny ");
    expect(composerProjectMentionText({ label: "Eagle Eye" })).toBe("@Eagle Eye ");
  });
});

describe("splitComposerProjectMentions", () => {
  it("separates project mentions from the other rows and keeps rows as is without any", () => {
    const rows = [{ type: "fork-project" }, { type: "thread" }, { type: "path" }];
    const split = splitComposerProjectMentions(rows);
    expect(split.projects).toEqual([{ type: "fork-project" }]);
    expect(split.rest).toEqual([{ type: "thread" }, { type: "path" }]);
    const plain = [{ type: "thread" }];
    expect(splitComposerProjectMentions(plain).rest).toBe(plain);
  });
});
