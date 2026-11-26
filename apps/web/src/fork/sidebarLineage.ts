import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

export type LineageThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "lineage" | "delegatedFrom"
>;

const threadKeyOf = (environmentId: EnvironmentId, threadId: ThreadId) =>
  scopedThreadKey(scopeThreadRef(environmentId, threadId));

/** The `environmentId:projectId` key the sidebar's project scope uses. */
export function lineageProjectKey(thread: Pick<LineageThread, "environmentId" | "projectId">) {
  return `${thread.environmentId}:${thread.projectId}`;
}

export type LineageIndex<T extends LineageThread> = ReadonlyMap<string, T>;

export function indexLineageThreads<T extends LineageThread>(
  threads: readonly T[],
): LineageIndex<T> {
  return new Map(threads.map((thread) => [threadKeyOf(thread.environmentId, thread.id), thread]));
}

/**
 * The threads one step up: the linked environment's thread that delegated this one, and the
 * parent in its own environment. A parent this client has not loaded falls back to the root.
 */
function parentKeys(thread: LineageThread, index: LineageIndex<LineageThread>): string[] {
  const keys: string[] = [];
  if (thread.delegatedFrom != null) {
    keys.push(threadKeyOf(thread.delegatedFrom.environmentId, thread.delegatedFrom.threadId));
  }
  const { parentThreadId, rootThreadId } = thread.lineage;
  if (parentThreadId !== null) {
    const parentKey = threadKeyOf(thread.environmentId, parentThreadId);
    keys.push(parentKey);
    if (!index.has(parentKey) && rootThreadId !== thread.id && rootThreadId !== parentThreadId) {
      keys.push(threadKeyOf(thread.environmentId, rootThreadId));
    }
  }
  return keys;
}

/**
 * The project keys of a thread and every ancestor this client knows, across environments.
 * Cycles and missing parents end the walk.
 */
export function lineageProjectKeys<T extends LineageThread>(
  thread: T,
  index: LineageIndex<T>,
): ReadonlySet<string> {
  const projectKeys = new Set<string>([lineageProjectKey(thread)]);
  const visited = new Set<string>([threadKeyOf(thread.environmentId, thread.id)]);
  const queue = parentKeys(thread, index);
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const ancestor = index.get(key);
    if (ancestor === undefined) continue;
    projectKeys.add(lineageProjectKey(ancestor));
    queue.push(...parentKeys(ancestor, index));
  }
  return projectKeys;
}

/** The keys of every ancestor this client knows, nearest first. Cycles end the walk. */
export function lineageAncestorKeys<T extends LineageThread>(
  thread: T,
  index: LineageIndex<T>,
): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>([threadKeyOf(thread.environmentId, thread.id)]);
  const queue = parentKeys(thread, index);
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const ancestor = index.get(key);
    if (ancestor === undefined) continue;
    ancestors.push(key);
    queue.push(...parentKeys(ancestor, index));
  }
  return ancestors;
}

/**
 * The thread keys a project scope lists: threads in a scoped project, and threads delegated or
 * spawned from one (a coding lane on another environment, its subagents). Null for no scope.
 */
export function resolveLineageScopedThreadKeys<T extends LineageThread>(
  threads: readonly T[],
  scopedProjectKeys: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  if (scopedProjectKeys === null) return null;
  const index = indexLineageThreads(threads);
  const inScope = new Set<string>();
  for (const thread of threads) {
    if (scopedProjectKeys.has(lineageProjectKey(thread))) {
      inScope.add(threadKeyOf(thread.environmentId, thread.id));
      continue;
    }
    for (const projectKey of lineageProjectKeys(thread, index)) {
      if (scopedProjectKeys.has(projectKey)) {
        inScope.add(threadKeyOf(thread.environmentId, thread.id));
        break;
      }
    }
  }
  return inScope;
}
