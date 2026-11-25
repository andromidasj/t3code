import { msg } from "gt-react";
import { useSyncExternalStore } from "react";

import { m } from "~/i18n/messages";

import { normalizeBoardSource } from "./forkSettings";

/** One open item from a desk's open/*.md, as bot-desk board.py's page_data writes it. */
export interface BoardItem {
  readonly id: string;
  /** "send" | "decide" | "do", or whatever a desk wrote. */
  readonly type: string;
  readonly ask: string;
  /** "now" | "anytime" | "later", or whatever a desk wrote. */
  readonly when: string;
  readonly unblocks: ReadonlyArray<string>;
  /** Set when the item is not ready yet: the reason. */
  readonly banner: string | null;
  /** The item's file on the machine that built the board. */
  readonly path: string;
  readonly body: string;
  readonly checked: string | null;
  readonly rank: number | null;
  readonly reach: number;
}

export interface BoardWorkRow {
  readonly id: string;
  readonly url: string | null;
  readonly section: string;
  readonly cols: ReadonlyArray<string>;
  readonly cells: ReadonlyArray<string>;
  readonly blockedBy: ReadonlyArray<string>;
  readonly unblocks: ReadonlyArray<string>;
}

export interface BoardTodayEvent {
  readonly t: string;
  readonly text: string;
}

export interface BoardDesk {
  readonly name: string;
  readonly slug: string;
  readonly items: ReadonlyArray<BoardItem>;
  readonly rows: ReadonlyArray<BoardWorkRow>;
  readonly today: ReadonlyArray<BoardTodayEvent>;
  readonly errors: ReadonlyArray<string>;
}

export interface BoardData {
  readonly built: string;
  readonly desks: ReadonlyArray<BoardDesk>;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const textOrNull = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function parseItem(value: unknown): BoardItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  if (id === "") return null;
  return {
    id,
    type: text(value.type),
    ask: text(value.ask, id),
    when: text(value.when, "now") || "now",
    unblocks: texts(value.unblocks),
    banner: textOrNull(value.banner),
    path: text(value.path),
    body: text(value.body),
    checked: textOrNull(value.checked),
    rank: finite(value.rank),
    reach: finite(value.reach) ?? 0,
  };
}

function parseRow(value: unknown): BoardWorkRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  if (id === "") return null;
  return {
    id,
    url: textOrNull(value.url),
    section: text(value.section),
    cols: texts(value.cols),
    cells: texts(value.cells),
    blockedBy: texts(value.blocked_by),
    unblocks: texts(value.unblocks),
  };
}

function parseToday(value: unknown): BoardTodayEvent | null {
  if (!isRecord(value) || typeof value.t !== "string" || typeof value.text !== "string") {
    return null;
  }
  return { t: value.t, text: value.text };
}

const present = <T>(value: T | null): value is T => value !== null;

function parseDesk(value: unknown): BoardDesk | null {
  if (!isRecord(value)) return null;
  const name = text(value.name).trim();
  const slug = text(value.slug).trim() || name;
  if (slug === "") return null;
  const list = (entries: unknown) => (Array.isArray(entries) ? entries : []);
  return {
    name: name || slug,
    slug,
    items: list(value.items).map(parseItem).filter(present),
    rows: list(value.rows).map(parseRow).filter(present),
    today: list(value.today).map(parseToday).filter(present),
    errors: texts(value.errors),
  };
}

/** board.py's data, checked field by field; a malformed item or desk is left out, not fatal. */
export function parseBoardPayload(value: unknown): BoardData | null {
  if (!isRecord(value) || !Array.isArray(value.desks)) return null;
  return { built: text(value.built), desks: value.desks.map(parseDesk).filter(present) };
}

/** The `const DATA = {...};` line board.py writes into index.html, parsed. */
export function extractBoardDataFromHtml(html: string): unknown {
  const match = /^\s*const DATA = (.+);\s*$/m.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!);
  } catch {
    return null;
  }
}

