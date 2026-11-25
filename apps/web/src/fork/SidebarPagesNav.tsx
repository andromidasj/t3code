import { useLocation, useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";

import { readIssueListPreferences } from "~/components/issue/issueListPreferences";
import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";
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
import { boardShortcutLabel } from "./boardShortcut";
import { useForkSettings, type SidebarPageId } from "./forkSettings";
import {
  SIDEBAR_PAGE_ICONS,
  SIDEBAR_PAGE_PATHS,
  useSidebarPageLabels,
  useSidebarPageSupport,
} from "./sidebarPages";

/** The workspace pages at the top of the sidebar, in the order and with the pages this Mac chose. */
export function SidebarPagesNav() {
  const { sidebarPages } = useForkSettings();
  const support = useSidebarPageSupport();
  const shown = sidebarPages.filter((page) => page.visible && support[page.id]);
  if (shown.length === 0) return null;
  return (
    <SidebarMenu className="mt-1">
      {shown.map((page) =>
        page.id === "board" ? (
          <SidebarBoardRow key={page.id} />
        ) : (
          <SidebarPageRow key={page.id} id={page.id} />
        ),
      )}
    </SidebarMenu>
  );
}

function useOpenSidebarPage() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return (id: SidebarPageId) => {
    if (isMobile) setOpenMobile(false);
    if (id === "pull-requests") {
      void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
    } else if (id === "issues") {
      void navigate({ to: "/issues", search: readIssueListPreferences() });
    } else {
      void navigate({ to: SIDEBAR_PAGE_PATHS.board });
    }
  };
}

function SidebarPageRow(props: { id: Exclude<SidebarPageId, "board"> }) {
  const label = useSidebarPageLabels()[props.id];
  const Icon = SIDEBAR_PAGE_ICONS[props.id];
  const openPage = useOpenSidebarPage();
  const active = useLocation({
    select: (location) => location.pathname === SIDEBAR_PAGE_PATHS[props.id],
  });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={() => openPage(props.id)}>
        <Icon />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The Board's row, with how many things wait on the user. */
function SidebarBoardRow() {
  const gt = useGT();
  const openPage = useOpenSidebarPage();
  const active = useLocation({
    select: (location) => location.pathname === SIDEBAR_PAGE_PATHS.board,
  });
  const { boardUrl } = useForkSettings();
  const board = useBoardData(boardUrl);
  const liveCount = countNeedsMe(useVisibleThreadShells());
  const count = liveCount + countReadyBoardItems(board.data);
  const name = useSidebarPageLabels().board;
  const Icon = SIDEBAR_PAGE_ICONS.board;
  const label = count > 0 ? gt("Board, {count} need you", { count }) : name;
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              isActive={active}
              aria-label={label}
              onClick={() => openPage("board")}
            >
              <Icon />
              <span className="min-w-0 flex-1 truncate">{name}</span>
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
  );
}
