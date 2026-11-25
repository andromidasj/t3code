import { ScheduledTaskId, ThreadId, type ScheduledTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createThreadNotificationGate,
  type ThreadNotificationObservation,
} from "~/components/ThreadNotificationCoordinator.logic";

import {
  applyScheduledDeliveryMode,
  parseScheduledDeliveryMode,
  quietsCompletion,
  scheduledTaskUpsertWithPrompt,
  stripScheduledDeliveryDirective,
  withoutScheduledDeliveryDirective,
} from "./scheduledDelivery";
import {
  createScheduledCompletionFilter,
  matchScheduledRun,
  MAX_QUEUE_WAIT_MS,
  type ScheduledRunThread,
} from "./scheduledNotificationGate";

describe("parseScheduledDeliveryMode", () => {
  it("reads each mode from a trailing marker line", () => {
    expect(parseScheduledDeliveryMode("Check mail.\n\n[t3-delivery: silent]")).toBe("silent");
    expect(parseScheduledDeliveryMode("Check mail.\n[t3-delivery: updates-only]")).toBe(
      "updates-only",
    );
    expect(parseScheduledDeliveryMode("Check mail.\r\n[t3-delivery:always]  ")).toBe("always");
    expect(parseScheduledDeliveryMode("Check mail.\n  [T3-Delivery: SILENT]")).toBe("silent");
  });

  it("is null without a marker, for an unknown mode, or for a marker inside a sentence", () => {
    expect(parseScheduledDeliveryMode("Check mail.")).toBeNull();
    expect(parseScheduledDeliveryMode("Check mail.\n[t3-delivery: loud]")).toBeNull();
    expect(parseScheduledDeliveryMode("Say [t3-delivery: silent] to me")).toBeNull();
  });

  it("takes the last marker when a prompt has several", () => {
    expect(
      parseScheduledDeliveryMode("[t3-delivery: always]\nCheck mail.\n[t3-delivery: silent]"),
    ).toBe("silent");
  });
});

describe("stripScheduledDeliveryDirective", () => {
  it("removes the marker line and the blank lines it leaves at the end", () => {
    expect(stripScheduledDeliveryDirective("Check mail.\n\n[t3-delivery: silent]")).toBe(
      "Check mail.",
    );
    expect(stripScheduledDeliveryDirective("Check mail.\r\n\r\n[t3-delivery: always]\n")).toBe(
      "Check mail.",
    );
  });

  it("keeps the rest of the prompt exactly, including inner blank lines", () => {
    const prompt = "Step one.\n\nStep two.\n";
    expect(stripScheduledDeliveryDirective(prompt)).toBe(prompt);
    expect(stripScheduledDeliveryDirective(`${prompt}\n[t3-delivery: silent]`)).toBe(
      "Step one.\n\nStep two.",
    );
    expect(stripScheduledDeliveryDirective("Say [t3-delivery: silent] once")).toBe(
      "Say [t3-delivery: silent] once",
    );
  });

  it("returns the same string when there is nothing to strip", () => {
    const prompt = "Check mail.";
    expect(stripScheduledDeliveryDirective(prompt)).toBe(prompt);
  });
});

describe("applyScheduledDeliveryMode", () => {
  it("adds, replaces and removes the marker", () => {
    expect(applyScheduledDeliveryMode("Check mail.", "silent")).toBe(
      "Check mail.\n\n[t3-delivery: silent]",
    );
    expect(applyScheduledDeliveryMode("Check mail.\n\n[t3-delivery: silent]", "always")).toBe(
      "Check mail.\n\n[t3-delivery: always]",
    );
    expect(applyScheduledDeliveryMode("Check mail.\n\n[t3-delivery: silent]", null)).toBe(
      "Check mail.",
    );
  });

  it("is idempotent and round-trips through parse and strip", () => {
    const once = applyScheduledDeliveryMode("Check mail.\n\n", "updates-only");
    expect(applyScheduledDeliveryMode(once, "updates-only")).toBe(once);
    expect(parseScheduledDeliveryMode(once)).toBe("updates-only");
    expect(stripScheduledDeliveryDirective(once)).toBe("Check mail.");
  });

  it("collapses several markers into one", () => {
    expect(
      applyScheduledDeliveryMode(
        "[t3-delivery: always]\nCheck mail.\n[t3-delivery: silent]",
        "always",
      ),
    ).toBe("Check mail.\n\n[t3-delivery: always]");
  });
});