/** Board data from data.json's text or from the page that embeds it. */
export function parseBoardText(body: string): BoardData | null {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      return parseBoardPayload(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return parseBoardPayload(extractBoardDataFromHtml(body));
}

/** Where a browser without the desktop bridge looks: only http(s), data.json before the page. */
export function browserBoardCandidates(source: string): ReadonlyArray<string> | null {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  if (/\.(json|html?)$/i.test(url.pathname)) return [url.href];
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return [new URL("data.json", url).href, url.href];
}

interface ForkBridge {
  readonly readBoardData: (source: string) => Promise<unknown>;
}

declare global {
  interface Window {
    /** Installed by the fork's desktop preload; absent in a plain browser. */
    t3ForkBridge?: ForkBridge;
  }
}

type ReadResult =
  | { readonly ok: true; readonly data: BoardData; readonly resolvedUrl: string }
  | { readonly ok: false; readonly error: string };

const REQUEST_TIMEOUT_MS = 10_000;

async function readThroughBridge(bridge: ForkBridge, source: string): Promise<ReadResult> {
  const result: unknown = await bridge.readBoardData(source);
  if (!isRecord(result)) return { ok: false, error: m(msg("The desktop app sent no board data.")) };
  if (result.ok !== true)
    return { ok: false, error: text(result.error) || m(msg("Couldn't read the board.")) };
  const data = parseBoardPayload(result.data);
  return data === null
    ? { ok: false, error: m(msg("The board data isn't in board.py's format.")) }
    : { ok: true, data, resolvedUrl: text(result.resolvedUrl, source) };
}

async function readInBrowser(source: string): Promise<ReadResult> {
  const candidates = browserBoardCandidates(source);
  if (candidates === null) {
    return { ok: false, error: m(msg("Local board files need the desktop app.")) };
  }
  const misses: string[] = [];
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      credentials: "omit",
    });
    if (!response.ok) {
      misses.push(`${candidate}: HTTP ${response.status}`);
      continue;
    }
    const data = parseBoardText(await response.text());
    if (data !== null) return { ok: true, data, resolvedUrl: candidate };
    misses.push(`${candidate}: no board data`);
  }
  return { ok: false, error: misses.join("; ") };
}

async function readBoard(source: string): Promise<ReadResult> {
  try {
    const bridge = typeof window === "undefined" ? undefined : window.t3ForkBridge;
    return bridge ? await readThroughBridge(bridge, source) : await readInBrowser(source);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface BoardDataSnapshot {
  /** The data from the last good read; kept while a later read fails. */
  readonly data: BoardData | null;
  readonly error: string | null;
  readonly lastFetchedAt: string | null;
  readonly resolvedUrl: string | null;
  readonly loading: boolean;
}

const EMPTY_SNAPSHOT: BoardDataSnapshot = {
  data: null,
  error: null,
  lastFetchedAt: null,
  resolvedUrl: null,
  loading: false,
};

const REFRESH_INTERVAL_MS = 30_000;
// Typing a source in Settings changes it on every key; only the one left standing loads.
const FIRST_LOAD_DELAY_MS = 300;
const FOCUS_MIN_GAP_MS = 5_000;

interface BoardDataStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => BoardDataSnapshot;
  readonly refresh: () => void;
}

/** One poller per source, shared by the sidebar row and the Board page. */
function createBoardDataStore(
  source: string,
  onActive: (store: BoardDataStore) => void,
  onIdle: (store: BoardDataStore) => void,
): BoardDataStore {
  let snapshot: BoardDataSnapshot = { ...EMPTY_SNAPSHOT, loading: true };
  const listeners = new Set<() => void>();
  let inflight = false;
  let lastStartedAt = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let firstLoad: ReturnType<typeof setTimeout> | null = null;

  const publish = (patch: Partial<BoardDataSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const load = () => {
    if (inflight) return;
    inflight = true;
    lastStartedAt = Date.now();
    publish({ loading: true });
    void readBoard(source).then((result) => {
      inflight = false;
      const lastFetchedAt = new Date().toISOString();
      publish(
        result.ok
          ? {
              data: result.data,
              error: null,
              resolvedUrl: result.resolvedUrl,
              lastFetchedAt,
              loading: false,
            }
          : { error: result.error, lastFetchedAt, loading: false },
      );
    });
  };

  const onFocus = () => {
    if (Date.now() - lastStartedAt >= FOCUS_MIN_GAP_MS) load();
  };

  const start = () => {
    firstLoad = setTimeout(load, FIRST_LOAD_DELAY_MS);
    interval = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
  };

  const stop = () => {
    if (firstLoad !== null) clearTimeout(firstLoad);
    if (interval !== null) clearInterval(interval);
    firstLoad = null;
    interval = null;
    window.removeEventListener("focus", onFocus);
    onIdle(store);
  };

  const store: BoardDataStore = {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        onActive(store);
        start();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    refresh: load,
  };
  return store;
}

const stores = new Map<string, BoardDataStore>();

function storeFor(source: string): BoardDataStore {
  let store = stores.get(source);
  if (store === undefined) {
    store = createBoardDataStore(
      source,
      (active) => {
        if (!stores.has(source)) stores.set(source, active);
      },
      (idle) => {
        if (stores.get(source) === idle) stores.delete(source);
      },
    );
    stores.set(source, store);
  }
  return store;
}

const noSubscription = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;
const noRefresh = () => {};

export interface BoardDataHandle extends BoardDataSnapshot {
  /** The usable source, or null when none is set or it can't be read. */
  readonly source: string | null;
  readonly refresh: () => void;
}

/**
 * The board at `boardSource` (Settings → Labs), reloaded every 30 seconds while the window is
 * visible and when it regains focus. Every caller with the same source shares one poller.
 */
export function useBoardData(boardSource: string): BoardDataHandle {
  const source = normalizeBoardSource(boardSource);
  const store = source === null ? null : storeFor(source);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  return { ...snapshot, source, refresh: store?.refresh ?? noRefresh };
}
