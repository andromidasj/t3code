import { useSyncExternalStore } from "react";

import { addNewSpace, normalizeSidebarSpaces, type SidebarSpace } from "./spaces.logic";

/**
 * Fork-only preferences. They stay in this Mac's localStorage, never in server settings, so one
 * build can serve several Macs that each point at their own board.
 */
export type SidebarPageId = "board" | "pull-requests" | "issues";

export interface SidebarPage {
  readonly id: SidebarPageId;
  readonly visible: boolean;
}

const SIDEBAR_PAGE_IDS: ReadonlyArray<SidebarPageId> = ["board", "pull-requests", "issues"];

/** A saved set of projects for the sidebar's project scope, by `environmentId:projectId` key. */
export interface SidebarFilterPreset {
  readonly id: string;
  readonly name: string;
  readonly projectKeys: ReadonlyArray<string>;
}

/** Where the user put one thread by hand: the main list, or the Bot / Background drawer. */
export type ThreadPlacement = "main" | "background";

/** Placement exceptions by `environmentId:threadId` key; absent threads follow the automatic rule. */
export type ThreadPlacementOverrides = Readonly<Record<string, ThreadPlacement>>;

export interface ForkSettings {
  /** Mirrors the "board" entry of sidebarPages; it also gates the Board's shortcut and launch. */
  readonly boardEnabled: boolean;
  /** Raw text as typed; read it through normalizeBoardSource or normalizeBoardUrl. */
  readonly boardUrl: string;
  readonly openBoardOnLaunch: boolean;
  /** The pages at the top of the sidebar, in order. Pages a server does not support stay hidden. */
  readonly sidebarPages: ReadonlyArray<SidebarPage>;
  /** Fold routine agent-to-agent and automation turns in a thread into one strip. */
  readonly collapseAgentTurns: boolean;
  /** The sidebar's Bot / Background drawer, saved project views and the running-threads pill. */
  readonly sidebarHierarchyEnabled: boolean;
  readonly sidebarFilterPresets: ReadonlyArray<SidebarFilterPreset>;
  /** Threads the user moved between the main list and Bot / Background by hand. */
  readonly threadPlacementOverrides: ThreadPlacementOverrides;
  /** Pinned projects as an avatar grid at the top of the sidebar. */
  readonly botDockEnabled: boolean;
  /** Arc-style Spaces: the sidebar shows one set of projects at a time, with a pinned grid each. */
  readonly spacesEnabled: boolean;
  /** Empty until the first change; the sidebar then shows one Home Space with every project. */
  readonly spaces: ReadonlyArray<SidebarSpace>;
  readonly defaultSpaceId: string | null;
  readonly activeSpaceId: string | null;
  /** Projects (bots) listed first in the composer's `@` menu; a pick inserts `@Name `. */
  readonly composerProjectMentions: boolean;
  /** Leave workspace files and folders out of the composer's `@` menu, and skip their search. */
  readonly hideComposerWorkspaceFiles: boolean;
  /** Two-finger sideways swipes no longer go back or forward (they still switch Spaces). */
  readonly disableHistorySwipeNavigation: boolean;
}

export const FORK_SETTINGS_STORAGE_KEY = "t3code:fork:settings:v1";

export const DEFAULT_FORK_SETTINGS: ForkSettings = {
  boardEnabled: true,
  boardUrl: "",
  openBoardOnLaunch: false,
  sidebarPages: SIDEBAR_PAGE_IDS.map((id) => ({ id, visible: true })),
  collapseAgentTurns: true,
  sidebarHierarchyEnabled: true,
  sidebarFilterPresets: [],
  threadPlacementOverrides: {},
  botDockEnabled: true,
  spacesEnabled: true,
  spaces: [],
  defaultSpaceId: null,
  activeSpaceId: null,
  composerProjectMentions: true,
  hideComposerWorkspaceFiles: true,
  disableHistorySwipeNavigation: true,
};

type ForkSettingsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ForkSettingsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The trimmed URL when it is an http(s) URL, else null. */
export function normalizeBoardUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return trimmed;
}

/**
 * The trimmed board source when the desktop bridge can read it: an http(s) or file:// URL, or an
 * absolute or ~/ path to board.py's folder, data.json or index.html. Else null.
 */
