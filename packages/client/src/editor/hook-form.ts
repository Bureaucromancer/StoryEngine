// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7, type PlotHook } from '@storyengine/shared';

/**
 * The hook editor's edits, as functions over whatever object is carrying the
 * hooks ([03 §4.1](../../../../docs/design/03-data-model.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md)).
 *
 * **Generic over the carrier, because there are three of them and they agree.**
 * 03 §4.1 names four sources for a hook — a Treatment primarily, a Setup on top
 * of it, a Lorebook where the hook is inseparable from a piece of lore, and the
 * session's own pool — and the three that are library objects all spell the
 * field `hooks`. So the model is a set of functions over `Draft` rather than a
 * method on a kind, and one editor serves all three. A per-carrier module would
 * be three copies of the same array surgery, differing only in which of them
 * somebody remembered to fix.
 *
 * **The draft is the carrier, not a projection of it**, which is the structural
 * decision [book-form.ts](./book-form.ts) records at more length and for the
 * same reason: a Treatment has fields this editor does not write, and a form
 * type built to carry the ones it does is a form type that drops the rest.
 * Holding the object itself makes [04 §2](../../../../docs/design/04-schemas.md)'s
 * promise structural rather than remembered — a field a newer build wrote
 * survives because nothing here ever took it out.
 *
 * What these functions guarantee is narrower and is the part worth testing:
 * **an edit to one hook leaves the other hooks, and the rest of that hook,
 * byte-identical**. Every one of them returns a new object and mutates nothing,
 * so a caller can hold drafts as ordinary state and compare them by value.
 */

/** The draft, at the honesty of the file rather than of the type. */
export type Draft = Record<string, unknown>;

/**
 * The hooks a carrier holds, or none.
 *
 * The cast is through `unknown` and it is the same one the editors make of
 * their own drafts: the object has passed the shape guard that got it here, and
 * this module must never be reached without one.
 */
export function hooksOf(carrier: Draft): PlotHook[] {
  return (carrier['hooks'] ?? []) as unknown as PlotHook[];
}

/**
 * The carrier with its hooks replaced, and everything else untouched.
 *
 * ***The absence rule, which is the one place the three carriers differ.***
 * `Treatment.hooks` and `Setup.hooks` are **required**; `Lorebook.hooks` is
 * **optional**, and for it an absent key and an empty list are different
 * claims — *this book carries no hooks* against *this book carries a hook list
 * that is empty*. 03 §4.1 makes hooks-on-lorebooks deliberately secondary, so a
 * book that gains `"hooks": []` from being *looked at* in an editor is a book
 * quietly reclassified by a surface that rendered it.
 *
 * So: an empty list writes the key only where the key was already there. A
 * carrier that arrived without one keeps it absent, and a Treatment or a Setup
 * — which cannot arrive without one and stay valid — keeps `[]`.
 *
 * **What this deliberately does *not* do is delete the key when the last hook
 * goes.** That is what `setSessionHooks` does one package over
 * (`packages/server/src/sessions/store.ts`), and it is right *there* because a
 * session's `hooks` is optional and the file is the session's own. Doing it
 * here would mean deleting a **required** property off a Treatment the moment
 * somebody removed its last hook — an object that no longer validates, written
 * by the editor that was supposed to be authoring it. So the rule that tells
 * the two apart without asking which kind it is holding is *keep what was
 * there*: this function is the **required**-carrier half, and a carrier whose
 * `hooks` is optional is served by {@link withOptionalHooks} below rather than
 * by living with the emptied list.
 *
 * ~~Its whole cost is that a lorebook which once had a hook keeps an empty list
 * after its last one is removed.~~ ***That cost was written before the other
 * half existed and never materialised.*** Nothing calls this on an optional
 * carrier: the lorebook editor calls `withOptionalHooks`, and the 412 merge in
 * [book-form.ts](./book-form.ts) does too. Keeping the sentence would leave the
 * module claiming a behaviour a reader could not find, which is the *one
 * description, two renderings* failure this file's header argues against,
 * turned inward.
 *
 * A carrier whose key is absent and whose next list is empty comes back **by
 * identity**, so an editor's change test stays false and a mount that touched
 * nothing does not light up Save.
 */
