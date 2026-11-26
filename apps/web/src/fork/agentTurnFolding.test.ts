import { MessageId, RunId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

import {
  agentTurnFoldId,
  flagsUser,
  foldAgentTurns,
  reuseFoldRows,
  splitTimelineTurns,
  type AgentTurnFoldRow,
  type AgentTurnFoldingContext,
} from "./agentTurnFolding";

const AT = "2026-11-25T10:00:00.000Z";
const NONE: AgentTurnFoldingContext = { expandedGroupIds: new Set() };

type Row = MessagesTimelineRow;

function userRow(
  id: string,
  text: string,
  overrides: Record<string, unknown> = {},
  createdAt = AT,
): Row {
  return {
    kind: "message",
    id,
    createdAt,
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      runId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    },
  } as Row;
}

const agent = (id: string, text = `relay ${id}`, createdAt = AT) =>
  userRow(
    id,
    text,
    { createdBy: "agent", senderThreadId: ThreadId.make(`sender-${id}`) },
    createdAt,
  );
const automation = (id: string, text = `job ${id}`) =>
  userRow(id, text, { createdBy: "user", scheduledTaskId: ScheduledTaskId.make("task-1") });
const human = (id: string, text = `hi ${id}`) => userRow(id, text);
const guest = (id: string) =>
  userRow(id, "guest words", { context: { guest: { name: "Sam", text: "guest words" } } });

function reply(
  id: string,
  text: string,
  overrides: Record<string, unknown> = {},
  createdAt = AT,
): Row {
  return {
    kind: "message",
    id,
    createdAt,
    showAssistantMeta: true,
    showAssistantCopyButton: true,
    assistantCopyStreaming: false,
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text,
      runId: RunId.make(`run-${id}`),
      streaming: false,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    },
  } as Row;
}

function event(id: string, item: Record<string, unknown>): Row {
  return {
    kind: "event",
    id,
    createdAt: AT,
    projectedItem: {
      position: 0,
      visibility: "local",
      sourceThreadId: "thread-1",
      sourceItemId: id,
      item: { id, runId: null, parentItemId: null, status: "completed", ...item },
    },
  } as unknown as Row;
}

function work(id: string, entry: Record<string, unknown>): Row {
  return {
    kind: "work",
    id,
    createdAt: AT,
    isExpandedToolGroup: false,
    groupedEntries: [{ id, createdAt: AT, label: "tool", tone: "tool", ...entry }],
  } as unknown as Row;
}

const ids = (rows: ReadonlyArray<Row>) => rows.map((row) => row.id);
const folds = (rows: ReadonlyArray<Row>) =>
  rows.filter((row): row is AgentTurnFoldRow => row.kind === "agent-turn-fold");

describe("splitTimelineTurns", () => {
  it("starts a turn at each user message and keeps earlier rows as the lead", () => {
    const rows = [event("lead", { type: "system_notice" }), human("u1"), reply("a1", "ok")];
    const { lead, turns } = splitTimelineTurns(rows);
    expect(ids(lead)).toEqual(["lead"]);
    expect(turns.map((turn) => ids(turn.rows))).toEqual([["u1", "a1"]]);
  });
});

