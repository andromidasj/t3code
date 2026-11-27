import type { ProjectFaviconProject } from "~/components/ProjectFavicon";
import {
  projectGroupsSpanEnvironments,
  type SidebarProjectSnapshot,
} from "~/sidebarProjectGrouping";

/**
 * `@` mentions of projects (each bot is a project): a pick inserts plain `@Name ` text, so the
 * agent reads who is meant without any attached context.
 */

export interface ComposerProjectMentionItem {
  readonly id: string;
  readonly type: "fork-project";
  readonly projectKey: string;
  readonly project: ProjectFaviconProject;
  readonly label: string;
  /** The machines the project lives on, only while projects span several. */
  readonly description: string;
}

type MentionableProject = Pick<
  SidebarProjectSnapshot,
  | "projectKey"
  | "displayName"
  | "pinned"
  | "archived"
  | "isScratch"
  | "memberProjects"
  | "environmentId"
  | "workspaceRoot"
  | "title"
  | "faviconPath"
  | "projectIcon"
>;

const COMPOSER_PROJECT_MENTION_LIMIT = 10;

const WORD_START = /[\s\-_./]/u;

/** 0 for a prefix match, 1 when a later word starts with the query, 2 for any substring, else null. */
function matchTier(name: string, query: string): number | null {
  if (query === "") return 0;
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return 0;
  let index = lower.indexOf(query);
  if (index < 0) return null;
  while (index >= 0) {
    if (WORD_START.test(lower[index - 1] ?? "")) return 1;
    index = lower.indexOf(query, index + 1);
  }
  return 2;
}

function environmentDescription(project: MentionableProject): string {
  const labels = project.memberProjects
    .map((member) => member.environmentLabel)
    .filter((label, index, all): label is string => label !== null && all.indexOf(label) === index);
  return labels.join(", ");
}

/**
 * Non-archived projects matching the `@` query, best first: prefix, then word start, then
 * substring matches; within each, the shown Space's projects, then pinned ones, alphabetically.
 */
export function matchComposerProjectMentionItems(input: {
  readonly projects: ReadonlyArray<MentionableProject>;
  readonly query: string;
  /** Project keys in the sidebar's shown Space, or null when Spaces are off. */
  readonly activeSpaceProjectKeys?: ReadonlySet<string> | null | undefined;
  readonly limit?: number;
}): ComposerProjectMentionItem[] {
  const query = input.query.trim().toLowerCase();
  const candidates = input.projects.filter((project) => !project.archived && !project.isScratch);
  const spansEnvironments = projectGroupsSpanEnvironments(candidates);
  const spaceKeys = input.activeSpaceProjectKeys ?? null;
  const ranked = candidates.flatMap((project) => {
    const name = project.displayName.trim();
    if (name === "") return [];
    const tier = matchTier(name, query);
    return tier === null ? [] : [{ project, name, tier }];
  });
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      Number(spaceKeys?.has(b.project.projectKey) ?? false) -
        Number(spaceKeys?.has(a.project.projectKey) ?? false) ||
      Number(b.project.pinned) - Number(a.project.pinned) ||
      a.name.localeCompare(b.name),
  );
  return ranked
    .slice(0, input.limit ?? COMPOSER_PROJECT_MENTION_LIMIT)
    .map(({ project, name }) => ({
      id: `fork-project:${project.projectKey}`,
      type: "fork-project",
      projectKey: project.projectKey,
      project: {
        environmentId: project.environmentId,
        workspaceRoot: project.workspaceRoot,
        title: project.title,
        faviconPath: project.faviconPath,
        projectIcon: project.projectIcon,
      },
      label: name,
      description: spansEnvironments ? environmentDescription(project) : "",
    }));
}

/** The text a pick inserts, with the trailing space that ends the mention. */
export function composerProjectMentionText(
  item: Pick<ComposerProjectMentionItem, "label">,
): string {
  return `@${item.label} `;
}

