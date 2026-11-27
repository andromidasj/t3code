import appCss from "../index.css?inline";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import type { SidebarRouteReveal } from "~/components/sidebar/routeReveal";
import { SidebarProvider } from "~/components/ui/sidebar";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { readLocalApi } from "~/localApi";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { makeThreadFixture } from "~/test-fixtures";
import type { Project } from "~/types";

import { render } from "../../test/render";
import { DEFAULT_FORK_SETTINGS, readForkSettings, updateForkSettings } from "./forkSettings";
import type { SidebarSpace } from "./spaces.logic";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock("../components/sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => <div data-testid="chrome-footer" />,
}));

const bots = EnvironmentId.make("local");

function project(id: string, title: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: bots,
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

const chief = project("chief", "Chief");
const penny = project("penny", "Penny");
const eagle = project("eagle", "Eagle Eye");
const repo = project("repo", "Review Repo");
const projectKey = (entry: Project) => `${bots}:${entry.workspaceRoot}`;

function shell(
  id: string,
  owner: Project,
  options: {
    readonly delegatedFrom?: string;
    readonly approval?: boolean;
    readonly running?: boolean;
  } = {},
) {
  const base = makeThreadFixture({
    environmentId: bots,
    id: ThreadId.make(id),
    projectId: owner.id,
    title: id,
  });
  return {
    ...base,
    hasPendingApprovals: options.approval ?? false,
    delegatedFrom:
      options.delegatedFrom === undefined
        ? null
        : { environmentId: bots, threadId: ThreadId.make(options.delegatedFrom), title: "main" },
    latestRun: options.running
      ? {
          runId: RunId.make(`${id}-run`),
          status: "running" as const,
          requestedAt: null,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        }
      : null,
  };
}

const chiefBrief = shell("Chief brief", chief);
const pennyClose = shell("Penny close", penny);
const eagleMain = shell("Eagle main", eagle);
const eagleLane = shell("Eagle lane in repo", repo, { delegatedFrom: "Eagle main" });
const repoAsk = shell("Repo asks", repo, { approval: true });
const threads = [chiefBrief, pennyClose, eagleMain, eagleLane, repoAsk];
const threadKey = (entry: { readonly id: ThreadId }) => `${bots}:${entry.id}`;

function space(id: string, name: string, projectKeys: string[], extra: Partial<SidebarSpace> = {}) {
  return {
    id,
    name,
    icon: "folder" as const,
    tint: "sky" as const,
    projectKeys,
    gridThreadKeys: [],
    gridLabels: {},
    ...extra,
  };
}

const HOME = space("home", "Home", [], { icon: "home", tint: "indigo" });
const EYE = space("eye", "Eagle Eye", [projectKey(eagle)], { icon: "eye" });
const WORK = space("work", "Work", [projectKey(repo)], { icon: "briefcase", tint: "emerald" });

async function setup(
  stack: DisposableStack,
  spaces: { spaces: SidebarSpace[]; activeSpaceId?: string } = { spaces: [HOME, EYE, WORK] },
) {
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  updateForkSettings({
    spacesEnabled: true,
    sidebarHierarchyEnabled: true,
    botDockEnabled: true,
    spaces: spaces.spaces,
    defaultSpaceId: spaces.spaces[0]?.id ?? null,
    activeSpaceId: spaces.activeSpaceId ?? spaces.spaces[0]?.id ?? null,
    sidebarFilterPresets: [{ id: "view", name: "Saved view", projectKeys: [projectKey(chief)] }],
  });
  stack.defer(() => updateForkSettings({ ...DEFAULT_FORK_SETTINGS, spacesEnabled: false }));
  stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-lens"));
  vi.mocked(useProjects).mockReturnValue([chief, penny, eagle, repo]);
  vi.mocked(useQuietThreadShells).mockReturnValue(threads);
  const handleNewThread = vi.fn();
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    defaultProjectFallbackReady: true,
    handleNewThread,
    routeDraftId: null,
    routeThreadRef: null,
  });
  const show = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => null);
  vi.mocked(readLocalApi).mockReturnValue({
    contextMenu: { show, close: vi.fn() },
  } as unknown as LocalApi);
  stack.defer(() => vi.mocked(readLocalApi).mockRestore());
  return { handleNewThread, show };
}

const newReveal = (): SidebarRouteReveal => ({ observedKey: null, pendingKey: null });

async function renderSidebar(reveal = newReveal()) {
  const screen = await render(
    <div style={{ width: 268, height: 820, display: "flex" }}>
      <SidebarProvider style={{ height: 820, minHeight: 820 }}>
        <Sidebar routeReveal={reveal} />
      </SidebarProvider>
    </div>,
  );
  return screen;
}

