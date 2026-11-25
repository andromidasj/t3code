import { isMacPlatform } from "@t3tools/shared/keybindingMatching";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useLayoutEffect } from "react";

import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";

import { isBoardShortcut } from "./boardShortcut";
import { readForkSettings } from "./forkSettings";

// Once per app session: leaving the Board and coming back to "/" must not redirect again.
let launchHandled = false;

/** Fork behavior that needs the router: the Board shortcut and opening the Board on launch. */
export function ForkBootstrap() {
  const navigate = useNavigate();
  const router = useRouter();
  const navigateToMainApp = useNavigateToMainApp();

  // A layout effect, so it runs before the index page's own effect starts a draft thread there.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- redirects the first landing on "/" to the Board when this Mac asks for it
  useLayoutEffect(() => {
    if (launchHandled) return;
    launchHandled = true;
    const settings = readForkSettings();
    if (!settings.boardEnabled || !settings.openBoardOnLaunch) return;
    if (router.state.location.pathname !== "/") return;
    void navigate({ to: "/board", replace: true });
  }, [navigate, router]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    if (!isBoardShortcut(event, isMacPlatform(navigator.platform))) return;
    if (!readForkSettings().boardEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (router.state.location.pathname === "/board") void navigateToMainApp();
    else void navigate({ to: "/board" });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the window Board shortcut
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
