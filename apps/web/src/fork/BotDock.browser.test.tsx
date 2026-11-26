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
import { SidebarProvider } from "~/components/ui/sidebar";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { readLocalApi } from "~/localApi";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import { makeThreadFixture } from "~/test-fixtures";
import type { Project } from "~/types";

import { render } from "../../test/render";
import { DEFAULT_FORK_SETTINGS, updateForkSettings } from "./forkSettings";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock("../components/sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const bots = EnvironmentId.make("local");
const PINNED_AT = "2026-11-01T00:00:00.000Z";

function project(id: string, title: string, pinned = true): Project {
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
    ...(pinned ? { pinnedAt: PINNED_AT } : {}),
  };
}

const penny = project("penny", "Penny");
const chief = project("chief", "Chief");
const eagle = project("eagle", "Eagle Eye");
const mortie = project("mortie", "Mortie");
const loose = project("loose", "Loose", false);

function shell(
  id: string,
  owner: Project,
  options: {
    readonly pinOrder?: string;
    readonly running?: boolean;
    readonly delegatedFrom?: string;
    readonly approval?: boolean;
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
    pinnedAt: options.pinOrder === undefined ? null : PINNED_AT,
    pinOrderKey: options.pinOrder ?? null,
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

const pennyMain = shell("Penny main thread", penny, { pinOrder: "a" });
const pennySecond = shell("Penny second pin", penny, { pinOrder: "b" });
const chiefTopic = shell("Chief topic", chief, { running: true });
const eagleMain = shell("Eagle main thread", eagle, { pinOrder: "c" });
const eagleLane = shell("Eagle lane in Loose", loose, { delegatedFrom: "Eagle main thread" });
const mortieAsk = shell("Mortie asks", mortie, { approval: true });
const looseThread = shell("Loose thread", loose);
const threads = [pennyMain, pennySecond, chiefTopic, eagleMain, eagleLane, mortieAsk, looseThread];

async function renderSidebar(stack: DisposableStack) {
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  updateForkSettings({ botDockEnabled: true, sidebarHierarchyEnabled: true });
  stack.defer(() => updateForkSettings(DEFAULT_FORK_SETTINGS));
  stack.defer(() => localStorage.removeItem("t3code:fork:sidebar-lens"));
  vi.mocked(useProjects).mockReturnValue([penny, chief, eagle, mortie, loose]);
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
  return { handleNewThread };
}

const tileId = (id: string) => `bot-dock-tile-${bots}:/projects/${id}`;
const tile = (id: string) => page.getByTestId(tileId(id));
const tileElement = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${tileId(id)}"]`)!;
const listText = () => document.body.textContent ?? "";

describe("Bot Dock", () => {
  it("lays pinned projects out three across, centering the last row", async () => {
    using stack = new DisposableStack();
    await renderSidebar(stack);
    await using _screen = await render(
      <div style={{ width: 256, height: 800, display: "flex" }}>
        <SidebarProvider style={{ height: 800, minHeight: 800 }}>
          <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
        </SidebarProvider>
      </div>,
    );
    await expect.element(page.getByTestId("bot-dock")).toBeVisible();
    const dock = document.querySelector<HTMLElement>('[data-testid="bot-dock"]')!;
    const tiles = [...dock.children] as HTMLElement[];
    // The project menu's order for pinned projects; Loose is not pinned.
    expect(tiles.map((element) => element.dataset.testid)).toEqual(
      ["chief", "eagle", "mortie", "penny"].map(tileId),
    );
    const rects = tiles.map((element) => element.getBoundingClientRect());
    expect(new Set(rects.slice(0, 3).map((rect) => Math.round(rect.top))).size).toBe(1);
    expect(rects[3]!.top).toBeGreaterThan(rects[0]!.top);
    const dockRect = dock.getBoundingClientRect();
    const center = (rect: DOMRect) => rect.left + rect.width / 2;
    expect(Math.abs(center(rects[3]!) - center(dockRect))).toBeLessThan(2);
    expect(Math.abs(center(rects[1]!) - center(dockRect))).toBeLessThan(2);

    // The avatar is a 48px disc whatever the icon.
    const avatar = tileElement("penny").querySelector<HTMLElement>(".rounded-full.size-12")!;
    expect(avatar.getBoundingClientRect().width).toBe(48);

    // The dock sits above the filter bar.
    const bar = page.getByTestId("sidebar-filter-bar").element();
    expect(dock.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rolls up status and leaves docked main threads out of Pinned", async () => {
    using stack = new DisposableStack();
    await renderSidebar(stack);
    await using _screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(page.getByText("Penny second pin")).toBeInTheDocument();
    expect(listText()).not.toContain("Penny main thread");
    expect(listText()).not.toContain("Eagle main thread");

    expect(tileElement("chief").dataset.status).toBe("working");
    expect(tileElement("mortie").dataset.status).toBe("needs");
    expect(tileElement("penny").dataset.status).toBe("idle");
    expect(tileElement("chief").querySelector('[data-testid="bot-dock-count"]')?.textContent).toBe(
      "1",
    );
    expect(tileElement("penny").querySelector('[data-testid="bot-dock-count"]')).toBeNull();
    expect(
      tileElement("mortie").querySelector('[data-testid="bot-dock-ring-needs"]'),
    ).not.toBeNull();
    expect(
      tileElement("chief").querySelector('[data-testid="bot-dock-ring-working"]'),
    ).not.toBeNull();

    // Needs me hides what is not waiting on the user, and the rest re-centers.
    await userEvent.click(page.getByRole("button", { name: /Needs me/ }));
    await vi.waitFor(() =>
      expect(document.querySelector(`[data-testid="${tileId("penny")}"]`)).toBeNull(),
    );
    const dock = document.querySelector<HTMLElement>('[data-testid="bot-dock"]')!;
    expect([...dock.children].map((element) => (element as HTMLElement).dataset.testid)).toEqual([
      tileId("mortie"),
    ]);
    const center = (rect: DOMRect) => rect.left + rect.width / 2;
    expect(
      Math.abs(
        center(tileElement("mortie").getBoundingClientRect()) -
          center(dock.getBoundingClientRect()),
      ),
    ).toBeLessThan(2);
  });

  it("scopes to a topic desk, follows delegated lanes, and toggles back", async () => {
    using stack = new DisposableStack();
    await renderSidebar(stack);
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
    await expect.element(page.getByText("Loose thread")).toBeInTheDocument();

    // A topic desk scopes the list and opens its latest thread.
    await userEvent.click(tile("chief").getByRole("button", { name: /^Chief/ }));
    await vi.waitFor(() => expect(tileElement("chief").dataset.selected).toBe("true"));
    expect(document.querySelector(`[data-testid="${tileId("penny")}"]`)).toBeNull();
    await vi.waitFor(() => expect(listText()).not.toContain("Loose thread"));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ threadId: "Chief topic" }) }),
    );
    await userEvent.click(tile("chief").getByRole("button", { name: /^Chief/ }));
    await vi.waitFor(() => expect(tileElement("chief").dataset.selected).toBeUndefined());
    await expect.element(page.getByText("Loose thread")).toBeInTheDocument();

    // Scoping to Eagle Eye keeps its lane, delegated into another project.
    const show = vi.fn(async () => "filter");
    vi.mocked(readLocalApi).mockReturnValue({
      contextMenu: { show, close: vi.fn() },
    } as unknown as LocalApi);
    stack.defer(() => vi.mocked(readLocalApi).mockRestore());
    tileElement("eagle")
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await vi.waitFor(() => expect(tileElement("eagle").dataset.selected).toBe("true"));
    await expect.element(page.getByText("Eagle lane in Loose")).toBeInTheDocument();
    await vi.waitFor(() => expect(listText()).not.toContain("Loose thread"));

    expect(document.querySelector(`[data-testid="${tileId("penny")}"]`)).toBeNull();

    // Show all projects brings the other tiles and threads back.
    show.mockResolvedValue("show-all");
    tileElement("eagle")
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await vi.waitFor(() => expect(tileElement("eagle").dataset.selected).toBeUndefined());
    await expect.element(page.getByText("Loose thread")).toBeInTheDocument();

    // A main thread's tile opens it.
    await userEvent.click(tile("penny").getByRole("button", { name: /^Penny/ }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ threadId: "Penny main thread" }),
      }),
    );
  });

  it("starts a thread from the + button and marks the open main thread", async () => {
    using stack = new DisposableStack();
    const { handleNewThread } = await renderSidebar(stack);
    stack.defer(() => vi.mocked(useThreadRouteTarget).mockRestore());
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: scopeThreadRef(bots, pennyMain.id),
    });
    await using _screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await vi.waitFor(() => expect(tileElement("penny").dataset.selected).toBe("true"));
    await expect
      .element(tile("penny").getByRole("button", { name: /^Penny/ }))
      .toHaveAttribute("aria-current", "true");

    const plus = tile("chief").getByRole("button", { name: "New thread in Chief" });
    await userEvent.hover(tile("chief"));
    await vi.waitFor(() => expect(getComputedStyle(plus.element()).opacity).toBe("1"));
    await userEvent.click(plus);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(bots, chief.id));
    // The tile's own click did not run: nothing was scoped.
    expect(tileElement("chief").dataset.selected).toBeUndefined();
  });

  it("keeps a picked saved view while the open thread sits in the dock", async () => {
    using stack = new DisposableStack();
    await renderSidebar(stack);
    updateForkSettings({
      sidebarFilterPresets: [
        { id: "chief-view", name: "Chief view", projectKeys: [`${bots}:/projects/chief`] },
      ],
    });
    stack.defer(() => useUiStateStore.getState().setSidebarProjectScopeKeys([]));
    stack.defer(() => vi.mocked(useThreadRouteTarget).mockRestore());
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: scopeThreadRef(bots, pennyMain.id),
    });
    const reveal = { observedKey: null, pendingKey: null };
    await using _screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={reveal} />
      </SidebarProvider>,
    );
    await expect.element(page.getByText("Loose thread")).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Chief view" }));
    await vi.waitFor(() => expect(listText()).not.toContain("Loose thread"));
    // The open main thread has no row to reveal; picking the view settles its reveal, so
    // nothing widens the view back to all projects.
    expect(reveal.pendingKey).toBeNull();
    await expect
      .element(page.getByRole("button", { name: "Chief view" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(listText()).not.toContain("Loose thread");
  });

  it("is gone when turned off, and the Pinned list is upstream's", async () => {
    using stack = new DisposableStack();
    await renderSidebar(stack);
    updateForkSettings({ botDockEnabled: false });
    await using _screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(page.getByText("Penny main thread")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="bot-dock"]')).toBeNull();
  });
});
