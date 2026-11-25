import type { KeybindingShortcut } from "@t3tools/contracts";

import { formatShortcutLabel } from "~/keybindings";

/**
 * Toggles the Board. Not a server keybinding command: adding one would change the contracts
 * package, which the fork leaves alone. mod+shift+b already toggles the thread panel upstream.
 */
const BOARD_SHORTCUT: KeybindingShortcut = {
  key: "b",
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: true,
  modKey: true,
};

export function boardShortcutLabel(platform?: string): string {
  return formatShortcutLabel(BOARD_SHORTCUT, platform);
}

export function isBoardShortcut(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  isMac: boolean,
): boolean {
  // `code`, since Option changes `key` on a Mac.
  if (event.code !== "KeyB" || !event.shiftKey || !event.altKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
