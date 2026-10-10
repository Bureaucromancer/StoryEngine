// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { PlotHook } from '@storyengine/shared';

import { useLibrary } from '../queries.js';
import { Button } from '../ui/Button.js';
import { TwoStep } from '../ui/TwoStep.js';
import { Field } from '../ui/Field.js';
import { Panel } from '../ui/Panel.js';
import { nudge } from '../ui/reorder.js';
import { Fine, Note, SectionTitle } from '../ui/Text.js';
import { HookFields, nameOfHook } from './HookFields.js';
import { moveHook, newHook, patchHook, removeHook } from './hook-form.js';

/**
 * The hooks of one carrier, written rather than shown —
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md).
 *
 * ***One component for three carriers***, which is the whole shape of the
 * change it belongs to. 03 §4.1 names a Treatment as the primary home for
 * hooks, a Setup as the place to add to it, and a Lorebook as the secondary
 * home *"for hooks that are genuinely inseparable from a piece of lore"* — and
 * until this existed none of the three could be authored anywhere, so the only
 * surface that could write a hook was a running session and there was no way
 * back out of one. A component per carrier would have been three surfaces to
 * keep in agreement about a schema all three share.
 *
 * **A list, a way to hear about a new one, and a sentence of its own.** No
 * kind, no schema id, no page state: everything else — the actor options, the
 * ordering, the per-hook controls — is this component's. That is what makes it mountable in
 * `SimpleEditorPage`'s schema-driven form and in the lorebook editor's
 * hand-written one without either of them learning what a hook is.
 *
 * ***Deliberately smaller than the entry list.*** `EntryList` carries a name
 * box, a folder rail, a drag-and-drop gesture with its own scroll loop, and an
 * unsaved mark per row, because a real lorebook is two hundred and forty-seven
 * entries. A hook list is a handful, so none of that is ported: the reorder is
 * two nudge buttons, which is [work plan §2.1]'s keyboard path anyway and the
 * half of the entry list's gesture that everybody can reach.
 *
 * **The note is the caller's**, because each carrier means something different
 * by its hooks and [10 §2.1]'s objection to a surface that does not say what it
 * is applies hardest where the same control appears three times.
 */