describe("withoutScheduledDeliveryDirective", () => {
  it("strips the text and keeps the other fields", () => {
    const presentation = { text: "Run.\n\n[t3-delivery: silent]", attribution: "automation" };
    expect(withoutScheduledDeliveryDirective(presentation)).toEqual({
      text: "Run.",
      attribution: "automation",
    });
    const plain = { text: "Run." };
    expect(withoutScheduledDeliveryDirective(plain)).toBe(plain);
  });
});

describe("quietsCompletion", () => {
  it("quiets silent and updates-only, not always or unmarked", () => {
    expect(quietsCompletion("silent")).toBe(true);
    expect(quietsCompletion("updates-only")).toBe(true);
    expect(quietsCompletion("always")).toBe(false);
    expect(quietsCompletion(null)).toBe(false);
  });
});

describe("scheduledTaskUpsertWithPrompt", () => {
  it("saves the task as it stands with the new prompt, leaving the thread binding alone", () => {
    const task = {
      id: ScheduledTaskId.make("task-1"),
      title: "Inbox",
      prompt: "Check mail.",
      enabled: false,
      schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      projectId: "project-1",
      threadId: "thread-1",
      threadMode: "fresh_session",
      workspaceStrategy: { type: "root" },
      modelSelection: { instanceId: "codex", model: "gpt" },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdBy: "agent",
      creationSource: "mcp",
      lastRunAt: null,
    } as unknown as ScheduledTask;
    const input = scheduledTaskUpsertWithPrompt(task, "Check mail.\n\n[t3-delivery: silent]");
    expect(input).toEqual({
      id: task.id,
      requireExisting: true,
      title: "Inbox",
      prompt: "Check mail.\n\n[t3-delivery: silent]",
      enabled: false,
      schedule: task.schedule,
      projectId: "project-1",
      workspaceStrategy: { type: "root" },
      modelSelection: task.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      creationSource: "mcp",
    });
    expect(input).not.toHaveProperty("threadId");
    expect(input).not.toHaveProperty("threadMode");
  });
});

const THREAD = ThreadId.make("jobs-thread");
const OTHER_THREAD = ThreadId.make("main-thread");

function task(
  id: string,
  prompt: string,
  lastRunAt: string | null,
  threadId: ThreadId | null = THREAD,
  enabled = true,
) {
  return { id: ScheduledTaskId.make(id), threadId, prompt, enabled, lastRunAt };
}

function thread(
  requestedAt: string | null,
  completedAt: string | null = "2026-11-25T09:05:00.000Z",
  runId = "run-1",
): ScheduledRunThread {
  return {
    id: THREAD,
    latestRun: { runId, requestedAt, startedAt: requestedAt, completedAt },
  };
}

const NONE = new Map<ScheduledTaskId, string>();
const FIRE = "2026-11-25T09:00:00.000Z";

describe("matchScheduledRun", () => {
  it("matches the task whose fire started the run", () => {
    const tasks = [
      task("morning", "A\n[t3-delivery: silent]", FIRE),
      task("hourly", "B\n[t3-delivery: always]", "2026-11-25T08:00:00.000Z"),
    ];
    expect(matchScheduledRun(tasks, thread("2026-11-25T09:00:02.000Z"), NONE)).toEqual({
      taskId: "morning",
      lastRunAt: FIRE,
      mode: "silent",
    });
  });

  it("picks the newest fire on a thread several tasks share", () => {
    const tasks = [
      task("a", "A\n[t3-delivery: always]", "2026-11-25T08:59:00.000Z"),
      task("b", "B\n[t3-delivery: updates-only]", FIRE),
    ];
    expect(matchScheduledRun(tasks, thread(FIRE), NONE)?.mode).toBe("updates-only");
  });

  it("matches a prompt that queued behind a running turn", () => {
    const tasks = [task("a", "A\n[t3-delivery: silent]", FIRE)];
    expect(matchScheduledRun(tasks, thread("2026-11-25T09:40:00.000Z"), NONE)?.taskId).toBe("a");
  });

  it("ignores fires already used, too old, or after the run, and other threads' tasks", () => {
    const silent = "A\n[t3-delivery: silent]";
    expect(
      matchScheduledRun(
        [task("a", silent, FIRE)],
        thread("2026-11-25T09:30:00.000Z"),
        new Map([[ScheduledTaskId.make("a"), FIRE]]),
      ),
    ).toBeNull();
    const late = new Date(Date.parse(FIRE) + MAX_QUEUE_WAIT_MS + 1).toISOString();
    expect(matchScheduledRun([task("a", silent, FIRE)], thread(late), NONE)).toBeNull();
    expect(
      matchScheduledRun([task("a", silent, "2026-11-25T09:10:00.000Z")], thread(FIRE), NONE),
    ).toBeNull();
    expect(
      matchScheduledRun([task("a", silent, FIRE, OTHER_THREAD)], thread(FIRE), NONE),
    ).toBeNull();
  });

  it("falls back to a mode every enabled task shares when the run has no timing", () => {
    const shared = [
      task("a", "A\n[t3-delivery: silent]", FIRE),
      task("b", "B\n[t3-delivery: silent]", null),
      task("off", "C\n[t3-delivery: always]", null, THREAD, false),
    ];
    expect(matchScheduledRun(shared, thread(null), NONE)).toEqual({
      taskId: null,
      lastRunAt: null,
      mode: "silent",
    });
    const mixed = [...shared, task("c", "D\n[t3-delivery: always]", null)];
    expect(matchScheduledRun(mixed, thread(null), NONE)).toBeNull();
  });
});

