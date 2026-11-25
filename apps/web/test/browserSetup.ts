import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

import { FORK_SETTINGS_STORAGE_KEY } from "../src/fork/forkSettings";
import { initializeI18n } from "../src/i18n/initializeI18n";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Moves Playwright's mouse off the page. */
    resetPointer: () => Promise<void>;
    /** Defined in vite.config.ts. Presses the primary button where the mouse is, without releasing. */
    pointerDown: () => Promise<void>;
    /** Defined in vite.config.ts. Releases the primary button. */
    pointerUp: () => Promise<void>;
  }
}

// Playwright's mouse outlives each test and each file, so whatever the next test mounts
// under its last position starts hovered. Registered here rather than in render() so tests
// that mount without it are covered too. Before each test, not after: a timed-out test keeps
// running and can move the mouse after its own afterEach.
beforeEach(async () => {
  await commands.resetPointer();
  // Fork: upstream tests expect upstream timelines and sidebars; fork tests turn these on.
  localStorage.setItem(
    FORK_SETTINGS_STORAGE_KEY,
    JSON.stringify({ collapseAgentTurns: false, sidebarHierarchyEnabled: false }),
  );
});

// The app initializes GT at startup; components using its hooks need the same here.
initializeI18n(() => {});
