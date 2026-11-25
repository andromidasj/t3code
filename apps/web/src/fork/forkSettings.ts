import { useSyncExternalStore } from "react";

/**
 * Fork-only preferences. They stay in this Mac's localStorage, never in server settings, so one
 * build can serve several Macs that each point at their own board.
 */
export interface ForkSettings {
  readonly boardEnabled: boolean;
  /** Raw text as typed; read it through normalizeBoardUrl before using it. */
  readonly boardUrl: string;
  readonly openBoardOnLaunch: boolean;
}

export const FORK_SETTINGS_STORAGE_KEY = "t3code:fork:settings:v1";

export const DEFAULT_FORK_SETTINGS: ForkSettings = {
  boardEnabled: true,
  boardUrl: "",
  openBoardOnLaunch: false,
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
  return {
    boardEnabled:
      typeof record.boardEnabled === "boolean"
        ? record.boardEnabled
        : DEFAULT_FORK_SETTINGS.boardEnabled,
    boardUrl:
      typeof record.boardUrl === "string" ? record.boardUrl : DEFAULT_FORK_SETTINGS.boardUrl,
    openBoardOnLaunch:
      typeof record.openBoardOnLaunch === "boolean"
        ? record.openBoardOnLaunch
        : DEFAULT_FORK_SETTINGS.openBoardOnLaunch,
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
  const next = { ...readForkSettings(storage), ...patch };
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
