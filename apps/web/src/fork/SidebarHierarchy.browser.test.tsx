import appCss from "../index.css?inline";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type LocalApi,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import Sidebar from "~/components/Sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { makeThreadFixture } from "~/test-fixtures";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { Project } from "~/types";

import { render } from "../../test/render";
import { DEFAULT_FORK_SETTINGS, updateForkSettings } from "./forkSettings";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock("../components/sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const environmentId = EnvironmentId.make("local");
const project: Project = {
  id: ProjectId.make("desk"),
  environmentId,
  title: "desk",
  workspaceRoot: "/projects/desk",
  repositoryIdentity: null,
  defaultModelSelection: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scripts: [],
};

function shell(
  id: string,
  title: string,
  options: {
    readonly bot?: boolean;
    readonly lane?: boolean;
    readonly failed?: boolean;
    readonly running?: boolean;
  } = {},
) {
  const base = makeThreadFixture({
    environmentId,
    id: ThreadId.make(id),
    projectId: project.id,
    title,
    ...(options.failed || options.running
      ? {
          latestRun: {
            runId: RunId.make(`${id}-run`),
            status: options.running ? ("running" as const) : ("failed" as const),
            requestedAt: null,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        }
      : {}),
  });
  const bot = options.bot
    ? { ...base, source: { ...base.source, createdBy: "agent" as const } }
    : base;
  // A coding lane an agent started in its own worktree.
  return options.lane ? { ...bot, worktreePath: `/worktrees/${id}` } : bot;
}

const threads = [
  shell("mine", "My own thread"),
  shell("nightly", "Nightly scan", { bot: true, lane: true }),
  shell("jobs", "Desk · scheduled jobs", { bot: true }),
  shell("broken", "Broken watcher", { bot: true, lane: true, failed: true }),
  shell("pointer", "👉 Pick a flight", { bot: true }),
  shell("digest", "Chief · inbox digest · Nov 26", { bot: true }),
];

describe("Bot / Background drawer", () => {
  it("separates bot lanes into a drawer and shows no All | Needs me switch", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    updateForkSettings({ sidebarHierarchyEnabled: true, sidebarFilterPresets: [] });
    stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-bot-expanded"));
    vi.mocked(useProjects).mockReturnValue([project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();
    // The All | Needs me switch is gone, and with no saved views nothing takes its height.
    expect(screen.getByRole("button", { name: "All", exact: true }).query()).toBeNull();
    expect(document.querySelector('[data-testid="sidebar-filter-bar"]')).toBeNull();
    await expect.element(screen.getByText("👉 Pick a flight")).toBeInTheDocument();
    // A report a bot opened on its own stays in the list.
    await expect.element(screen.getByText("Chief · inbox digest · Nov 26")).toBeInTheDocument();
    const drawerToggle = screen.getByTestId("sidebar-bot-shelf-toggle");
    await vi.waitFor(() =>
      expect(drawerToggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?2$/,
      ),
    );
    await expect.element(drawerToggle).toHaveAttribute("aria-expanded", "false");
    expect(document.body.textContent).not.toContain("Nightly scan");
    expect(document.body.textContent).not.toContain("Desk · scheduled jobs");

    await userEvent.click(drawerToggle);
    await expect.element(screen.getByText("Nightly scan")).toBeInTheDocument();
    await expect.element(screen.getByText("Desk · scheduled jobs")).toBeInTheDocument();
    // A lane whose run failed leaves the drawer (it is not a quiet lane).
    expect(document.body.textContent).not.toContain("Broken watcher");
    await expect.element(drawerToggle).toHaveAttribute("aria-expanded", "true");
    // The drawer's rows are full thread rows below its header.
    const header = document.querySelector('[data-testid="sidebar-bot-header"]')!;
    const nightly = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Nightly scan"),
    )!;
    expect(header.compareDocumentPosition(nightly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(drawerToggle);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Nightly scan"));
  });

  it("shows running / total on the Bot / Background header, or just the total when idle", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    updateForkSettings({ sidebarHierarchyEnabled: true, sidebarFilterPresets: [] });
    stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-bot-expanded"));
    const busy = [
      shell("busy-mine", "Busy own thread"),
      shell("busy-lane-a", "Lane A", { bot: true, lane: true, running: true }),
      shell("busy-lane-b", "Lane B", { bot: true, lane: true, running: true }),
      shell("busy-lane-c", "Lane C", { bot: true, lane: true }),
    ];
    vi.mocked(useProjects).mockReturnValue([project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(busy);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const toggle = screen.getByTestId("sidebar-bot-shelf-toggle");
    await vi.waitFor(() =>
      expect(toggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?2 ?\/ ?3$/,
      ),
    );
    await expect.element(screen.getByRole("img", { name: "2 running of 3" })).toBeInTheDocument();
    expect(toggle.element().querySelector("svg")).not.toBeNull();
  });

  it("moves a single thread between the main sidebar and Bot / Background from its menu", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    updateForkSettings({ sidebarHierarchyEnabled: true, sidebarFilterPresets: [] });
    stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-bot-expanded"));
    vi.mocked(useProjects).mockReturnValue([project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: null,
    });
    const show = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => null);
    vi.mocked(readLocalApi).mockReturnValue({
      contextMenu: { show, close: vi.fn() },
    } as unknown as LocalApi);
    stack.defer(() => vi.mocked(readLocalApi).mockRestore());
    const row = (id: string) =>
      document.querySelector<HTMLElement>(`[data-sidebar-row="${environmentId}:${id}"]`);
    const rightClick = (element: Element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    const placementLabel = () => {
      const items = show.mock.calls.at(-1)![0] as Array<{ id: string; label: string }>;
      return items.find((item) => item.id === "fork-thread-placement")?.label ?? null;
    };

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();
    const drawerToggle = screen.getByTestId("sidebar-bot-shelf-toggle");
    await vi.waitFor(() =>
      expect(drawerToggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?2$/,
      ),
    );

    // A thread of the user's own goes to the drawer.
    show.mockResolvedValueOnce("fork-thread-placement");
    rightClick(row("mine")!);
    await vi.waitFor(() => expect(placementLabel()).toBe("Move to Bot / Background"));
    await vi.waitFor(() =>
      expect(drawerToggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?3$/,
      ),
    );
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("My own thread"));
    expect(JSON.parse(localStorage.getItem("t3code:fork:settings:v1")!)).toMatchObject({
      threadPlacementOverrides: { [`${environmentId}:mine`]: "background" },
    });

    // A bot lane in the drawer comes back to the main list.
    (drawerToggle.element() as HTMLElement).click();
    await expect.element(screen.getByText("Nightly scan")).toBeInTheDocument();
    show.mockResolvedValueOnce("fork-thread-placement");
    rightClick(row("nightly")!);
    await vi.waitFor(() => expect(placementLabel()).toBe("Move to main sidebar"));
    await vi.waitFor(() =>
      expect(drawerToggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?2$/,
      ),
    );
    const header = document.querySelector('[data-testid="sidebar-bot-header"]')!;
    const nightly = row("nightly")!;
    expect(header.compareDocumentPosition(nightly) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    // Moving the user's own thread back drops its override.
    show.mockResolvedValueOnce("fork-thread-placement");
    rightClick(row("mine")!);
    await vi.waitFor(() => expect(placementLabel()).toBe("Move to main sidebar"));
    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("t3code:fork:settings:v1")!).threadPlacementOverrides,
    ).toEqual({ [`${environmentId}:nightly`]: "main" });
  });

  it("fits a narrow sidebar and keeps the drawer steady right above Settled", async () => {
    using stack = new DisposableStack();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    stack.defer(() => style.remove());
    await page.viewport(1200, 800);
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    const projectKey = scopedProjectKey(scopeProjectRef(environmentId, project.id));
    updateForkSettings({
      sidebarHierarchyEnabled: true,
      sidebarFilterPresets: [{ id: "bots", name: "Bots", projectKeys: [projectKey] }],
    });
    stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-bot-expanded"));
    vi.mocked(useProjects).mockReturnValue([project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <div style={{ width: 250, height: 700, display: "flex" }}>
        <SidebarProvider style={{ height: 700, minHeight: 700 }}>
          <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
        </SidebarProvider>
      </div>,
    );
    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();

    // Saved views are all the bar holds; the All | Needs me switch is gone.
    expect(document.querySelector('[data-slot="toggle"]')).toBeNull();

    // The saved view's label is centered; its delete badge floats over the corner.
    const chip = screen.getByRole("button", { name: "Bots", exact: true }).element() as HTMLElement;
    const chipStyle = getComputedStyle(chip);
    expect(chipStyle.paddingLeft).toBe(chipStyle.paddingRight);
    const remove = screen.getByRole("button", { name: "Delete view Bots" }).element();
    expect(getComputedStyle(remove).position).toBe("absolute");
    const restWidth = chip.offsetWidth;
    await userEvent.hover(chip);
    await vi.waitFor(() => expect(getComputedStyle(remove).opacity).toBe("1"));
    expect(chip.offsetWidth).toBe(restWidth);

    // The drawer is the shelf right above Settled.
    const header = screen.getByTestId("sidebar-bot-header").element() as HTMLElement;
    expect(header.nextElementSibling?.getAttribute("data-testid")).toBe("sidebar-settled-header");

    // A row above that changes height after paint must not make the first toggle jump.
    const firstRow = [...header.parentElement!.children].find((li) =>
      li.textContent?.includes("My own thread"),
    ) as HTMLElement;
    firstRow.style.paddingTop = "8px";
    const toggle = screen.getByTestId("sidebar-bot-shelf-toggle").element() as HTMLElement;
    toggle.click();
    // The header's own motion starts in the toggle's commit, before the rows are found.
    expect(header.getAnimations()).toEqual([]);
    await expect.element(screen.getByText("Nightly scan")).toBeInTheDocument();
    expect(header.getAnimations()).toEqual([]);
    const settledHeader = screen.getByTestId("sidebar-settled-header").element();
    const nightly = [...header.parentElement!.children].find((li) =>
      li.textContent?.includes("Nightly scan"),
    )!;
    expect(header.compareDocumentPosition(nightly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      nightly.compareDocumentPosition(settledHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    toggle.click();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Nightly scan"));

    // The project menu says how to pick several, and Ctrl-click adds one without closing it.
    await userEvent.click(screen.getByRole("button", { name: "Bots", exact: true }));
    (document.querySelector<HTMLElement>('button[aria-label^="Projects"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="project-scope-multi-select-hint"]')?.textContent,
      ).toMatch(/Shift or (⌘|Ctrl)-click to select multiple/),
    );
    await userEvent.click(page.getByRole("option", { name: /desk/ }), { modifiers: ["Control"] });
    await expect.element(page.getByTestId("project-scope-multi-select-hint")).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /desk/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("is upstream's sidebar when turned off", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    updateForkSettings({ sidebarHierarchyEnabled: false });
    vi.mocked(useProjects).mockReturnValue([project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await expect.element(screen.getByText("Nightly scan")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="sidebar-filter-bar"]')).toBeNull();
    expect(document.querySelector('[data-testid="sidebar-bot-header"]')).toBeNull();
  });
});
