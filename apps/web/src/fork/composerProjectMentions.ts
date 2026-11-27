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
