import { RIGHT_PANEL_JUMP_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";

/**
 * What the Board's right panel shows: a Board item, a live thread, or only the pull requests
 * opened from the Today list.
 */
export type BoardPanelSelection =
  | { readonly kind: "item"; readonly key: string }
  | { readonly kind: "thread"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "links" };

/**
 * The thread id of the right panel store entry that holds a selection's pull request tabs. Each
 * selection keeps its own tabs, as each thread does beside the chat.
 */
export function boardPanelHostThreadId(selection: BoardPanelSelection): string {
  switch (selection.kind) {
    case "item":
      return `fork-board:item:${selection.key}`;
    case "thread":
      return `fork-board:thread:${selection.threadId}`;
    case "links":
      return "fork-board:links";
  }
}

export function sameBoardPanelSelection(
  a: BoardPanelSelection | null,
  b: BoardPanelSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "item" && b.kind === "item") return a.key === b.key;
  if (a.kind === "thread" && b.kind === "thread") {
    return a.environmentId === b.environmentId && a.threadId === b.threadId;
  }
  return a.kind === b.kind;
}

/** The Board's own tabs; pull request tabs use their right panel surface ids. */
export const BOARD_DETAILS_TAB = "board:details";
export const BOARD_CHAT_TAB = "board:chat";
export const BOARD_THREAD_TAB = "board:thread";

/** The tabs a selection always has, before any pull request tabs. */
export function boardBaseTabs(
  selection: BoardPanelSelection,
  hasDeskThread: boolean,
): ReadonlyArray<string> {
  switch (selection.kind) {
    case "item":
      return hasDeskThread ? [BOARD_DETAILS_TAB, BOARD_CHAT_TAB] : [BOARD_DETAILS_TAB];
    case "thread":
      return [BOARD_THREAD_TAB];
    case "links":
      return [];
  }
}

/**
 * A tab the user picked, valid while the right panel store has seen no other action on this
 * selection since: opening or closing a pull request tab there moves the panel to what the store
 * shows, as it would beside a thread.
 */
export interface BoardTabChoice {
  readonly tabId: string;
  readonly revision: number;
}

export function resolveBoardActiveTab(input: {
  readonly tabIds: ReadonlyArray<string>;
  readonly choice: BoardTabChoice | undefined;
  readonly storeActiveId: string | null;
  readonly storeRevision: number;
}): string | null {
  const { tabIds, choice } = input;
  if (choice !== undefined && choice.revision === input.storeRevision) {
    if (tabIds.includes(choice.tabId)) return choice.tabId;
  }
  if (input.storeActiveId !== null && tabIds.includes(input.storeActiveId)) {
    return input.storeActiveId;
  }
  return tabIds[0] ?? null;
}

/** The tab `step` places from the active one, wrapping; null without another tab. */
export function adjacentBoardTab(
  tabIds: ReadonlyArray<string>,
  activeId: string | null,
  step: 1 | -1,
): string | null {
  if (activeId === null || tabIds.length < 2) return null;
  const index = tabIds.indexOf(activeId);
  if (index < 0) return null;
  return tabIds[(index + step + tabIds.length) % tabIds.length] ?? null;
}

/** The tab at 1-based `position`, with 9 meaning the last tab like browser tabs. */
export function boardTabAt(tabIds: ReadonlyArray<string>, position: number): string | null {
  return (position === 9 ? tabIds.at(-1) : tabIds[position - 1]) ?? null;
}

export type BoardPanelAction =
  | { readonly type: "toggle" }
  | { readonly type: "close" }
  | { readonly type: "activate"; readonly tabId: string };

const JUMP_COMMANDS: ReadonlyArray<KeybindingCommand> = RIGHT_PANEL_JUMP_KEYBINDING_COMMANDS;

/**
 * What a right panel command does on the Board, or null to let it through. Tab commands need
 * the panel open, as they do beside a thread.
 */
export function boardPanelShortcutAction(
  command: KeybindingCommand | null,
  panel: {
    readonly open: boolean;
    readonly canOpen: boolean;
    readonly tabIds: ReadonlyArray<string>;
    readonly activeId: string | null;
  },
): BoardPanelAction | null {
  if (command === "rightPanel.toggle") {
    return panel.open || panel.canOpen ? { type: "toggle" } : null;
  }
  if (!panel.open) return null;
  if (command === "rightPanel.close") return { type: "close" };
  let tabId: string | null = null;
  if (command === "rightPanel.nextTab") tabId = adjacentBoardTab(panel.tabIds, panel.activeId, 1);
  else if (command === "rightPanel.previousTab") {
    tabId = adjacentBoardTab(panel.tabIds, panel.activeId, -1);
  } else if (command !== null && JUMP_COMMANDS.includes(command)) {
    tabId = boardTabAt(panel.tabIds, JUMP_COMMANDS.indexOf(command) + 1);
  }
  return tabId === null ? null : { type: "activate", tabId };
}

const TYPING_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OPEN_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether Escape should close the Board's panel: nothing handled it yet, and focus is not in a
 * field, and no dialog, popover or menu is open to take it first.
 */
export function shouldEscapeCloseBoardPanel(
  event: Pick<
    KeyboardEvent,
    "key" | "defaultPrevented" | "isComposing" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  target: { closest(selectors: string): unknown } | null,
  layerOpen: boolean,
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (layerOpen) return false;
  return target?.closest(TYPING_TARGETS) == null && target?.closest(OPEN_LAYERS) == null;
}

/** Whether a dialog, popover or menu is open anywhere in the document. */
export function boardOverlayOpen(root: Pick<Document, "querySelector">): boolean {
  return root.querySelector(OPEN_LAYERS) !== null;
}
