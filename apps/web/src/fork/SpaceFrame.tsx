import { useEffect, useState, type CSSProperties } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { isMacPlatform } from "~/lib/utils";

import { neighborSpaceId } from "./spaces.logic";
import { spaceTintColor } from "./spaceLook";
import { spaceShortcutIndex } from "./spaceSwipe.logic";
import { useSpaceSwipe } from "./useSpaceSwipe";
import { SPACE_FRAME_ATTRIBUTE, type ForkSidebarSpaces } from "./useSidebarSpaces";

const tintWash = (color: string): CSSProperties => ({
  background: `radial-gradient(130% 230px at 0 0, color-mix(in oklab, ${color} 15%, transparent), transparent 72%), linear-gradient(180deg, color-mix(in oklab, ${color} 7%, transparent), color-mix(in oklab, ${color} 3%, transparent) 45%, color-mix(in oklab, ${color} 6%, transparent))`,
});

const tintEdge = (color: string): CSSProperties => ({
  background: `linear-gradient(90deg, transparent, color-mix(in oklab, ${color} 65%, transparent) 30%, color-mix(in oklab, ${color} 30%, transparent) 75%, transparent)`,
});

/**
 * Paints the shown Space's tint behind the sidebar, which must isolate so the wash sits under its
 * rows, and switches Spaces on a sideways swipe or Ctrl+1 to Ctrl+9.
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
    >
      {view.resolved.spaces.map((space) =>
        space.tint === "none" ? null : (
          <span
            key={space.id}
            className="absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none"
            style={{
              ...tintWash(spaceTintColor(space.tint)),
              opacity: space.id === view.shownSpace.id ? 1 : 0,
            }}
          >
            <span
              className="absolute inset-x-0 top-0 h-px"
              style={tintEdge(spaceTintColor(space.tint))}
            />
          </span>
        ),
      )}
    </span>
  );
}
