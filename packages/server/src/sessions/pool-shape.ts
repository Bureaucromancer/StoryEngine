// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createValidator, PlotHook } from '@storyengine/shared';

import type { HookSource, PooledHook } from './types.js';

/**
 * ***The hook pool as a file holds it, which is not always as the type says***
 * (2026-09-27).
 *
 * A session's pool is written by three doors that checked nothing — the hook
 * route, the hooks a session is created with, and a session import — and by a
 * text editor. Every reader then trusted the `PooledHook[]` type: the filter
 * iterated `involves`, the actor lookup read `introduces.actor.id`, the panel
 * read `introduces.entrances`. One hook without `involves` made every read of
 * the session a 500 and every turn a failure, because the lookup runs on every
 * gather, and the Remove control that could have fixed it was on the page that
 * would not load.
 *
 * The doors check a hook now. This is for what is already on disk: the engine
 * reads only {@link readPool}'s `usable`, and the panel shows `malformed` as
 * rows it can name. Nothing here imports storage, so the store, the gather and
 * the routes can all share one answer to *is this a hook*.
 */

const isHook = createValidator().compile<PlotHook>(PlotHook);

/** One of [03 §4.1]'s four sources, as `HookSource` spells them. */
export function isHookSource(value: unknown): value is HookSource {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (kind === 'session') return true;
  return (kind === 'treatment' || kind === 'setup' || kind === 'lore') && typeof id === 'string';
}

/** A pool entry the engine may read: a hook the schema takes, from a source it knows. */
export function isPooledHook(value: unknown): value is PooledHook {
  if (typeof value !== 'object' || value === null) return false;
  const { hook, source } = value as { hook?: unknown; source?: unknown };
  return isHookSource(source) && isHook(hook);
}

/**
 * A pool split into what the engine may read and what it may only show. An
 * entry that is not even an object is neither: there is nothing in it to name.
 */
export function readPool(value: unknown): {
  usable: PooledHook[];
  malformed: Record<string, unknown>[];
} {
  const usable: PooledHook[] = [];
  const malformed: Record<string, unknown>[] = [];
  if (!Array.isArray(value)) return { usable, malformed };
  for (const entry of value as unknown[]) {
    if (isPooledHook(entry)) usable.push(entry);
    else if (typeof entry === 'object' && entry !== null) {
      malformed.push(entry as Record<string, unknown>);
    }
  }
  return { usable, malformed };
}

/** The id a pool entry answers to, if it carries one, whatever else it lacks. */
export function pooledId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const hook = (entry as { hook?: unknown }).hook;
  if (typeof hook !== 'object' || hook === null) return undefined;
  const id = (hook as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}
