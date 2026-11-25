import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import { Label } from "~/components/ui/label";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  applyScheduledDeliveryMode,
  parseScheduledDeliveryMode,
  SCHEDULED_DELIVERY_MODES,
  scheduledTaskUpsertWithPrompt,
  type ScheduledDeliveryMode,
} from "./scheduledDelivery";

function useDeliveryModeLabels(): Record<ScheduledDeliveryMode, string> {
  const gt = useGT();
  return {
    silent: gt("Silent"),
    "updates-only": gt("Updates only"),
    always: gt("Always"),
  };
}

/** One line on what the chosen mode does, for the task form. */
function useScheduledDeliveryHelp(mode: ScheduledDeliveryMode | null): string {
  const gt = useGT();
  switch (mode) {
    case "silent":
      return gt(
        "Runs quietly: no notification when it finishes. Failures and requests still notify.",
      );
    case "updates-only":
      return gt(
        "No notification for routine runs; the agent speaks up only when it has news. Failures and requests still notify.",
      );
    case "always":
      return gt("Notifies every time a run finishes.");
    default:
      return gt("Not set: notifies every time a run finishes, as before.");
  }
}

/** Silent | Updates only | Always. Nothing is pressed for a task saved before modes existed. */
function ScheduledDeliveryModePicker(props: {
  value: ScheduledDeliveryMode | null;
  onChange: (mode: ScheduledDeliveryMode) => void;
  disabled?: boolean;
  /** Names the task in the label when several pickers share a page. */
  taskTitle?: string;
}) {
  const gt = useGT();
  const labels = useDeliveryModeLabels();
  return (
    <ToggleGroup
      aria-label={
        props.taskTitle === undefined
          ? gt("Delivery")
          : gt("Delivery for {title}", { title: props.taskTitle })
      }
      value={props.value === null ? [] : [props.value]}
      disabled={props.disabled}
      onValueChange={(values) => {
        const next = values[0];
        // Pressing the chosen mode again would clear it; a task keeps one mode once set.
        if (next !== undefined && next !== props.value) {
          const mode = SCHEDULED_DELIVERY_MODES.find((candidate) => candidate === next);
          if (mode) props.onChange(mode);
        }
      }}
    >
      {SCHEDULED_DELIVERY_MODES.map((mode) => (
        <Toggle key={mode} value={mode}>
          {labels[mode]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** The picker on a task's row, saving the change at once. */
export function ScheduledTaskDeliverySwitch(props: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
}) {
  const gt = useGT();
  const { environmentId, task } = props;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "scheduled task delivery",
  });
  const [pending, setPending] = useState<ScheduledDeliveryMode | null>(null);
  const saved = parseScheduledDeliveryMode(task.prompt);
  const save = async (mode: ScheduledDeliveryMode) => {
    if (pending !== null || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return;
    }
    setPending(mode);
    const result = await upsertTask({
      environmentId,
      input: scheduledTaskUpsertWithPrompt(task, applyScheduledDeliveryMode(task.prompt, mode)),
    });
    setPending(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not update scheduled task"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <ScheduledDeliveryModePicker
      value={pending ?? saved}
      onChange={(mode) => void save(mode)}
      disabled={!canOperate || pending !== null}
      taskTitle={task.title}
    />
  );
}

/** The Delivery field of the task form: the picker and what the chosen mode does. */
export function ScheduledDeliveryField(props: {
  value: ScheduledDeliveryMode | null;
  onChange: (mode: ScheduledDeliveryMode) => void;
}) {
  const gt = useGT();
  const help = useScheduledDeliveryHelp(props.value);
  return (
    <div className="space-y-1.5">
      <Label render={<div />}>{gt("Delivery")}</Label>
      <ScheduledDeliveryModePicker value={props.value} onChange={props.onChange} />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}
