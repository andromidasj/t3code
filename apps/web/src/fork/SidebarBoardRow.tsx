import { useLocation, useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { LayoutGridIcon } from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useVisibleThreadShells } from "~/state/entities";

import { countNeedsMe, countReadyBoardItems } from "./board.logic";
import { useBoardData } from "./boardData";
import { BOARD_PATH } from "./boardNavigation";
import { boardShortcutLabel } from "./boardShortcut";
import { useForkSettings } from "./forkSettings";

/** The Board's row at the top of the sidebar, with how many things wait on the user. */
export function SidebarBoardRow() {
  const { boardEnabled } = useForkSettings();
  if (!boardEnabled) return null;
  return <SidebarBoardRowInner />;
}

function SidebarBoardRowInner() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = useLocation({ select: (location) => location.pathname === BOARD_PATH });
  const { boardUrl } = useForkSettings();
  const board = useBoardData(boardUrl);
  const liveCount = countNeedsMe(useVisibleThreadShells());
  const count = liveCount + countReadyBoardItems(board.data);
  const label =
    count > 0
      ? gt("Board, {count} need you", { count })
      : gt("Board", { $context: "sidebar link to the board of active threads" });
  return (
    <SidebarMenu className="mt-1">
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                isActive={active}
                aria-label={label}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                  void navigate({ to: BOARD_PATH });
                }}
              >
                <LayoutGridIcon />
                <span className="min-w-0 flex-1 truncate">
                  {gt("Board", { $context: "sidebar link to the board of active threads" })}
                </span>
                {count > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 font-semibold text-2xs tabular-nums leading-none",
                      liveCount > 0
                        ? "bg-warning/16 text-warning-foreground ring-1 ring-warning/40"
                        : "bg-sidebar-control-surface text-sidebar-muted-foreground ring-1 ring-sidebar-border",
                    )}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </SidebarMenuButton>
            }
          />
          <TooltipPopup side="right">{`${label} (${boardShortcutLabel()})`}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
