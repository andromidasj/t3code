import { EnvironmentId, MessageId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { act, render } from "../../test/render";
import { MessagesTimeline } from "~/components/chat/MessagesTimeline";

import { FORK_SETTINGS_STORAGE_KEY } from "./forkSettings";

vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [{ id: "task-backup", title: "Nightly backup", prompt: "Back up." }] },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  })) as never,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-11-25T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: `environment-local:thread-${Math.random().toString(36).slice(2)}`,
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
  };
}

function message(
  id: string,
  text: string,
  overrides: Partial<Extract<Entry, { kind: "message" }>["message"]> = {},
): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
      ...overrides,
    },
  };
}

const fromAgent = { createdBy: "agent", senderThreadId: ThreadId.make("thread-arlo") } as const;

const ENTRIES: ReadonlyArray<Entry> = [
  message("u1", "What is left for today?"),
  message("a1", "Two errands.", { role: "assistant" }),
  message("g1", "Receipt for the Costco run attached.", fromAgent),
  message("a2", "Filed the Costco receipt.", { role: "assistant" }),
  message("j1", "Run the nightly backup.", {
    createdBy: "user",
    scheduledTaskId: ScheduledTaskId.make("task-backup"),
  }),
  message("a3", "Backup finished OK.", { role: "assistant" }),
  message("g2", "Drive deal found.", fromAgent),
  message("a4", "👉 Needs you: buy the 20TB drive before 6 PM?", { role: "assistant" }),
];

function setFolding(enabled: boolean) {
  localStorage.setItem(FORK_SETTINGS_STORAGE_KEY, JSON.stringify({ collapseAgentTurns: enabled }));
}

async function renderTimeline(entries: ReadonlyArray<Entry>) {
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  const screen = await render(
    <MessagesTimeline {...baseProps()} timelineEntries={entries as Entry[]} />,
    { container },
  );
  const button = (label: string) => {
    const match = [...container.querySelectorAll<HTMLElement>("button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  };
  return Object.assign(screen, { text: () => container.textContent ?? "", button });
}

describe("CollapsedAgentTurnsRow", () => {
  it("folds routine bot turns into a strip that expands and collapses in place", async () => {
    setFolding(true);
    await using screen = await renderTimeline(ENTRIES);

    await vi.waitFor(() => expect(screen.text()).toContain("Bot activity · 2 updates"));
    expect(screen.text()).toContain("Backup finished OK.");
    expect(screen.text()).toContain("Nightly backup");
    expect(screen.text()).not.toContain("Filed the Costco receipt.");
    // The user's own turn and the 👉 flag stay in view.
    expect(screen.text()).toContain("What is left for today?");
    expect(screen.text()).toContain("👉 Needs you: buy the 20TB drive");

    await act(async () => screen.button("Show bot activity, 2 updates").click());
    await vi.waitFor(() => expect(screen.text()).toContain("Filed the Costco receipt."));
    expect(screen.button("Collapse bot activity").getAttribute("aria-expanded")).toBe("true");

    await act(async () => screen.button("Collapse bot activity").click());
    await vi.waitFor(() => expect(screen.text()).not.toContain("Filed the Costco receipt."));
    expect(screen.text()).toContain("Bot activity · 2 updates");
  });

  it("shows every turn when the setting is off", async () => {
    setFolding(false);
    await using screen = await renderTimeline(ENTRIES);

    await vi.waitFor(() => expect(screen.text()).toContain("Two errands."));
    expect(screen.text()).not.toContain("Bot activity");
  });
});
