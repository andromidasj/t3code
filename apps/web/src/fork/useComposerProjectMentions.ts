import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { useMessages } from "gt-react";

import { useClientSettings } from "~/hooks/useSettings";
import { buildSidebarProjectSnapshots } from "~/sidebarProjectGrouping";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "~/state/environments";
import { useProjects } from "~/state/entities";

import {
  matchComposerProjectMentionItems,
  type ComposerProjectMentionItem,
} from "./composerProjectMentions";
import { useForkSettings } from "./forkSettings";
import { resolveSpaces, spaceIdForProject } from "./spaces.logic";

const NO_ITEMS: ReadonlyArray<ComposerProjectMentionItem> = [];

/** Project mentions for an open `@` menu (`query` null while it is closed), grouped like the sidebar. */
export function useComposerProjectMentionItems(
  query: string | null,
): ReadonlyArray<ComposerProjectMentionItem> {
  const settings = useForkSettings();
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const environments = useEnvironmentIdentities();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const resolve = useMessages();
  if (query === null || !settings.composerProjectMentions) return NO_ITEMS;
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
