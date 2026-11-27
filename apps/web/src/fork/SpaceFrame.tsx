import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { isMacPlatform } from "~/lib/utils";

import { neighborSpaceId } from "./spaces.logic";
import { spaceShortcutIndex } from "./spaceSwipe.logic";
import { useSpaceSwipe } from "./useSpaceSwipe";
import { SPACE_FRAME_ATTRIBUTE, type ForkSidebarSpaces } from "./useSidebarSpaces";

/**
 * Anchors the Space sidebar's sideways swipe gesture and Ctrl+1 to Ctrl+9 shortcuts.
 * Keeps the sidebar background native to the active T3 theme so selected rows stay legible;
 * the Space's color shows on its header badge and the bottom switcher pill.
 */
export function SpaceFrame(props: { readonly spaces: ForkSidebarSpaces }) {
  const { spaces } = props;
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const attach = useStableCallback((node: HTMLSpanElement | null) =>
    setFrame(node?.parentElement ?? null),
  );
  const view = spaces.view;
  const switchBy = (direction: -1 | 1) => {
    const id =
      view === null
        ? null
        : neighborSpaceId({ ...view.resolved, activeSpace: view.shownSpace }, direction);
    if (id !== null) spaces.switchTo(id);
  };
  useSpaceSwipe(frame, {
    enabled: view !== null && view.resolved.spaces.length > 1,
    canGo: (direction) =>
      view !== null &&
      neighborSpaceId({ ...view.resolved, activeSpace: view.shownSpace }, direction) !== null,
    onSwitch: switchBy,
  });
  const onShortcut = useStableCallback((event: KeyboardEvent) => {
    const index = spaceShortcutIndex(event);
    const space = index === null ? undefined : view?.resolved.spaces[index];
    if (space === undefined) return;
    event.preventDefault();
    spaces.switchTo(space.id);
  });
  const shortcutsOn = view !== null && isMacPlatform(navigator.platform);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the window's Ctrl+1 to Ctrl+9 Space shortcuts registered while Spaces are on; elsewhere Ctrl+digit is the thread jump
  useEffect(() => {
    if (!shortcutsOn) return;
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [onShortcut, shortcutsOn]);
  if (view === null) return null;
  return (
    <span
      ref={attach}
      aria-hidden
      data-testid="space-tint"
      {...{ [SPACE_FRAME_ATTRIBUTE]: "" }}
      data-tint={view.shownSpace.tint}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    />
  );
}
