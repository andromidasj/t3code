import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { useMessages } from "gt-react";
import { useEffect } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { buildSidebarProjectSnapshots } from "~/sidebarProjectGrouping";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "~/state/environments";
import { useProjects } from "~/state/entities";

import { setComposerProjectMentionRegistry } from "./composerProjectMentionRegistry";
import {
  matchComposerProjectMentionItems,
  type ComposerProjectMentionItem,
} from "./composerProjectMentions";
import { useForkSettings } from "./forkSettings";
import { resolveSpaces, spaceIdForProject } from "./spaces.logic";

const NO_ITEMS: ReadonlyArray<ComposerProjectMentionItem> = [];

/** The sidebar's project groups, or null while project mentions are off or `active` is false. */
function useMentionableProjectGroups(active: boolean) {
  const settings = useForkSettings();
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const environments = useEnvironmentIdentities();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const resolve = useMessages();
  if (!active || !settings.composerProjectMentions) return null;
  const labels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const groups = buildSidebarProjectSnapshots(
    {
      projects,
      groupScratchProjects: true,
      settings: groupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => labels.get(environmentId) ?? null,
    },
    resolve,
  );
  return { settings, groups };
}

/** Project mentions for an open `@` menu (`query` null while it is closed), grouped like the sidebar. */
export function useComposerProjectMentionItems(
  query: string | null,
): ReadonlyArray<ComposerProjectMentionItem> {
  const mentionable = useMentionableProjectGroups(query !== null);
  if (query === null || mentionable === null) return NO_ITEMS;
  const { settings, groups } = mentionable;
  const spaces = settings.spacesEnabled ? resolveSpaces(settings) : null;
  const activeSpaceProjectKeys = spaces
    ? new Set(
        groups
          .filter((group) => spaceIdForProject(spaces, group.projectKey) === spaces.activeSpace.id)
          .map((group) => group.projectKey),
      )
    : null;
  return matchComposerProjectMentionItems({ projects: groups, query, activeSpaceProjectKeys });
}

/** Keeps the names the composer chips as `@Name` in step with the sidebar's projects. */
export function useComposerProjectMentionRegistrySync(): void {
  const mentionable = useMentionableProjectGroups(true);
  const items =
    mentionable === null
      ? NO_ITEMS
      : matchComposerProjectMentionItems({
          projects: mentionable.groups,
          query: "",
          limit: Number.POSITIVE_INFINITY,
        });
  // The registry ignores an unchanged list, so running after every render is cheap.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the sidebar's projects into the module registry the composer's text parser reads
  useEffect(() => setComposerProjectMentionRegistry(items));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the registry when the app shell unmounts
  useEffect(() => () => setComposerProjectMentionRegistry(NO_ITEMS), []);
}
