import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_CHAT_TAB,
  BOARD_DETAILS_TAB,
  BOARD_THREAD_TAB,
  adjacentBoardTab,
  boardBaseTabs,
  boardPanelHostThreadId,
  boardPanelShortcutAction,
  boardTabAt,
  resolveBoardActiveTab,
  sameBoardPanelSelection,
  shouldEscapeCloseBoardPanel,
} from "./boardPanel.logic";

const item = { kind: "item", key: "eagle-eye/EER-12" } as const;
const thread = { kind: "thread", environmentId: "env-1", threadId: "t-1" } as const;
const PR = "pull-request:project:acme/app#42";
const PR2 = "pull-request:project:acme/app#43";

describe("board panel selections", () => {
  it("gives each selection its own right panel entry", () => {
    expect(boardPanelHostThreadId(item)).toBe("fork-board:item:eagle-eye/EER-12");
    expect(boardPanelHostThreadId(thread)).toBe("fork-board:thread:t-1");
    expect(boardPanelHostThreadId({ kind: "links" })).toBe("fork-board:links");
  });

  it("compares selections by what they point at", () => {
    expect(sameBoardPanelSelection(item, { kind: "item", key: item.key })).toBe(true);
    expect(sameBoardPanelSelection(item, thread)).toBe(false);
    expect(sameBoardPanelSelection(thread, { ...thread, environmentId: "env-2" })).toBe(false);
    expect(sameBoardPanelSelection(null, null)).toBe(true);
    expect(sameBoardPanelSelection(null, item)).toBe(false);
  });

  it("shows Details, plus Bot chat when the desk has a thread, for an item", () => {
    expect(boardBaseTabs(item, false)).toEqual([BOARD_DETAILS_TAB]);
    expect(boardBaseTabs(item, true)).toEqual([BOARD_DETAILS_TAB, BOARD_CHAT_TAB]);
    expect(boardBaseTabs(thread, true)).toEqual([BOARD_THREAD_TAB]);
    expect(boardBaseTabs({ kind: "links" }, true)).toEqual([]);
  });
});

describe("resolveBoardActiveTab", () => {
  const tabIds = [BOARD_DETAILS_TAB, BOARD_CHAT_TAB, PR];

  it("starts on the first tab", () => {
    expect(
      resolveBoardActiveTab({ tabIds, choice: undefined, storeActiveId: null, storeRevision: 0 }),
    ).toBe(BOARD_DETAILS_TAB);
    expect(
      resolveBoardActiveTab({
        tabIds: [],
        choice: undefined,
        storeActiveId: null,
        storeRevision: 0,
      }),
    ).toBeNull();
  });

  it("keeps the tab the user picked while nothing else happened", () => {
    expect(
      resolveBoardActiveTab({
        tabIds,
        choice: { tabId: BOARD_CHAT_TAB, revision: 3 },
        storeActiveId: PR,
        storeRevision: 3,
      }),
    ).toBe(BOARD_CHAT_TAB);
  });

  it("follows a pull request link opened after the pick", () => {
    expect(
      resolveBoardActiveTab({
        tabIds,
        choice: { tabId: BOARD_CHAT_TAB, revision: 3 },
        storeActiveId: PR,
        storeRevision: 4,
      }),
    ).toBe(PR);
  });

  it("falls back to the first tab when the picked or stored tab is gone", () => {
    expect(
      resolveBoardActiveTab({
        tabIds: [BOARD_DETAILS_TAB],
        choice: { tabId: BOARD_CHAT_TAB, revision: 1 },
        storeActiveId: PR,
        storeRevision: 1,
      }),
    ).toBe(BOARD_DETAILS_TAB);
  });
});

