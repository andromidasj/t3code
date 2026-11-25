import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { BotIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { use } from "react";

import { RelativeTime } from "~/components/RelativeTime";
import { useScheduledTaskTitle } from "~/components/chat/TimelineUserMessageRow";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";

import type { AgentTurnFoldRow, AgentTurnSender } from "./agentTurnFolding";

const SHOWN_SENDERS = 2;

/** Routine bot turns folded into one strip; open, it heads the rows it folded. */
export function CollapsedAgentTurnsRow({ row }: { row: AgentTurnFoldRow }) {
  const gt = useGT();
  const ctx = use(TimelineRowCtx);
  const shownSenders = row.senders.slice(0, SHOWN_SENDERS);
  const moreSenders = row.senders.length - shownSenders.length;
  const Chevron = row.expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div data-agent-turn-fold={row.expanded ? "expanded" : "collapsed"}>
      <button
        type="button"
        aria-expanded={row.expanded}
        data-scroll-anchor-ignore
        onClick={() => row.onToggle(row.id)}
        aria-label={
          row.expanded
            ? gt("Collapse bot activity")
            : gt(
                "Show bot activity, {count, plural, one {{count} update} other {{count} updates}}",
                {
                  count: row.turnCount,
                },
              )
        }
        className={cn(
          "flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          row.expanded && "bg-transparent",
        )}
      >
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <BotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {row.expanded ? (
          <span className="shrink-0 font-medium text-foreground/80">
            {gt("Collapse bot activity")}
          </span>
        ) : (
          <span className="shrink-0 font-medium text-foreground/80">
            {gt("Bot activity · {count, plural, one {{count} update} other {{count} updates}}", {
              count: row.turnCount,
            })}
          </span>
        )}
        {shownSenders.length > 0 ? (
          <span className="hidden min-w-0 max-w-1/3 shrink truncate text-muted-foreground sm:inline">
            {shownSenders.map((sender, index) => (
              <span key={sender.key}>
                {index > 0 ? ", " : ""}
                <AgentTurnSenderLabel
                  sender={sender}
                  environmentId={ctx.activeThreadEnvironmentId}
                />
              </span>
            ))}
            {moreSenders > 0 ? ` +${moreSenders}` : ""}
          </span>
        ) : null}
        {!row.expanded && row.preview !== "" ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {row.preview.normalize("NFC")}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <span className="shrink-0 text-muted-foreground/80 tabular-nums">
          <RelativeTime timestamp={row.latestAt} />
        </span>
      </button>
    </div>
  );
}

function AgentTurnSenderLabel(props: { sender: AgentTurnSender; environmentId: EnvironmentId }) {
  return props.sender.kind === "automation" ? (
    <AutomationSenderLabel sender={props.sender} environmentId={props.environmentId} />
  ) : (
    <AgentSenderLabel sender={props.sender} environmentId={props.environmentId} />
  );
}

function AutomationSenderLabel(props: {
  sender: Extract<AgentTurnSender, { kind: "automation" }>;
  environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const title = useScheduledTaskTitle(props.environmentId, props.sender.scheduledTaskId);
  return title ?? gt("Scheduled task");
}

function AgentSenderLabel(props: {
  sender: Extract<AgentTurnSender, { kind: "agent" }>;
  environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const { linkedSender, senderThreadId } = props.sender;
  const ref =
    linkedSender ??
    (senderThreadId === undefined ? null : scopeThreadRef(props.environmentId, senderThreadId));
  const shell = useQuietThreadShell(ref);
  return (
    shell?.title.trim() ||
    linkedSender?.title.trim() ||
    gt("Agent", { $context: "sender of a message from another agent" })
  );
}
