import { composerMathRanges } from "@t3tools/shared/composerInlineTokens";
import { useSyncExternalStore } from "react";

import { markdownMathRanges } from "~/markdown/wordsHast";

import {
  withComposerProjectMentionTokens,
  type ComposerProjectMentionItem,
  type ComposerProjectMentionToken,
} from "./composerProjectMentions";

/**
 * The projects the composer reads `@Name` as, kept in step with the sidebar by
 * useComposerProjectMentionRegistrySync. Empty while the setting is off, so parsing stays
 * upstream's.
 */
let entries: ReadonlyArray<ComposerProjectMentionItem> = [];
let names: ReadonlyArray<string> = [];
let byLowerName: ReadonlyMap<string, ComposerProjectMentionItem> = new Map();
let entriesKey = "";
const listeners = new Set<() => void>();

const registryKey = (next: ReadonlyArray<ComposerProjectMentionItem>) =>
  JSON.stringify(next.map((item) => [item.projectKey, item.label, item.project, item.description]));

export function setComposerProjectMentionRegistry(
  next: ReadonlyArray<ComposerProjectMentionItem>,
): void {
  const key = registryKey(next);
  if (key === entriesKey) return;
  entriesKey = key;
  entries = next;
  const lookup = new Map<string, ComposerProjectMentionItem>();
  for (const item of next) {
    const lower = item.label.toLowerCase();
    if (!lookup.has(lower)) lookup.set(lower, item);
  }
  byLowerName = lookup;
  names = [...lookup.values()].map((item) => item.label);
  for (const listener of listeners) listener();
}

export function findComposerProjectMention(name: string): ComposerProjectMentionItem | null {
  return byLowerName.get(name.trim().toLowerCase()) ?? null;
}

/** Composer inline tokens with `@Name` project mentions added (unchanged when none are known). */
export function withComposerProjectMentions<
  T extends { readonly type: string; readonly source: string; start: number; end: number },
>(text: string, tokens: ReadonlyArray<T>): ReadonlyArray<T | ComposerProjectMentionToken> {
  if (names.length === 0) return tokens;
  return withComposerProjectMentionTokens(text, tokens, names, (value) =>
    composerMathRanges(value, markdownMathRanges),
  );
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const getEntries = () => entries;

/** The project a mention chip's text names, or null for a file mention. */
export function useComposerProjectMention(name: string): ComposerProjectMentionItem | null {
  useSyncExternalStore(subscribe, getEntries, getEntries);
  return findComposerProjectMention(name);
}