describe("createScheduledCompletionFilter", () => {
  const now = () => Date.parse("2026-11-25T09:05:00.000Z");

  it("quiets a silent or updates-only run's completion, not an always or unmarked one", () => {
    for (const [prompt, quiet] of [
      ["A\n[t3-delivery: silent]", true],
      ["A\n[t3-delivery: updates-only]", true],
      ["A\n[t3-delivery: always]", false],
      ["A", false],
    ] as const) {
      const filter = createScheduledCompletionFilter(now);
      filter.setTasks([task("a", prompt, FIRE)]);
      expect(filter.quietCompletion(thread(FIRE))).toBe(quiet);
    }
  });

  it("decides each run once and lets the next run of the thread notify", () => {
    const filter = createScheduledCompletionFilter(now);
    filter.setTasks([task("a", "A\n[t3-delivery: silent]", FIRE)]);
    expect(filter.quietCompletion(thread(FIRE))).toBe(true);
    expect(filter.quietCompletion(thread(FIRE))).toBe(true);
    // The user writes in the jobs thread after the scheduled run: that answer notifies.
    expect(
      filter.quietCompletion(
        thread("2026-11-25T09:20:00.000Z", "2026-11-25T09:21:00.000Z", "run-2"),
      ),
    ).toBe(false);
  });

  it("does nothing before the run ends or before the tasks load", () => {
    const filter = createScheduledCompletionFilter(now);
    expect(filter.quietCompletion(thread(FIRE))).toBe(false);
    filter.setTasks([task("a", "A\n[t3-delivery: silent]", FIRE)]);
    expect(filter.quietCompletion(thread(FIRE, null))).toBe(false);
    expect(filter.quietCompletion(thread(FIRE))).toBe(true);
  });

  it("treats fires settled before the app was watching as used", () => {
    const filter = createScheduledCompletionFilter(() => Date.parse("2026-11-25T10:00:00.000Z"));
    filter.setTasks([task("a", "A\n[t3-delivery: silent]", FIRE)]);
    expect(
      filter.quietCompletion(
        thread("2026-11-25T09:30:00.000Z", "2026-11-25T10:00:00.000Z", "run-9"),
      ),
    ).toBe(false);
  });
});

describe("quiet scheduled completions in the notification gate", () => {
  const observation = (overrides: Partial<ThreadNotificationObservation> = {}) => ({
    attention: null,
    requestId: null,
    settled: false,
    completedAt: null,
    backgroundWake: false,
    ...overrides,
  });
  const quiet = { archived: false, quiet: true, snoozed: false };

  it("still announces failures and requests on a quiet task's thread", () => {
    const notices: string[] = [];
    const gate = createThreadNotificationGate<string>((_, kind) => notices.push(kind));
    gate.observe("t", undefined, observation(), quiet);
    gate.observe("t", observation(), observation({ attention: "run-1:failed" }), quiet);
    gate.observe(
      "t",
      observation(),
      observation({ attention: "approval:req-1", requestId: "req-1" }),
      quiet,
    );
    expect(notices).toEqual(["input", "input"]);
  });

  it("drops the completion itself", () => {
    const notices: string[] = [];
    const gate = createThreadNotificationGate<string>((_, kind) => notices.push(kind));
    gate.observe("t", undefined, observation(), quiet);
    gate.observe("t", observation(), observation({ settled: true, completedAt: 1 }), quiet);
    expect(notices).toEqual([]);
  });
});
