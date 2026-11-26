import appCss from "../index.css?inline";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
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
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { makeThreadFixture } from "~/test-fixtures";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { Project } from "~/types";

import { render } from "../../test/render";
import { DEFAULT_FORK_SETTINGS, updateForkSettings } from "./forkSettings";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
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
  options: { readonly bot?: boolean; readonly failed?: boolean } = {},
) {
  const base = makeThreadFixture({
    environmentId,
    id: ThreadId.make(id),
    projectId: project.id,
    title,
    ...(options.failed
      ? {
          latestRun: {
            runId: RunId.make(`${id}-run`),
            status: "failed" as const,
            requestedAt: null,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        }
      : {}),
  });
  return options.bot ? { ...base, source: { ...base.source, createdBy: "agent" as const } } : base;
}

const threads = [
  shell("mine", "My own thread"),
  shell("nightly", "Nightly scan", { bot: true }),
  shell("broken", "Broken watcher", { bot: true, failed: true }),
  shell("pointer", "👉 Pick a flight", { bot: true }),
];

describe("sidebar filter and Bot / Background drawer", () => {
  it("separates bot threads into a drawer and filters by All, Mine and Needs me", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    updateForkSettings({ sidebarHierarchyEnabled: true, sidebarFilterPresets: [] });
    stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-lens"));
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
    await expect.element(screen.getByText("👉 Pick a flight")).toBeInTheDocument();
    const drawerToggle = screen.getByTestId("sidebar-bot-shelf-toggle");
    await vi.waitFor(() =>
      expect(drawerToggle.element().textContent?.replace(/\s+/g, " ")).toMatch(
        /^Bot \/ Background ?2$/,
      ),
    );
    await expect.element(drawerToggle).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByRole("img", { name: "1 failed" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Nightly scan");
    await expect
      .element(screen.getByRole("button", { name: /Needs me, 2 waiting/ }))
      .toBeInTheDocument();

    await userEvent.click(drawerToggle);
    await expect.element(screen.getByText("Nightly scan")).toBeInTheDocument();
    await expect.element(screen.getByText("Broken watcher")).toBeInTheDocument();
    await expect.element(drawerToggle).toHaveAttribute("aria-expanded", "true");
    // The drawer's rows are full thread rows below its header.
    const header = document.querySelector('[data-testid="sidebar-bot-header"]')!;
    const nightly = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Nightly scan"),
    )!;
    expect(header.compareDocumentPosition(nightly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(drawerToggle);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Nightly scan"));

    await userEvent.click(screen.getByRole("button", { name: "Mine", exact: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="sidebar-bot-header"]')).toBeNull(),
    );
    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();
    await expect.element(screen.getByText("👉 Pick a flight")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Needs me/ }));
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("My own thread"));
    await expect.element(screen.getByText("👉 Pick a flight")).toBeInTheDocument();
    await expect.element(screen.getByText("Broken watcher")).toBeInTheDocument();
    expect(localStorage.getItem("t3code:fork:sidebar-lens")).toBe('"needs-me"');

    await userEvent.click(screen.getByRole("button", { name: "All", exact: true }));
    await expect.element(screen.getByText("My own thread")).toBeInTheDocument();
    await expect.element(screen.getByTestId("sidebar-bot-shelf-toggle")).toBeInTheDocument();
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
    stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-lens"));
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

    // Every filter option shows its whole label, the count included.
    const bar = document.querySelector<HTMLElement>('[data-testid="sidebar-filter-bar"]')!;
    const toggles = [...bar.querySelectorAll<HTMLElement>('[data-slot="toggle"]')];
    expect(toggles).toHaveLength(3);
    for (const toggle of toggles)
      expect(toggle.scrollWidth).toBeLessThanOrEqual(toggle.clientWidth);

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