describe("board tab navigation", () => {
  const tabIds = [BOARD_DETAILS_TAB, BOARD_CHAT_TAB, PR, PR2];

  it("cycles to the next and previous tab, wrapping", () => {
    expect(adjacentBoardTab(tabIds, BOARD_DETAILS_TAB, 1)).toBe(BOARD_CHAT_TAB);
    expect(adjacentBoardTab(tabIds, PR2, 1)).toBe(BOARD_DETAILS_TAB);
    expect(adjacentBoardTab(tabIds, BOARD_DETAILS_TAB, -1)).toBe(PR2);
    expect(adjacentBoardTab([BOARD_DETAILS_TAB], BOARD_DETAILS_TAB, 1)).toBeNull();
    expect(adjacentBoardTab(tabIds, null, 1)).toBeNull();
  });

  it("jumps by position, with 9 meaning the last tab", () => {
    expect(boardTabAt(tabIds, 1)).toBe(BOARD_DETAILS_TAB);
    expect(boardTabAt(tabIds, 3)).toBe(PR);
    expect(boardTabAt(tabIds, 9)).toBe(PR2);
    expect(boardTabAt(tabIds, 5)).toBeNull();
  });
});

describe("boardPanelShortcutAction", () => {
  const open = { open: true, canOpen: true, tabIds: [BOARD_DETAILS_TAB, PR], activeId: PR };
  const closed = { ...open, open: false };

  it("toggles the panel, but only reopens when there is something to show", () => {
    expect(boardPanelShortcutAction("rightPanel.toggle", open)).toEqual({ type: "toggle" });
    expect(boardPanelShortcutAction("rightPanel.toggle", closed)).toEqual({ type: "toggle" });
    expect(boardPanelShortcutAction("rightPanel.toggle", { ...closed, canOpen: false })).toBeNull();
  });

  it("closes an open panel and lets the shortcut through otherwise", () => {
    expect(boardPanelShortcutAction("rightPanel.close", open)).toEqual({ type: "close" });
    expect(boardPanelShortcutAction("rightPanel.close", closed)).toBeNull();
  });

  it("cycles and jumps between tabs of an open panel", () => {
    expect(boardPanelShortcutAction("rightPanel.nextTab", open)).toEqual({
      type: "activate",
      tabId: BOARD_DETAILS_TAB,
    });
    expect(boardPanelShortcutAction("rightPanel.previousTab", open)).toEqual({
      type: "activate",
      tabId: BOARD_DETAILS_TAB,
    });
    expect(boardPanelShortcutAction("rightPanel.jump.1", open)).toEqual({
      type: "activate",
      tabId: BOARD_DETAILS_TAB,
    });
    expect(boardPanelShortcutAction("rightPanel.jump.9", open)).toEqual({
      type: "activate",
      tabId: PR,
    });
    expect(boardPanelShortcutAction("rightPanel.jump.3", open)).toBeNull();
    expect(boardPanelShortcutAction("rightPanel.nextTab", closed)).toBeNull();
  });

  it("ignores other commands", () => {
    expect(boardPanelShortcutAction("chat.new", open)).toBeNull();
    expect(boardPanelShortcutAction(null, open)).toBeNull();
  });
});

describe("shouldEscapeCloseBoardPanel", () => {
  const escape = {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };
  const element = (matches: string[]) => ({
    closest: (selectors: string) =>
      matches.some((selector) => selectors.includes(selector)) ? {} : null,
  });

  it("closes on a plain Escape outside fields and overlays", () => {
    expect(shouldEscapeCloseBoardPanel(escape, element([]), false)).toBe(true);
    expect(shouldEscapeCloseBoardPanel(escape, null, false)).toBe(true);
  });

  it("leaves Escape to fields, editors, open overlays and handlers that took it", () => {
    expect(shouldEscapeCloseBoardPanel(escape, element(["textarea"]), false)).toBe(false);
    expect(shouldEscapeCloseBoardPanel(escape, element(["[contenteditable]"]), false)).toBe(false);
    expect(shouldEscapeCloseBoardPanel(escape, element(['[role="menu"]']), false)).toBe(false);
    expect(shouldEscapeCloseBoardPanel(escape, element([]), true)).toBe(false);
    expect(
      shouldEscapeCloseBoardPanel({ ...escape, defaultPrevented: true }, element([]), false),
    ).toBe(false);
    expect(shouldEscapeCloseBoardPanel({ ...escape, metaKey: true }, element([]), false)).toBe(
      false,
    );
    expect(shouldEscapeCloseBoardPanel({ ...escape, key: "Enter" }, element([]), false)).toBe(
      false,
    );
  });
});
