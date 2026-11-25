import { isMacPlatform } from "@t3tools/shared/keybindingMatching";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useLayoutEffect } from "react";

import { BOARD_PATH, startBoardReturnTracking, useLeaveBoard } from "./boardNavigation";
import { isBoardShortcut } from "./boardShortcut";
import { readForkSettings } from "./forkSettings";

// Once per app session: leaving the Board and coming back to "/" must not redirect again.
let launchHandled = false;

/**
 * Fork behavior that needs the router: the Board shortcut, opening the Board on launch, and
 * remembering where the Board's Back button returns to.
 */
export function ForkBootstrap() {
  const navigate = useNavigate();
  const router = useRouter();
  const leaveBoard = useLeaveBoard();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to router navigation to remember the Board's return page
  useEffect(() => startBoardReturnTracking(router), [router]);

  // A layout effect, so it runs before the index page's own effect starts a draft thread there.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- redirects the first landing on "/" to the Board when this Mac asks for it
  useLayoutEffect(() => {
    if (launchHandled) return;
    launchHandled = true;
    const settings = readForkSettings();
    if (!settings.boardEnabled || !settings.openBoardOnLaunch) return;
    if (router.state.location.pathname !== "/") return;
    void navigate({ to: BOARD_PATH, replace: true });
  }, [navigate, router]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    if (!isBoardShortcut(event, isMacPlatform(navigator.platform))) return;
    if (!readForkSettings().boardEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (router.state.location.pathname === BOARD_PATH) void leaveBoard();
    else void navigate({ to: BOARD_PATH });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the window Board shortcut
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
