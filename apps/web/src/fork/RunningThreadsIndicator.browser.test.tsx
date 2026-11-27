import appCss from "../index.css?inline";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { SidebarMenu, SidebarProvider } from "~/components/ui/sidebar";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import {
  useEnvironmentIdentities,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { makeThreadFixture } from "~/test-fixtures";
import type { Project } from "~/types";

import { render } from "../../test/render";
import { DEFAULT_FORK_SETTINGS, updateForkSettings } from "./forkSettings";
import { RunningThreadsIndicator } from "./RunningThreadsIndicator";

vi.mock("../state/entities", { spy: true });
vi.mock("../state/environments", { spy: true });

const dev = EnvironmentId.make("dev");
const bots = EnvironmentId.make("bots");

function project(environmentId: EnvironmentId, id: string, title: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    projectIcon: { kind: "monogram", text: title.slice(0, 1), color: "blue" },
  };
}

const eagle = project(dev, "eagle", "Eagle Eye");
const chief = project(bots, "chief", "Chief");

function shell(
  owner: Project,
  id: string,
  options: { readonly running?: boolean; readonly lane?: boolean; readonly since?: string } = {},
) {
  const base = makeThreadFixture({
    environmentId: owner.environmentId,
    id: ThreadId.make(id),
    projectId: owner.id,
    title: id,
  });
  const bot = options.lane
    ? {
        ...base,
        source: { ...base.source, createdBy: "agent" as const },
        worktreePath: `/worktrees/${id}`,
      }
    : base;
  return {
    ...bot,
    latestRun: options.running
      ? {
          runId: RunId.make(`${id}-run`),
          status: "running" as const,
          requestedAt: null,
          startedAt: options.since ?? null,
          completedAt: null,
          assistantMessageId: null,
        }
      : null,
  };
}

async function setup(
  stack: DisposableStack,
  threads: ReturnType<typeof shell>[],
  options: { readonly hierarchy?: boolean } = {},
) {
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  updateForkSettings({ sidebarHierarchyEnabled: options.hierarchy ?? true });
  stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
  vi.mocked(useProjects).mockReturnValue([eagle, chief]);
  vi.mocked(useQuietThreadShells).mockReturnValue(threads);
  vi.mocked(useEnvironmentIdentities).mockReturnValue([
    { environmentId: dev, label: "dev" },
    { environmentId: bots, label: "bots" },
  ]);
  vi.mocked(useEnvironmentMachines).mockReturnValue(
    new Map<EnvironmentId, EnvironmentMachineKind>([
      [dev, "linux"],
      [bots, "server"],
    ]),
  );
  vi.mocked(usePrimaryEnvironmentId).mockReturnValue(null);
}

const renderFooter = () =>
  render(
    <div style={{ width: 268, display: "flex" }}>
      <SidebarProvider>
        <SidebarMenu className="flex-row items-center">
          <RunningThreadsIndicator />
        </SidebarMenu>
      </SidebarProvider>
    </div>,
  );

const pill = () => document.querySelector<HTMLElement>('[data-testid="running-threads-pill"]');

describe("running threads pill", () => {
  it("renders nothing while no thread runs", async () => {
    using stack = new DisposableStack();
    await setup(stack, [shell(eagle, "idle"), shell(chief, "also idle")]);
    await using screen = await renderFooter();
    expect(pill()).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("renders nothing with the sidebar hierarchy off, even while threads run", async () => {
    using stack = new DisposableStack();
    await setup(stack, [shell(eagle, "busy", { running: true })], { hierarchy: false });
    await using screen = await renderFooter();
    expect(pill()).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("shows the total running across machines and lists them by machine", async () => {
    using stack = new DisposableStack();
    await setup(stack, [
      shell(eagle, "Eagle lane one", { running: true, since: "2026-01-01T10:00:00.000Z" }),
      shell(eagle, "Eagle lane two", {
        running: true,
        lane: true,
        since: "2026-01-01T11:00:00.000Z",
      }),
      shell(chief, "Chief brief", { running: true }),
      shell(chief, "Chief done"),
    ]);
    await using screen = await renderFooter();

    const trigger = screen.getByTestId("running-threads-pill");
    await expect.element(trigger).toBeVisible();
    expect(trigger.element().textContent?.trim()).toBe("3");
    expect(trigger.element().getAttribute("aria-label")).toBe("3 running threads");
    // The pill sits in the footer's row without growing it.
    expect(trigger.element().getBoundingClientRect().height).toBeLessThanOrEqual(24);

    await userEvent.click(trigger);
    const popover = page.getByTestId("running-threads-popover");
    await expect.element(popover).toBeVisible();
    await expect.element(popover.getByText("Running now")).toBeVisible();

    const devGroup = page.getByTestId("running-threads-group-dev").element() as HTMLElement;
    const botsGroup = page.getByTestId("running-threads-group-bots").element() as HTMLElement;
    // Machines are listed A–Z by name when none is this machine.
    expect(botsGroup.compareDocumentPosition(devGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(devGroup.querySelector("svg")).not.toBeNull();
    const rowTitles = (group: HTMLElement) =>
      [...group.querySelectorAll('[data-testid="running-thread-row"]')].map((row) =>
        row.querySelector(".truncate")?.textContent?.trim(),
      );
    expect(rowTitles(botsGroup)).toEqual(["Chief brief"]);
    // The newest run is first, and a bot's lane carries a "bg" tag.
    expect(rowTitles(devGroup)).toEqual(["Eagle lane two", "Eagle lane one"]);
    expect(devGroup.textContent).toContain("bg");
    expect(botsGroup.textContent).not.toContain("bg");
    // Per-machine counts.
    expect(devGroup.firstElementChild?.textContent).toMatch(/dev\s*2$/);
    expect(botsGroup.firstElementChild?.textContent).toMatch(/bots\s*1$/);
  });

  it("opens the clicked thread and closes the popover", async () => {
    using stack = new DisposableStack();
    await setup(stack, [
      shell(eagle, "Eagle lane one", { running: true }),
      shell(chief, "Chief brief", { running: true }),
    ]);
    await using screen = await renderFooter();
    const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);

    await userEvent.click(screen.getByTestId("running-threads-pill"));
    await userEvent.click(page.getByRole("button", { name: /Chief brief/ }));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: { environmentId: bots, threadId: "Chief brief" },
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="running-threads-popover"]')).toBeNull(),
    );
  });
});
