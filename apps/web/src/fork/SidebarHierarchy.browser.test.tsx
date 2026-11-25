import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import Sidebar from "~/components/Sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { makeThreadFixture } from "~/test-fixtures";
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
