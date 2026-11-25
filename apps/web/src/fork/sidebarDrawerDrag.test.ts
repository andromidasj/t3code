import type { SortingStrategy } from "@dnd-kit/sortable";
import { describe, expect, it } from "vite-plus/test";

import { createSidebarSortingStrategy } from "~/components/Sidebar.drag";
import {
  sidebarListItemId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "~/components/Sidebar.logic";

const thread = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });

const items: SidebarListItem[] = [
  marker("pinned-header"),
  thread("pinned", "pinned"),
  marker("pinned-divider"),
  thread("human", "active"),
  thread("human-2", "active"),
  marker("bot-header"),
  thread("bot", "active"),
  marker("settled-header"),
  marker("settled-placeholder"),
];

function preview(active: string, over: string) {
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? 82
        : item.marker === "pinned-header" ||
            item.marker === "pinned-divider" ||
            item.marker.endsWith("placeholder")
          ? 0
          : 32;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  const args = {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
  const strategy = createSidebarSortingStrategy({
    items,
    settledOrder: [],
    settledExpanded: false,
  });
  return new Map(
    items.map((item, index) => [sidebarListItemId(item), strategy({ ...args, index })]),
  );
}

describe("drag preview with the Bot / Background drawer", () => {
  it("keeps the drawer's header and rows where they are when nothing moves", () => {
    for (const [id, transform] of preview("human", "human")) {
      expect({ id, y: transform?.y, scaleY: transform?.scaleY }).toEqual({ id, y: 0, scaleY: 1 });
    }
  });

  it("moves the drawer down with the active rows when a pinned thread joins them", () => {
    const moved = preview("pinned", "human-2");
    const header = moved.get("sidebar-marker-bot-header");
    const bot = moved.get("bot");
    expect(header?.scaleY).toBe(1);
    // The pinned card leaves the top, and the drawer stays below the user's rows.
    expect(header?.y).toBe(bot?.y);
    expect(moved.get("human")?.y).toBeLessThan(0);
  });
});