export function normalizeBoardSource(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("/") || trimmed === "~" || trimmed.startsWith("~/")) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol === "file:") return url.pathname.length > 1 ? trimmed : null;
  return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
}

const isSidebarPageId = (value: unknown): value is SidebarPageId =>
  SIDEBAR_PAGE_IDS.includes(value as SidebarPageId);

/**
 * Stored pages in their saved order, without unknown or repeated ids, followed by any page this
 * build added since. Settings saved before the list existed keep the Board where boardEnabled put it.
 */
export function normalizeSidebarPages(
  raw: unknown,
  boardEnabled: boolean,
): ReadonlyArray<SidebarPage> {
  const pages: SidebarPage[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, visible } = entry as Record<string, unknown>;
    if (!isSidebarPageId(id) || pages.some((page) => page.id === id)) continue;
    pages.push({ id, visible: typeof visible === "boolean" ? visible : true });
  }
  for (const id of SIDEBAR_PAGE_IDS) {
    if (!pages.some((page) => page.id === id)) {
      pages.push({ id, visible: id === "board" ? boardEnabled : true });
    }
  }
  return pages;
}

export function isSidebarPageVisible(
  pages: ReadonlyArray<SidebarPage>,
  id: SidebarPageId,
): boolean {
  return pages.find((page) => page.id === id)?.visible ?? true;
}

export function setSidebarPageVisible(
  pages: ReadonlyArray<SidebarPage>,
  id: SidebarPageId,
  visible: boolean,
): ReadonlyArray<SidebarPage> {
  return pages.map((page) => (page.id === id ? { id, visible } : page));
}

/** The pages with `id` moved one place up (-1) or down (1); unchanged at either end. */
export function moveSidebarPage(
  pages: ReadonlyArray<SidebarPage>,
  id: SidebarPageId,
  direction: -1 | 1,
): ReadonlyArray<SidebarPage> {
  const from = pages.findIndex((page) => page.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= pages.length) return pages;
  const next = [...pages];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Stored presets that have an id, a name and at least one project key; repeated ids dropped. */
export function normalizeSidebarFilterPresets(raw: unknown): ReadonlyArray<SidebarFilterPreset> {
  const presets: SidebarFilterPreset[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, projectKeys } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
    if (presets.some((preset) => preset.id === id)) continue;
    const keys = Array.isArray(projectKeys)
      ? [...new Set(projectKeys.filter((key): key is string => typeof key === "string"))]
      : [];
    if (keys.length === 0) continue;
    presets.push({ id, name, projectKeys: keys });
  }
  return presets;
}

/** Stored overrides whose values are `"main"` or `"background"`; anything else is dropped. */
export function normalizeThreadPlacementOverrides(raw: unknown): ThreadPlacementOverrides {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const overrides: Record<string, ThreadPlacement> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "" && (value === "main" || value === "background")) overrides[key] = value;
  }
  return overrides;
}