/** The menu's items split into the leading project mentions and everything else. */
export function splitComposerProjectMentions<T extends { readonly type: string }>(
  items: ReadonlyArray<T>,
): { readonly projects: ReadonlyArray<T>; readonly rest: ReadonlyArray<T> } {
  const projects = items.filter((item) => item.type === "fork-project");
  return projects.length === 0
    ? { projects, rest: items }
    : { projects, rest: items.filter((item) => item.type !== "fork-project") };
}

/** A typed `@Name` that names a project, shaped like the composer's file mention tokens. */
export interface ComposerProjectMentionToken {
  readonly type: "mention";
  /** The project's display name as the sidebar spells it. */
  readonly value: string;
  /** The text as written, e.g. `@eagle eye`. */
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

const projectMentionPatterns = new WeakMap<
  ReadonlyArray<string>,
  { readonly regex: RegExp; readonly byLowerName: ReadonlyMap<string, string> } | null
>();

function projectMentionPattern(names: ReadonlyArray<string>) {
  const cached = projectMentionPatterns.get(names);
  if (cached !== undefined) return cached;
  const byLowerName = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed !== "" && !byLowerName.has(trimmed.toLowerCase())) {
      byLowerName.set(trimmed.toLowerCase(), trimmed);
    }
  }
  // Longest first, so `@Eagle Eye Review` is not read as `@Eagle Eye` plus text.
  const alternatives = [...byLowerName.values()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Like upstream's `@file` and model mentions, a name chips only once whitespace follows it
  // (closing punctuation may come between), so typing `@Eagle` cannot lock before ` Eye`, and
  // `@penny.com` and `foo@penny` stay text.
  const pattern =
    alternatives.length === 0
      ? null
      : {
          regex: new RegExp(
            `(?<=^|[\\s(\\[{"',:;])@(${alternatives.join("|")})(?=[.,!?:;)\\]}"']*\\s)`,
            "giu",
          ),
          byLowerName,
        };
  projectMentionPatterns.set(names, pattern);
  return pattern;
}

/** Every `@Name` in `text` that names one of `names`, case-insensitively, in text order. */
export function collectComposerProjectMentions(
  text: string,
  names: ReadonlyArray<string>,
): ComposerProjectMentionToken[] {
  const pattern = projectMentionPattern(names);
  if (pattern === null || !text.includes("@")) return [];
  return [...text.matchAll(pattern.regex)].map((match) => {
    const start = match.index ?? 0;
    const written = match[1] ?? "";
    return {
      type: "mention",
      value: pattern.byLowerName.get(written.toLowerCase()) ?? written,
      source: match[0],
      start,
      end: start + match[0].length,
    };
  });
}

interface InlineTokenRange {
  readonly type: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

const overlaps = (a: InlineTokenRange, b: { readonly start: number; readonly end: number }) =>
  a.start < b.end && a.end > b.start;

/**
 * The composer's inline tokens with project mentions added. A project mention replaces the bare
 * `@word` file mention it overlaps (`@Eagle` of `@Eagle Eye`), and yields to file links and math.
 */
export function withComposerProjectMentionTokens<T extends InlineTokenRange>(
  text: string,
  tokens: ReadonlyArray<T>,
  names: ReadonlyArray<string>,
  mathRanges: (text: string) => ReadonlyArray<{ readonly start: number; readonly end: number }>,
): ReadonlyArray<T | ComposerProjectMentionToken> {
  const found = collectComposerProjectMentions(text, names);
  if (found.length === 0) return tokens;
  const blocked = [
    ...tokens.filter((token) => token.type === "mention" && token.source.startsWith("[")),
    ...mathRanges(text),
  ];
  const kept = found.filter((mention) => !blocked.some((range) => overlaps(mention, range)));
  if (kept.length === 0) return tokens;
  return [
    ...tokens.filter((token) => !kept.some((mention) => overlaps(token, mention))),
    ...kept,
  ].sort((left, right) => left.start - right.start);
}
