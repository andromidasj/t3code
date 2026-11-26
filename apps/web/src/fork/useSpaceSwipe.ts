import { useEffect } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

import {
  createSpaceSwipeState,
  isHorizontalSwipe,
  scrollsHorizontally,
  stepSpaceSwipe,
  wheelPixels,
} from "./spaceSwipe.logic";

const SLIDE_SELECTOR = "[data-fork-space-slide]";
const RELEASE_MS = 150;

function setSlideOffset(frame: HTMLElement, offset: number, animate: boolean) {
  for (const element of frame.querySelectorAll<HTMLElement>(SLIDE_SELECTOR)) {
    element.style.transition = animate ? "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    element.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
  }
}

/**
 * Two-finger horizontal swipes on the sidebar switch Spaces, one per flick. The content follows
 * the fingers until the switch, and springs back when the gesture stops short.
 */
export function useSpaceSwipe(
  frame: HTMLElement | null,
  options: {
    readonly enabled: boolean;
    readonly canGo: (direction: -1 | 1) => boolean;
    readonly onSwitch: (direction: -1 | 1) => void;
  },
): void {
  const canGo = useStableCallback(options.canGo);
  const onSwitch = useStableCallback(options.onSwitch);
  const { enabled } = options;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a non-passive wheel listener on the sidebar while Spaces can switch, so a sideways swipe never scrolls or navigates back
  useEffect(() => {
    if (frame === null || !enabled) return;
    const state = createSpaceSwipeState();
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      const { dx, dy } = wheelPixels(event);
      if (!isHorizontalSwipe(dx, dy)) return;
      if (scrollsHorizontally(event.target instanceof Element ? event.target : null, frame)) {
        return;
      }
      event.preventDefault();
      const step = stepSpaceSwipe(state, { dx, now: performance.now(), canGo });
      clearTimeout(releaseTimer);
      if (step.kind === "cooling") return;
      if (step.kind === "switch") {
        setSlideOffset(frame, 0, false);
        onSwitch(step.direction);
        return;
      }
      setSlideOffset(frame, step.offset, false);
      releaseTimer = setTimeout(() => {
        state.travel = 0;
        setSlideOffset(frame, 0, true);
      }, RELEASE_MS);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(releaseTimer);
      frame.removeEventListener("wheel", onWheel);
      setSlideOffset(frame, 0, false);
    };
  }, [canGo, enabled, frame, onSwitch]);
}
