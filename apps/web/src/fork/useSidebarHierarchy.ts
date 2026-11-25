import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { useForkSettings } from "./forkSettings";
import {
  applySidebarHierarchy,
  SIDEBAR_FILTER_LENSES,
  type SidebarFilterLens,
  type SidebarHierarchyThread,
  type SidebarHierarchyView,
  type SidebarPartitionLists,
} from "./sidebarHierarchy";

const SIDEBAR_LENS_KEY = "t3code:fork:sidebar-lens";
const SIDEBAR_BOT_EXPANDED_KEY = "t3code:fork:sidebar-bot-expanded";
const SidebarLensSchema = Schema.Literals(SIDEBAR_FILTER_LENSES);

/** The sidebar's filter, shared by the filter bar and the thread list. */
export function useSidebarLens() {
  return useLocalStorage<SidebarFilterLens, SidebarFilterLens>(
    SIDEBAR_LENS_KEY,
    "all",
    SidebarLensSchema,
  );
}

export type ForkSidebarHierarchy<T> = SidebarHierarchyView<T> & {
  readonly toggleBotDrawer: () => void;
};

/** The sidebar's partition with this Mac's filter applied; upstream's when the hierarchy is off. */
export function useForkSidebarHierarchy<
  T extends SidebarHierarchyThread,
  P extends SidebarPartitionLists<T>,
>(
  partition: P & SidebarPartitionLists<T>,
  routeThreadKey: string | null,
): P & { readonly forkHierarchy: ForkSidebarHierarchy<T> } {
  const { sidebarHierarchyEnabled } = useForkSettings();
  const [lens] = useSidebarLens();
  const [botExpanded, setBotExpanded] = useLocalStorage(
    SIDEBAR_BOT_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const result = applySidebarHierarchy<T, P>(partition, {
    enabled: sidebarHierarchyEnabled,
    lens,
    botExpanded,
    routeThreadKey,
  });
  return {
    ...result,
    forkHierarchy: {
      ...result.forkHierarchy,
      toggleBotDrawer: () => setBotExpanded((value) => !value),
    },
  };
}
