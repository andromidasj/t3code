import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
// Routes load lazily; their first transform would eat the test's timeout.
import "~/components/ChatView";
import "./BoardPage";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { boardPanelHostRef } from "./boardPanels";
import { openBoardPanel, useBoardPanelStore } from "./boardPanelStore";
import { DEFAULT_FORK_SETTINGS, updateForkSettings } from "./forkSettings";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
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

// One environment for the file: the app keeps its connection between tests.
const THREAD = threadWithHistory("thread-b", 1);
const DESK_THREAD = threadWithHistory("thread-desk", 1);
installFakeEnvironment([THREAD, DESK_THREAD]);

async function mountBoard() {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/board"] }));
  await router.load();
  const app = await render(<AppRoot router={router} />, { router: false });
  return { app, router };
}

const tabButtons = () => [
  ...document.querySelectorAll('[role="tablist"][aria-label="Board panel tabs"] [role="tab"]'),
];
const tabs = () => tabButtons().map((tab) => tab.textContent);
const activeTab = () =>
  tabButtons().find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
const footerLabels = () =>
  [...document.querySelectorAll('[data-sidebar="footer"] button[aria-label]')].map((button) =>
    button.getAttribute("aria-label"),
  );

it("shows a thread and its pull requests in the Board's right panel, with T3's panel shortcuts", async () => {
  const thread = THREAD;
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  updateForkSettings({ sidebarPages: DEFAULT_FORK_SETTINGS.sidebarPages });
  useBoardPanelStore.setState({ open: false, selection: null, choices: {} });
  const { app, router } = await mountBoard();
  await using _app = app;

  await expect.element(page.getByRole("button", { name: /^Board/ })).toBeVisible();
  await expect.element(page.getByText(`Thread ${thread.id}`).first()).toBeVisible();
  expect(footerLabels()).toEqual(["Settings", "Usage"]);
  const toggle = page.getByRole("button", { name: "Toggle right panel" });
  await expect.element(toggle).toBeDisabled();
  const historyLength = router.history.length;

  const selection = { kind: "thread", environmentId: ENVIRONMENT_ID, threadId: thread.id } as const;
  await act(() => openBoardPanel(selection));
  await vi.waitFor(() => expect(tabs()).toEqual([`Thread ${thread.id}`]));
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");

  // A pull request link clicked in the thread lands in the selection's panel entry.
  const hostRef = boardPanelHostRef(ENVIRONMENT_ID, selection);
  await act(() =>
    useRightPanelStore.getState().openPullRequest(hostRef, {
      projectId: PROJECT_ID,
      repository: "acme/app",
      number: 42,
    }),
  );
  await vi.waitFor(() => expect(tabs()).toEqual([`Thread ${thread.id}`, "#42"]));
  expect(activeTab()).toBe("#42");

  await userEvent.keyboard("{Control>}{Alt>}1{/Alt}{/Control}");
  await vi.waitFor(() => expect(activeTab()).toBe(`Thread ${thread.id}`));
  // Next/previous tab bind only in the desktop app (upstream's `isDesktop` rule); 9 is the last tab.
  await userEvent.keyboard("{Control>}{Alt>}9{/Alt}{/Control}");
  await vi.waitFor(() => expect(activeTab()).toBe("#42"));

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(useBoardPanelStore.getState().open).toBe(false));
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  // Reopens what it showed.
  await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
  await vi.waitFor(() => expect(useBoardPanelStore.getState().open).toBe(true));
  await vi.waitFor(() => expect(activeTab()).toBe("#42"));

  await toggle.click();
  await vi.waitFor(() => expect(useBoardPanelStore.getState().open).toBe(false));
  expect(router.history.length).toBe(historyLength);
  expect(router.state.location.pathname).toBe("/board");
});

it("shows only the sidebar pages this Mac chose, in its order", async () => {
  updateForkSettings({
    sidebarPages: [
      { id: "issues", visible: true },
      { id: "pull-requests", visible: true },
      { id: "board", visible: false },
    ],
  });
  using _restore = {
    [Symbol.dispose]: () =>
      updateForkSettings({ sidebarPages: DEFAULT_FORK_SETTINGS.sidebarPages }),
  };
  const { app, router: labsRouter } = await mountBoard();
  await using _app = app;
  await expect.element(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /^Board/ }).elements()).toHaveLength(0);
  await act(() => labsRouter.navigate({ to: "/settings/labs" }));
  await expect.element(page.getByText("Sidebar pages").first()).toBeVisible();
  await expect
    .element(page.getByRole("switch", { name: "Show Board in the sidebar" }))
    .not.toBeChecked();
});

it("opens a Board item's details beside the board and its desk's thread in one click", async () => {
  const environmentFetch = globalThis.fetch;
  const board = {
    built: "2026-11-25T10:00:00-06:00",
    desks: [
      {
        // Named after the fake environment's project, so its thread is the desk's bot chat.
        name: "Render scenarios",
        slug: "render",
        items: [
          {
            id: "shipBoardPanel",
            type: "decide",
            ask: "Ship the Board panel?",
            when: "now",
            body: "The panel now matches T3's own.",
          },
        ],
        rows: [],
        today: [],
        errors: [],
      },
    ],
  };
  globalThis.fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input) === "https://board.test/data.json"
      ? new Response(JSON.stringify(board), { headers: { "content-type": "application/json" } })
      : environmentFetch(input, init);
  using _fetch = { [Symbol.dispose]: () => void (globalThis.fetch = environmentFetch) };
  updateForkSettings({ boardUrl: "https://board.test/data.json" });
  using _board = { [Symbol.dispose]: () => void updateForkSettings({ boardUrl: "" }) };
  useBoardPanelStore.setState({ open: false, selection: null, choices: {} });
  const { app, router } = await mountBoard();
  await using _app = app;

  await expect.element(page.getByText(`Thread ${DESK_THREAD.id}`).first()).toBeVisible();
  const row = page.getByRole("button", { name: /Ship the Board panel\?/ });
  await expect.element(row).toBeVisible();
  // The row's quick action, shown on hover.
  await expect
    .element(page.getByRole("button", { name: "Open in Render scenarios" }).first())
    .toBeInTheDocument();

  await row.click();
  await vi.waitFor(() => expect(tabs()).toEqual(["Details", "Bot chat"]));
  expect(activeTab()).toBe("Details");
  await expect.element(page.getByText("The panel now matches T3's own.")).toBeVisible();
  await row.hover();
  await expect
    .element(page.getByRole("button", { name: "Open in Render scenarios" }).last())
    .toBeVisible();

  // Both threads share the project, so the desk's thread is whichever the desk lookup picks.
  await userEvent.click(row, { modifiers: ["Control"] });
  await vi.waitFor(() =>
    expect([THREAD.id, DESK_THREAD.id].map((id) => `/${ENVIRONMENT_ID}/${id}`)).toContain(
      router.state.location.pathname,
    ),
  );
});