describe("foldAgentTurns", () => {
  it("returns the same rows when nothing folds", () => {
    const rows = [human("u1"), reply("a1", "done")];
    expect(foldAgentTurns(rows, NONE)).toBe(rows);
  });

  it("folds consecutive agent and automation turns into one strip", () => {
    const rows = [
      human("u1"),
      reply("a1", "sure"),
      agent("g1"),
      reply("a2", "Noted the relay."),
      automation("j1"),
      reply("a3", "Backup finished OK.\nDetails follow."),
      human("u2"),
      reply("a4", "answer"),
    ];
    const folded = foldAgentTurns(rows, NONE);
    const id = agentTurnFoldId("g1");
    expect(ids(folded)).toEqual(["u1", "a1", id, "u2", "a4"]);
    const [strip] = folds(folded);
    expect(strip).toMatchObject({
      turnCount: 2,
      expanded: false,
      preview: "Backup finished OK.",
      createdAt: AT,
    });
    expect(strip!.senders.map((sender) => sender.kind)).toEqual(["automation", "agent"]);
  });

  it("folds a single routine turn", () => {
    const folded = foldAgentTurns([agent("g1"), reply("a1", "FYI")], NONE);
    expect(folds(folded)).toHaveLength(1);
    expect(folds(folded)[0]!.turnCount).toBe(1);
  });

  it("never folds the user's own or a guest's turns", () => {
    const rows = [human("u1"), reply("a1", "x"), guest("q1"), reply("a2", "y")];
    expect(foldAgentTurns(rows, NONE)).toBe(rows);
  });

  it("splits groups around a human turn", () => {
    const rows = [agent("g1"), reply("a1", "x"), human("u1"), agent("g2"), reply("a2", "y")];
    const folded = foldAgentTurns(rows, NONE);
    expect(ids(folded)).toEqual([agentTurnFoldId("g1"), "u1", agentTurnFoldId("g2")]);
  });

  it("shows the folded rows under the strip while expanded", () => {
    const id = agentTurnFoldId("g1");
    const rows = [agent("g1"), reply("a1", "x"), agent("g2"), reply("a2", "y"), human("u1")];
    const folded = foldAgentTurns(rows, { expandedGroupIds: new Set([id]) });
    expect(ids(folded)).toEqual([id, "g1", "a1", "g2", "a2", "u1"]);
    expect(folds(folded)[0]!.expanded).toBe(true);
  });

  it("previews the opening prompt when the turn has no reply yet", () => {
    const folded = foldAgentTurns([agent("g1", "\n  Please file this\nmore")], NONE);
    expect(folds(folded)[0]!.preview).toBe("Please file this");
  });

  it("dates the strip by the newest row in the group", () => {
    const later = "2026-11-25T11:30:00.000Z";
    const folded = foldAgentTurns([agent("g1"), reply("a1", "x", {}, later)], NONE);
    expect(folds(folded)[0]!.latestAt).toBe(later);
  });

  describe("keeps a turn expanded when", () => {
    const fold = (rows: ReadonlyArray<Row>, context: AgentTurnFoldingContext = NONE) =>
      folds(foldAgentTurns(rows, context));

    it("it is still running", () => {
      expect(fold([agent("g1"), reply("a1", "par", { streaming: true })])).toEqual([]);
      expect(fold([agent("g1"), { kind: "working", id: "w", createdAt: null } as Row])).toEqual([]);
      expect(fold([agent("g1"), reply("a1", "x")], { ...NONE, isWorking: true })).toEqual([]);
      expect(
        fold([agent("g1"), reply("a1", "x")], { ...NONE, runningRunId: RunId.make("run-a1") }),
      ).toEqual([]);
      expect(
        fold([agent("g1"), reply("a1", "x")], {
          ...NONE,
          latestRun: {
            runId: RunId.make("run-a1"),
            status: "running",
            startedAt: AT,
            completedAt: null,
            turnEnded: false,
          } as never,
        }),
      ).toEqual([]);
    });

    it("only an earlier turn is running elsewhere", () => {
      // isWorking applies to the newest turn only.
      const rows = [agent("g1"), reply("a1", "x"), human("u1")];
      expect(fold(rows, { ...NONE, isWorking: true })).toHaveLength(1);
    });

    it("it failed", () => {
      expect(
        fold([agent("g1"), event("e1", { type: "error", status: "failed" }), reply("a1", "x")]),
      ).toEqual([]);
      expect(fold([agent("g1"), work("w1", { tone: "error" })])).toEqual([]);
      expect(
        fold([agent("g1"), reply("a1", "x")], {
          ...NONE,
          latestRun: { runId: RunId.make("run-a1"), status: "failed" } as never,
        }),
      ).toEqual([]);
      expect(
        fold([agent("g1"), reply("a1", "x")], { ...NONE, usageLimitRunId: RunId.make("run-a1") }),
      ).toEqual([]);
    });

    it("it waits on an approval, a question, or a plan", () => {
      const approval = work("w1", {
        projectedItem: {
          item: { type: "approval_request", requestId: "req-1", status: "pending" },
        },
      });
      expect(
        fold([agent("g1"), approval], { ...NONE, pendingApprovalRequestIds: new Set(["req-1"]) }),
      ).toEqual([]);
      // An answered approval no longer holds the turn open.
      expect(fold([agent("g1"), approval])).toHaveLength(1);
      expect(
        fold([agent("g1"), event("q1", { type: "user_input_request", status: "waiting" })]),
      ).toEqual([]);
      expect(
        fold([agent("g1"), event("s1", { type: "secret_request", secretStatus: "pending" })]),
      ).toEqual([]);
      expect(
        fold([
          agent("g1"),
          {
            kind: "proposed-plan",
            id: "p1",
            createdAt: AT,
            proposedPlan: { status: "draft" },
          } as unknown as Row,
        ]),
      ).toEqual([]);
    });

    it("the bot flags the user", () => {
      expect(fold([agent("g1"), reply("a1", "  👉 Can you approve the refund?")])).toEqual([]);
      expect(fold([automation("j1"), reply("a1", "Summary.\n\n👉 Needs you: sign")])).toEqual([]);
    });

    it("a 👉 or ⚠️ sits anywhere in the reply", () => {
      expect(fold([agent("g1"), reply("a1", "Done.\n👉 see the invoice")])).toEqual([]);
      expect(fold([agent("g1"), reply("a1", "Mostly fine, 👉 one thing")])).toEqual([]);
      expect(fold([agent("g1"), reply("a1", "Backup ran.\n⚠️ disk is 91% full")])).toEqual([]);
      expect(fold([agent("g1"), reply("a1", "FYI: all quiet")])).toHaveLength(1);
    });

    it("the turn carries a visual, a sent message, or an attachment", () => {
      const htmlRender = { kind: "html-render", id: "h1", createdAt: AT } as unknown as Row;
      const sent = { kind: "sent-message", id: "s1", createdAt: AT, text: "hi" } as unknown as Row;
      const viewed = {
        kind: "viewed-images",
        id: "v1",
        createdAt: AT,
        paths: [],
      } as unknown as Row;
      expect(fold([agent("g1"), reply("a1", "chart"), htmlRender])).toEqual([]);
      expect(fold([agent("g1"), sent])).toEqual([]);
      expect(fold([agent("g1"), viewed])).toEqual([]);
      expect(
        fold([
          agent("g1"),
          reply("a1", "see file", { attachments: [{ type: "image", id: "i1", name: "a.png" }] }),
        ]),
      ).toEqual([]);
    });

    it("a scheduled job is set to always deliver", () => {
      const job = (id: string, mode: string) =>
        userRow(id, `Run the backup.\n\n[t3-delivery: ${mode}]`, {
          createdBy: "user",
          scheduledTaskId: ScheduledTaskId.make("task-1"),
        });
      expect(fold([job("j1", "always"), reply("a1", "done")])).toEqual([]);
      expect(fold([job("j1", "silent"), reply("a1", "done")])).toHaveLength(1);
      expect(fold([job("j1", "updates-only"), reply("a1", "done")])).toHaveLength(1);
      expect(fold([automation("j1"), reply("a1", "🤖 FYI: routine")])).toHaveLength(1);
      // The task's own prompt decides when the message text lacks the marker.
      const context = { ...NONE, alwaysTaskIds: new Set(["task-1"]) };
      expect(fold([automation("j1"), reply("a1", "done")], context)).toEqual([]);
      expect(
        fold([automation("j1"), reply("a1", "done")], {
          ...NONE,
          alwaysTaskIds: new Set(["task-2"]),
        }),
      ).toHaveLength(1);
    });

    it("it holds the cited message", () => {
      expect(
        fold([agent("g1"), reply("a1", "x")], { ...NONE, pinnedIds: new Set(["a1"]) }),
      ).toEqual([]);
    });
  });

  it("keeps routine neighbours folded around a turn that stays open", () => {
    const rows = [
      agent("g1"),
      reply("a1", "x"),
      agent("g2"),
      reply("a2", "👉 Needs you"),
      agent("g3"),
      reply("a3", "z"),
    ];
    expect(ids(foldAgentTurns(rows, NONE))).toEqual([
      agentTurnFoldId("g1"),
      "g2",
      "a2",
      agentTurnFoldId("g3"),
    ]);
  });
});

describe("flagsUser", () => {
  it("matches a 👉 or ⚠️ anywhere", () => {
    expect(flagsUser("👉 look")).toBe(true);
    expect(flagsUser("\n 👉look")).toBe(true);
    expect(flagsUser("done. 👉 Needs you to sign")).toBe(true);
    expect(flagsUser("done. 👉 see above")).toBe(true);
    expect(flagsUser("careful ⚠️ low disk")).toBe(true);
    expect(flagsUser("all quiet")).toBe(false);
  });
});

describe("reuseFoldRows", () => {
  it("keeps an unchanged fold row the same object and replaces a changed one", () => {
    const first = foldAgentTurns([agent("g1"), reply("a1", "x")], NONE);
    const kept = reuseFoldRows(first, new Map());
    const again = reuseFoldRows(foldAgentTurns([agent("g1"), reply("a1", "x")], NONE), kept.byId);
    expect(again.rows[0]).toBe(kept.rows[0]);
    const changed = reuseFoldRows(
      foldAgentTurns([agent("g1"), reply("a1", "new")], NONE),
      kept.byId,
    );
    expect(changed.rows[0]).not.toBe(kept.rows[0]);
  });
});
