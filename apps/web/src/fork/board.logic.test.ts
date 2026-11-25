import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardProjectKey,
  boardSearchFromUrl,
  buildBoardModel,
  countNeedsMe,
  opensFullThread,
  type BoardThreadInput,
} from "./board.logic";
import {
  DEFAULT_FORK_SETTINGS,
  FORK_SETTINGS_STORAGE_KEY,
  normalizeBoardUrl,
  readForkSettings,
  updateForkSettings,
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

  it("keeps a selected thread only with both ids", () => {
    expect(boardSearchFromUrl({ boardEnvironmentId: "env", boardThreadId: "t" })).toEqual({
      boardEnvironmentId: "env",
      boardThreadId: "t",
    });
    expect(boardSearchFromUrl({ boardThreadId: "t" })).toEqual({});
    expect(boardSearchFromUrl({ boardEnvironmentId: "env", boardThreadId: 3 })).toEqual({});
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
    expect(readForkSettings(storage)).toEqual({
      boardEnabled: true,
      boardUrl: "https://board.example/",
      openBoardOnLaunch: true,
    });
    expect(JSON.parse(storage.values.get(FORK_SETTINGS_STORAGE_KEY) ?? "null")).toEqual({
      boardEnabled: true,
      boardUrl: "https://board.example/",
      openBoardOnLaunch: true,
    });
  });
});
