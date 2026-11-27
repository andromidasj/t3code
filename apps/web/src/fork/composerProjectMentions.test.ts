import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

import {
  collectComposerInlineTokens,
  composerMathRanges,
} from "@t3tools/shared/composerInlineTokens";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { markdownMathRanges } from "~/markdown/wordsHast";

import {
  collectComposerProjectMentions,
  composerProjectMentionText,
  matchComposerProjectMentionItems,
  splitComposerProjectMentions,
  withComposerProjectMentionTokens,
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

describe("collectComposerProjectMentions", () => {
  const names = ["Penny", "Eagle Eye", "Eagle Eye Review"];
  const sources = (text: string, list: ReadonlyArray<string> = names) =>
    collectComposerProjectMentions(text, list).map((token) => [token.source, token.value]);

  it("matches a one-word name before whitespace", () => {
    expect(collectComposerProjectMentions("ask @Penny about it", names)).toEqual([
      { type: "mention", value: "Penny", source: "@Penny", start: 4, end: 10 },
    ]);
  });

  it("matches a name with spaces as one mention", () => {
    expect(sources("@Eagle Eye please")).toEqual([["@Eagle Eye", "Eagle Eye"]]);
  });

  it("prefers the longest name", () => {
    expect(sources("@Eagle Eye Review now and @Eagle Eye now")).toEqual([
      ["@Eagle Eye Review", "Eagle Eye Review"],
      ["@Eagle Eye", "Eagle Eye"],
    ]);
  });

  it("allows closing punctuation and opening punctuation around the name", () => {
    expect(sources('@Eagle Eye, then (@Penny) and "@penny." ok')).toEqual([
      ["@Eagle Eye", "Eagle Eye"],
      ["@Penny", "Penny"],
      ["@penny", "Penny"],
    ]);
  });

  it("matches case-insensitively and keeps the text as written", () => {
    expect(sources("hi @eagle eye ")).toEqual([["@eagle eye", "Eagle Eye"]]);
  });

  it("waits for whitespace, so a name being typed does not match yet", () => {
    expect(sources("ask @Penny")).toEqual([]);
    expect(sources("ask @Eagle ")).toEqual([]);
  });

  it("ignores emails, mid-word @ and longer words", () => {
    expect(
      sources("mail foo@penny.com or @penny.com or x@Penny or @Pennyworth or @Penny's "),
    ).toEqual([]);
  });

  it("finds nothing without names", () => {
    expect(sources("ask @Penny ", [])).toEqual([]);
  });

  it("escapes regex characters in names", () => {
    expect(sources("ping @C++ (bot) now", ["C++ (bot)"])).toEqual([["@C++ (bot)", "C++ (bot)"]]);
  });
});

describe("withComposerProjectMentionTokens", () => {
  const names = ["Eagle Eye", "Penny"];
  const merged = (text: string) =>
    withComposerProjectMentionTokens(
      text,
      collectComposerInlineTokens(text, { findMath: markdownMathRanges }),
      names,
      (value) => composerMathRanges(value, markdownMathRanges),
    ).map((token) => [token.type, token.source]);

  it("replaces the split file mention with one project mention", () => {
    expect(merged("ask @Eagle Eye about $ui ")).toEqual([
      ["mention", "@Eagle Eye"],
      ["skill", "$ui"],
    ]);
    expect(merged("ask @Penny, then @AGENTS.md ")).toEqual([
      ["mention", "@Penny"],
      ["mention", "@AGENTS.md"],
    ]);
  });

  it("leaves file links and math alone", () => {
    const link = serializeComposerFileLink("docs/a @Penny b.md");
    expect(merged(`see ${link} `)).toEqual([["mention", link]]);
    expect(merged("formula $x @Penny y$ done")).toEqual([]);
  });

  it("returns the same tokens when nothing names a project", () => {
    const tokens = collectComposerInlineTokens("read @README.md ");
    expect(withComposerProjectMentionTokens("read @README.md ", tokens, names, () => [])).toBe(
      tokens,
    );
  });
});
