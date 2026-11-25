// @effect-diagnostics nodeBuiltinImport:off globalFetch:off extendsNativeError:off globalDate:off - A small fork-only IPC handler kept outside the Effect runtime so upstream rebases never touch it.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { BrowserWindow } from "electron";

/**
 * Reads a bot-desk board (board.py's data.json, or the index.html it embeds the same data in)
 * for the fork's Board page. The renderer can't: the tailnet page sends no CORS headers, and a
 * board may be a local folder.
 */
const READ_BOARD_DATA_CHANNEL = "t3fork:readBoardData";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const LOCAL_NAMES = ["data.json", "index.html"] as const;

export type BoardDataResult =
  | {
      readonly ok: true;
      readonly data: unknown;
      readonly fetchedAt: string;
      readonly resolvedUrl: string;
    }
  | { readonly ok: false; readonly error: string };

export interface BoardSourceTarget {
  readonly kind: "http" | "file";
  /** Tried in order; the first that holds board data wins. */
  readonly candidates: ReadonlyArray<string>;
}

const allowedLocalName = (path: string) =>
  LOCAL_NAMES.some((name) => NodePath.basename(path).endsWith(name));

/** Where to look for a board, or null for a source this bridge won't read. */
export function resolveBoardSource(source: string, homeDir: string): BoardSourceTarget | null {
  const trimmed = source.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    url.hash = "";
    if (/\.(json|html?)$/i.test(url.pathname)) return { kind: "http", candidates: [url.href] };
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
    // board.py writes index.html; data.json is preferred when a newer board.py also writes it.
    return { kind: "http", candidates: [new URL("data.json", url).href, url.href] };
  }
  let path: string;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      path = NodeURL.fileURLToPath(trimmed);
    } catch {
      return null;
    }
  } else if (trimmed === "~" || trimmed.startsWith("~/")) {
    path = NodePath.join(homeDir, trimmed.slice(1));
  } else if (trimmed.startsWith("/")) {
    path = trimmed;
  } else {
    return null;
  }
  path = NodePath.resolve(path);
  if (allowedLocalName(path)) return { kind: "file", candidates: [path] };
  return { kind: "file", candidates: LOCAL_NAMES.map((name) => NodePath.join(path, name)) };
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

const looksLikeBoard = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { desks?: unknown }).desks);

/** Board data from a fetched body, whether it is data.json or the page itself. */
export function parseBoardText(text: string): unknown {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return looksLikeBoard(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const embedded = extractBoardDataFromHtml(text);
  return looksLikeBoard(embedded) ? embedded : null;
}

class BoardReadMiss extends Error {}

async function readHttp(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json, text/html;q=0.9" },
  });
  if (response.status === 404) throw new BoardReadMiss(`${url}: not found`);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error(`${url}: larger than 5 MB`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`${url}: larger than 5 MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readLocal(path: string): Promise<string> {
  let stat: Awaited<ReturnType<typeof NodeFSP.stat>>;
  try {
    stat = await NodeFSP.stat(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BoardReadMiss(`${path}: not found`);
    }
    throw cause;
  }
  if (!stat.isFile()) throw new BoardReadMiss(`${path}: not a file`);
  if (stat.size > MAX_BYTES) throw new Error(`${path}: larger than 5 MB`);
  return NodeFSP.readFile(path, "utf8");
}

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export async function readBoardData(
  source: unknown,
  homeDir: string = NodeOS.homedir(),
): Promise<BoardDataResult> {
  if (typeof source !== "string" || source.length > 4096) {
    return { ok: false, error: "Board source must be text." };
  }
  const target = resolveBoardSource(source, homeDir);
  if (target === null) {
    return {
      ok: false,
      error: "Use an http(s) or file:// address, or a path starting with / or ~/.",
    };
  }
  const misses: string[] = [];
  for (const candidate of target.candidates) {
    let text: string;
    try {
      text = target.kind === "http" ? await readHttp(candidate) : await readLocal(candidate);
    } catch (cause) {
      if (cause instanceof BoardReadMiss) {
        misses.push(cause.message);
        continue;
      }
      return { ok: false, error: errorText(cause) };
    }
    const data = parseBoardText(text);
    if (data === null) {
      misses.push(`${candidate}: no board data`);
      continue;
    }
    return {
      ok: true,
      data,
      fetchedAt: new Date().toISOString(),
      resolvedUrl: target.kind === "http" ? candidate : NodeURL.pathToFileURL(candidate).href,
    };
  }
  return { ok: false, error: misses.join("; ") || "No board data found." };
}

// Only the app's own windows: preview tabs load arbitrary pages in their own web contents.
function isAppWindow(event: IpcMainInvokeEvent): boolean {
  return (
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    BrowserWindow.getAllWindows().some((window) => window.webContents.id === event.sender.id)
  );
}

export function registerForkBoardDataIpc(ipcMain: Pick<IpcMain, "handle" | "removeHandler">) {
  ipcMain.removeHandler(READ_BOARD_DATA_CHANNEL);
  ipcMain.handle(READ_BOARD_DATA_CHANNEL, (event, source: unknown) =>
    isAppWindow(event)
      ? readBoardData(source)
      : Promise.resolve<BoardDataResult>({ ok: false, error: "Not allowed from this window." }),
  );
}
