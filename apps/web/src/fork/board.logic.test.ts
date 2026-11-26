import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardDeskCounts,
  boardItemKey,
  boardProjectKey,
  boardSearchFromUrl,
  buildBoardModel,
  collectBoardToday,
  countNeedsMe,
  countReadyBoardItems,
  findBoardItem,
  findBoardItemById,
  findDeskThreadRef,
  matchDeskProjects,
  opensFullThread,
  parseBoardItemKey,
  parseBoardThreadHref,
  plainBoardText,
  groupBoardItems,
  rankBoardItems,
  type BoardGrouping,
  rewriteBoardThreadLinks,
  type BoardProjectInput,
  type BoardThreadInput,
} from "./board.logic";
import {
  browserBoardCandidates,
  extractBoardDataFromHtml,
  parseBoardPayload,
  parseBoardText,
  type BoardData,
  type BoardDesk,
  type BoardItem,
} from "./boardData";
import {
  DEFAULT_FORK_SETTINGS,
  FORK_SETTINGS_STORAGE_KEY,
  isSidebarPageVisible,
  moveSidebarPage,
  normalizeBoardSource,
  normalizeBoardUrl,
  normalizeSidebarPages,
  readForkSettings,
  setSidebarPageVisible,
  updateForkSettings,
  type SidebarPage,
} from "./forkSettings";

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");
const PROJECT = ProjectId.make("project-1");

type Runtime = NonNullable<BoardThreadInput["runtime"]>;

const runtime = (status: Runtime["status"], activityStartedAt?: string): Runtime => ({
  status,
  activeRunId: null,
  ...(activityStartedAt === undefined ? {} : { activityStartedAt }),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: null,
  lastError: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
});

function thread(id: string, overrides: Partial<BoardThreadInput> = {}): BoardThreadInput {
  const threadId = ThreadId.make(id);
  return {
    environmentId: ENV,
    id: threadId,
    projectId: PROJECT,
    title: id,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    archivedAt: null,
    deletedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    hasActionableProposedPlan: false,
    runtime: null,
    updatedAt: "2026-11-20T10:00:00.000Z",
    pinnedAt: null,
    ...overrides,
  };
}

const names = new Map([[boardProjectKey(ENV, PROJECT), "Eagle Eye"]]);
const ids = (rows: ReadonlyArray<{ thread: BoardThreadInput }>) => rows.map((row) => row.thread.id);

