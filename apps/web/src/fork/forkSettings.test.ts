import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FORK_SETTINGS, FORK_SETTINGS_STORAGE_KEY, readForkSettings } from "./forkSettings";

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
