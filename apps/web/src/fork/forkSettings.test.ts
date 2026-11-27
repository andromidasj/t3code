import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FORK_SETTINGS,
  FORK_SETTINGS_STORAGE_KEY,
  normalizeThreadPlacementOverrides,
  readForkSettings,
} from "./forkSettings";

const storage = (value: unknown) => ({
  getItem: (key: string) => (key === FORK_SETTINGS_STORAGE_KEY ? JSON.stringify(value) : null),
  setItem: () => {},
});

describe("disableHistorySwipeNavigation", () => {
  it("is on by default, including for settings saved before it existed", () => {
    expect(DEFAULT_FORK_SETTINGS.disableHistorySwipeNavigation).toBe(true);
    expect(readForkSettings(storage({ spacesEnabled: true })).disableHistorySwipeNavigation).toBe(
      true,
    );
  });

  it("keeps a saved choice", () => {
    expect(
      readForkSettings(storage({ disableHistorySwipeNavigation: false }))
        .disableHistorySwipeNavigation,
    ).toBe(false);
  });
});

describe("threadPlacementOverrides", () => {
  it("defaults to none, including for settings saved before it existed", () => {
    expect(DEFAULT_FORK_SETTINGS.threadPlacementOverrides).toEqual({});
    expect(readForkSettings(storage({ spacesEnabled: true })).threadPlacementOverrides).toEqual({});
  });

  it("keeps only main and background values", () => {
    expect(
      readForkSettings(
        storage({
          threadPlacementOverrides: { "a:1": "main", "a:2": "background", "a:3": "x", "a:4": 1 },
        }),
      ).threadPlacementOverrides,
    ).toEqual({ "a:1": "main", "a:2": "background" });
  });

  it("reads anything that is not a map as empty", () => {
    for (const raw of [null, "main", ["main"], 3]) {
      expect(normalizeThreadPlacementOverrides(raw)).toEqual({});
    }
  });
});
