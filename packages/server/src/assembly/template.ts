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
 *
 * ***Grown by three at [P13.2], and this is the argument***
 * ([P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)).
 * A call that speaks for one member of a group has to be able to say who else
 * is there — *"write only as Vera, not as Lund or Ned"* is the one sentence a
 * group prompt cannot do without, and both sources ship it. All three are
 * **names**, which is the fence this namespace keeps: a list of who is in the
 * room is the same kind of fact as who is talking, and no body reaches a
 * template through them. They are SillyTavern's own macros, so an imported
 * preset that says them means what its author meant.
 */
export interface RenderContext {
  /**
   * The active actor's name. ST's `{{char}}`. ***The speaker, on a call that
   * speaks for somebody*** ([P13.2]); otherwise the first of the cast, as
   * before.
   */
  char: string;
  /** The persona's name, or the account's display name when there is no persona. ST's `{{user}}`. */
  user: string;
  /**
   * ***Every cast member's name, muted included, comma-separated*** — ST's
   * `{{group}}`: *"Comma-separated list of group member names (including muted)
   * or the character name in solo chats"* (`macros/definitions/env-macros.js:30-36`),
   * built by `getGroupValue(ctx, { includeMuted: true })`
   * (`macros/engine/MacroEnvBuilder.js:135`). A cast of one is that one name,
   * which is ST's solo reading too; an empty cast is `char`'s own fallback
   * rather than an empty string, for the reason `user` has one.
   */
  group: string;
  /**
   * ***The speaker's name in a one-member cast, else the group*** — ST's
   * `{{charIfNotGroup}}`, which is not a macro of its own there but a hidden
   * **alias** of `{{group}}` (`env-macros.js:31`): in a solo chat `group`
   * already answers with the character's name. Kept as its own name here
   * because an imported template spells it, and because stating it separately
   * says what it is for — the sentence that reads right in both a solo chat
   * and a group.
   */
  charIfNotGroup: string;
  /**
   * ***Everyone in the scene but `char`, the persona included*** — ST's
   * `{{notChar}}`, documented as *"all participants except the current speaker"*
   * (`env-macros.js:45-50`).
   *
   * **Where ours parts from ST's code, and why.** `getGroupValue` builds it with
   * `filterOutChar: true, includeUser: user` and the default `includeMuted:
   * false` (`MacroEnvBuilder.js:137`), and `includeUser` is read only on the
   * solo branch (`:194`): so in a solo chat ST's `notChar` is the user, and in a
   * group it is the unmuted members but the speaker, **without the user**. Ours
   * is the documented meaning in both cases — the persona first, then every
   * other member, muted ones too. The sentence this macro is written for is
   * *"do not write for {{notChar}}"*, and the player is the one person a group
   * reply most needs telling not to write for; a muted member is still in the
   * room, and still somebody the reply must not speak as.
   */
  notChar: string;
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
 *
 * ***And it has limits*** (2026-09-27). liquidjs defaults all three to
 * infinity, and a preset is somebody else's file: the SillyTavern importer
 * passes `{% … %}` through untouched. So `{% for i in (1..1000000000) %}` in one
 * text block built a billion-element array on the event loop, once per
 * assembly and once per preview. V8 aborted, which no `catch` can stop, and
 * every account on the install lost the server.
 *
 * - `memoryLimit` is charged before a range, `append`, `join` or `split`
 *   allocates, so that range is a thrown error and a {@link RenderFailure}.
 *   A million is several orders past anything a block legitimately builds,
 *   since the namespace holds ~~two names~~ five, all names ([P13.2]).
 * - `renderLimit` is a wall-clock backstop per render for loops that stay under
 *   the memory budget. Only a pathological template reaches it, so an
 *   ordinary render stays reproducible.
 * - `templates`, empty and without a prototype, means `include`, `render` and
 *   `layout` find nothing. They resolved against the process's working
 *   directory, which is no business of a preset's.
 *
 * `cache: true` went with them: it caches templates read from files, and there
 * are none.
 */
const engine = new Liquid({
  strictVariables: false,
  strictFilters: false,
  ownPropertyOnly: true,
  memoryLimit: 1_000_000,
  renderLimit: 500,
  templates: Object.create(null) as Record<string, string>,
});

/**
 * Renders one block's template.
 *
 * Synchronous because the assembler is, and because a template with no I/O has
 * nothing to wait for. `parseAndRenderSync` throws on a malformed template; that
 * is turned into a value here rather than propagated, for the reason
 * {@link RenderFailure} gives.
 *
 * ***The three group names are optional here and never in the collector***
 * ([P13.2]). The collector always has a cast to count and always names all
 * five; a caller rendering one template outside a turn — the importer checking
 * what a converted macro renders to — has two names and no group, and a name
 * it does not pass renders empty, as any name outside the namespace does
 * (`strictVariables` is off above, for its stated reason).
 */
export function renderTemplate(
  template: string,
  context: Pick<RenderContext, 'char' | 'user'> & Partial<RenderContext>,
): RenderResult {
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

/**
 * Renders a channel's value as prompt text — [06 §4], [P7.1].
 *
 * **The same engine, a different namespace, and the difference is the point.**
 * {@link renderTemplate}'s context is [06 §5]'s closed participant namespace —
 * `char` and `user`, names and never bodies — because a block template that
 * could reach content would be a second assembler. A channel template's context
 * is **its own channel's value and nothing else**, which is narrower still: it
 * cannot see another channel, cannot see the session, and cannot see the
 * assembled prompt. So the fence that section draws is not widened by this; a
 * second, smaller one is drawn beside it.
 *
 * **A non-object value is bound as `value`.** A channel whose state is a number
 * or a string has no fields to interpolate, and `{{ value }}` is the obvious
 * spelling — inventing a name per type would be a vocabulary nobody could guess.
 * An object binds its own keys, which is what makes `{{ hour }}` work.
 *
 * *`null` renders as nothing rather than as "null"*: a channel with no value yet
 * is a channel with nothing to say, and `omitWhenEmpty` on the slot is what
 * decides whether the block disappears.
 */
export function renderChannelValue(template: string, value: unknown): RenderResult {
  if (value === null || value === undefined) return { ok: true, text: '' };

  const context =
    typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };

  try {
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
