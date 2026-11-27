import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { withoutThreadsShownAbove } from "./botDock.logic";
import { useForkSettings } from "./forkSettings";
import {
  applySidebarHierarchy,
  type SidebarHierarchyThread,
  type SidebarHierarchyView,
  type SidebarPartitionLists,
} from "./sidebarHierarchy";
import { resolveLineageScopedThreadKeys, type LineageThread } from "./sidebarLineage";

const SIDEBAR_BOT_EXPANDED_KEY = "t3code:fork:sidebar-bot-expanded";

export type ForkSidebarHierarchy<T> = SidebarHierarchyView<T> & {
  readonly toggleBotDrawer: () => void;
};

/**
 * The sidebar's partition with bots' background lanes folded away; upstream's when the hierarchy
 * is off.
 * Threads the Bot Dock or the Space's grid shows leave the list.
 */
export function useForkSidebarHierarchy<
  T extends SidebarHierarchyThread,
  P extends SidebarPartitionLists<T>,
>(
  partition: P & SidebarPartitionLists<T>,
  routeThreadKey: string | null,
  shownAboveThreadKeys: ReadonlySet<string>,
): P & { readonly forkHierarchy: ForkSidebarHierarchy<T> } {
  const { sidebarHierarchyEnabled, threadPlacementOverrides } = useForkSettings();
  const [botExpanded, setBotExpanded] = useLocalStorage(
    SIDEBAR_BOT_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const result = withoutThreadsShownAbove(
    applySidebarHierarchy<T, P>(partition, {
      enabled: sidebarHierarchyEnabled,
      botExpanded,
      routeThreadKey,
      placementOverrides: threadPlacementOverrides,
    }),
    shownAboveThreadKeys,
  );
  return {
    ...result,
    forkHierarchy: {
      ...result.forkHierarchy,
      toggleBotDrawer: () => setBotExpanded((value) => !value),
    },
  };
}

/**
 * The threads a project scope lists once delegated lanes and subagents follow their parent's
 * project; null leaves upstream's own project filter in charge.
 */
export function useForkLineageScope(
  threads: ReadonlyArray<LineageThread>,
  scopedProjectKeys: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  const { sidebarHierarchyEnabled, botDockEnabled, spacesEnabled } = useForkSettings();
  if (!sidebarHierarchyEnabled && !botDockEnabled && !spacesEnabled) return null;
  return resolveLineageScopedThreadKeys(threads, scopedProjectKeys);
}