describe("buildBoardModel", () => {
  it("puts approvals first, then input and plans, newest first within each", () => {
    const model = buildBoardModel(
      [
        thread("plan", { hasActionableProposedPlan: true, updatedAt: "2026-11-20T12:00:00.000Z" }),
        thread("input-old", { hasPendingUserInput: true, updatedAt: "2026-11-20T09:00:00.000Z" }),
        thread("approval-old", {
          hasPendingApprovals: true,
          updatedAt: "2026-11-20T08:00:00.000Z",
        }),
        thread("input-new", { hasPendingUserInput: true, updatedAt: "2026-11-20T11:00:00.000Z" }),
        thread("approval-new", {
          hasPendingApprovals: true,
          updatedAt: "2026-11-20T10:30:00.000Z",
        }),
        thread("idle"),
      ],
      names,
    );
    expect(ids(model.needsMe)).toEqual([
      "approval-new",
      "approval-old",
      "input-new",
      "input-old",
      "plan",
    ]);
    expect(model.needsMe.map((row) => row.urgency)).toEqual([
      "approval",
      "approval",
      "input",
      "input",
      "plan",
    ]);
    expect(model.needsMeCount).toBe(5);
    expect(model.needsMe[0]?.projectName).toBe("Eagle Eye");
  });

  it("counts a subagent's open request on its parent", () => {
    const model = buildBoardModel(
      [
        thread("parent-input", { pendingSubagentRequest: "user_input" }),
        thread("parent-approval", { pendingSubagentRequest: "approval" }),
      ],
      names,
    );
    expect(model.needsMe.map((row) => [row.thread.id, row.urgency])).toEqual([
      ["parent-approval", "approval"],
      ["parent-input", "input"],
    ]);
  });

  it("lists active threads under Running unless they need the user", () => {
    const model = buildBoardModel(
      [
        thread("running-old", { runtime: runtime("running", "2026-11-20T09:00:00.000Z") }),
        thread("queued", { runtime: runtime("queued", "2026-11-20T09:30:00.000Z") }),
        thread("running-new", { runtime: runtime("starting", "2026-11-20T10:00:00.000Z") }),
        thread("blocked", { runtime: runtime("running"), hasPendingApprovals: true }),
        thread("done", { runtime: runtime("completed") }),
        thread("failed", { runtime: runtime("failed") }),
      ],
      names,
    );
    expect(ids(model.running)).toEqual(["running-new", "queued", "running-old"]);
    expect(ids(model.needsMe)).toEqual(["blocked"]);
  });

  it("holds a proposed plan back while its thread is still working", () => {
    const model = buildBoardModel(
      [thread("planning", { hasActionableProposedPlan: true, runtime: runtime("running") })],
      names,
    );
    expect(ids(model.needsMe)).toEqual([]);
    expect(ids(model.running)).toEqual(["planning"]);
  });

  it("leaves out archived, deleted, subagent and side chat threads", () => {
    const parent = ThreadId.make("parent");
    const threads = [
      thread("archived", { hasPendingApprovals: true, archivedAt: "2026-11-19T00:00:00.000Z" }),
      thread("deleted", { runtime: runtime("running"), deletedAt: "2026-11-19T00:00:00.000Z" }),
      thread("subagent", {
        hasPendingApprovals: true,
        lineage: { parentThreadId: parent, relationshipToParent: "subagent", rootThreadId: parent },
      }),
      thread("side-chat", {
        runtime: runtime("running"),
        lineage: {
          parentThreadId: parent,
          relationshipToParent: "fork",
          rootThreadId: parent,
          sideChat: true,
        },
      }),
      thread("pinned-archived", {
        pinnedAt: "2026-11-19T00:00:00.000Z",
        archivedAt: "2026-11-19T00:00:00.000Z",
      }),
    ];
    const model = buildBoardModel(threads, names);
    expect(model.needsMe).toEqual([]);
    expect(model.running).toEqual([]);
    expect(model.pinned).toEqual([]);
    expect(countNeedsMe(threads)).toBe(0);
  });

  it("lists pinned threads newest pin first, whatever their state", () => {
    const model = buildBoardModel(
      [
        thread("pin-old", { pinnedAt: "2026-11-18T00:00:00.000Z" }),
        thread("pin-new", {
          pinnedAt: "2026-11-19T00:00:00.000Z",
          hasPendingApprovals: true,
          environmentId: OTHER_ENV,
        }),
        thread("unpinned"),
      ],
      names,
    );
    expect(ids(model.pinned)).toEqual(["pin-new", "pin-old"]);
    expect(model.pinned[0]?.projectName).toBeNull();
  });

  it("counts what Needs Me lists", () => {
    const threads = [
      thread("a", { hasPendingApprovals: true }),
      thread("b", { hasPendingUserInput: true }),
      thread("c", { runtime: runtime("running") }),
    ];
    expect(countNeedsMe(threads)).toBe(buildBoardModel(threads, names).needsMeCount);
  });
});

describe("boardSearchFromUrl", () => {
  it("keeps known views and drops the default", () => {
    expect(boardSearchFromUrl({ boardView: "running" })).toEqual({ boardView: "running" });
    expect(boardSearchFromUrl({ boardView: "all" })).toEqual({});
    expect(boardSearchFromUrl({ boardView: "nope" })).toEqual({});
  });

  it("keeps the desk filter and drops the old panel selection keys", () => {
    expect(
      boardSearchFromUrl({
        boardView: "today",
        boardDesk: "chief",
        boardItem: "chief/cliproxyUpdate",
        boardPane: "chat",
        boardEnvironmentId: "env",
        boardThreadId: "t",
      }),
    ).toEqual({ boardView: "today", boardDesk: "chief" });
    expect(boardSearchFromUrl({ boardDesk: "" })).toEqual({});
  });
});

