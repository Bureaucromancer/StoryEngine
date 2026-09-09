// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Liquid } from 'liquidjs';

/**
 * Block-scoped template rendering — [06 §5](../../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * *"Liquid, following Aventuras"*, built at P4.1 because import needs it
 * ([P4 §1.6](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Why it could not wait.** The macro table converts SillyTavern's macros
 * *into* Liquid ([04 §8.4.2]), and until now nothing rendered Liquid — so a
 * converted preset's `{{char}}` reached the model as literal braces. That fails
 * the phase's own posture in behaviour: *authored prose survives intact* is
 * worthless if it survives as template soup, and PLAYABLE would have been
 * testing prompt garbage.
 *
 * **Rendered within a block, never across blocks.** The unit is one block's
 * `template` string. A template cannot see another block, cannot see the
 * assembled prompt, and cannot cause a block to exist — because a template that
 * could do any of those is a second assembler, and there is exactly one
 * ([06 §5]).
 *
 * **The namespace is closed and holds names, not bodies** (§1.6's fence). It has
 * what SillyTavern's macros actually name about the *participants*: who the
 * character is, who the user is. Content — a description, a scenario, dialogue
 * examples — arrives through slots, and a template able to pull a section body
 * would be the second assembler again, reached from the other direction.
 */

/**
 * Everything a template may see.
 *
 * Deliberately tiny, and deliberately all strings. Growing it is a decision to
 * be argued rather than a convenience: every field here is one more thing a
 * template can depend on, and therefore one more thing that has to be true
 * before a block can render.
 */
export interface RenderContext {
  /** The active actor's name. ST's `{{char}}`. */
  char: string;
  /** The persona's name, or the account's display name when there is no persona. ST's `{{user}}`. */
  user: string;
}

/**
 * Why a render produced nothing usable.
 *
 * A refusal is a *value*, like a parser's ([P4 §1.2]): a preset is somebody
 * else's authored file, and a template that will not compile must not take the
 * turn down with it.
 */
export interface RenderFailure {
  ok: false;
  /** The template, unrendered, so the caller can emit it verbatim if it chooses. */
  source: string;
  message: string;
}

export type RenderResult = { ok: true; text: string } | RenderFailure;

/**
 * One engine for the process.
 *
 * `strictVariables` and `strictFilters` are **off, deliberately**. An imported
 * template naming something the namespace does not hold should render it empty
 * and leave the rest of the prose intact — the alternative is one unknown
 * variable blanking a block that was otherwise fine, which is the *mangled
 * prompt that looks fine* failure §8.4.2 is written against, inverted. What a
 * person needs is the review flagging it, which the import side does at
 * conversion time when it still knows the macro's name.
 *
 * `ownPropertyOnly` keeps a template off prototype chains: the context is a
 * plain object built here, but the value of that guarantee is that it does not
 * depend on staying one.
 */
const engine = new Liquid({
  strictVariables: false,
  strictFilters: false,
  ownPropertyOnly: true,
  // Rendering is synchronous by construction — there is nothing to await, and a
  // template that could await would be a template that could do I/O.
  cache: true,
});

/**
 * Renders one block's template.
 *
 * Synchronous because the assembler is, and because a template with no I/O has
 * nothing to wait for. `parseAndRenderSync` throws on a malformed template; that
 * is turned into a value here rather than propagated, for the reason
 * {@link RenderFailure} gives.
 */
export function renderTemplate(template: string, context: RenderContext): RenderResult {
  // A template with no interpolation at all is the overwhelmingly common case —
  // most authored prose is prose — and skipping the engine keeps that free.
  if (!template.includes('{{') && !template.includes('{%')) {
    return { ok: true, text: template };
  }

  try {
    // `parseAndRenderSync` is typed `any` by the library; the value is a string
    // for a synchronous render with no output filters, and saying so here keeps
    // the `any` from spreading past this line.
    const text: unknown = engine.parseAndRenderSync(template, { ...context });
    return { ok: true, text: typeof text === 'string' ? text : String(text) };
  } catch (error) {
    return {
      ok: false,
      source: template,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
