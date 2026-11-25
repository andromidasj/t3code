import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { LayoutDashboardIcon } from "lucide-react";

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useVisibleThreadShells } from "~/state/entities";

import { countNeedsMe } from "./board.logic";
import { boardShortcutLabel } from "./boardShortcut";
import { useForkSettings } from "./forkSettings";

/** The sidebar footer's Board button, with the number of threads waiting on the user. */
export function SidebarBoardButton() {
  const { boardEnabled } = useForkSettings();
  if (!boardEnabled) return null;
  return <SidebarBoardButtonInner />;
}

function SidebarBoardButtonInner() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const needsMeCount = countNeedsMe(useVisibleThreadShells());
  const label =
    needsMeCount > 0
      ? gt("Board, {count} need you", { count: needsMeCount })
      : gt("Board", { $context: "sidebar link to the board of active threads" });
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              className="relative"
              size="icon"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/board" });
              }}
            >
              <LayoutDashboardIcon />
              {needsMeCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-black text-3xs font-semibold leading-none tabular-nums"
                >
                  {needsMeCount > 9 ? "9+" : needsMeCount}
                </span>
              ) : null}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{`${label} (${boardShortcutLabel()})`}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
