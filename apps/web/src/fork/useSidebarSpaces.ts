import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveListedAncestorThreadRef } from "@t3tools/client-runtime/state/threads";
import type {
  ContextMenuItem,
  ContextMenuSource,
  LocalApi,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  completeSidebarRouteReveal,
  type SidebarRouteReveal,
} from "~/components/sidebar/routeReveal";
import { contextMenuSourceOf } from "~/contextMenuSource";
import { useNowMinute } from "~/hooks/useNowMinute";
import { readLocalApi } from "~/localApi";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useQuietThreadShells } from "~/state/entities";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { useUiStateStore } from "~/uiStateStore";

import {
  addForkSpace,
  readForkSettings,
  updateForkSettings,
  useForkSettings,
} from "./forkSettings";
import {
  resolveSpaceNewThreadProjectRef,
  setActiveSpace,
  setGridThread,
  type SidebarSpacesState,
} from "./spaces.logic";
import { buildSpacesView, type SpacesView } from "./spacesView.logic";
import {
  withThreadPlacementItem,
  type ThreadPlacementMenuInput,
  type ThreadPlacementMenuId,
} from "./threadPlacementMenu";

export type SpacesThread = EnvironmentThreadShell;
export type SpacesGroup = SidebarProjectSnapshot;
export type ForkSpacesView = SpacesView<SpacesThread, SpacesGroup>;

const GRID_MENU_ID = "fork-space-grid";
const PROJECT_FILTER_MENU_ID = "filter-by-project";

/** The thread menu's Pin to top grid entry, which the fork handles itself. */
export function isSpaceGridMenuId(value: string): value is typeof GRID_MENU_ID {
  return value === GRID_MENU_ID;
}

// The route each sidebar last followed. Keyed by the reveal AppSidebarLayout owns, so a Settings
// remount does not read as a new route and pull the sidebar back to the open thread's Space.
const followedRouteKeys = new WeakMap<SidebarRouteReveal, string>();

export interface ForkSidebarSpaces {
  readonly enabled: boolean;
  /** The shown Space's project keys, for the sidebar's project scope; null when Spaces are off. */
  readonly scopeKeys: ReadonlyArray<string> | null;
  /** The shown Space's grid, which the list leaves out. */
  readonly gridThreadKeys: ReadonlySet<string>;
  readonly view: ForkSpacesView | null;
  readonly routeThreadKey: string | null;
  readonly state: SidebarSpacesState;
  readonly save: (next: SidebarSpacesState) => void;
  readonly switchTo: (id: string) => void;
  readonly addSpace: () => void;
  readonly toggleGrid: (threadKey: string) => void;
  readonly editorOpen: boolean;
  readonly setEditorOpen: (open: boolean) => void;
  /**
   * The thread menu, with Move to main sidebar / Bot / Background and Pin to top grid added and
   * the project filter left out when Spaces are on.
   */
  readonly threadMenu: (
    api: LocalApi,
    threadKey: string,
  ) => {
    readonly show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position: { x: number; y: number },
      source: ContextMenuSource,
      placement: ThreadPlacementMenuInput,
    ) => Promise<T | typeof GRID_MENU_ID | ThreadPlacementMenuId | null>;
  };
  /** Starts the toolbar's new thread in the Space's projects; false leaves it to upstream. */
  readonly newThread: (input: {
    readonly event: ReactMouseEvent | undefined;
    readonly viewed: Pick<ScopedProjectRef, "environmentId" | "projectId"> | null | undefined;
    readonly onProjectRef: (ref: ScopedProjectRef) => void;
    readonly onGroup: (group: SpacesGroup) => void;
  }) => boolean;
}

/** The sidebar the Space tint paints behind, which the swipe listens on. */
export const SPACE_FRAME_ATTRIBUTE = "data-fork-space-frame";
const spaceFrame = () =>
  document.querySelector(`[${SPACE_FRAME_ATTRIBUTE}]`)?.parentElement ?? null;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slides the Space's header, grid and list in from the side it came from after commit. */
