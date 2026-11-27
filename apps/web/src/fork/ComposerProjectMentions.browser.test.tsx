import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ProjectId, WS_METHODS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the timeout.
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  answerRpc,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { FORK_SETTINGS_STORAGE_KEY, updateForkSettings } from "./forkSettings";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const menuOptions = () =>
  [...document.querySelectorAll<HTMLElement>("[data-composer-item-id]")].map(
    (element) => element.dataset.composerItemId ?? "",
  );

it("lists projects first in the @ menu, inserts @Name, and hides workspace files until turned off", async () => {
  localStorage.setItem(
    FORK_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      collapseAgentTurns: false,
      sidebarHierarchyEnabled: false,
      botDockEnabled: false,
      spacesEnabled: false,
      composerProjectMentions: true,
      hideComposerWorkspaceFiles: true,
    }),
  );
  const thread = threadWithHistory("thread-mentions", 1);
  using _environment = installFakeEnvironment([thread], {
    extraProjects: [
      { id: ProjectId.make("project-penny"), title: "Penny" },
      { id: ProjectId.make("project-eagle"), title: "Eagle Eye" },
    ],
  });
  const searches: unknown[] = [];
  using _search = answerRpc(WS_METHODS.projectsSearchEntries, (input: unknown) => {
    searches.push(input);
    return Effect.succeed({ entries: [{ path: "docs/notes.md", kind: "file" }], truncated: false });
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using screen = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText("Answer 0 for thread-mentions.")).toBeVisible();

  const editor = screen.getByRole("textbox", { name: `Message ${thread.title}`, exact: true });
  const prompt = () =>
    useComposerDraftStore.getState().getComposerDraft(scopeThreadRef(ENVIRONMENT_ID, thread.id))
      ?.prompt;
  await userEvent.click(editor);
  await userEvent.keyboard("ask @");
  await expect.element(page.getByText("Projects & bots")).toBeVisible();
  // The thread's own project and both bots lead the menu.
  await vi.waitFor(() =>
    expect(
      menuOptions()
        .slice(0, 3)
        .every((id) => id.startsWith("fork-project:")),
    ).toBe(true),
  );
  // No file search runs while files are hidden.
  expect(menuOptions().some((id) => id.startsWith("path:"))).toBe(false);
  expect(searches).toEqual([]);

  await userEvent.keyboard("pen");
  await vi.waitFor(() => expect(menuOptions()[0]).toMatch(/^fork-project:/));
  await expect.element(page.getByRole("option", { name: /Penny/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  // Plain text; the editor shows it like any typed `@word`.
  await vi.waitFor(() => expect(prompt()).toBe("ask @Penny "));
  expect(document.querySelector("[data-composer-item-id]")).toBeNull();

  await userEvent.keyboard("and @eag");
  await expect.element(page.getByRole("option", { name: /Eagle Eye/ })).toBeVisible();
  await userEvent.keyboard("{Tab}");
  await vi.waitFor(() => expect(prompt()).toBe("ask @Penny and @Eagle Eye "));

  // Files come back, below the projects, once the setting is off.
  updateForkSettings({ hideComposerWorkspaceFiles: false });
  await userEvent.keyboard("@");
  await vi.waitFor(() => expect(menuOptions()).toContain("path:file:docs/notes.md"));
  const ids = menuOptions();
  expect(ids.findIndex((id) => id.startsWith("path:"))).toBeGreaterThan(
    ids.findLastIndex((id) => id.startsWith("fork-project:")),
  );
  expect(searches.length).toBeGreaterThan(0);
});

it("leaves projects out of the @ menu when the setting is off", async () => {
  // browserSetup turns both settings off, as upstream expects.
  const thread = threadWithHistory("thread-mentions-off", 1);
  using _environment = installFakeEnvironment([thread], {
    extraProjects: [{ id: ProjectId.make("project-penny"), title: "Penny" }],
  });
  using _search = answerRpc(WS_METHODS.projectsSearchEntries, () =>
    Effect.succeed({ entries: [{ path: "docs/notes.md", kind: "file" }], truncated: false }),
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using screen = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText("Answer 0 for thread-mentions-off.")).toBeVisible();

  await userEvent.click(
    screen.getByRole("textbox", { name: `Message ${thread.title}`, exact: true }),
  );
  await userEvent.keyboard("@");
  await vi.waitFor(() => expect(menuOptions()).toContain("path:file:docs/notes.md"));
  expect(menuOptions().some((id) => id.startsWith("fork-project:"))).toBe(false);
  expect(document.body.textContent).not.toContain("Projects & bots");
});
