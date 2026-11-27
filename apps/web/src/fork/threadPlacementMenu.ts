import type { ContextMenuItem } from "@t3tools/contracts";

import {
  readForkSettings,
  updateForkSettings,
  type ThreadPlacement,
  type ThreadPlacementOverrides,
} from "./forkSettings";
import {
  isBackgroundBotThread,
  toggleThreadPlacementOverride,
  type SidebarHierarchyThread,
} from "./sidebarHierarchy";

const MENU_ID = "fork-thread-placement";
export type ThreadPlacementMenuId = typeof MENU_ID;

/** The thread menu's Move to main sidebar / Move to Bot / Background entry, handled by the fork. */
export function isThreadPlacementMenuId(value: string): value is typeof MENU_ID {
  return value === MENU_ID;
}

/** Where the entry would send the thread: out of the drawer if it is in it, else into it. */
function threadPlacementTarget(
  thread: SidebarHierarchyThread,
  overrides: ThreadPlacementOverrides,
): ThreadPlacement {
  return isBackgroundBotThread(thread, overrides) ? "main" : "background";
}

export interface ThreadPlacementMenuInput {
  readonly thread: SidebarHierarchyThread;
  readonly eligible: boolean;
}

/**
 * The thread menu with the placement entry added, for an active or working thread while the
 * sidebar filter is on. A thread already pinned, settled, snoozed or in a Space's grid is not in
 * the list the drawer splits, so it gets none.
 */
export function withThreadPlacementItem<T extends string>(
  items: readonly ContextMenuItem<T>[],
  input: ThreadPlacementMenuInput,
  labels: { readonly toMain: string; readonly toBackground: string },
): readonly ContextMenuItem<T | typeof MENU_ID>[] {
  if (!input.eligible) return items;
  const target = threadPlacementTarget(input.thread, readForkSettings().threadPlacementOverrides);
  return [
    ...items,
    {
      id: MENU_ID,
      label: target === "main" ? labels.toMain : labels.toBackground,
      separatorBefore: true,
    },
  ];
}

/** Applies the entry: flips the thread to the other side, keeping the saved map minimal. */
export function applyThreadPlacement(thread: SidebarHierarchyThread): void {
  const { threadPlacementOverrides } = readForkSettings();
  updateForkSettings({
    threadPlacementOverrides: toggleThreadPlacementOverride(
      threadPlacementOverrides,
      thread,
      threadPlacementTarget(thread, threadPlacementOverrides),
    ),
  });
}
