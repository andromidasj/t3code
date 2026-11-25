import { useGT } from "gt-react";
import { LayoutGridIcon, type LucideIcon } from "lucide-react";

import { IssueGlyph } from "~/components/issue/issuePresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { useIssuesSupported, usePullRequestsSupported } from "~/state/environments";

import type { SidebarPageId } from "./forkSettings";

export const SIDEBAR_PAGE_PATHS: Record<SidebarPageId, string> = {
  board: "/board",
  "pull-requests": "/pull-requests",
  issues: "/issues",
};

export const SIDEBAR_PAGE_ICONS: Record<SidebarPageId, LucideIcon> = {
  board: LayoutGridIcon,
  "pull-requests": PullRequestGlyph.pullRequest,
  issues: IssueGlyph.issue,
};

export function useSidebarPageLabels(): Record<SidebarPageId, string> {
  const gt = useGT();
  return {
    board: gt("Board", { $context: "sidebar link to the board of active threads" }),
    "pull-requests": gt("Pull requests"),
    issues: gt("Issues", { $context: "sidebar link to the list of issues" }),
  };
}

/** Whether a connected server can show the page at all; the Board needs none. */
export function useSidebarPageSupport(): Record<SidebarPageId, boolean> {
  return {
    board: true,
    "pull-requests": usePullRequestsSupported(),
    issues: useIssuesSupported(),
  };
}