export function HookList(props: {
  hooks: PlotHook[];
  /**
   * ***A change to the list, never the list*** (2026-09-27).
   *
   * A hook's premise and an entrance's text both carry an assist, and an
   * assist's result lands long after its click — through the `onChange` of the
   * render that started it. When that built the next list from `props.hooks`,
   * the result put back every hook as it was at the click, and the page's own
   * write then did the same to the rest of the object. So every change here is
   * an updater, and the carrier applies it to the hooks as its form holds them
   * when the change arrives.
   */
  onChange: (update: (hooks: PlotHook[]) => PlotHook[]) => void;
  /** A sentence under the heading — each carrier says something different. */
  note?: string;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [moved, setMoved] = useState('');

  /**
   * ***The actor options are fetched here rather than passed in***, which is
   * the one place this component reaches past its own props.
   *
   * Two fields of a hook point at an actor — `involves`, which decides whether
   * the hook is still moot, and `introduces.actor`, which is the arrival
   * itself — and both are `Ref`s that have to be *picked* rather than typed, or
   * the id in them is whatever somebody transcribed. Asking three mounting
   * pages to each fetch the library and pass it down would put the same query
   * in three places to serve one component's two controls, and the query is
   * cached by key: the page that also lists actors pays for one fetch, not two.
   *
   * *Picked rather than typed was the intent, and until 2026-10-10 not the
   * behaviour*: `introduces.actor` is a select and always was, but `involves`
   * was a tag field's combobox and took whatever was typed as an id. It is
   * strict now ([HookFields](./HookFields.tsx)'s `ActorRefs` has the account).
   *
   * ***Undefined until the library answers*** (2026-10-10), where it was `[]`
   * from the first render: `involves` marks an actor the library does not have
   * as *Missing*, and drawn from `[]` that badge would land on every actor a
   * hook names while the request is in flight.
   *
   * ***The winners only*** (2026-10-10). The list carries a shadowed copy
   * beside its winner under the same id, and both were offered — two options
   * with one value, and a name taken from whichever came last. The winner is
   * what an id-only read resolves to (`resolveMember`'s rule, for its reason),
   * so it is the one name a chip can honestly carry.
   */
  const actors = useLibrary('actors');
  const cast = actors.data?.objects
    .filter((object) => !object.shadowed)
    .map((object) => ({ id: object.id, name: object.name }));
  // Only a list that never arrived — a poll failing after an answer keeps it.
  const unread = cast === undefined && actors.isError;

  function add(): void {
    // Minted out here, where it runs once: React runs an updater twice under
    // StrictMode, and a hook minted inside one would be two different hooks.
    const made = newHook(title.trim());
    props.onChange((hooks) => [...hooks, made]);
    setTitle('');
  }

  function move(hook: PlotHook, to: number): void {
    props.onChange((hooks) => moveHook(hooks, hook.id, to));
    // Announced rather than only shown: what changed is a *position*, and a row
    // moving under the pointer is exactly the change the DOM does not report.
    setMoved(movedLine(hook, to, props.hooks.length));
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Plot hooks">
      <div>
        <SectionTitle as="h2">Plot hooks</SectionTitle>
        {props.note === undefined ? null : <Note>{props.note}</Note>}
      </div>

      {props.hooks.length === 0 ? <Fine>None here yet.</Fine> : null}

      {/*
       * ***Said once, for the list*** (2026-10-10) — `BookScope`'s line for
       * the same failure. A strict picker over a list that never arrived offers
       * nobody, and *Nothing matches Vera* typed against it would be the field
       * blaming the name for the request. The field itself says *nobody can be
       * chosen until your library has been read*, at the box (`HookFields`'
       * `unanswered`, added on review); this says why, and what to do, once
       * rather than on every card.
       */}
      {unread && props.hooks.length > 0 ? (
        <Fine>
          Your library could not be read, so no character can be chosen for a hook here. Try
          reloading the page.
        </Fine>
      ) : null}

      {props.hooks.map((hook, at) => (
        <Panel key={hook.id} variant="card" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{positionLine(at, props.hooks.length)}</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={moveLabel(hook, 'up')}
                disabled={at === 0}
                className={nudge}
                onClick={() => {
                  move(hook, at - 1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={moveLabel(hook, 'down')}
                disabled={at === props.hooks.length - 1}
                className={nudge}
                onClick={() => {
                  move(hook, at + 1);
                }}
              >
                ↓
              </button>
              <TwoStep
                label={removeLabel(hook)}
                question="Remove this hook? Nothing is written until you save."
                confirm="Remove"
                variant="dangerOutline"
                size="tiny"
                onConfirm={() => {
                  props.onChange((hooks) => removeHook(hooks, hook.id));
                }}
              />
            </div>
          </div>

          <HookFields
            hook={hook}
            /**
             * ***The other hooks, not all of them.*** `blockedBy` and
             * `notBefore.afterHook` are gates one hook sets on another, and a
             * hook that named *itself* would be a hook that can never fire —
             * which the engine would report as blocked rather than as a
             * mistake, since a self-reference is indistinguishable from an
             * unfired sibling from the inside.
             */
            siblings={props.hooks.filter((other) => other.id !== hook.id)}
            actors={cast}
            onPatch={(patch) => {
              props.onChange((hooks) => patchHook(hooks, hook.id, patch));
            }}
            onIntroduce={(update) => {
              /**
               * ***An absent arrival unsets rather than blanks***, and the actor
               * picker's empty option is the only thing in the application that
               * turns an arrival back into an ordinary hook. `HookFields`' own
               * docstring has the reason it must remove rather than blank: an
               * `Introduction` with no subject is a hook that is ineligible
               * forever, with a visible reason, which is worse than the hook the
               * author was trying to get back to. `patchHook` removes a key
               * given `undefined`, which is the whole of how.
               *
               * The update is applied to the arrival this hook holds *now* —
               * the first hook with this id, the one `patchHook` then writes —
               * so an entrance's text written by an assist lands beside the
               * label typed while it was being written, not over it.
               */
              props.onChange((hooks) =>
                patchHook(hooks, hook.id, {
                  introduces: update(hooks.find((one) => one.id === hook.id)?.introduces),
                }),
              );
            }}
          />
        </Panel>
      ))}

      {/*
       * **The create control is a title and nothing else**, which is the same
       * judgement the session panel makes from the other side: a hook is worth
       * naming before it is worth describing, and a form that demanded the
       * premise first would be an editor standing in front of an editor. The
       * rest of the fields are one click away, in the card this makes.
       */}
      <div className="flex items-end gap-2">
        <div className="grow">
          <Field
            label="Something you want to happen"
            value={title}
            onChange={setTitle}
            placeholder="A title for your list"
          />
        </div>
        <Button
          type="button"
          disabled={title.trim() === ''}
          onClick={() => {
            add();
          }}
        >
          Add a hook
        </Button>
      </div>

      {/*
       * One region for the whole list rather than a message per card: what is
       * announced is the outcome of a gesture, and a live region that moves
       * with the rows is one that gets re-read whenever the list re-renders.
       */}
      <span aria-live="polite" className="sr-only">
        {moved}
      </span>
    </section>
  );
}

/** Which card this is, as a whole phrase rather than a shape in the tree. */
function positionLine(at: number, total: number): string {
  return `Hook ${String(at + 1)} of ${String(total)}`;
}

/** A nudge button's accessible name. */
function moveLabel(hook: PlotHook, direction: 'up' | 'down'): string {
  return direction === 'up' ? `Move ${nameOfHook(hook)} up` : `Move ${nameOfHook(hook)} down`;
}

/** The remove button's words, which are also its accessible name. */
function removeLabel(hook: PlotHook): string {
  return `Remove ${nameOfHook(hook)}`;
}

/** What the live region says after a nudge. */
function movedLine(hook: PlotHook, to: number, total: number): string {
  return `Moved ${nameOfHook(hook)} to position ${String(to + 1)} of ${String(total)}.`;
}
