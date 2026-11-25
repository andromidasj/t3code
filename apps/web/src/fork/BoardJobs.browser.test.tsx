import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
// Routes load lazily; their first transform would eat the test's timeout.
import "~/components/ChatView";
import "./BoardPage";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { buildBoardJobs } from "./boardJobs";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const jobs = vi.hoisted(() => ({ tasks: [] as ScheduledTask[] }));

// The fake environment never answers the scheduled task subscription; these stand in for it.
vi.mock(import("./BoardScheduledJobsSection"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useBoardScheduledJobs: (_ids, projectNames, filterProjectKeys) => ({
      rows: buildBoardJobs(
        [{ environmentId: ENVIRONMENT_ID, tasks: jobs.tasks, timeZone: "UTC" }],
        projectNames,
        filterProjectKeys,
      ),
      total: jobs.tasks.length,
    }),
  };
});

installFakeEnvironment([threadWithHistory("thread-jobs", 1)]);

function task(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: ScheduledTaskId.make(id),
    title: id,
    prompt: "Check things\n\n[t3-delivery: silent]",
    enabled: true,
    schedule: { type: "interval", everyMs: 3_600_000 },
    projectId: PROJECT_ID,
    threadId: ThreadId.make("thread-jobs"),
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: "2026-11-25T08:00:00.000Z",
    lastRunStatus: "succeeded",
    lastRunError: null,
    runCount: 3,
    ...overrides,
  };
}

async function mountBoard(path = "/board") {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const app = await render(<AppRoot router={router} />, { router: false });
  return { app, router };
}

it("shows scheduled job health on the Board, failed jobs first, with delivery and actions", async () => {
  jobs.tasks = [
    task("Morning brief"),
    task("Nightly backup", { lastRunStatus: "failed", lastRunError: "disk full" }),
    task("Old watcher", { enabled: false, lastRunStatus: "never", lastRunAt: null }),
  ];
  const { app, router } = await mountBoard();
  await using _app = app;

  const jobsPill = page.getByRole("button", { name: /^Jobs/ });
  await expect.element(jobsPill).toBeVisible();
  // One failed job; gt-react wraps translated text in invisible marks, so match loosely.
  await vi.waitFor(() =>
    expect(jobsPill.element().querySelector('[data-slot="badge"]')?.textContent).toBe("1"),
  );

  // A failing job opens the strip at the bottom of All on its own.
  const strip = page.getByRole("button", { name: "Scheduled jobs" });
  await expect.element(strip).toHaveAttribute("aria-expanded", "true");
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll('[data-testid="board-job-row"]')].map(
        (row) => row.querySelector(".font-medium")?.textContent,
      ),
    ).toEqual(["Nightly backup", "Morning brief", "Old watcher"]),
  );
  await expect
    .element(page.getByRole("img", { name: "Last run failed: disk full" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Every 60 min").first()).toBeVisible();
  const delivery = page.getByRole("group", { name: "Delivery for Nightly backup" });
  await expect.element(delivery).toBeVisible();
  await expect
    .element(delivery.getByRole("button", { name: "Silent" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Run Nightly backup now" }))
    .toBeInTheDocument();

  await strip.click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="board-job-row"]')).toHaveLength(0),
  );

  await jobsPill.click();
  await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ boardView: "jobs" }));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="board-job-row"]')).toHaveLength(3),
  );

  await page.getByRole("button", { name: "Edit Nightly backup in Settings" }).click();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/settings/scheduled-tasks"));
  expect(router.state.location.search).toMatchObject({
    environmentId: ENVIRONMENT_ID,
    taskId: "Nightly backup",
  });
});

it("keeps the jobs strip closed while nothing fails, and hides Jobs without tasks", async () => {
  jobs.tasks = [task("Morning brief")];
  const first = await mountBoard();
  {
    await using _app = first.app;
    await expect
      .element(page.getByRole("button", { name: "Scheduled jobs" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll('[data-testid="board-job-row"]')).toHaveLength(0);
  }

  jobs.tasks = [];
  const second = await mountBoard();
  await using _app = second.app;
  await expect.element(page.getByRole("button", { name: /^Needs me/ })).toBeVisible();
  expect(page.getByRole("button", { name: /^Jobs/ }).elements()).toHaveLength(0);
  expect(document.querySelector('[data-testid="board-jobs-section"]')).toBeNull();
});
