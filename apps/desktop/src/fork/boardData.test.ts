// @effect-diagnostics nodeBuiltinImport:off - Reads a real board folder in a temporary directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  extractBoardDataFromHtml,
  parseBoardText,
  readBoardData,
  resolveBoardSource,
} from "./boardData.ts";

const HOME = "/Users/someone";
const BOARD = { built: "2026-11-25T10:00:00-06:00", desks: [] };

describe("resolveBoardSource", () => {
  it("tries data.json, then the page itself, for a folder URL", () => {
    expect(resolveBoardSource("https://host.example:8447/", HOME)).toEqual({
      kind: "http",
      candidates: ["https://host.example:8447/data.json", "https://host.example:8447/"],
    });
    expect(resolveBoardSource("http://host.example/board#chief", HOME)).toEqual({
      kind: "http",
      candidates: ["http://host.example/board/data.json", "http://host.example/board/"],
    });
  });

  it("reads a named json or html URL as given", () => {
    expect(resolveBoardSource("https://host.example/x/index.html", HOME)?.candidates).toEqual([
      "https://host.example/x/index.html",
    ]);
  });

  it("expands ~ and file URLs and looks inside folders", () => {
    expect(resolveBoardSource("~/dev/bot/.board", HOME)).toEqual({
      kind: "file",
      candidates: [`${HOME}/dev/bot/.board/data.json`, `${HOME}/dev/bot/.board/index.html`],
    });
    expect(resolveBoardSource("file:///tmp/board/data.json", HOME)).toEqual({
      kind: "file",
      candidates: ["/tmp/board/data.json"],
    });
  });

  it("refuses other schemes and relative paths", () => {
    expect(resolveBoardSource("ftp://host/board", HOME)).toBeNull();
    expect(resolveBoardSource("javascript:alert(1)", HOME)).toBeNull();
    expect(resolveBoardSource("dev/bot/.board", HOME)).toBeNull();
    expect(resolveBoardSource("  ", HOME)).toBeNull();
  });

  it("only reads data.json or index.html files, after resolving ..", () => {
    expect(resolveBoardSource("/etc/passwd", HOME)?.candidates).toEqual([
      "/etc/passwd/data.json",
      "/etc/passwd/index.html",
    ]);
    expect(resolveBoardSource("/tmp/data.json/../secret", HOME)?.candidates).toEqual([
      "/tmp/secret/data.json",
      "/tmp/secret/index.html",
    ]);
  });
});

describe("parseBoardText", () => {
  it("reads data.json and the page board.py embeds the data in", () => {
    expect(parseBoardText(JSON.stringify(BOARD))).toEqual(BOARD);
    const html = `<script>\nconst DATA = ${JSON.stringify(BOARD).replace("</", "<\\/")};\nconst X = 1;\n</script>`;
    expect(extractBoardDataFromHtml(html)).toEqual(BOARD);
    expect(parseBoardText(html)).toEqual(BOARD);
  });

  it("returns null for the unfilled template and other pages", () => {
    expect(parseBoardText("<script>\nconst DATA = /*DATA*/null;\n</script>")).toBeNull();
    expect(parseBoardText("<html>hello</html>")).toBeNull();
    expect(parseBoardText('{"other": true}')).toBeNull();
  });
});

describe("readBoardData", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fork-board-"));
  });
  afterEach(async () => {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });

  it("falls back to index.html in a folder without data.json", async () => {
    await NodeFSP.writeFile(
      NodePath.join(dir, "index.html"),
      `const DATA = ${JSON.stringify(BOARD)};\n`,
    );
    const result = await readBoardData(dir);
    expect(result.ok && result.data).toEqual(BOARD);
    expect(result.ok && result.resolvedUrl).toBe(`file://${dir}/index.html`);
  });

  it("reports a missing board and a bad source", async () => {
    const missing = await readBoardData(dir);
    expect(missing.ok).toBe(false);
    expect(await readBoardData("ftp://x")).toMatchObject({ ok: false });
    expect(await readBoardData(42)).toMatchObject({ ok: false });
  });
});