function parseForkSettings(raw: string | null): ForkSettings {
  if (raw === null) return DEFAULT_FORK_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FORK_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_FORK_SETTINGS;
  const record = parsed as Record<string, unknown>;
  const sidebarPages = normalizeSidebarPages(
    record.sidebarPages,
    typeof record.boardEnabled === "boolean"
      ? record.boardEnabled
      : DEFAULT_FORK_SETTINGS.boardEnabled,
  );
  return {
    boardEnabled: isSidebarPageVisible(sidebarPages, "board"),
    boardUrl:
      typeof record.boardUrl === "string" ? record.boardUrl : DEFAULT_FORK_SETTINGS.boardUrl,
    openBoardOnLaunch:
      typeof record.openBoardOnLaunch === "boolean"
        ? record.openBoardOnLaunch
        : DEFAULT_FORK_SETTINGS.openBoardOnLaunch,
    sidebarPages,
    collapseAgentTurns:
      typeof record.collapseAgentTurns === "boolean"
        ? record.collapseAgentTurns
        : DEFAULT_FORK_SETTINGS.collapseAgentTurns,
    sidebarHierarchyEnabled:
      typeof record.sidebarHierarchyEnabled === "boolean"
        ? record.sidebarHierarchyEnabled
        : DEFAULT_FORK_SETTINGS.sidebarHierarchyEnabled,
    sidebarFilterPresets: normalizeSidebarFilterPresets(record.sidebarFilterPresets),
    threadPlacementOverrides: normalizeThreadPlacementOverrides(record.threadPlacementOverrides),
    botDockEnabled:
      typeof record.botDockEnabled === "boolean"
        ? record.botDockEnabled
        : DEFAULT_FORK_SETTINGS.botDockEnabled,
    spacesEnabled:
      typeof record.spacesEnabled === "boolean"
        ? record.spacesEnabled
        : DEFAULT_FORK_SETTINGS.spacesEnabled,
    spaces: normalizeSidebarSpaces(record.spaces),
    defaultSpaceId: typeof record.defaultSpaceId === "string" ? record.defaultSpaceId : null,
    activeSpaceId: typeof record.activeSpaceId === "string" ? record.activeSpaceId : null,
    composerProjectMentions:
      typeof record.composerProjectMentions === "boolean"
        ? record.composerProjectMentions
        : DEFAULT_FORK_SETTINGS.composerProjectMentions,
    hideComposerWorkspaceFiles:
      typeof record.hideComposerWorkspaceFiles === "boolean"
        ? record.hideComposerWorkspaceFiles
        : DEFAULT_FORK_SETTINGS.hideComposerWorkspaceFiles,
    disableHistorySwipeNavigation:
      typeof record.disableHistorySwipeNavigation === "boolean"
        ? record.disableHistorySwipeNavigation
        : DEFAULT_FORK_SETTINGS.disableHistorySwipeNavigation,
  };
}

function readRaw(storage: ForkSettingsStorage | null): string | null {
  try {
    return storage?.getItem(FORK_SETTINGS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function readForkSettings(
  storage: ForkSettingsStorage | null = defaultStorage(),
): ForkSettings {
  return parseForkSettings(readRaw(storage));
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSettings: ForkSettings = DEFAULT_FORK_SETTINGS;

export function updateForkSettings(
  patch: Partial<ForkSettings>,
  storage: ForkSettingsStorage | null = defaultStorage(),
): ForkSettings {
  const merged = { ...readForkSettings(storage), ...patch };
  // boardEnabled and the Board's sidebar entry are one setting; whichever the patch names wins.
  const next: ForkSettings =
    patch.sidebarPages !== undefined
      ? { ...merged, boardEnabled: isSidebarPageVisible(merged.sidebarPages, "board") }
      : patch.boardEnabled !== undefined
        ? {
            ...merged,
            sidebarPages: setSidebarPageVisible(merged.sidebarPages, "board", patch.boardEnabled),
          }
        : merged;
  try {
    storage?.setItem(FORK_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked or full storage: keep the app working without saving.
  }
  for (const listener of listeners) listener();
  return next;
}

// One person adds Spaces by hand on one Mac, so the time is unique enough.
const newSpaceId = () => `space-${Date.now().toString(36)}`;

/** Adds a Space to this Mac's saved Spaces and makes it the shown one; returns its id. */
export function addForkSpace(
  name: string,
  storage: ForkSettingsStorage | null = defaultStorage(),
): string {
  const { spaces, defaultSpaceId, activeSpaceId } = readForkSettings(storage);
  const id = newSpaceId();
  const next = addNewSpace({ spaces, defaultSpaceId, activeSpaceId }, { id, name });
  updateForkSettings(
    {
      spaces: next.spaces,
      defaultSpaceId: next.defaultSpaceId,
      activeSpaceId: next.activeSpaceId,
    },
    storage,
  );
  return id;
}

// useSyncExternalStore needs the same object back until the stored text changes.
function getSnapshot(): ForkSettings {
  const raw = readRaw(defaultStorage());
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSettings = parseForkSettings(raw);
  }
  return cachedSettings;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another window of the app writing the same key.
  const onStorage = (event: StorageEvent) => {
    if (event.key === FORK_SETTINGS_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useForkSettings(): ForkSettings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_FORK_SETTINGS);
}
