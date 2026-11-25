import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import { isAppModalPage } from "~/components/sidebar/mainAppLocation";
import { withoutAssistantCitationHash } from "~/lib/assistantCitationNavigation";

export const BOARD_PATH = "/board";

// The page the Board's Back button and its shortcut return to.
let boardReturnHref: string | null = null;

/** Remembers the last page outside the Board and Settings or Usage, for leaving the Board. */
export function startBoardReturnTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, href } = router.state.location;
    if (pathname === BOARD_PATH || isAppModalPage(pathname)) return;
    boardReturnHref = withoutAssistantCitationHash(href);
  };
  record();
  return router.subscribe("onResolved", record);
}

export function useLeaveBoard() {
  const navigate = useNavigate();
  return () => navigate({ href: boardReturnHref ?? "/" });
}
