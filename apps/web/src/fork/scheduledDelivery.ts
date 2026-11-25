import type { ScheduledTask, ScheduledTaskUpsertInput } from "@t3tools/contracts";

/**
 * How loud a scheduled task is. The server has no field for it, so the mode rides on the task's
 * prompt as a trailing `[t3-delivery: <mode>]` line: the agent reads it as an instruction, and
 * this client reads it to decide whether a finished run notifies. Unmarked tasks behave as
 * upstream does.
 */
export type ScheduledDeliveryMode = "silent" | "updates-only" | "always";

export const SCHEDULED_DELIVERY_MODES: ReadonlyArray<ScheduledDeliveryMode> = [
  "silent",
  "updates-only",
  "always",
];

const DIRECTIVE_LINE = /^[ \t]*\[t3-delivery:[ \t]*(silent|updates-only|always)[ \t]*\][ \t]*$/i;

function isMode(value: string): value is ScheduledDeliveryMode {
  return (SCHEDULED_DELIVERY_MODES as ReadonlyArray<string>).includes(value);
}

/** The mode the prompt's last marker line names, or null when it has none. */
export function parseScheduledDeliveryMode(prompt: string): ScheduledDeliveryMode | null {
  let mode: ScheduledDeliveryMode | null = null;
  for (const line of prompt.split(/\r?\n/)) {
    const match = DIRECTIVE_LINE.exec(line);
    const value = match?.[1]?.toLowerCase();
    if (value !== undefined && isMode(value)) mode = value;
  }
  return mode;
}

/** The prompt without its marker lines, and without blank lines they leave at the end. */
export function stripScheduledDeliveryDirective(prompt: string): string {
  if (!/\[t3-delivery:/i.test(prompt)) return prompt;
  const lines = prompt.split(/\r?\n/);
  const kept = lines.filter((line) => !DIRECTIVE_LINE.test(line));
  if (kept.length === lines.length) return prompt;
  while (kept.length > 0 && kept.at(-1)!.trim() === "") kept.pop();
  return kept.join("\n");
}

/** The prompt carrying exactly one marker for `mode` on its last line, or none for null. */
export function applyScheduledDeliveryMode(
  prompt: string,
  mode: ScheduledDeliveryMode | null,
): string {
  const body = stripScheduledDeliveryDirective(prompt).trimEnd();
  if (mode === null) return body;
  return body === "" ? `[t3-delivery: ${mode}]` : `${body}\n\n[t3-delivery: ${mode}]`;
}

/** Whether a mode keeps a finished run's completion from notifying. */
export function quietsCompletion(mode: ScheduledDeliveryMode | null): boolean {
  return mode === "silent" || mode === "updates-only";
}

/**
 * A save of `task` as it stands with only its prompt replaced. Thread binding and mode stay as
 * stored because the input omits them; a webhook's signing secret stays because none is sent.
 */
export function scheduledTaskUpsertWithPrompt(
  task: ScheduledTask,
  prompt: string,
): ScheduledTaskUpsertInput {
  return {
    id: task.id,
    requireExisting: true,
    title: task.title,
    prompt,
    enabled: task.enabled,
    schedule: task.schedule,
    projectId: task.projectId,
    workspaceStrategy: task.workspaceStrategy,
    modelSelection: task.modelSelection,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
    creationSource: task.creationSource,
  };
}

/** A presented message with its delivery marker line removed, for showing a scheduled prompt. */
export function withoutScheduledDeliveryDirective<T extends { readonly text: string }>(
  presentation: T,
): T {
  const text = stripScheduledDeliveryDirective(presentation.text);
  return text === presentation.text ? presentation : { ...presentation, text };
}
