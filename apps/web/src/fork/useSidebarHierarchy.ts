import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { withoutDockedPinnedThreads } from "./botDock.logic";
import { useForkSettings } from "./forkSettings";
import {
  applySidebarHierarchy,
  parseSidebarFilterLens,
  type SidebarFilterLens,
  type SidebarHierarchyThread,
  type SidebarHierarchyView,
  type SidebarPartitionLists,
} from "./sidebarHierarchy";
import { resolveLineageScopedThreadKeys, type LineageThread } from "./sidebarLineage";

const SIDEBAR_LENS_KEY = "t3code:fork:sidebar-lens";
const SIDEBAR_BOT_EXPANDED_KEY = "t3code:fork:sidebar-bot-expanded";

/**
 * The sidebar's filter, shared by the filter bar and the thread list. Read as a plain string so
 * a lens this build no longer has (Mine) opens as All instead of failing to decode.
 */
export function useSidebarLens(): [SidebarFilterLens, (lens: SidebarFilterLens) => void] {
  const [stored, setStored] = useLocalStorage<string, string>(
    SIDEBAR_LENS_KEY,
    "all",
    Schema.String,
  );
  return [parseSidebarFilterLens(stored), setStored];
}

export type ForkSidebarHierarchy<T> = SidebarHierarchyView<T> & {
  readonly toggleBotDrawer: () => void;
};

/**
 * The sidebar's partition with this Mac's filter applied; upstream's when the hierarchy is off.
 * Main threads the Bot Dock shows leave the Pinned list.
 */
export function useForkSidebarHierarchy<
  T extends SidebarHierarchyThread,
  P extends SidebarPartitionLists<T>,
>(
  partition: P & SidebarPartitionLists<T>,
  routeThreadKey: string | null,
  dockedMainThreadKeys: ReadonlySet<string>,
): P & { readonly forkHierarchy: ForkSidebarHierarchy<T> } {
  const { sidebarHierarchyEnabled } = useForkSettings();
  const [lens] = useSidebarLens();
  const [botExpanded, setBotExpanded] = useLocalStorage(
    SIDEBAR_BOT_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const result = withoutDockedPinnedThreads(
    applySidebarHierarchy<T, P>(partition, {
      enabled: sidebarHierarchyEnabled,
      lens,
      botExpanded,
      routeThreadKey,
    }),
    dockedMainThreadKeys,
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
  const { sidebarHierarchyEnabled, botDockEnabled } = useForkSettings();
  if (!sidebarHierarchyEnabled && !botDockEnabled) return null;
  return resolveLineageScopedThreadKeys(threads, scopedProjectKeys);
}