export function withHooks(carrier: Draft, next: PlotHook[]): Draft {
  if (next.length === 0 && !Object.hasOwn(carrier, 'hooks')) return carrier;
  return { ...carrier, hooks: next };
}

/**
 * The same replacement, for a carrier whose `hooks` is **optional** — the
 * lorebook, and only the lorebook.
 *
 * ***The deleting half, and it lives here rather than in the editor that needed
 * it first.*** It was written in `LorebookEditorPage` as `withBookHooks`, which
 * left the absent-versus-empty decision in two files giving two answers, and
 * then a third caller arrived that could not reach either: `reapplyBookEdits`
 * merges a lorebook's hooks after a 412 and has to write the merged list under
 * the same rule the form writes it under, or a conflict would put back the
 * `"hooks": []` the form is careful never to leave. Two callers is this
 * repository's stated threshold for lifting a decision, so it is lifted.
 *
 * **On a lorebook an empty list and no key are the same claim, and *no key* is
 * the one that says it.** 03 §4.1 makes hooks-on-lorebooks deliberately
 * secondary, and a book carrying `"hooks": []` because somebody opened a fold
 * and changed their mind is a book quietly reclassified by a surface that
 * rendered it — visible to every importer and to the compatible-export path,
 * saying something about narrative intent its author did not mean to say. The
 * one case this treats as the author's rather than as preservation is a book
 * that arrived with an explicit `"hooks": []`: empty it through this and the key
 * goes, because both spellings mean *no hooks* and only one of them is what this
 * editor writes.
 *
 * A carrier that has no key and is given no hooks comes back **by identity**,
 * for the reason {@link withHooks} gives.
 */
export function withOptionalHooks(carrier: Draft, next: PlotHook[]): Draft {
  if (next.length > 0) return withHooks(carrier, next);
  if (!Object.hasOwn(carrier, 'hooks')) return carrier;
  const rest = { ...carrier };
  delete rest['hooks'];
  return rest;
}

/**
 * A blank hook, with the defaults a hook typed by hand would want.
 *
 * **The same defaults the session panel already hard-codes**
 * ([HookPanel.tsx](../play/HookPanel.tsx), [P7.5]): `local` blast radius,
 * ordinary weight, woven rather than expanded, once. That panel is two fields
 * on purpose — it is *"the sentence the feature exists for"* rather than an
 * editor — and the five values it fills in behind them are a statement about
 * what an unremarkable hook is. A second, different statement here would mean a
 * hook written while playing and a hook written in the editor were different
 * objects for no reason a person could see.
 *
 * *The id is minted here rather than at save*, because every other field of a
 * hook is addressed by it the moment the form renders — `blockedBy` and
 * `notBefore.afterHook` on its siblings point at it, and
 * [15 §5.1](../../../../docs/design/15-world.md) makes a hook id the one thing
 * that must survive every copy of the hook afterwards.
 *
 * The three optional fields — `blockedBy`, `notBefore`, `introduces` — are
 * **absent** rather than empty, which is what [04 §2] means by additive: a hook
 * that has never been given an eligibility filter says nothing about one.
 */
