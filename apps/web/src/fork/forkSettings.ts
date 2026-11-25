import { useSyncExternalStore } from "react";

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

export interface ForkSettings {
  /** Mirrors the "board" entry of sidebarPages; it also gates the Board's shortcut and launch. */
  readonly boardEnabled: boolean;
  /** Raw text as typed; read it through normalizeBoardSource or normalizeBoardUrl. */
  readonly boardUrl: string;
  readonly openBoardOnLaunch: boolean;
  /** The pages at the top of the sidebar, in order. Pages a server does not support stay hidden. */
  readonly sidebarPages: ReadonlyArray<SidebarPage>;
}

export const FORK_SETTINGS_STORAGE_KEY = "t3code:fork:settings:v1";

export const DEFAULT_FORK_SETTINGS: ForkSettings = {
  boardEnabled: true,
  boardUrl: "",
  openBoardOnLaunch: false,
  sidebarPages: SIDEBAR_PAGE_IDS.map((id) => ({ id, visible: true })),
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
