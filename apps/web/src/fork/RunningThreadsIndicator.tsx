import type { EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import { EnvironmentMachineIcon } from "~/components/EnvironmentMachineIcon";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { RelativeTime } from "~/components/RelativeTime";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";
import { SidebarMenuItem, useSidebar } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import {
  useEnvironmentIdentities,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { buildThreadRouteParams } from "~/threadRoutes";

import { useForkSettings } from "./forkSettings";
import {
  buildRunningThreads,
  runningThreadsBreakdown,
  type RunningThreadGroup,
  type RunningThreadRow,
} from "./runningThreads.logic";

/**
 * The sidebar footer's count of threads working right now, across every connected machine, and
 * the popover that lists them by machine. Nothing while none run, and nothing with the sidebar
 * hierarchy off.
 */
export function RunningThreadsIndicator() {
  const { sidebarHierarchyEnabled } = useForkSettings();
  return sidebarHierarchyEnabled ? <RunningThreadsPill /> : null;
}

function RunningThreadsPill() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { threadPlacementOverrides } = useForkSettings();
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const machines = useEnvironmentMachines();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [open, setOpen] = useState(false);

  const model = buildRunningThreads({
    threads,
    labelByEnvironmentId: new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    ),
    machineByEnvironmentId: machines,
    primaryEnvironmentId,
    fallbackLabel: gt("Remote", { $context: "machine location" }),
    placementOverrides: threadPlacementOverrides,
  });
  if (model.totalCount === 0) return null;

  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const openThread = (row: RunningThreadRow) => {
    setOpen(false);
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(row.thread.environmentId, row.thread.id)),
    });
  };
  const machineCount = model.groups.length;
  const tooltip =
    machineCount > 1
      ? gt("{count} running across {machines} machines ({breakdown})", {
          count: model.totalCount,
          machines: machineCount,
          breakdown: runningThreadsBreakdown(model),
        })
      : gt("{count} running", { count: model.totalCount });

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <SharedTooltipTrigger render={<span className="flex shrink-0" />} label={tooltip}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                data-testid="running-threads-pill"
                aria-label={gt("{count} running threads", { count: model.totalCount })}
                className={cn(
                  "flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-sidebar-border px-2 text-xs tabular-nums text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  open && "bg-sidebar-row-hover text-sidebar-foreground",
                )}
              />
            }
          >
            <Spinner size="xs" tone="muted" />
            <span>{model.totalCount}</span>
          </PopoverTrigger>
          <PopoverPopup
            side="top"
            align="end"
            width="md"
            padding="compact"
            collisionAvoidance={{ side: "flip", align: "shift" }}
            aria-label={gt("Running now")}
          >
            <div data-testid="running-threads-popover" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="font-medium text-sm">
                  {gt("Running now", { $context: "popover title, threads working right now" })}
                </span>
                <CountBadge count={model.totalCount} />
              </div>
              {model.groups.map((group) => (
                <MachineGroup
                  key={group.environmentId}
                  group={group}
                  projectByKey={projectByKey}
                  onOpen={openThread}
                />
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      </SharedTooltipTrigger>
    </SidebarMenuItem>
  );
}

function CountBadge(props: { readonly count: number }) {
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 font-medium text-2xs tabular-nums leading-none text-muted-foreground">
      {props.count}
    </span>
  );
}

function MachineGroup(props: {
  readonly group: RunningThreadGroup;
  readonly projectByKey: ReadonlyMap<string, Parameters<typeof ProjectFavicon>[0]["project"]>;
  readonly onOpen: (row: RunningThreadRow) => void;
}) {
  const { group } = props;
  return (
    <section
      data-testid={`running-threads-group-${group.environmentId}`}
      className="flex flex-col gap-0.5"
    >
      <div className="flex items-center gap-1.5 px-1 text-muted-foreground text-xs">
        <EnvironmentMachineIcon aria-hidden kind={group.machine} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
        <CountBadge count={group.threads.length} />
      </div>
      {group.threads.map((row) => (
        <ThreadRow
          key={row.key}
          row={row}
          project={props.projectByKey.get(
            `${row.thread.environmentId as EnvironmentId}:${row.thread.projectId}`,
          )}
          onOpen={props.onOpen}
        />
      ))}
    </section>
  );
}

function ThreadRow(props: {
  readonly row: RunningThreadRow;
  readonly project: Parameters<typeof ProjectFavicon>[0]["project"] | undefined;
  readonly onOpen: (row: RunningThreadRow) => void;
}) {
  const gt = useGT();
  const { row, project } = props;
  const title = row.thread.title.trim() === "" ? gt("Untitled thread") : row.thread.title;
  return (
    <button
      type="button"
      data-testid="running-thread-row"
      className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => props.onOpen(row)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {project === undefined ? (
          <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />
        ) : (
          <ProjectFavicon project={project} className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {row.background ? (
        <span className="shrink-0 rounded-sm border border-border px-1 text-2xs text-muted-foreground leading-4">
          {gt("bg", { $context: "short tag, a bot's background thread" })}
        </span>
      ) : null}
      <span className="shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums">
        <RelativeTime timestamp={row.since} />
      </span>
    </button>
  );
}