export function newHook(title: string): PlotHook {
  return {
    id: uuidv7(),
    title,
    premise: '',
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
}

/**
 * A patch, with **`undefined` meaning *take the key off*** rather than *set it
 * to undefined*.
 *
 * `Partial<PlotHook>` cannot say this: `exactOptionalPropertyTypes` is on, so
 * `{ notBefore: undefined }` is not assignable to it, and that is the right
 * refusal for a type describing *a hook* — a hook with a `notBefore` key holding
 * `undefined` is not a shape the schema has. This is a type describing *an
 * edit*, which is a different thing, and removal is one of the edits.
 */
export type HookPatch = { [K in keyof PlotHook]?: PlotHook[K] | undefined };

/**
 * The list with one hook's fields changed.
 *
 * **Spread over the hook rather than rebuilt from it**, for [04 §2]'s reason:
 * a hook is an object, the promise is per-object, and a hook rebuilt from the
 * fields this build knows would strip whatever a newer one wrote into it.
 *
 * ***And a key set to `undefined` is removed rather than written***, which is
 * the one edit a spread cannot express and the reason {@link HookPatch} exists.
 * Three of a hook's fields are optional — `blockedBy`, `notBefore` and
 * `introduces` — and {@link newHook} states the rule they follow: **absent
 * rather than empty**, because *a hook that has never been given an eligibility
 * filter says nothing about one*. A control that cleared its last token to
 * `blockedBy: []`, or its last gate to `notBefore: {}`, would be writing a hook
 * that is no longer byte-identical to one that never had the field — into the
 * portable file, every export and every diff — for an edit whose whole meaning
 * was *never mind*. This is how those controls get back to absence, and it is
 * the same edit `introduces` already had a bespoke function for.
 *
 * **The first match, not every match**, which is the defence `withEntry` makes
 * next door. Hook ids are meant to be unique and are not guaranteed to be: the
 * pool copies them from several sources keeping the ids
 * ([03 §4.1](../../../../docs/design/03-data-model.md)), and an author can
 * paste a hook from one object into another. Patching the first degrades to
 * *one of the two is uneditable*, which is visible; patching both would edit
 * two hooks from one form and save both, which is not.
 */
export function patchHook(hooks: PlotHook[], id: string, fields: HookPatch): PlotHook[] {
  let done = false;
  return hooks.map((hook) => {
    if (done || hook.id !== id) return hook;
    done = true;
    // Spread first and *then* dropped, rather than filtering the patch before
    // it is applied: the key has to come off the hook that had it, and a patch
    // entry naming a key the hook never carried has to leave it absent. Both
    // fall out of this order; neither does from the other one. Rebuilt rather
    // than `delete`d because a stored value is never `undefined` — these
    // objects come off disk as JSON — so the two are the same edit and only one
    // of them is a dynamic delete.
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...hook, ...fields })) {
      if (value !== undefined) next[key] = value;
    }
    return next as unknown as PlotHook;
  });
}

/** The list without that hook. */
export function removeHook(hooks: PlotHook[], id: string): PlotHook[] {
  return hooks.filter((hook) => hook.id !== id);
}

/**
 * The list with one hook at a new position — the nudge buttons' edit.
 *
 * **Addressed by an index rather than by the hook it lands before**, which is
 * the opposite of the choice `moveEntryBefore` makes and the difference is a
 * fact about the two lists rather than a change of mind. An entry list is
 * filtered twice over — by folder and by a name box — so *before this entry* is
 * the only expression of a position that means the same thing on screen and in
 * the array. A hook list is short, unfiltered, and shown whole, so the position
 * a person sees **is** the index, and an index is what the up and down buttons
 * have to hand.
 *
 * A target outside the list is clamped rather than refused, so *down* on the
 * last hook is a no-op instead of an exception; a hook this list does not hold
 * comes back **by identity**, so nothing downstream reads a move that did not
 * happen as a change.
 */
export function moveHook(hooks: PlotHook[], id: string, to: number): PlotHook[] {
  const moving = hooks.find((hook) => hook.id === id);
  if (moving === undefined) return hooks;

  const at = Math.min(Math.max(to, 0), hooks.length - 1);
  // The hook already standing there is the one being moved, so the move is a
  // no-op — which covers *down* on the last hook and *up* on the first without
  // a guard of its own, the way `moveEntryBefore` does.
  if (hooks[at] === moving) return hooks;

  const rest = hooks.filter((hook) => hook !== moving);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
