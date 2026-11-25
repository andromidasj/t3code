import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { T, useGT, useLocale, useMessages } from "gt-react";
import { ChevronRightIcon, PencilIcon, PlayIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { RelativeTime } from "~/components/RelativeTime";
import { scheduleLabel } from "~/components/settings/scheduledTasksSettings.logic";
import { Badge } from "~/components/ui/badge";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { usePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { environmentAtomList, environmentIdsKey } from "~/state/environmentAtomList";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { IconAction } from "./boardPanels";
import {
  boardJobHealth,
  buildBoardJobs,
  countFailedBoardJobs,
  type BoardJobHealth,
  type BoardJobRow,
  type BoardJobsSource,
} from "./boardJobs";
import { ScheduledTaskDeliverySwitch } from "./ScheduledDeliveryControl";

const boardScheduledTasksAtom = environmentAtomList("fork-board-scheduled-tasks", (environmentId) =>
  serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);

/**
 * Scheduled jobs across the connected environments, failed first, limited to the desk filter's
 * projects when it has them.
 */
export function useBoardScheduledJobs(
  connectedIds: ReadonlyArray<EnvironmentId>,
  projectNames: ReadonlyMap<string, string>,
  filterProjectKeys: ReadonlySet<string> | null,
): { readonly rows: ReadonlyArray<BoardJobRow>; readonly total: number } {
  const queries = useAtomValue(boardScheduledTasksAtom(environmentIdsKey(connectedIds)));
  const sources: BoardJobsSource[] = [];
  for (const [index, query] of queries.entries()) {
    const data = AsyncResult.getOrElse(query, () => null);
    const environmentId = connectedIds[index];
    if (data === null || environmentId === undefined) continue;
    sources.push({ environmentId, tasks: data.tasks, timeZone: data.timeZone });
  }
  return {
    rows: buildBoardJobs(sources, projectNames, filterProjectKeys),
    total: sources.reduce((sum, source) => sum + source.tasks.length, 0),
  };
}

/** The Jobs filter's count: red with the failed jobs while any fail. */
export function BoardJobsCountBadge(props: { readonly rows: ReadonlyArray<BoardJobRow> }) {
  const failed = countFailedBoardJobs(props.rows);
  if (failed === 0 && props.rows.length === 0) return null;
  return (
    <Badge size="sm" variant={failed > 0 ? "error" : "secondary"}>
      {failed > 0 ? failed : props.rows.length}
    </Badge>
  );
}

/**
 * The Board's scheduled jobs: a strip at the bottom of All (open on its own while a job is
 * failing) or the whole Jobs view.
 */
export function BoardScheduledJobsSection(props: {
  readonly rows: ReadonlyArray<BoardJobRow>;
  readonly collapsible: boolean;
}) {
  const gt = useGT();
  const failed = countFailedBoardJobs(props.rows);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = !props.collapsible || (open ?? failed > 0);
  if (props.collapsible && props.rows.length === 0) return null;
  const title = gt("Scheduled jobs");
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid="board-jobs-section">
      <h2 className="flex items-center gap-2 px-3 font-medium text-sm">
        {props.collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="-ml-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setOpen(!expanded)}
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
            {title}
          </button>
        ) : (
          title
        )}
        <span className="text-muted-foreground tabular-nums">{props.rows.length}</span>
        {failed > 0 ? (
          <Badge size="sm" variant="error">
            {gt("{count} failed", { count: failed })}
          </Badge>
        ) : null}
      </h2>
      {!expanded ? null : props.rows.length === 0 ? (
        <p className="px-3 text-muted-foreground text-sm">
          <T>No scheduled jobs for this filter.</T>
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {props.rows.map((row) => (
            <BoardJobListRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

const DOT_CLASS: Record<BoardJobHealth, string> = {
  failed: "bg-destructive",
  running: "bg-warning",
  succeeded: "bg-success",
  idle: "bg-muted-foreground/40",
};

function BoardJobListRow({ row }: { row: BoardJobRow }) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const navigate = useNavigate();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const environmentId = EnvironmentId.make(row.environmentId);
  const { task } = row;
  const health = boardJobHealth(task);
  const healthLabel = {
    failed: task.lastRunError
      ? gt("Last run failed: {error}", { error: task.lastRunError })
      : gt("Last run failed"),
    running: gt("Running", { $context: "scheduled task run status" }),
    succeeded: gt("Last run succeeded"),
    idle: task.enabled ? gt("Never run") : gt("Paused"),
  }[health];
  const details = [
    row.projectName === null
      ? null
      : { key: "project", node: <span className="truncate">{row.projectName}</span> },
    {
      key: "schedule",
      node: (
        <span className="truncate">
          {scheduleLabel(
            task.schedule,
            timestampFormat,
            row.timeZone,
            task.nextRunAt,
            messages,
            locale,
          )}
        </span>
      ),
    },
    task.lastRunAt === null
      ? null
      : {
          key: "ran",
          node: (
            <span className="shrink-0">
              <T>
                ran <RelativeTime timestamp={task.lastRunAt} />
              </T>
            </span>
          ),
        },
  ].filter((detail) => detail !== null);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 hover:bg-accent/50"
      data-testid="board-job-row"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={healthLabel}
                className={cn("size-2 rounded-full", DOT_CLASS[health])}
              />
            }
          />
          <TooltipPopup side="bottom" className="max-w-96 whitespace-pre-wrap">
            {healthLabel}
          </TooltipPopup>
        </Tooltip>
      </span>
      <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <span className={cn("truncate font-medium text-sm", !task.enabled && "opacity-64")}>
          {task.title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground text-xs">
          {details.map((detail, index) => (
            <Fragment key={detail.key}>
              {index === 0 ? null : <span aria-hidden>·</span>}
              {detail.node}
            </Fragment>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <ScheduledTaskDeliverySwitch environmentId={environmentId} task={task} />
        <RunJobNowButton environmentId={environmentId} task={task} />
        <IconAction
          label={gt("Edit {title} in Settings", { title: task.title })}
          onClick={() =>
            void navigate({
              to: "/settings/scheduled-tasks",
              search: { environmentId, taskId: task.id },
            })
          }
        >
          <PencilIcon />
        </IconAction>
      </span>
    </div>
  );
}

function RunJobNowButton(props: { environmentId: EnvironmentId; task: ScheduledTask }) {
  const gt = useGT();
  const { environmentId, task } = props;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "board scheduled task run now",
  });
  const [busy, setBusy] = useState(false);
  if (task.schedule.type === "webhook") return null;
  const runNow = async () => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result = await run({ environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not run scheduled task"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <IconAction
      label={gt("Run {title} now", { title: task.title })}
      disabled={busy || !canOperate || task.lastRunStatus === "running"}
      onClick={() => void runNow()}
    >
      <PlayIcon />
    </IconAction>
  );
}
