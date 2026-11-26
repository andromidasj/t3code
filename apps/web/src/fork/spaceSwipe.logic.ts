/** Horizontal travel, in pixels, that switches the Space. */
const SWIPE_THRESHOLD = 55;
/** A switch ignores the trackpad's momentum tail until it has been quiet this long. */
export const SWIPE_QUIET_MS = 380;
/** A pause this long starts a new gesture. */
const SWIPE_RESET_MS = 220;

export interface SpaceSwipeState {
  travel: number;
  lastAt: number;
  /** While set, wheel events extend the quiet window instead of moving. */
  coolingUntil: number;
}

export function createSpaceSwipeState(): SpaceSwipeState {
  return { travel: 0, lastAt: Number.NEGATIVE_INFINITY, coolingUntil: Number.NEGATIVE_INFINITY };
}

/** The wheel's travel in pixels; line-mode wheels report lines. */
export function wheelPixels(event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">): {
  readonly dx: number;
  readonly dy: number;
} {
  const scale = event.deltaMode === 1 ? 16 : 1;
  return { dx: event.deltaX * scale, dy: event.deltaY * scale };
}

export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * 1.2;
}

export type SpaceSwipeStep =
  | { readonly kind: "cooling" }
  | { readonly kind: "drag"; readonly offset: number }
  | { readonly kind: "switch"; readonly direction: -1 | 1 };

/**
 * One horizontal wheel event. Travel past the threshold switches once toward a Space that
 * exists; short of it, or at either end, the content follows the fingers with resistance.
 */
export function stepSpaceSwipe(
  state: SpaceSwipeState,
  input: {
    readonly dx: number;
    readonly now: number;
    readonly canGo: (direction: -1 | 1) => boolean;
  },
): SpaceSwipeStep {
  if (input.now < state.coolingUntil) {
    state.coolingUntil = input.now + SWIPE_QUIET_MS;
    return { kind: "cooling" };
  }
  if (input.now - state.lastAt > SWIPE_RESET_MS) state.travel = 0;
  state.lastAt = input.now;
  state.travel += input.dx;
  if (state.travel === 0) return { kind: "drag", offset: 0 };
  const direction: -1 | 1 = state.travel > 0 ? 1 : -1;
  const atEdge = !input.canGo(direction);
  if (!atEdge && Math.abs(state.travel) >= SWIPE_THRESHOLD) {
    state.travel = 0;
    state.coolingUntil = input.now + SWIPE_QUIET_MS;
    return { kind: "switch", direction };
  }
  return {
    kind: "drag",
    offset: atEdge
      ? -direction * Math.min(26, Math.abs(state.travel) * 0.22)
      : -state.travel * 0.55,
  };
}

/** The wheel is over something that scrolls sideways itself, such as a code block. */
export function scrollsHorizontally(target: Element | null, boundary: Element): boolean {
  for (
    let element = target;
    element !== null && element !== boundary;
    element = element.parentElement
  ) {
    if (element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
}

/** The digit of a Ctrl+1 to Ctrl+9 press with no other modifier, else null. */
export function spaceShortcutIndex(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): number | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  return /^[1-9]$/u.test(event.key) ? Number(event.key) - 1 : null;
}
