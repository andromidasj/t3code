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
const RELEASE_MS = 140;
const SPRING_BACK_MS = 180;

function cancelSlideAnimations(frame: HTMLElement) {
  for (const element of frame.querySelectorAll<HTMLElement>(SLIDE_SELECTOR)) {
    for (const animation of element.getAnimations()) animation.cancel();
  }
}

function setSlideOffset(frame: HTMLElement, offset: number, animate: boolean) {
  for (const element of frame.querySelectorAll<HTMLElement>(SLIDE_SELECTOR)) {
    element.style.transition = animate
      ? `transform ${SPRING_BACK_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : offset === 0
        ? ""
        : "none";
    element.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
  }
}

function clearSlideStyles(frame: HTMLElement) {
  for (const element of frame.querySelectorAll<HTMLElement>(SLIDE_SELECTOR)) {
    element.style.transition = "";
    element.style.transform = "";
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
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    const onWheel = (event: WheelEvent) => {
      const { dx, dy } = wheelPixels(event);
      if (!isHorizontalSwipe(dx, dy)) return;
      // Only defer to an inner horizontal scroller before a Space drag starts; once dragging,
      // our own translateX must never abort the gesture.
      if (
        !dragging &&
        scrollsHorizontally(event.target instanceof Element ? event.target : null, frame)
      ) {
        return;
      }
      event.preventDefault();
      const step = stepSpaceSwipe(state, { dx, now: performance.now(), canGo });
      clearTimeout(releaseTimer);
      clearTimeout(cleanupTimer);
      if (step.kind === "cooling") return;
      if (step.kind === "switch") {
        dragging = false;
        clearSlideStyles(frame);
        onSwitch(step.direction);
        return;
      }
      if (!dragging) {
        dragging = true;
        cancelSlideAnimations(frame);
      }
      setSlideOffset(frame, step.offset, false);
      releaseTimer = setTimeout(() => {
        dragging = false;
        state.travel = 0;
        setSlideOffset(frame, 0, true);
        cleanupTimer = setTimeout(() => clearSlideStyles(frame), SPRING_BACK_MS + 20);
      }, RELEASE_MS);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(releaseTimer);
      clearTimeout(cleanupTimer);
      frame.removeEventListener("wheel", onWheel);
      clearSlideStyles(frame);
    };
  }, [canGo, enabled, frame, onSwitch]);
}