const text = () => document.body.textContent ?? "";
const shownSpace = () =>
  document.querySelector<HTMLElement>('[data-testid="space-header"]')?.textContent ?? "";
const strip = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="space-strip-${id}"]`)!;
const row = (entry: { readonly id: ThreadId }) =>
  document.querySelector<HTMLElement>(`[data-sidebar-row="${threadKey(entry)}"]`);
const tiles = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="space-grid-tile-"]')].map((element) =>
    element.dataset.testid!.slice("space-grid-tile-".length),
  );
const tileLabel = (entry: { readonly id: ThreadId }) =>
  document
    .querySelector(`[data-testid="space-grid-tile-${threadKey(entry)}"] .truncate`)
    ?.textContent?.trim() ?? null;
const contextMenu = (element: Element) =>
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

describe("Spaces sidebar", () => {
  it("replaces the project menu, saved views and dock with the Space, its grid and the strip", async () => {
    using stack = new DisposableStack();
    await setup(stack);
    await using _screen = await renderSidebar();

    await expect.element(page.getByText("Chief brief")).toBeInTheDocument();
    expect(shownSpace()).toContain("Home");
    expect(text()).toContain("Penny close");
    // Other Spaces' projects stay out, including Eagle's lane in Work's repo.
    expect(text()).not.toContain("Eagle main");
    expect(text()).not.toContain("Eagle lane in repo");
    expect(page.getByRole("button", { name: "Projects" }).query()).toBeNull();
    expect(page.getByRole("button", { name: "Saved view" }).query()).toBeNull();
    expect(document.querySelector('[data-testid="bot-dock"]')).toBeNull();
    // An empty grid takes no room: the filter bar follows the header directly.
    expect(document.querySelector('[data-testid="space-grid"]')).toBeNull();

    // The strip sits right above Settings, with Home selected and Work flagged as waiting.
    const stripElement = page.getByTestId("space-strip").element();
    expect(stripElement.nextElementSibling).toBe(page.getByTestId("chrome-footer").element());
    expect(strip("home").getAttribute("aria-selected")).toBe("true");
    expect(strip("work").dataset.dot).toBe("needs");
    expect(strip("eye").dataset.dot).toBeUndefined();
    expect(page.getByTestId("space-tint").element().dataset.tint).toBe("indigo");
  });

  it("switches from the strip, Ctrl+digit and a swipe, without moving the open chat", async () => {
    using stack = new DisposableStack();
    await setup(stack);
    stack.defer(() => vi.mocked(useThreadRouteTarget).mockRestore());
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: scopeThreadRef(bots, chiefBrief.id),
    });
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    stack.defer(() => platform.mockRestore());
    const reveal = newReveal();
    await using screen = await renderSidebar(reveal);
    const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
    await expect.element(page.getByText("Chief brief")).toBeInTheDocument();

    // The open thread's Space keeps showing after a switch away: no snapping back.
    await userEvent.click(strip("eye"));
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));
    await expect.element(page.getByText("Eagle main")).toBeInTheDocument();
    // A delegated lane follows its bot into the bot's Space.
    await expect.element(page.getByText("Eagle lane in repo")).toBeInTheDocument();
    await vi.waitFor(() => expect(row(chiefBrief)).toBeNull());
    expect(readForkSettings().activeSpaceId).toBe("eye");

    await userEvent.keyboard("{Control>}3{/Control}");
    await vi.waitFor(() => expect(shownSpace()).toContain("Work"));
    await expect.element(page.getByText("Repo asks")).toBeInTheDocument();

    // One sideways flick moves one Space, however long its momentum tail.
    // Dispatch on a real thread row inside the ScrollArea viewport so positive translateX
    // during a swipe back exercises the horizontal overflow path.
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    stack.defer(() => nowSpy.mockRestore());
    const rowInWork = row(repoAsk)!;
    for (let index = 0; index < 12; index += 1) {
      now += 16;
      rowInWork.dispatchEvent(
        new WheelEvent("wheel", { deltaX: -20, deltaY: 1, bubbles: true, cancelable: true }),
      );
    }
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));
    // Swiping forward and back over the scrollable list works in both directions, even right
    // after reversing direction past the brief bounce guard.
    const rowInEye = row(eagleMain)!;
    now += 120;
    for (let index = 0; index < 5; index += 1) {
      now += 16;
      rowInEye.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 20, deltaY: 0, bubbles: true, cancelable: true }),
      );
    }
    await vi.waitFor(() => expect(shownSpace()).toContain("Work"));
    const rowInWorkAgain = row(repoAsk)!;
    now += 120;
    for (let index = 0; index < 5; index += 1) {
      now += 16;
      rowInWorkAgain.dispatchEvent(
        new WheelEvent("wheel", { deltaX: -20, deltaY: 0, bubbles: true, cancelable: true }),
      );
    }
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));
    // A vertical scroll does not switch.
    row(eagleMain)!.dispatchEvent(new WheelEvent("wheel", { deltaY: 80, bubbles: true }));
    expect(shownSpace()).toContain("Eagle Eye");

    expect(navigate).not.toHaveBeenCalled();
    expect(readForkSettings().activeSpaceId).toBe("eye");
    expect(reveal.pendingKey).toBeNull();
  });

  it("aligns the bottom Space pill evenly with the second and third icons at non-16px root font sizes", async () => {
    using stack = new DisposableStack();
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "13px";
    stack.defer(() => {
      document.documentElement.style.fontSize = previousFontSize;
    });
    await setup(stack, { spaces: [HOME, EYE, WORK], activeSpaceId: "eye" });
    await using _screen = await renderSidebar();
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));

    const pill = page.getByTestId("space-strip-pill").element();
    for (const id of ["home", "eye", "work"]) {
      await userEvent.click(strip(id));
      await vi.waitFor(() => {
        expect(strip(id).getAttribute("aria-selected")).toBe("true");
        const pillBox = pill.getBoundingClientRect();
        const tabBox = strip(id).getBoundingClientRect();
        expect(Math.abs(pillBox.left - tabBox.left)).toBeLessThan(0.75);
        expect(Math.abs(pillBox.width - tabBox.width)).toBeLessThan(0.75);
      });
    }
  });

  it("follows a thread opened from elsewhere into its Space", async () => {
    using stack = new DisposableStack();
    await setup(stack);
    stack.defer(() => vi.mocked(useThreadRouteTarget).mockRestore());
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: scopeThreadRef(bots, repoAsk.id),
    });
    await using _screen = await renderSidebar();
    await vi.waitFor(() => expect(shownSpace()).toContain("Work"));
    await expect.element(page.getByText("Repo asks")).toBeInTheDocument();
    expect(readForkSettings().activeSpaceId).toBe("work");
  });

  it("pins threads to the grid from the list, renames a tile and moves it back", async () => {
    using stack = new DisposableStack();
    const { show, handleNewThread } = await setup(stack);
    await using screen = await renderSidebar();
    const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
    await expect.element(page.getByText("Chief brief")).toBeInTheDocument();

    show.mockResolvedValueOnce("fork-space-grid");
    contextMenu(row(chiefBrief)!);
    await vi.waitFor(() => expect(tiles()).toEqual([threadKey(chiefBrief)]));
    const items = show.mock.calls[0]![0] as Array<{ id: string; label: string }>;
    expect(items.at(-1)).toMatchObject({ id: "fork-space-grid", label: "Pin to top grid" });
    // The Space has no project filter to offer.
    expect(items.some((item) => item.id === "filter-by-project")).toBe(false);
    // Shown in the grid, the thread leaves the list; its only tile is named for its project.
    await vi.waitFor(() => expect(row(chiefBrief)).toBeNull());
    const tile = page.getByTestId(`space-grid-tile-${threadKey(chiefBrief)}`);
    await vi.waitFor(() => expect(tileLabel(chiefBrief)).toBe("Chief"));

    // The grid sits right above the filter bar.
    const grid = page.getByTestId("space-grid").element();
    const bar = page.getByTestId("sidebar-filter-bar").element();
    expect(grid.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const disc = tile.element().querySelector<HTMLElement>(".size-12.rounded-full")!;
    expect(disc.getBoundingClientRect().width).toBe(48);

    await userEvent.click(tile.getByRole("button"));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ threadId: "Chief brief" }) }),
    );

    show.mockResolvedValueOnce("rename");
    contextMenu(tile.getByRole("button").element());
    const input = page.getByTestId("space-grid-rename");
    await expect.element(input).toBeVisible();
    await userEvent.fill(input, "Brief");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(tileLabel(chiefBrief)).toBe("Brief"));
    expect(readForkSettings().spaces[0]!.gridLabels).toEqual({ [threadKey(chiefBrief)]: "Brief" });

    show.mockResolvedValueOnce("new-thread");
    contextMenu(tile.getByRole("button").element());
    await vi.waitFor(() =>
      expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(bots, chief.id)),
    );

    show.mockResolvedValueOnce("unpin");
    contextMenu(tile.getByRole("button").element());
    await vi.waitFor(() => expect(tiles()).toEqual([]));
    await vi.waitFor(() => expect(row(chiefBrief)).not.toBeNull());
  });

  it("hides grid tiles that do not need the user under Needs me", async () => {
    using stack = new DisposableStack();
    await setup(stack, {
      spaces: [HOME, EYE, { ...WORK, gridThreadKeys: [threadKey(repoAsk), threadKey(eagleLane)] }],
      activeSpaceId: "work",
    });
    await using _screen = await renderSidebar();
    await vi.waitFor(() => expect(tiles()).toEqual([threadKey(repoAsk), threadKey(eagleLane)]));
    // Two tiles from one project are named by thread.
    expect(tileLabel(repoAsk)).toBe("Repo asks");
    expect(tileLabel(eagleLane)).toBe("Eagle lane in repo");
    expect(
      document
        .querySelector(`[data-testid="space-grid-tile-${threadKey(repoAsk)}"]`)!
        .getAttribute("data-status"),
    ).toBe("needs");

    await userEvent.click(page.getByRole("button", { name: /Needs me/ }));
    await vi.waitFor(() => expect(tiles()).toEqual([threadKey(repoAsk)]));
    const grid = page.getByTestId("space-grid").element();
    const only = grid.firstElementChild!.getBoundingClientRect();
    const box = grid.getBoundingClientRect();
    expect(Math.abs(only.left + only.width / 2 - (box.left + box.width / 2))).toBeLessThan(2);
  });

  it("starts a new thread in the Space's only project", async () => {
    using stack = new DisposableStack();
    const { handleNewThread } = await setup(stack, { spaces: [HOME, EYE], activeSpaceId: "eye" });
    await using _screen = await renderSidebar();
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));
    await userEvent.click(page.getByRole("button", { name: "New thread" }));
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(bots, eagle.id));
  });

  it("edits the Space: name, tint, projects, default and delete", async () => {
    using stack = new DisposableStack();
    await setup(stack, { spaces: [HOME, EYE] });
    await using _screen = await renderSidebar();
    await expect.element(page.getByText("Chief brief")).toBeInTheDocument();

    await userEvent.click(page.getByTestId("space-editor-trigger"));
    const editor = page.getByTestId("space-editor");
    await expect.element(editor).toBeVisible();
    const name = editor.getByRole("textbox", { name: "Space name" });
    await userEvent.fill(name, "Bots");
    await vi.waitFor(() => expect(shownSpace()).toContain("Bots"));
    await userEvent.click(editor.getByRole("button", { name: "Rose" }));
    await vi.waitFor(() =>
      expect(page.getByTestId("space-tint").element().dataset.tint).toBe("rose"),
    );

    // Home is the default, so its projects only leave from another Space.
    await expect.element(editor.getByRole("checkbox", { name: "Chief in Bots" })).toBeDisabled();
    await userEvent.click(editor.getByRole("button", { name: /Move Eagle Eye from Eagle Eye/ }));
    await expect.element(page.getByText("Eagle main")).toBeInTheDocument();
    expect(readForkSettings().spaces[0]!.projectKeys).toEqual([projectKey(eagle)]);

    // Deleting a Space returns its projects to the default.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(strip("eye"));
    await vi.waitFor(() => expect(shownSpace()).toContain("Eagle Eye"));
    await userEvent.click(page.getByTestId("space-editor-trigger"));
    await expect.element(page.getByTestId("space-editor")).toBeVisible();
    await expect
      .element(page.getByTestId("space-editor").getByText("No projects yet. Move some in below."))
      .toBeVisible();
    await userEvent.click(
      page.getByTestId("space-editor").getByRole("button", { name: "Delete Space" }),
    );
    await vi.waitFor(() => expect(shownSpace()).toContain("Bots"));
    expect(readForkSettings().spaces.map((entry) => entry.id)).toEqual(["home"]);
    // The last Space cannot be deleted.
    await userEvent.click(page.getByTestId("space-editor-trigger"));
    await expect
      .element(page.getByTestId("space-editor").getByRole("button", { name: "Delete Space" }))
      .toBeDisabled();
  });

  it("adds a Space from the strip and opens its editor", async () => {
    using stack = new DisposableStack();
    await setup(stack, { spaces: [] });
    await using _screen = await renderSidebar();
    // A Mac with no Spaces saved shows one Home Space with every project.
    await expect.element(page.getByText("Eagle main")).toBeInTheDocument();
    expect(shownSpace()).toContain("Home");

    await userEvent.click(page.getByTestId("space-strip-add"));
    await expect.element(page.getByTestId("space-editor")).toBeVisible();
    await vi.waitFor(() => expect(shownSpace()).toContain("New Space"));
    const saved = readForkSettings();
    expect(saved.spaces.map((entry) => entry.name)).toEqual(["Home", "New Space"]);
    expect(saved.activeSpaceId).toBe(saved.spaces[1]!.id);
    // A new Space starts empty.
    expect(text()).not.toContain("Eagle main");
  });
});
