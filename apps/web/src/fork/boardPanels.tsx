import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import SideThreadPane from "~/components/chat/SideThreadPane";
import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";

// The board's panel has no thread of its own; side panes need a host ref in the shown
// thread's environment, so each environment gets this sentinel thread id.
const BOARD_PANEL_THREAD_ID = ThreadId.make("fork-board-panel");

export function IconAction(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The resizable panel beside the board, with a header row of its own. */
export function BoardPanelFrame(props: { label: string; header: ReactNode; children: ReactNode }) {
  return (
    <PreviewPanelShell
      mode="inline"
      widthStorageKey="t3code:fork:board-panel-width"
      defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
      workspaceLabel={props.label}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1.5 border-b border-border pr-2 pl-3",
          isElectron && "drag-region",
        )}
      >
        {props.header}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </PreviewPanelShell>
  );
}

/** A thread drawn by the same pane side chats use, hosted by the board. */
export function BoardSideThread(props: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { threadRef } = props;
  const [hostRef] = useState(() => scopeThreadRef(threadRef.environmentId, BOARD_PANEL_THREAD_ID));
  // The board has no diff panel or terminal, so those open the thread full screen.
  const parentPanel: SideChatParentPanel = {
    hostRef,
    openToolDiff: props.onOpenFull,
    runShellCommand: props.onOpenFull,
  };
  const [surface] = useState(() => ({
    id: `thread:${threadRef.threadId}` as const,
    kind: "thread" as const,
    threadId: threadRef.threadId,
  }));
  return (
    <SideThreadPane
      parentRef={hostRef}
      surface={surface}
      parentPanel={parentPanel}
      onClose={props.onClose}
    />
  );
}

/** The selected live thread beside the board. */
export function BoardThreadPanel(props: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const gt = useGT();
  const shell = useThreadShell(props.threadRef);
  return (
    <BoardPanelFrame
      label={gt("Board thread panel")}
      header={
        <>
          <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
            {shell?.title ?? gt("Thread")}
          </h2>
          <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
            <IconAction label={gt("Open full thread")} onClick={props.onOpenFull}>
              <ArrowUpRightIcon />
            </IconAction>
            <IconAction label={gt("Close thread panel")} onClick={props.onClose}>
              <XIcon />
            </IconAction>
          </div>
        </>
      }
    >
      <BoardSideThread
        key={`${props.threadRef.environmentId}/${props.threadRef.threadId}`}
        threadRef={props.threadRef}
        onClose={props.onClose}
        onOpenFull={props.onOpenFull}
      />
    </BoardPanelFrame>
  );
}