describe("opensFullThread", () => {
  it("opens full screen with Command or Control held", () => {
    expect(opensFullThread({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(opensFullThread({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(opensFullThread({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("normalizeBoardUrl", () => {
  it("accepts trimmed http and https URLs", () => {
    expect(normalizeBoardUrl("  https://host:8447/  ")).toBe("https://host:8447/");
    expect(normalizeBoardUrl("http://127.0.0.1:8447/")).toBe("http://127.0.0.1:8447/");
  });

  it("rejects empty, relative and non-web URLs", () => {
    expect(normalizeBoardUrl("")).toBeNull();
    expect(normalizeBoardUrl("   ")).toBeNull();
    expect(normalizeBoardUrl("host:8447")).toBeNull();
    expect(normalizeBoardUrl("/board")).toBeNull();
    expect(normalizeBoardUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBoardUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("normalizeBoardSource", () => {
  it("accepts web URLs, file URLs and absolute or home paths", () => {
    expect(normalizeBoardSource(" https://host:8447/ ")).toBe("https://host:8447/");
    expect(normalizeBoardSource("http://127.0.0.1:8447/")).toBe("http://127.0.0.1:8447/");
    expect(normalizeBoardSource("file:///Users/me/dev/bot/.board/data.json")).toBe(
      "file:///Users/me/dev/bot/.board/data.json",
    );
    expect(normalizeBoardSource("/Users/me/dev/bot/.board")).toBe("/Users/me/dev/bot/.board");
    expect(normalizeBoardSource("~/dev/bot/.board")).toBe("~/dev/bot/.board");
  });

  it("rejects other schemes and relative paths", () => {
    expect(normalizeBoardSource("")).toBeNull();
    expect(normalizeBoardSource("javascript:alert(1)")).toBeNull();
    expect(normalizeBoardSource("ftp://host/board")).toBeNull();
    expect(normalizeBoardSource("dev/bot/.board")).toBeNull();
    expect(normalizeBoardSource("~someone/board")).toBeNull();
    expect(normalizeBoardSource("file:///")).toBeNull();
  });
});

describe("fork settings storage", () => {
  it("reads defaults when nothing or garbage is stored", () => {
    expect(readForkSettings(memoryStorage())).toEqual(DEFAULT_FORK_SETTINGS);
    expect(readForkSettings(memoryStorage({ [FORK_SETTINGS_STORAGE_KEY]: "{not json" }))).toEqual(
      DEFAULT_FORK_SETTINGS,
    );
    expect(readForkSettings(null)).toEqual(DEFAULT_FORK_SETTINGS);
  });

  it("falls back per field when a stored field has the wrong type", () => {
    const storage = memoryStorage({
      [FORK_SETTINGS_STORAGE_KEY]: JSON.stringify({ boardEnabled: "yes", boardUrl: "https://b/" }),
    });
    expect(readForkSettings(storage)).toEqual({
      ...DEFAULT_FORK_SETTINGS,
      boardUrl: "https://b/",
    });
  });

  it("persists updates on top of what is stored", () => {
    const storage = memoryStorage();
    updateForkSettings({ boardUrl: "https://board.example/" }, storage);
    updateForkSettings({ openBoardOnLaunch: true }, storage);
    const expected = {
      boardEnabled: true,
      boardUrl: "https://board.example/",
      openBoardOnLaunch: true,
      sidebarPages: DEFAULT_FORK_SETTINGS.sidebarPages,
      collapseAgentTurns: true,
      sidebarHierarchyEnabled: true,
      sidebarFilterPresets: [],
      botDockEnabled: true,
      spacesEnabled: true,
      spaces: [],
      defaultSpaceId: null,
      activeSpaceId: null,
    };
    expect(readForkSettings(storage)).toEqual(expected);
    expect(JSON.parse(storage.values.get(FORK_SETTINGS_STORAGE_KEY) ?? "null")).toEqual(expected);
  });
  it("keeps the routine bot update folding switch", () => {
    const storage = memoryStorage();
    expect(readForkSettings(storage).collapseAgentTurns).toBe(true);
    updateForkSettings({ collapseAgentTurns: false }, storage);
    expect(readForkSettings(storage).collapseAgentTurns).toBe(false);
    const garbage = memoryStorage({
      [FORK_SETTINGS_STORAGE_KEY]: JSON.stringify({ collapseAgentTurns: "no" }),
    });
    expect(readForkSettings(garbage).collapseAgentTurns).toBe(true);
  });
});

describe("sidebar pages", () => {
  const ids = (pages: ReadonlyArray<SidebarPage>) => pages.map((page) => page.id);
  const visible = (pages: ReadonlyArray<SidebarPage>) =>
    pages.filter((page) => page.visible).map((page) => page.id);

  it("defaults to Board, Pull requests and Issues, all shown", () => {
    expect(DEFAULT_FORK_SETTINGS.sidebarPages).toEqual([
      { id: "board", visible: true },
      { id: "pull-requests", visible: true },
      { id: "issues", visible: true },
    ]);
  });

  it("hides the Board for settings saved with boardEnabled off before the list existed", () => {
    const storage = memoryStorage({
      [FORK_SETTINGS_STORAGE_KEY]: JSON.stringify({ boardEnabled: false, boardUrl: "" }),
    });
    const settings = readForkSettings(storage);
    expect(settings.boardEnabled).toBe(false);
    expect(ids(settings.sidebarPages)).toEqual(["board", "pull-requests", "issues"]);
    expect(visible(settings.sidebarPages)).toEqual(["pull-requests", "issues"]);
  });

  it("keeps the saved order, drops unknown and repeated ids, and appends missing pages", () => {
    const pages = normalizeSidebarPages(
      [
        { id: "issues", visible: false },
        { id: "nope", visible: true },
        { id: "issues", visible: true },
        "board",
        { id: "board", visible: "yes" },
      ],
      false,
    );
    expect(pages).toEqual([
      { id: "issues", visible: false },
      { id: "board", visible: true },
      { id: "pull-requests", visible: true },
    ]);
  });

  it("lets a saved Board entry win over a stale boardEnabled", () => {
    const storage = memoryStorage({
      [FORK_SETTINGS_STORAGE_KEY]: JSON.stringify({
        boardEnabled: true,
        sidebarPages: [{ id: "board", visible: false }],
      }),
    });
    expect(readForkSettings(storage).boardEnabled).toBe(false);
  });

  it("toggles a page's visibility", () => {
    const pages = setSidebarPageVisible(DEFAULT_FORK_SETTINGS.sidebarPages, "issues", false);
    expect(visible(pages)).toEqual(["board", "pull-requests"]);
    expect(isSidebarPageVisible(pages, "issues")).toBe(false);
    expect(visible(setSidebarPageVisible(pages, "issues", true))).toEqual(ids(pages));
  });

  it("moves a page up or down, and not past either end", () => {
    const pages = DEFAULT_FORK_SETTINGS.sidebarPages;
    expect(ids(moveSidebarPage(pages, "issues", -1))).toEqual(["board", "issues", "pull-requests"]);
    expect(ids(moveSidebarPage(pages, "board", 1))).toEqual(["pull-requests", "board", "issues"]);
    expect(moveSidebarPage(pages, "board", -1)).toBe(pages);
    expect(moveSidebarPage(pages, "issues", 1)).toBe(pages);
  });

  it("keeps boardEnabled and the Board entry in step whichever one changes", () => {
    const storage = memoryStorage();
    expect(updateForkSettings({ boardEnabled: false }, storage).sidebarPages[0]).toEqual({
      id: "board",
      visible: false,
    });
    const reordered = moveSidebarPage(readForkSettings(storage).sidebarPages, "board", 1);
    const shown = setSidebarPageVisible(reordered, "board", true);
    const next = updateForkSettings({ sidebarPages: shown }, storage);
    expect(next.boardEnabled).toBe(true);
    expect(readForkSettings(storage)).toMatchObject({
      boardEnabled: true,
      sidebarPages: [
        { id: "pull-requests", visible: true },
        { id: "board", visible: true },
        { id: "issues", visible: true },
      ],
    });
  });
});

function item(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    type: "do",
    ask: `Ask ${id}`,
    when: "now",
    unblocks: [],
    banner: null,
    path: `/home/bots/chief/open/${id}.md`,
    body: "",
    checked: null,
    rank: 0,
    reach: 0,
    ...overrides,
  };
}

function desk(slug: string, items: BoardItem[], overrides: Partial<BoardDesk> = {}): BoardDesk {
  return {
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    slug,
    items,
    rows: [],
    today: [],
    errors: [],
    ...overrides,
  };
}

const board = (...desks: BoardDesk[]): BoardData => ({ built: "2026-11-25T10:00:00-06:00", desks });

describe("parseBoardPayload", () => {
  it("reads board.py's page data and drops malformed entries", () => {
    const parsed = parseBoardPayload({
      built: "2026-11-25T10:17:51-06:00",
      desks: [
        {
          name: "Eagle Eye",
          slug: "eagle-eye",
          items: [
            {
              id: "agentTestChecks",
              type: "decide",
              ask: "Let an agent run checks?",
              when: "anytime",
              unblocks: ["EAG-1", 3],
              banner: null,
              path: "/home/josh/bots/eagle-eye/open/agent-test-checks.md",
              body: "# Body",
              checked: "2026-11-24T22:03:00-06:00",
              rank: 9,
              reach: 2,
            },
            { type: "do" },
            "nonsense",
          ],
          rows: [{ id: "EAG-1", url: null, section: "s", cols: ["id"], cells: ["EAG-1"] }],
          today: [{ t: "2026-11-25T01:25:00-06:00", text: "Zach answered" }, { t: 1 }],
          errors: ["work.md: x"],
        },
        { items: [] },
      ],
    });
    expect(parsed?.built).toBe("2026-11-25T10:17:51-06:00");
    expect(parsed?.desks).toHaveLength(1);
    const [eagle] = parsed!.desks;
    expect(eagle?.items).toEqual([
      {
        id: "agentTestChecks",
        type: "decide",
        ask: "Let an agent run checks?",
        when: "anytime",
        unblocks: ["EAG-1"],
        banner: null,
        path: "/home/josh/bots/eagle-eye/open/agent-test-checks.md",
        body: "# Body",
        checked: "2026-11-24T22:03:00-06:00",
        rank: 9,
        reach: 2,
      },
    ]);
    expect(eagle?.rows[0]).toMatchObject({ id: "EAG-1", blockedBy: [], unblocks: [] });
    expect(eagle?.today).toEqual([{ t: "2026-11-25T01:25:00-06:00", text: "Zach answered" }]);
    expect(eagle?.errors).toEqual(["work.md: x"]);
  });

  it("rejects payloads without desks", () => {
    expect(parseBoardPayload(null)).toBeNull();
    expect(parseBoardPayload({ built: "x" })).toBeNull();
    expect(parseBoardPayload([])).toBeNull();
  });
});

describe("board page fallback", () => {
  const data = { built: "2026-11-25T10:00:00-06:00", desks: [{ name: "Chief", slug: "chief" }] };

  it("pulls the embedded DATA line out of board.py's index.html", () => {
    const html = [
      "<!doctype html><script>",
      `const DATA = ${JSON.stringify({ ...data, note: "</script>" }).replace("</", "<\\/")};`,
      'const DESK_COLORS = ["#6b7cff"];',
      "</script>",
    ].join("\n");
    expect(extractBoardDataFromHtml(html)).toEqual({ ...data, note: "</script>" });
    expect(parseBoardText(html)?.desks.map((entry) => entry.slug)).toEqual(["chief"]);
  });

  it("reads data.json and ignores the unfilled template", () => {
    expect(parseBoardText(JSON.stringify(data))?.desks).toHaveLength(1);
    expect(parseBoardText("const DATA = /*DATA*/null;\n")).toBeNull();
    expect(parseBoardText("<html></html>")).toBeNull();
  });

  it("tries data.json before the page for a folder URL in a browser", () => {
    expect(browserBoardCandidates("https://host:8447/")).toEqual([
      "https://host:8447/data.json",
      "https://host:8447/",
    ]);
    expect(browserBoardCandidates("https://host/board/index.html#chief")).toEqual([
      "https://host/board/index.html",
    ]);
    expect(browserBoardCandidates("~/dev/bot/.board")).toBeNull();
    expect(browserBoardCandidates("file:///tmp/data.json")).toBeNull();
  });
});

describe("rankBoardItems", () => {
  it("splits ready, not ready and later, ordering now before anytime, then reach and rank", () => {
    const data = board(
      desk("chief", [
        item("anytime-wide", { when: "anytime", reach: 3 }),
        item("now-rank1", { rank: 1 }),
        item("not-ready", { banner: "waiting on Zach" }),
        item("not-ready-later", { banner: "parked", when: "later" }),
        item("later", { when: "later" }),
      ]),
      desk("house", [
        item("now-rank0"),
        item("now-reach2", { reach: 2, rank: 4 }),
        item("anytime", { when: "anytime" }),
      ]),
    );
    const lists = rankBoardItems(data);
    expect(lists.ready.map((row) => row.item.id)).toEqual([
      "now-reach2",
      "now-rank0",
      "now-rank1",
      "anytime-wide",
      "anytime",
    ]);
    expect(lists.notReady.map((row) => row.key)).toEqual(["chief/not-ready"]);
    expect(lists.later.map((row) => row.key)).toEqual(["chief/later", "chief/not-ready-later"]);
    // The sidebar's count is the rows listed as ready.
    expect(countReadyBoardItems(data)).toBe(lists.ready.length);
    expect(rankBoardItems(data, "house").ready.map((row) => row.item.id)).toEqual([
      "now-reach2",
      "now-rank0",
      "anytime",
    ]);
    expect(rankBoardItems(null)).toEqual({ ready: [], notReady: [], later: [] });
  });

  it("counts ready items per desk so the chips add up to Needs me, keeping desks with none ready", () => {
    const data = board(
      desk("chief", [item("a"), item("b", { when: "later" })]),
      desk("eagle", [item("c"), item("d"), item("e", { banner: "blocked" })]),
      desk("mortie", [item("f", { banner: "blocked" })]),
      desk("house", []),
    );
    const counts = boardDeskCounts(data).map((entry) => [entry.desk.slug, entry.count]);
    expect(counts).toEqual([
      ["chief", 1],
      ["eagle", 2],
      ["mortie", 0],
    ]);
    const sum = boardDeskCounts(data).reduce((total, entry) => total + entry.count, 0);
    expect(sum).toBe(countReadyBoardItems(data));
    expect(sum).toBe(rankBoardItems(data).ready.length);
  });
});

describe("groupBoardItems", () => {
  const data = board(
    desk("chief", [
      item("chief-send", { type: "send", when: "anytime" }),
      item("chief-decide", { type: "decide", reach: 2 }),
    ]),
    desk("eagle", [item("eagle-do", { type: "do" }), item("eagle-send", { type: "send" })]),
  );
  const ready = rankBoardItems(data).ready;
  const shape = (grouping: BoardGrouping) =>
    groupBoardItems(ready, grouping, data).map((group) => [
      group.id,
      group.rows.map((row) => row.item.id),
    ]);

  it("groups by priority, now first", () => {
    expect(shape("priority")).toEqual([
      ["now", ["chief-decide", "eagle-do", "eagle-send"]],
      ["anytime", ["chief-send"]],
    ]);
  });

  it("groups by type as Send, Decide, Do", () => {
    expect(shape("type")).toEqual([
      ["send", ["eagle-send", "chief-send"]],
      ["decide", ["chief-decide"]],
      ["do", ["eagle-do"]],
    ]);
  });

  it("groups by bot in the board's desk order", () => {
    const groups = groupBoardItems(ready, "bot", data);
    expect(groups.map((group) => [group.id, group.desk?.name, group.rows.length])).toEqual([
      ["chief", "Chief", 2],
      ["eagle", "Eagle", 2],
    ]);
  });

  it("keeps one ranked list when flat, or when everything shares one group", () => {
    expect(shape("flat")).toEqual([[null, ready.map((row) => row.item.id)]]);
    const onlyNow = ready.filter((row) => row.item.when === "now");
    expect(groupBoardItems(onlyNow, "priority", data).map((group) => group.id)).toEqual([null]);
    expect(groupBoardItems([], "type", data)).toEqual([]);
  });
});

describe("Board item lookup", () => {
  const data = board(desk("chief", [item("a", { unblocks: ["b"] })]), desk("house", [item("b")]));

  it("round-trips item keys and finds items by key or id", () => {
    expect(boardItemKey("chief", "a")).toBe("chief/a");
    expect(parseBoardItemKey("chief/a/b")).toEqual({ deskSlug: "chief", itemId: "a/b" });
    expect(parseBoardItemKey("chief")).toBeNull();
    expect(parseBoardItemKey("/a")).toBeNull();
    expect(findBoardItem(data, "chief/a")?.item.id).toBe("a");
    expect(findBoardItem(data, "house/a")).toBeNull();
    expect(findBoardItemById(data, "b", "chief")?.key).toBe("house/b");
    expect(findBoardItemById(data, "missing", "chief")).toBeNull();
  });
});

describe("collectBoardToday", () => {
  it("merges every desk's Today events, newest first", () => {
    const data = board(
      desk("chief", [], {
        today: [
          { t: "2026-11-25T08:00:00-06:00", text: "early" },
          { t: "2026-11-25T11:00:00-06:00", text: "late" },
        ],
      }),
      desk("eagle-eye", [], { today: [{ t: "2026-11-25T09:30:00-06:00", text: "middle" }] }),
    );
    expect(collectBoardToday(data).map((row) => row.event.text)).toEqual([
      "late",
      "middle",
      "early",
    ]);
    expect(collectBoardToday(data, "eagle-eye").map((row) => row.desk.slug)).toEqual(["eagle-eye"]);
  });
});

describe("findDeskThreadRef", () => {
  const project = (
    id: string,
    title: string,
    workspaceRoot: string,
    overrides: Partial<BoardProjectInput> = {},
  ): BoardProjectInput => ({
    environmentId: ENV,
    id: ProjectId.make(id),
    title,
    workspaceRoot,
    archivedAt: null,
    ...overrides,
  });

  const chiefProject = project("p-chief", "Chief", "/home/josh/bots/chief");
  const homelabProject = project("p-homelab", "Homelab & Media", "/home/josh/bots/homelab/");
  const eagleProject = project("p-eagle", "Eagle Eye", "/srv/elsewhere/eer", {
    environmentId: OTHER_ENV,
  });
  const projects = [chiefProject, homelabProject, eagleProject];

  it("matches a desk by its folder, its slug as folder name, or its name as title", () => {
    const arlo = desk("homelab", [], { name: "Arlo" });
    expect(matchDeskProjects(arlo, projects)).toEqual([homelabProject]);
    const eagle = desk("eagle-eye", [], { name: "Eagle Eye" });
    expect(matchDeskProjects(eagle, projects)).toEqual([eagleProject]);
    const chief = desk("chief", [item("x", { path: "/home/josh/bots/chief/open/x.md" })], {
      name: "Chief",
    });
    const decoy = project("p-decoy", "Chief", "/Users/me/chief");
    expect(matchDeskProjects(chief, [decoy, chiefProject])).toEqual([chiefProject]);
    expect(matchDeskProjects(desk("nobody", []), projects)).toEqual([]);
    expect(
      matchDeskProjects(desk("chief", []), [
        project("p-old", "Chief", "/x/chief", { archivedAt: "2026-11-01T00:00:00.000Z" }),
      ]),
    ).toEqual([]);
  });

  it("returns the pinned thread, else the newest listed thread, in the desk's projects", () => {
    const chief = desk("chief", [], { name: "Chief" });
    const inChief = (id: string, overrides: Partial<BoardThreadInput> = {}) =>
      thread(id, { projectId: chiefProject.id, ...overrides });
    const parent = ThreadId.make("main");
    const threads = [
      inChief("old", { updatedAt: "2026-11-20T08:00:00.000Z" }),
      inChief("new", { updatedAt: "2026-11-25T08:00:00.000Z" }),
      inChief("archived", {
        updatedAt: "2026-11-26T08:00:00.000Z",
        archivedAt: "2026-11-26T08:00:00.000Z",
      }),
      inChief("subagent", {
        updatedAt: "2026-11-27T08:00:00.000Z",
        lineage: { parentThreadId: parent, relationshipToParent: "subagent", rootThreadId: parent },
      }),
      thread("other-project", {
        projectId: homelabProject.id,
        updatedAt: "2026-11-28T08:00:00.000Z",
      }),
    ];
    expect(findDeskThreadRef(chief, projects, threads)).toEqual({
      environmentId: ENV,
      threadId: "new",
    });
    const pinned = [
      ...threads,
      inChief("pinned-old", {
        pinnedAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      }),
      inChief("pinned-new", {
        pinnedAt: "2026-11-02T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      }),
    ];
    expect(findDeskThreadRef(chief, projects, pinned)?.threadId).toBe("pinned-new");
    expect(findDeskThreadRef(desk("nobody", []), projects, threads)).toBeNull();
  });
});

describe("Board thread links", () => {
  it("parses t3-thread v2 and t3code thread links", () => {
    expect(parseBoardThreadHref("t3-thread://v2/env-1/mcp:launch:abc")).toEqual({
      environmentId: "env-1",
      threadId: "mcp:launch:abc",
    });
    expect(parseBoardThreadHref("t3code://threads/env-1/thread%201")).toEqual({
      environmentId: "env-1",
      threadId: "thread 1",
    });
    expect(parseBoardThreadHref("t3-thread://v1/thread-only")).toBeNull();
    expect(parseBoardThreadHref("t3code://threads/env-1")).toBeNull();
    expect(parseBoardThreadHref("t3code://pair?x=1")).toBeNull();
    expect(parseBoardThreadHref("https://example.com")).toBeNull();
  });

  it("rewrites t3code thread links in Markdown so T3 renders them as thread links", () => {
    expect(
      rewriteBoardThreadLinks(
        "See [the lane](t3code://threads/env-1/abc) and [docs](https://example.com).",
      ),
    ).toBe("See [the lane](t3-thread://v2/env-1/abc) and [docs](https://example.com).");
  });
});

describe("plainBoardText", () => {
  it("drops link targets, code ticks and bold markers from a headline", () => {
    expect(plainBoardText("Approve [EAG-487](https://x/EAG-487) and `cliproxy` **tonight**")).toBe(
      "Approve EAG-487 and cliproxy tonight",
    );
  });
});