function playSpaceSlide(frame: HTMLElement | null, direction: -1 | 1): void {
  if (frame === null || prefersReducedMotion()) return;
  for (const element of frame.querySelectorAll<HTMLElement>("[data-fork-space-slide]")) {
    for (const animation of element.getAnimations()) animation.cancel();
    element.style.transition = "";
    element.style.transform = "";
    element.animate(
      [
        { transform: `translateX(${direction * 22}px)`, opacity: 0.45 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
}

export function useSidebarSpaces(input: {
  readonly groups: ReadonlyArray<SpacesGroup>;
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly routeDraftProject: Pick<ScopedProjectRef, "environmentId" | "projectId"> | null;
  readonly routeReveal: SidebarRouteReveal;
}): ForkSidebarSpaces {
  const gt = useGT();
  const settings = useForkSettings();
  const threads = useQuietThreadShells();
  // `YYYY-MM-DDTHH:mm` in UTC; badges only need snooze wakes to the minute.
  const nowMinute = useNowMinute();
  const localLastVisitedAt = useUiStateStore((store) => store.threadLastVisitedAtById);
  const clearSelection = useThreadSelectionStore((store) => store.clearSelection);
  const [editorOpen, setEditorOpen] = useState(false);
  const pendingSlideRef = useRef<{ readonly targetId: string; readonly direction: -1 | 1 } | null>(
    null,
  );
  const { routeReveal } = input;
  const enabled = settings.spacesEnabled;
  const state: SidebarSpacesState = {
    spaces: settings.spaces,
    defaultSpaceId: settings.defaultSpaceId,
    activeSpaceId: settings.activeSpaceId,
  };
  const routeThreadKey =
    input.routeThreadRef === null
      ? null
      : scopedThreadKey(resolveListedAncestorThreadRef(input.routeThreadRef, threads));
  const view = enabled
    ? buildSpacesView({
        state,
        groups: input.groups,
        threads,
        routeThreadKey,
        routeChanged:
          routeThreadKey !== null && followedRouteKeys.get(routeReveal) !== routeThreadKey,
        routeDraftProject: input.routeDraftProject,
        now: `${nowMinute}:00.000Z`,
        localLastVisitedAt,
        placementOverrides: settings.threadPlacementOverrides,
      })
    : null;
  const routeSpaceId = view?.routeSpaceId ?? null;
  const routeOwnerKnown = view?.routeOwnerKnown ?? false;
  const routeInGrid =
    routeThreadKey !== null && (view?.gridThreadKeys.has(routeThreadKey) ?? false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows a route that opened a thread in another Space into this Mac's stored Space, once per route, and settles the reveal of a thread the grid shows
  useEffect(() => {
    if (!enabled || routeThreadKey === null) return;
    if (routeInGrid) completeSidebarRouteReveal(routeReveal);
    // A thread whose project has not loaded yet is followed once it has.
    if (!routeOwnerKnown) return;
    followedRouteKeys.set(routeReveal, routeThreadKey);
    if (routeSpaceId !== null) {
      const next = setActiveSpace(readSpacesState(), routeSpaceId);
      updateForkSettings({
        spaces: next.spaces,
        defaultSpaceId: next.defaultSpaceId,
        activeSpaceId: next.activeSpaceId,
      });
    }
  }, [enabled, routeInGrid, routeOwnerKnown, routeReveal, routeSpaceId, routeThreadKey]);

  const save = (next: SidebarSpacesState) =>
    updateForkSettings({
      spaces: next.spaces,
      defaultSpaceId: next.defaultSpaceId,
      activeSpaceId: next.activeSpaceId,
    });
  const shownSpace = view?.shownSpace ?? null;
  const shownSpaceId = shownSpace?.id ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates the freshly committed Space DOM and resets scroll after a Space switch
  useLayoutEffect(() => {
    const pending = pendingSlideRef.current;
    if (pending === null || pending.targetId !== shownSpaceId) return;
    pendingSlideRef.current = null;
    const frame = spaceFrame();
    frame?.querySelector("[data-slot=scroll-area-viewport]")?.scrollTo({ top: 0 });
    playSpaceSlide(frame, pending.direction);
  }, [shownSpaceId]);

  const switchTo = (id: string) => {
    if (view === null || shownSpace === null || id === shownSpace.id) return;
    const { spaces } = view.resolved;
    const from = spaces.indexOf(shownSpace);
    const to = spaces.findIndex((space) => space.id === id);
    if (to < 0) return;
    // A Space switch never moves the open chat, and the sidebar must not snap back to it.
    completeSidebarRouteReveal(routeReveal);
    if (routeThreadKey !== null) followedRouteKeys.set(routeReveal, routeThreadKey);
    clearSelection();
    pendingSlideRef.current = { targetId: id, direction: to > from ? 1 : -1 };
    save(setActiveSpace(state, id));
  };
  const addSpace = () => {
    if (view === null) return;
    completeSidebarRouteReveal(routeReveal);
    if (routeThreadKey !== null) followedRouteKeys.set(routeReveal, routeThreadKey);
    clearSelection();
    // Skip the slide when immediately opening the editor so its popover anchors cleanly to •••.
    pendingSlideRef.current = null;
    addForkSpace(gt("New Space"));
    setEditorOpen(true);
  };
  const toggleGrid = (threadKey: string) => {
    if (shownSpace === null) return;
    save(
      setGridThread(
        state,
        shownSpace.id,
        threadKey,
        !shownSpace.gridThreadKeys.includes(threadKey),
      ),
    );
  };

  return {
    enabled,
    scopeKeys:
      view === null || shownSpace === null
        ? null
        : (view.projects.groupsBySpace.get(shownSpace.id) ?? []).map((group) => group.projectKey),
    gridThreadKeys: view?.gridThreadKeys ?? NO_KEYS,
    view,
    routeThreadKey,
    state,
    save,
    switchTo,
    addSpace,
    toggleGrid,
    editorOpen: enabled && editorOpen,
    setEditorOpen,
    threadMenu: (api, threadKey) => ({
      show: (baseItems, position, source, placement) => {
        const items = withThreadPlacementItem(baseItems, placement, {
          toMain: gt("Move to main sidebar"),
          toBackground: gt("Move to Bot / Background"),
        });
        if (shownSpace === null) return api.contextMenu.show(items, position, source);
        const inGrid = shownSpace.gridThreadKeys.includes(threadKey);
        return api.contextMenu.show<(typeof items)[number]["id"] | typeof GRID_MENU_ID>(
          [
            ...items.filter((item) => item.id !== PROJECT_FILTER_MENU_ID),
            {
              id: GRID_MENU_ID,
              label: inGrid ? gt("Remove from top grid") : gt("Pin to top grid"),
              icon: inGrid ? "pin-off" : "pin",
              separatorBefore: true,
            },
          ],
          position,
          source,
        );
      },
    }),
    newThread: ({ event, viewed, onProjectRef, onGroup }) => {
      if (view === null || shownSpace === null || event?.shiftKey) return false;
      const groups = view.projects.groupsBySpace.get(shownSpace.id) ?? [];
      const ref = resolveSpaceNewThreadProjectRef(groups, viewed);
      if (ref !== null) {
        onProjectRef(ref);
        return true;
      }
      const api = readLocalApi();
      if (groups.length < 2 || !api) return false;
      const bounds = event?.currentTarget.getBoundingClientRect();
      void (async () => {
        let clicked: string | null;
        try {
          clicked = await api.contextMenu.show(
            [
              {
                id: "header",
                label: gt("New thread in {space}", { space: shownSpace.name }),
                header: true,
              },
              ...groups.map((group) => ({ id: group.projectKey, label: group.displayName })),
            ],
            bounds === undefined ? undefined : { x: bounds.left, y: bounds.bottom + 4 },
            event === undefined ? "keyboard" : contextMenuSourceOf(event),
          );
        } catch {
          return;
        }
        const group = groups.find((candidate) => candidate.projectKey === clicked);
        if (group !== undefined) onGroup(group);
      })();
      return true;
    },
  };
}

const NO_KEYS: ReadonlySet<string> = new Set();

function readSpacesState(): SidebarSpacesState {
  const { spaces, defaultSpaceId, activeSpaceId } = readForkSettings();
  return { spaces, defaultSpaceId, activeSpaceId };
}
