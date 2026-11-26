import { describe, expect, it } from "vite-plus/test";

import {
  createSpaceSwipeState,
  isHorizontalSwipe,
  spaceShortcutIndex,
  stepSpaceSwipe,
  SWIPE_QUIET_MS,
  wheelPixels,
} from "./spaceSwipe.logic";

const always = () => true;

describe("Space swipe", () => {
  it("counts only clearly sideways wheels, in pixels", () => {
    expect(isHorizontalSwipe(30, 20)).toBe(true);
    expect(isHorizontalSwipe(30, 26)).toBe(false);
    expect(wheelPixels({ deltaX: 2, deltaY: 1, deltaMode: 1 })).toEqual({ dx: 32, dy: 16 });
    expect(wheelPixels({ deltaX: 2, deltaY: 1, deltaMode: 0 })).toEqual({ dx: 2, dy: 1 });
  });

  it("follows the fingers, switches once past the threshold, then ignores the momentum tail", () => {
    const state = createSpaceSwipeState();
    expect(stepSpaceSwipe(state, { dx: 20, now: 0, canGo: always })).toEqual({
      kind: "drag",
      offset: -11,
    });
    expect(stepSpaceSwipe(state, { dx: 20, now: 16, canGo: always }).kind).toBe("drag");
    expect(stepSpaceSwipe(state, { dx: 20, now: 32, canGo: always })).toEqual({
      kind: "switch",
      direction: 1,
    });
    // A long flick's tail keeps arriving: one switch, not two.
    let now = 32;
    for (let index = 0; index < 30; index += 1) {
      now += 16;
      expect(stepSpaceSwipe(state, { dx: 40, now, canGo: always }).kind).toBe("cooling");
    }
    // Quiet long enough, a new gesture can switch again, the other way too.
    now += SWIPE_QUIET_MS + 1;
    expect(stepSpaceSwipe(state, { dx: -60, now, canGo: always })).toEqual({
      kind: "switch",
      direction: -1,
    });
  });

  it("resists at either end instead of switching", () => {
    const state = createSpaceSwipeState();
    const step = stepSpaceSwipe(state, { dx: 200, now: 0, canGo: () => false });
    expect(step).toEqual({ kind: "drag", offset: -26 });
  });

  it("starts over after a pause", () => {
    const state = createSpaceSwipeState();
    stepSpaceSwipe(state, { dx: 40, now: 0, canGo: always });
    expect(stepSpaceSwipe(state, { dx: 40, now: 500, canGo: always }).kind).toBe("drag");
  });
});

describe("Space shortcuts", () => {
  const press = (
    key: string,
    modifiers: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>>,
  ) => ({
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
  });

  it("reads Ctrl+1 to Ctrl+9 and nothing else", () => {
    expect(spaceShortcutIndex(press("1", { ctrl: true }))).toBe(0);
    expect(spaceShortcutIndex(press("9", { ctrl: true }))).toBe(8);
    expect(spaceShortcutIndex(press("0", { ctrl: true }))).toBeNull();
    expect(spaceShortcutIndex(press("1", {}))).toBeNull();
    expect(spaceShortcutIndex(press("1", { ctrl: true, meta: true }))).toBeNull();
    expect(spaceShortcutIndex(press("1", { ctrl: true, shift: true }))).toBeNull();
  });
});
