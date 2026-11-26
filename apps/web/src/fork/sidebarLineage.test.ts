import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "~/test-fixtures";

import { sidebarThreadKey } from "./sidebarHierarchy";
import {
  indexLineageThreads,
  lineageProjectKeys,
  resolveLineageScopedThreadKeys,
} from "./sidebarLineage";

const bots = EnvironmentId.make("bots");
const dev = EnvironmentId.make("dev");

function thread(
  environmentId: EnvironmentId,
  id: string,
  projectId: string,
  links: {
    readonly parent?: string;
    readonly root?: string;
    readonly delegatedFrom?: { readonly environmentId: EnvironmentId; readonly threadId: string };
  } = {},
) {
  return makeThreadFixture({
    environmentId,
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    lineage: {
      rootThreadId: ThreadId.make(links.root ?? links.parent ?? id),
      parentThreadId: links.parent === undefined ? null : ThreadId.make(links.parent),
      relationshipToParent: links.parent === undefined ? null : "subagent",
    },
    delegatedFrom:
      links.delegatedFrom === undefined
        ? null
        : {
            environmentId: links.delegatedFrom.environmentId,
            threadId: ThreadId.make(links.delegatedFrom.threadId),
            title: "parent",
          },
  });
}

const eagleEye = `${bots}:eagle-eye`;

function scoped(threads: ReturnType<typeof thread>[], projectKeys: readonly string[]) {
  const keys = resolveLineageScopedThreadKeys(threads, new Set(projectKeys));
  return threads.filter((entry) => keys?.has(sidebarThreadKey(entry))).map((entry) => entry.id);
}

describe("lineage project scope", () => {
  const main = thread(bots, "ee-main", "eagle-eye");
  const other = thread(bots, "chief-topic", "chief");
  const lane = thread(dev, "lane", "eagle-eye-review", {
    delegatedFrom: { environmentId: bots, threadId: "ee-main" },
  });
  const laneSubagent = thread(dev, "lane-sub", "eagle-eye-review", { parent: "lane" });
  const otherLane = thread(dev, "other-lane", "eagle-eye-review");

  it("is upstream's filter when nothing is scoped", () => {
    expect(resolveLineageScopedThreadKeys([main, other], null)).toBeNull();
  });

  it("lists threads in a scoped project", () => {
    expect(scoped([main, other], [eagleEye])).toEqual(["ee-main"]);
  });

  it("follows delegatedFrom across environments and parentThreadId within one", () => {
    expect(scoped([main, other, lane, laneSubagent, otherLane], [eagleEye])).toEqual([
      "ee-main",
      "lane",
      "lane-sub",
    ]);
  });

  it("reaches the parent's project in any order the threads arrive", () => {
    expect(scoped([laneSubagent, lane, main], [eagleEye])).toEqual(["lane-sub", "lane", "ee-main"]);
  });

  it("does not pull a parent into its child's project", () => {
    expect(scoped([main, lane], [`${dev}:eagle-eye-review`])).toEqual(["lane"]);
  });

  it("falls back to the root when the parent is not loaded", () => {
    const orphan = thread(dev, "deep", "eagle-eye-review", { parent: "gone", root: "lane" });
    expect(scoped([main, lane, orphan], [eagleEye])).toEqual(["ee-main", "lane", "deep"]);
  });

  it("stops at a parent in an environment this client cannot see", () => {
    const remote = thread(dev, "remote-child", "eagle-eye-review", {
      delegatedFrom: { environmentId: EnvironmentId.make("work-mac"), threadId: "unknown" },
    });
    expect(scoped([main, remote], [eagleEye])).toEqual(["ee-main"]);
  });

  it("ends cycles without hanging", () => {
    const a = thread(dev, "a", "loop", { parent: "b" });
    const b = thread(dev, "b", "loop", {
      parent: "a",
      delegatedFrom: { environmentId: dev, threadId: "a" },
    });
    expect(scoped([a, b], [eagleEye])).toEqual([]);
    expect(scoped([a, b], [`${dev}:loop`])).toEqual(["a", "b"]);
    const index = indexLineageThreads([a, b]);
    expect([...lineageProjectKeys(a, index)]).toEqual([`${dev}:loop`]);
  });

  it("collects every project up a multi-hop chain", () => {
    const index = indexLineageThreads([main, lane, laneSubagent]);
    expect([...lineageProjectKeys(laneSubagent, index)]).toEqual([
      `${dev}:eagle-eye-review`,
      eagleEye,
    ]);
  });
});
