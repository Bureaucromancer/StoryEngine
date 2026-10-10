// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import {
  uuidv7,
  type Entrance,
  type Introduction,
  type PlotHook,
  type Ref,
} from '@storyengine/shared';

import { labels } from '../i18n/catalogue.js';
import { ReadOnlyField } from '../library/ByField.js';
import { choicesOf, fieldsOf, labelFor, plotHookSchema, type FieldRow } from '../library/fields.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { TwoStep } from '../ui/TwoStep.js';
import { CheckboxField, Field, NumberField, SelectField } from '../ui/Field.js';
import { TokenField, type TokenOption } from '../ui/TokenField.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import { disclosure } from '../ui/classes.js';
import type { HookPatch } from './hook-form.js';

/**
 * One plot hook, as the schema's own shape —
 * [04 §6.1a](../../../../docs/design/04-schemas.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md), and the write side of
 * what [P7 §1.5](../../../../docs/design/workplan/23-p7-implementation.md)
 * recorded as *"a hook has nowhere to be authored"*.
 *
 * **Modelled on [EntryFields](./EntryFields.tsx), and it inherits that file's
 * two corrections rather than restating them.**
 *
 * The first: ***the switch is the list.*** There is no membership set beside it
 * saying which keys this editor owns. EntryFields had one, and removing the
 * guard in front of its switch rendered every field as the last case's control
 * while the suite stayed green — a list of what is owned and a switch deciding
 * what each one renders as are two descriptions of one thing, and this is the
 * one that cannot disagree with itself.
 *
 * The second: ***a field with no case is visible and read-only***, through the
 * read surface's own `ReadOnlyField` ([ByField.tsx](../library/ByField.tsx)), so
 * a field added to `PlotHook` later arrives in this editor **shown and
 * unwritable** rather than invisible. [10 §2.1] forbids a hidden field, and an
 * editor that silently omitted one would be the reason somebody could not
 * discover it exists. `id` is the standing case: addressed by every other
 * hook's `blockedBy`, never typed by anybody.
 *
 * **Rows come from the schema, so the order and the labels are the file's.**
 * `fieldsOf(plotHookSchema(), hook)` is the same derivation the read surface
 * uses, which is [polish §1](../../../../docs/design/workplan/06-polish.md)'s
 * *one description of a kind's fields, two renderings of it* holding inside a
 * single form — this one alternates between the two renderings field by field.
 *
 * ***Two disclosures, and deliberately only two.*** A `LoreEntry` has around
 * forty fields and needs [10 §11.2d]'s whole banner apparatus; a `PlotHook` has
 * eight, so the disclosure problem barely exists here and inventing groups for
 * it would be a second arrangement of a schema that declares none. What is
 * folded is the two fields that are *structures* — `notBefore`, which is a pair
 * of gates most hooks never set, and `introduces`, which is a whole character
 * arrival with a list inside it. Everything else stands in place.
 */

/**
 * ***The words for a reference that resolves to nothing*** (2026-10-10) — the
 * badge `BookScope` and `MembersField` draw, in this field's own namespace for
 * the catalogue's *one namespace, one source of English* rule, and with a title
 * that says what a dangling value does *on a hook*, which is not what it does
 * on a book or a World.
 *
 * The two titles differ because the two fields fail differently. An `involves`
 * entry naming nobody retires the hook
 * ([03 §4.1](../../../../docs/design/03-data-model.md)): its cast is gone, so
 * it is never eligible — the engine resolves the `Ref` by id
 * (`resolvableActors`) and refuses it as `cast-gone`. *By id only*, which is
 * narrower than [04 §3](../../../../docs/design/04-schemas.md)'s *exact id,
 * then case-insensitive name*: a typed-in *Vera Kohl* would resolve by name
 * there and does not here. The badge follows the engine, because the engine
 * is what retires the hook.
 *
 * A `blockedBy` entry naming no hook here blocks nothing on this object, and
 * is kept rather than dropped for `NotBefore`'s reason below: the id may
 * resolve to a hook another carrier brings into the same session.
 *
 * ***And each said again in words under the field*** (2026-10-10, on review):
 * `missingActors` and `missingHooks` are the field's hint while any of its
 * values is Missing, because the title above is the only place the badge's
 * reason was said and a `title` reaches neither a touch screen nor a keyboard
 * (`CastPanel`'s rule). `MembersField`'s `missingNote` is the precedent for
 * the sentence; the hint is the place for it because `TokenField` makes the
 * hint the box's description, so it is read at the field as well as seen
 * under it. `unanswered` is the same move for a list still in flight or never
 * read: without it the first thing a strict picker over no list says is
 * *Nothing matches Vera*, blaming the name for the request.
 */
const WORDS = labels('editor.hook-refs', {
  missing: 'Missing',
  missingActor:
    'Not in your library — deleted, never on this install, or typed in rather than chosen. A hook whose cast is gone is quietly retired, so this one will not fire while it names somebody missing. Remove it here if you no longer want it.',
  missingHook:
    'Not one of the other hooks on this object — removed, or never here. It is kept because a hook another treatment, setup or book brings into play may carry this id. Remove it here if you no longer want it.',
  missingActors:
    'A character marked Missing is not in your library, and this hook will not fire while it names somebody missing. Remove them here if you no longer want them.',
  missingHooks:
    'A hook marked Missing is not one of the other hooks on this object. It blocks this one only if a hook with its id is brought into play from elsewhere and fires; remove it here if you no longer want it.',
  unanswered: 'Nobody can be chosen until your library has been read.',
});

export function HookFields(props: {
  hook: PlotHook;
  /** One field changed. The list is the caller's; this only describes the edit. */
  onPatch: (patch: HookPatch) => void;
  /**
   * The introduction, set or **removed** — the one field whose absence is a
   * different claim from its emptiness, so the one that cannot go through
   * `onPatch`.
   *
   * `introduces` present means *this hook **is** a character's arrival*, which
   * [04 §6.1a] says inverts the hook's whole eligibility test: an ordinary hook
   * wants its cast alive and met, an introduction wants its subject **not** met.
   * An empty `Introduction` would therefore be a hook claiming to be an arrival
   * for nobody, ineligible forever with a visible reason. So turning it off
   * removes the key, and an update answering `undefined` is how this editor
   * says so.
   *
   * ***An update over the arrival as it is, not the arrival***
   * (2026-09-27). An entrance's text carries an assist, and its result lands
   * through the change handler of the render that started it; an arrival built
   * from that render's hook put back every other entrance as it was at the
   * click. So this passes a function of the arrival the hook holds when the
   * change lands, and the caller applies it there.
   */
  onIntroduce: (update: (held: Introduction | undefined) => Introduction | undefined) => void;
  /**
   * The other hooks on this carrier — what `blockedBy` and `notBefore.afterHook`
   * can point at, offered by title rather than by id.
   *
   * *The carrier's, not the session's pool.* A hook can only name a sibling it
   * travels with: the pool a session builds is four sources deep
   * ([03 §4.1](../../../../docs/design/03-data-model.md)) and exists only while
   * that session does, so an id borrowed from it would be an eligibility gate
   * that could never resolve in the object it was saved into.
   */
  siblings: PlotHook[];
  /**
   * The library's actors, for the two fields that point at one.
   *
   * ***Undefined until the library has answered*** (2026-10-10), where it was
   * `[]` — `MembersField`'s `candidates` rule. The two are different claims
   * now that `involves` marks an actor the library does not have as
   * *Missing*: an empty answer says nobody is there, and a pending one says
   * nothing yet, and a badge drawn on the second would be the field asserting
   * a deletion because a request was slow.
   */
  actors: { id: string; name: string }[] | undefined;
}): JSX.Element {
  const rows = fieldsOf(plotHookSchema(), props.hook);

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <HookRow key={row.key} row={row} {...props} />
      ))}
    </div>
  );
}

/**
 * One field — a control where this editor owns it, the read-only rendering
 * where it does not.
 *
 * The branch is on the property name, which is an identifier rather than
 * displayed text; the label beside it is `labelFor`'s in both arms, so the words
 * a reader sees are the schema's either way.
 */
function HookRow(props: {
  row: FieldRow;
  hook: PlotHook;
  onPatch: (patch: HookPatch) => void;
  onIntroduce: (update: (held: Introduction | undefined) => Introduction | undefined) => void;
  siblings: PlotHook[];
  actors: { id: string; name: string }[] | undefined;
}): JSX.Element {
  const { row, hook, onPatch } = props;

  switch (row.key) {
    case 'title':
      return (
        <Field
          label={row.label}
          path={`hooks.${hook.id}.${row.key}`}
          value={hook.title}
          onChange={(title) => {
            onPatch({ title });
          }}
          hint="For your list, and for naming this hook to another one. Never injected."
        />
      );
    case 'premise':
      /**
       * ***The path is the hook's id and the field's key*** — [10 §11.2],
       * [P11.2]. Hooks are reordered by the nudge buttons beside them, so an
       * index in this key would attribute one hook's generated prose to
       * whichever hook took its place — worse than no provenance, because it
       * reads as an answer.
       */
      return (
        <Field
          label={row.label}
          path={`hooks.${hook.id}.${row.key}`}
          value={hook.premise}
          onChange={(premise) => {
            onPatch({ premise });
          }}
          multiline
          rows={4}
          hint="What happens. Held out of the story until the selector judges the moment, and never shown before it fires."
        />
      );
    case 'magnitude':
      return (
        <EnumField
          row={row}
          value={hook.magnitude}
          onChange={(magnitude) => {
            onPatch({ magnitude: magnitude as PlotHook['magnitude'] });
          }}
          hint="Blast radius rather than location: how big a turn this is."
        />
      );
    case 'delivery':
      return (
        <EnumField
          row={row}
          value={hook.delivery}
          onChange={(delivery) => {
            onPatch({ delivery: delivery as PlotHook['delivery'] });
          }}
          hint="Woven as guidance, expanded from the premise, or played immediately."
        />
      );
    case 'weight':
      return (
        <WeightField
          label={row.label}
          value={hook.weight}
          onChange={(weight) => {
            onPatch({ weight });
          }}
        />
      );
    case 'once':
      return (
        <CheckboxField
          label={row.label}
          checked={hook.once}
          onChange={(once) => {
            onPatch({ once });
          }}
          hint="Off lets this hook fire again later. It is moot on a hook that introduces somebody, which is self-limiting anyway."
        />
      );
    case 'involves':
      return (
        <ActorRefs
          label={row.label}
          values={hook.involves}
          actors={props.actors}
          onChange={(involves) => {
            onPatch({ involves });
          }}
          hint="Moot if these are dead, gone, or never introduced. Firing a hook about somebody who died four sessions ago is what this prevents."
        />
      );
    case 'blockedBy':
      return (
        <SiblingHooks
          label={row.label}
          values={hook.blockedBy ?? []}
          siblings={props.siblings}
          onChange={(blockedBy) => {
            // Emptied is **absent**, not `[]` — `newHook`'s rule for the three
            // optional fields, kept by the control that can undo it. A hook
            // whose last blocker was removed has to come back byte-identical to
            // one that never had the field, or *never mind* leaves a mark in
            // the portable file, every export and every diff.
            onPatch({ blockedBy: blockedBy.length === 0 ? undefined : blockedBy });
          }}
          hint="Hooks that would make this one nonsensical once they have fired."
        />
      );
    case 'notBefore':
      return <NotBefore row={row} hook={hook} siblings={props.siblings} onPatch={onPatch} />;
    case 'introduces':
      return (
        <Introduces row={row} hook={hook} actors={props.actors} onIntroduce={props.onIntroduce} />
      );
    default:
      return (
        <ReadOnlyField row={row} value={(hook as unknown as Record<string, unknown>)[row.key]} />
      );
  }
}

/**
 * A closed union, as a picker over the schema's own arms.
 *
 * **The options are read out of the schema rather than listed here**, which is
 * the argument `positionOptions` makes in [EntryFields](./EntryFields.tsx) and
 * `AdminInstall` made before it: a hand-written list of a union's values is a
 * second copy of the schema, and a second copy drifts. `labelFor` turns the
 * value into words by the same rule every field label is derived by, so
 * `sweeping` reads as *Sweeping* without a table of nicer English.
 *
 * *An unreadable schema falls back to the hook's own value*, so a build that
 * cannot parse what it was given renders a picker holding what is stored rather
 * than an empty one that would clear the field on the first change event.
 */
function EnumField(props: {
  row: FieldRow;
  value: string;
  onChange: (value: string) => void;
  hint: string;
}): JSX.Element {
  const values = choicesOf(props.row.schema) ?? [props.value];
  return (
    <SelectField
      label={props.row.label}
      value={props.value}
      options={values.map((value) => [value, labelFor(value)] as const)}
      onChange={props.onChange}
      hint={props.hint}
    />
  );
}

/**
 * A number held as text while it is being typed.
 *
 * **The text is state and the number is derived**, for the reason
 * [form.ts](./form.ts) keeps its own buffers and `NumberField` takes a string:
 * `''` and `-` are states a person passes through, and a control that read the
 * empty box as zero would write a weight nobody chose into the object on the
 * way to typing a different one.
 *
 * *`weight` is required, so a blank box writes nothing at all* rather than
 * removing the field — the last number typed stands until another one is. The
 * box is allowed to look empty while that is true, which is the honest half:
 * what is in the object is what the hook had, and what is on screen is what the
 * person is in the middle of doing.
 *
 * **Re-seeded on the value rather than on the text**, the way `LinesField` is
 * next door: typing hands the parent the number this component produced, so it
 * comes back equal and the buffer is left alone; a value from anywhere else — a
 * version restored, a newer copy after a 412 — differs, and re-seeds.
 */
function WeightField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  const [held, setHeld] = useState<{ text: string; from: number }>(() => ({
    text: String(props.value),
    from: props.value,
  }));

  if (props.value !== held.from) {
    setHeld({ text: String(props.value), from: props.value });
  }

  return (
    <NumberField
      label={props.label}
      value={held.text}
      onChange={(text) => {
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed)) {
          setHeld({ text, from: props.value });
          return;
        }
        setHeld({ text, from: parsed });
        props.onChange(parsed);
      }}
      hint="Relative likelihood among the hooks that are eligible at the same moment."
    />
  );
}

/**
 * A list of actors, committed as `Ref`s.
 *
 * **The combobox deals in ids and this rebuilds the `Ref`s around them**, which
 * is what keeps [04 §3](../../../../docs/design/04-schemas.md)'s link intact: a
 * `Ref` carries a name for display and name-fallback resolution and an optional
 * `fingerprint` recording what it looked like when it was linked. A control that
 * minted a fresh `Ref` per commit would drop the fingerprint of every actor
 * somebody merely re-ordered, so a ref already held comes through **by
 * identity** and only a newly added one is built.
 *
 * *An actor the library no longer has keeps its chip and its stored name.* 03
 * §4.1 says a dangling `involves` entry retires a hook quietly, which is mercy
 * for a cast that is gone — and a control that silently dropped the ref would
 * be doing the retiring on the author's behalf without telling them.
 *
 * ***Only an actor the library offers can be added*** (2026-10-10,
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md)). The combobox is
 * `TokenField`, built for tags, where Enter, a comma and leaving the box all
 * commit whatever was typed — and until today this took what it was handed and
 * built `{ id: typed, name: typed }` around it: a `Ref` whose id is somebody's
 * *name*, resolving to nothing anywhere. That is the paragraph above's mercy
 * turned on the author: the hook was retired quietly by a typo, and nothing
 * said so. So the field is `strict` — typing narrows the options, Enter takes
 * the one it is on or says nothing matches, a comma is part of a name, and a
 * term left in the box stays a search — and the `?? id` in `rebuilt` is a
 * type's fallback rather than a path anything takes, which `pickable` sees to:
 * `strict` alone left one, an id with a space at either end. *(Closed in
 * `TokenField` the same day, 2026-10-10: `strict` now commits an offered id
 * as given — `pickable`'s dated note.)*
 *
 * ***What a chip shows is what its remove button and the live region say*** —
 * `renderToken` and `nameOf` read one function. They had read two: the chip
 * drew the stored name and the button said *Remove* and the id, which for an
 * actor made here is a uuid read out as hex.
 *
 * ***A ref already held stays as it is, however it got there.*** One typed in
 * before today — `{ id: 'Old Tom', name: 'Old Tom' }` — is in files now, and
 * this control is not the place to decide what its author meant: it keeps its
 * chip under its stored name, is marked *Missing* once the library has
 * answered (`BookScope`'s and `MembersField`'s badge, and their rule that a
 * list still loading is not a deletion), and goes when a person removes it.
 * Nothing here rewrites it or drops it — including in the rebuild after
 * somebody adds a second actor, the moment a control like this is likeliest to.
 *
 * ***What Missing does is said in words, not only in the badge's title***
 * (2026-10-10, on review) — `WORDS`' `missingActors`, as the field's hint
 * while any actor it names is Missing, and `unanswered` while there is no
 * list to say that of.
 *
 * ~~***A Missing ref taken off by Backspace cannot be typed back, and that is a
 * known cost*** (2026-10-10, on review). `TokenField` removes the last chip on
 * Backspace in an empty box, so a key held to clear a search can run on into
 * the chips. Before `strict` a value removed that way could be retyped; now
 * only an offered one can, and nobody offers a ref the library does not have —
 * so the way back is leaving the editor without saving. The live region does
 * say *Removed Old Tom*.~~ **Repaired in `TokenField` the same day**
 * (2026-10-10, the follow-up this paragraph asked for): under `strict`,
 * Backspace in an empty box moves to the last chip's remove button and does
 * not press it, a held key never presses it, and nothing is announced until a
 * second, deliberate press does — `TokenField.test.tsx`'s *a strict field,
 * over ids*. ~~The repair is `TokenField`'s, because `BookScope`'s Missing ids
 * have the same need: under `strict`, Backspace in an empty box moving to the
 * last chip's remove button rather than pressing it.~~ The in-file alternative
 * — remembering what was held at mount and offering it back — was declined: a
 * third source of values for `pickable` and `rebuilt` to agree with, for one
 * caller of two.
 */
function ActorRefs(props: {
  label: string;
  values: Ref[];
  /** Undefined until the library has answered — see `HookFields`' `actors`. */
  actors: { id: string; name: string }[] | undefined;
  onChange: (values: Ref[]) => void;
  hint: string;
}): JSX.Element {
  // The first ref under an id is the one drawn: a hand-edited file can name one
  // actor twice, and `rebuilt` keeps both, so either would do — this one is
  // the one a reader of the file meets first.
  const held = new Map<string, Ref>();
  for (const ref of props.values) if (!held.has(ref.id)) held.set(ref.id, ref);
  const known = new Map((props.actors ?? []).map((actor) => [actor.id, actor.name] as const));
  const answered = props.actors !== undefined;
  const said = !answered
    ? WORDS.unanswered
    : props.values.some((ref) => !known.has(ref.id))
      ? WORDS.missingActors
      : null;

  /**
   * The name a chip is drawn and spoken under: the name stored in the `Ref`,
   * else the library's, else the id.
   *
   * *The stored name first, not the library's*, which is what this control
   * always drew: it is what the file says and what every export of it will
   * say, and a chip that quietly showed the newer name would be a surface
   * disagreeing with the object it edits. *A blank stored name is no name* —
   * a hand edit can leave one — because a chip with no words on it, and a
   * button called *Remove*, are a row nobody can decide about (`MembersField`'s
   * `shownName`, for the same reason).
   */
  function nameOf(id: string): string {
    const stored = held.get(id)?.name;
    return stored !== undefined && stored.trim() !== '' ? stored : (known.get(id) ?? id);
  }

  return (
    <TokenField
      label={props.label}
      values={props.values.map((ref) => ref.id)}
      strict
      nameOf={nameOf}
      onChange={(ids) => {
        const next = pickable(ids, held, known);
        if (next !== null) props.onChange(rebuilt(next, props.values, known));
      }}
      optionsFor={(term) => offer(props.actors ?? [], term, held)}
      renderToken={(id) =>
        answered && !known.has(id) ? (
          <Unresolved name={nameOf(id)} title={WORDS.missingActor} />
        ) : (
          nameOf(id)
        )
      }
      hint={said === null ? props.hint : `${props.hint} ${said}`}
    />
  );
}

/**
 * The ids `TokenField` handed back, as ids this field may write — **every one
 * already held, as it is, and a new one only if it was offered** — or `null`
 * when a new one cannot be named, and the pick writes nothing.
 *
 * ***`BookScope`'s `pickableIds`, for its reason and one more*** (2026-10-10,
 * on review). Its reason: `strict` is the combobox's promise, and this is the
 * field keeping it rather than trusting it. The one more: `TokenField` trims
 * what it commits, an option's value included, and `Id` is unpatterned — so an
 * id a hand-edited file holds with a space at either end came back without
 * it, and the ref built around that named nobody, which is the dangling entry
 * the field exists not to write. The trimmed id is put back to the one offered
 * id it was trimmed from; two that trim alike cannot be told apart, and
 * neither is guessed at. The trim is `TokenField`'s to stop doing under
 * `strict`, and when it does this is a guard that never fires.
 *
 * ***It has stopped, so the remap below no longer fires*** (2026-10-10, the
 * follow-up the sentence above waited for): under `strict`, `TokenField`
 * commits an offered value exactly as given, so an id with a space around it
 * comes back as it went out and passes on `offered.has`. The remap and its
 * `null` are kept rather than deleted — the first half of this guard is the
 * field keeping `strict`'s promise instead of trusting it, and the second is
 * the same distrust for the one way the promise was already broken once. A
 * pick reaching the remap now means `TokenField` trims again.
 *
 * ***No test reaches either half now, and that is by design*** (2026-10-10,
 * the fix's own review): a strict `TokenField` commits only an offered value,
 * exactly, so nothing it hands back is dropped or remapped — `pickable` taken
 * out of both pickers leaves every suite in `editor/` green. It is held by
 * reading, not by a test. Testing it directly would mean exporting it from a
 * component file for its tests alone, which this follow-up left undone.
 *
 * *Without `pickableIds`' dedupe*, which would fold a hand-edited file's two
 * refs to one actor into one — `rebuilt`'s case, and not this field's to
 * repair.
 */
function pickable(
  ids: readonly string[],
  held: Pick<ReadonlySet<string>, 'has'>,
  offered: ReadonlyMap<string, unknown>,
): string[] | null {
  const out: string[] = [];
  for (const id of ids) {
    if (held.has(id) || offered.has(id)) {
      out.push(id);
      continue;
    }
    const [meant, ...more] = [...offered.keys()].filter((one) => one.trim() === id);
    if (meant === undefined || more.length > 0) return null;
    out.push(meant);
  }
  return out;
}

/**
 * The `Ref`s for the ids the combobox handed back — **the held ones by
 * identity**, in the order given, and a new one built only for an id nothing
 * held.
 *
 * *Matched in turn rather than looked up*, so a file that names one actor
 * twice — two refs, perhaps with two fingerprints — comes back with both as
 * they were rather than with the last one twice. The combobox cannot make that
 * file (it refuses a value it already carries), but it can be handed one, and
 * an edit beside it is not licence to rewrite it.
 */
function rebuilt(
  ids: readonly string[],
  held: readonly Ref[],
  known: ReadonlyMap<string, string>,
): Ref[] {
  const waiting = new Map<string, Ref[]>();
  for (const ref of held) waiting.set(ref.id, [...(waiting.get(ref.id) ?? []), ref]);
  return ids.map((id) => waiting.get(id)?.shift() ?? { id, name: known.get(id) ?? id });
}

/**
 * A chip whose value resolves to nothing: drawn under the name it is spoken
 * by, with `BookScope`'s *Missing* badge beside it.
 *
 * *The badge is the chip's, never the remove button's*: `TokenField` names the
 * button from `nameOf` alone, so it says *Remove Old Tom* and not *Remove Old
 * Tom Missing* — the word is read where the chip is read, and its reason sits
 * in the title, as `BookScope`'s does.
 */
function Unresolved(props: { name: string; title: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-sm text-ink">{props.name}</span>
      <Badge tone="danger" title={props.title}>
        {WORDS.missing}
      </Badge>
    </span>
  );
}

/** The actors this term matches that are not already carried. */
function offer(
  actors: { id: string; name: string }[],
  term: string,
  held: ReadonlyMap<string, unknown>,
): TokenOption[] {
  const wanted = term.trim().toLowerCase();
  return actors
    .filter((actor) => !held.has(actor.id))
    .filter((actor) => wanted === '' || actor.name.toLowerCase().includes(wanted))
    .map((actor) => ({ value: actor.id, label: actor.name }));
}

/**
 * A list of sibling hooks, by title.
 *
 * The same combobox over a different set, and the same reason for the mapping:
 * what is stored is an **id**, because a hook's title is editable and a gate
 * that pointed at one would come undone the moment somebody renamed it. What is
 * offered and what is drawn is the title, because an id is not something anybody
 * can pick from a list.
 *
 * ***And the same three corrections, on the same day*** (2026-10-10,
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md)), because this had
 * the same flaw over a different set. **`strict`**: a title typed and left, or
 * typed and Entered, became a hook id that names no hook — and its chip drew
 * the typed text, so *The marriage* typed by hand looked exactly like a gate on
 * the sibling of that name while it gated on nothing at all, since an id no
 * hook carries is an id that never fires. **`nameOf`**: the remove button and
 * the live region spoke the id, which for a hook made here is a uuid; they now
 * say the title the chip shows. **A held id that names no hook here keeps its
 * chip** — under its id, since `blockedBy` stores nothing else to call it —
 * marked *Missing*, and is never dropped: `NotBefore`'s *a hook not on this
 * object*, for its reason, that the id may resolve to a hook another carrier
 * brings into play. *No loading rule*, unlike the actors above: the siblings
 * are this object's own hooks, in hand whenever this field is.
 *
 * The Missing gate's reason is said in words under the field as well as in the
 * badge's title, `ActorRefs`' `missingActors` for its reason; and a pick goes
 * through `pickable` there, for the same trimmed id. ~~A Missing gate taken off
 * by Backspace cannot be typed back either — `ActorRefs`' known cost, and
 * sharper here, where a Missing gate is kept because its hook may yet arrive.~~
 * *Struck 2026-10-10*: repaired in `TokenField` the same day, as `ActorRefs`'
 * note says — a strict Backspace moves to the remove button and does not
 * press it — and the trimmed id `pickable` mapped back no longer reaches it.
 *
 * ***Two buttons can now share a name, and that is a known cost rather than an
 * oversight.*** The card of hook *The marriage* has *Remove The marriage*, and
 * so does this chip on any other card gated on it. The chip's is inside a field
 * labelled *Blocked by* and removes only the gate; the card's asks before it
 * removes anything. Telling them apart in a list of buttons would take one of
 * two changes, neither made here: the card's button renamed — `HookList`'s
 * `removeLabel`, a name the lorebook editor's suite and anybody's habits remove
 * a hook by — or a remove label of `TokenField`'s own, so the chip's could say
 * which gate it lifts while its announcements keep the title. (This said only
 * the second until review, on 2026-10-10, found the first.)
 */
function SiblingHooks(props: {
  label: string;
  values: string[];
  siblings: PlotHook[];
  onChange: (values: string[]) => void;
  hint: string;
}): JSX.Element {
  const held = new Set(props.values);
  const titles = new Map(props.siblings.map((hook) => [hook.id, nameOfHook(hook)] as const));
  const missing = props.values.some((id) => !titles.has(id));

  /** What a chip is drawn and spoken as: the hook's title, else its id. */
  function nameOf(id: string): string {
    return titles.get(id) ?? id;
  }

  return (
    <TokenField
      label={props.label}
      values={props.values}
      strict
      nameOf={nameOf}
      onChange={(ids) => {
        const next = pickable(ids, held, titles);
        if (next !== null) props.onChange(next);
      }}
      optionsFor={(term) => {
        const wanted = term.trim().toLowerCase();
        return props.siblings
          .filter((hook) => !held.has(hook.id))
          .filter((hook) => wanted === '' || nameOfHook(hook).toLowerCase().includes(wanted))
          .map((hook) => ({ value: hook.id, label: nameOfHook(hook) }));
      }}
      renderToken={(id) =>
        titles.has(id) ? nameOf(id) : <Unresolved name={nameOf(id)} title={WORDS.missingHook} />
      }
      hint={missing ? `${props.hint} ${WORDS.missingHooks}` : props.hint}
    />
  );
}

/**
 * The two gates that say *not yet* — a turn count and a hook that has to have
 * fired first.
 *
 * **Folded, because most hooks have neither**, and a pair of empty boxes on
 * every hook in the list is the noise [10 §11.2d]'s disclosure argument is
 * about. The summary says what is set, so a closed fold never hides a gate
 * somebody would be surprised by — [10 §2.1]'s rule, which is the whole licence
 * for a disclosure being here at all.
 *
 * ***Cleared to an **absent** `notBefore`, not to an empty one.*** The engine
 * reads the two the same way — an absent half is *no constraint*
 * (`packages/server/src/sessions/hooks.ts`) — so this is not about eligibility.
 * It is about what the file says: [`newHook`](./hook-form.ts) states the rule
 * that `blockedBy`, `notBefore` and `introduces` are *absent rather than empty,
 * which is what [04 §2] means by additive — a hook that has never been given an
 * eligibility filter says nothing about one*, and a control that wrote
 * `notBefore: {}` on the way back from a floor somebody typed and thought
 * better of would leave a hook that is no longer byte-identical to one that
 * never had a gate, in the portable file and in every diff of it. `patchHook`
 * takes `undefined` as *remove the key*, so the removal costs no extra callback
 * — which is what the paragraph this replaces was trading the rule away for.
 */
function NotBefore(props: {
  row: FieldRow;
  hook: PlotHook;
  siblings: PlotHook[];
  onPatch: (patch: HookPatch) => void;
}): JSX.Element {
  const gate = props.hook.notBefore ?? {};

  function set(next: { turn?: number; afterHook?: string }): void {
    props.onPatch({ notBefore: Object.keys(next).length === 0 ? undefined : next });
  }

  return (
    <details>
      <summary className={disclosure.quiet}>
        <SubsectionTitle as="h4">{notBeforeSummary(gate, props.row.label)}</SubsectionTitle>
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <NumberField
          label="Turn"
          value={gate.turn === undefined ? '' : String(gate.turn)}
          min={0}
          onChange={(text) => {
            const parsed = Number(text);
            const blank = text.trim() === '' || !Number.isFinite(parsed);
            // Spread conditionally rather than assigning `undefined`:
            // `exactOptionalPropertyTypes` makes `{ turn: undefined }` and *no
            // `turn`* different objects, and only the second one is *no floor*.
            set({
              ...(gate.afterHook === undefined ? {} : { afterHook: gate.afterHook }),
              ...(blank ? {} : { turn: parsed }),
            });
          }}
          hint="How many turns have to have happened first. Blank is no floor."
        />
        <SelectField
          label="After hook"
          value={gate.afterHook ?? ''}
          options={[
            ['', 'No hook first'],
            ...props.siblings.map((hook) => [hook.id, nameOfHook(hook)] as const),
            /**
             * ***A gate naming a hook this object does not carry is shown***
             * (2026-09-27). Removed here, promoted without its sibling, or
             * imported — the value named no option, so the select fell back to
             * its first and read *No hook first* while the engine held the hook
             * back; and choosing that option fired no change, so the gate
             * could not be cleared. Not *removed*: the id may resolve to a hook
             * on another carrier in play.
             */
            ...(gate.afterHook !== undefined &&
            !props.siblings.some((hook) => hook.id === gate.afterHook)
              ? [[gate.afterHook, 'A hook not on this object'] as const]
              : []),
          ]}
          onChange={(id) => {
            set({
              ...(gate.turn === undefined ? {} : { turn: gate.turn }),
              ...(id === '' ? {} : { afterHook: id }),
            });
          }}
          hint="This one waits until that one has fired."
        />
      </div>
    </details>
  );
}

/** What the closed gate fold says about itself — the whole phrase, computed. */
function notBeforeSummary(gate: { turn?: number; afterHook?: string }, label: string): string {
  if (gate.turn !== undefined && gate.afterHook !== undefined) {
    return `${label} — a turn and another hook`;
  }
  if (gate.turn !== undefined) return `${label} — turn ${String(gate.turn)}`;
  if (gate.afterHook !== undefined) return `${label} — after another hook`;
  return label;
}

/**
 * The hook as a character's arrival — [04 §6.1a], added to the schema at
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md) and given a
 * surface here for the first time.
 *
 * **Choosing the subject is what turns it on, and choosing nobody is what turns
 * it off.** There is no separate switch, because there is nothing an
 * introduction without a subject could mean: the field exists to declare *who
 * arrives*, and 04 §6.1a makes a dangling subject the one place a `Ref`'s
 * never-block rule needs a second answer — ineligible, with a visible reason,
 * rather than quietly retired.
 *
 * ***The entrances are content and the premise is the instruction***, which is
 * the division the schema draws and the reason both are editable here: with
 * entrances present the selector weaves the one it picks, and with none the
 * premise is expanded into an arrival. The **note** on an entrance is neither —
 * it is guidance to the *selector* about when that arrival fits, which 04 §6.1a
 * is careful to distinguish from an `Opening.note`'s *this steers the
 * expansion*.
 *
 * *`primaryEntranceId` is **not** always-use-this* — the selector otherwise
 * draws across all of them — so the empty option is the ordinary state of a
 * hook whose author has not picked a favourite, and it is spelled as one rather
 * than as an absence somebody has to infer.
 *
 * ***The subject's `Ref` is rebuilt on a change of subject, which `ActorRefs`
 * above is careful not to do, and the asymmetry is accepted rather than
 * overlooked.*** That control keeps a held `Ref` by identity so a `fingerprint`
 * survives somebody merely re-ordering `involves`; here there is exactly one
 * ref, the only edit that touches it is *choose somebody else*, and a ref for
 * the new subject was never held to keep. What is genuinely lost is the
 * fingerprint of a subject switched away from and back again in one sitting —
 * a re-link of a link the author just broke, which is what the field records
 * anyway, and not worth a component that remembers refs it no longer shows.
 */
function Introduces(props: {
  row: FieldRow;
  hook: PlotHook;
  actors: { id: string; name: string }[] | undefined;
  onIntroduce: (update: (held: Introduction | undefined) => Introduction | undefined) => void;
}): JSX.Element {
  const held = props.hook.introduces;
  const entrances = held?.entrances ?? [];
  // Nobody to offer until the library answers — what `[]` meant here before
  // `actors` could say *not yet*. The held subject is offered either way, below.
  const cast = props.actors ?? [];

  /**
   * Fields of an arrival that exists, written over the arrival as it is when
   * the write lands — and nothing at all if, by then, it has been turned off.
   */
  function set(next: Partial<Introduction>): void {
    props.onIntroduce((current) => (current === undefined ? current : { ...current, ...next }));
  }

  return (
    <details>
      <summary className={disclosure.quiet}>
        <SubsectionTitle as="h4">{introducesSummary(held, props.row.label)}</SubsectionTitle>
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <Fine>
          A hook that introduces somebody is eligible only while they have not been met, which is
          the opposite of the test every other hook gets.
        </Fine>

        <SelectField
          label="Arrives"
          value={held?.actor.id ?? ''}
          options={[
            ['', 'Not an arrival'],
            ...cast.map((actor) => [actor.id, actor.name] as const),
            // An actor the library no longer has still has to be shown, or the
            // picker would silently re-point the hook at somebody else.
            ...(held !== undefined && !cast.some((actor) => actor.id === held.actor.id)
              ? [[held.actor.id, held.actor.name] as const]
              : []),
          ]}
          onChange={(id) => {
            if (id === '') {
              props.onIntroduce(() => undefined);
              return;
            }
            const name = cast.find((actor) => actor.id === id)?.name ?? id;
            props.onIntroduce((current) =>
              current === undefined
                ? { actor: { id, name }, entrances: [], primaryEntranceId: null }
                : { ...current, actor: { id, name } },
            );
          }}
          hint="Who this hook brings into the story. Choosing nobody makes it an ordinary hook again."
        />

        {held === undefined ? null : (
          <>
            <Entrances
              hookId={props.hook.id}
              entrances={entrances}
              onChange={(update) => {
                props.onIntroduce((current) => {
                  if (current === undefined) return current;
                  const next = update(current.entrances);
                  return {
                    ...current,
                    entrances: next,
                    // A primary that has just been removed stops being one,
                    // rather than staying as an id pointing at nothing — which a
                    // manual fire would read as *use this* and find nothing to
                    // use. Read off `current`, not the render: the primary may
                    // have been chosen since this change was started.
                    ...(current.primaryEntranceId !== null &&
                    !next.some((entrance) => entrance.id === current.primaryEntranceId)
                      ? { primaryEntranceId: null }
                      : {}),
                  };
                });
              }}
            />
            <SelectField
              label="Primary entrance"
              value={held.primaryEntranceId ?? ''}
              options={[
                ['', 'No favourite'],
                ...entrances.map((entrance) => [entrance.id, nameOfEntrance(entrance)] as const),
              ]}
              onChange={(id) => {
                set({ primaryEntranceId: id === '' ? null : id });
              }}
              hint="The one a manual fire uses, and the one shown first. The selector still draws across all of them."
            />
          </>
        )}
      </div>
    </details>
  );
}

/** What the closed arrival fold says about itself. */
function introducesSummary(held: Introduction | undefined, label: string): string {
  if (held === undefined) return label;
  if (held.entrances.length === 0) return `${label} — ${held.actor.name}`;
  return `${label} — ${held.actor.name}, ${String(held.entrances.length)} written`;
}

/**
 * The written alternates, added and removed one at a time.
 *
 * **Every entrance is shown in full here and by label everywhere else**, and
 * that asymmetry is the feature rather than an inconsistency: [08 §6] and
 * [10 §10.1] both require that an unfired entrance is shown *by label, never by
 * text*, because an unfired entrance is hidden content and a panel that spoils
 * the arrival defeats the hook. This is the one surface where the author is
 * writing the thing, so this is the one surface where the text belongs.
 *
 * *Empty is legal*, which is why there is no floor on the list: with no
 * entrances the premise steers an improvised arrival, and an empty premise is
 * legal when entrances are present.
 */
function Entrances(props: {
  hookId: string;
  entrances: Entrance[];
  /** A change to the entrances as they are when it lands — see `onIntroduce`. */
  onChange: (update: (entrances: Entrance[]) => Entrance[]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <SubsectionTitle as="h4">Entrances</SubsectionTitle>
      {props.entrances.length === 0 ? (
        <Fine>None written. The premise steers the arrival instead.</Fine>
      ) : null}

      {props.entrances.map((entrance, at) => (
        <div
          key={entrance.id}
          className="flex flex-col gap-3 rounded-control border border-line p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">{entranceHeading(at)}</p>
            <TwoStep
              label={removeEntranceLabel(entrance)}
              question="Remove this entrance? Nothing is written until you save."
              confirm="Remove"
              variant="quiet"
              size="tiny"
              onConfirm={() => {
                props.onChange((all) => all.filter((each) => each.id !== entrance.id));
              }}
            />
          </div>
          <Field
            label="Label"
            value={entrance.label}
            onChange={(label) => {
              props.onChange((all) => patchEntrance(all, entrance.id, { label }));
            }}
            hint="What a panel shows instead of the text. It exists so there is something to show that is not the spoiler."
          />
          <Field
            label="Text"
            path={`hooks.${props.hookId}.introduces.entrances.${entrance.id}.text`}
            value={entrance.text}
            onChange={(text) => {
              props.onChange((all) => patchEntrance(all, entrance.id, { text }));
            }}
            multiline
            rows={4}
            hint="The written arrival, woven when this entrance is the one chosen."
          />
          <Field
            label="Note"
            value={entrance.note ?? ''}
            onChange={(note) => {
              // Blanked is **absent**, which is `newEntrance`'s rule below: *an
              // entrance whose author has not said when it fits has not said it
              // fits nowhere*. The same edit the gate above makes, one level
              // down.
              props.onChange((all) =>
                patchEntrance(all, entrance.id, {
                  note: note.trim() === '' ? undefined : note,
                }),
              );
            }}
            hint="When this one fits — guidance to the selector, not to the narrator."
          />
        </div>
      ))}

      <div>
        <Button
          type="button"
          size="compact"
          onClick={() => {
            // Minted out here, where it runs once — React runs an updater twice
            // under StrictMode, and `primaryEntranceId` points at this id.
            const made = newEntrance();
            props.onChange((all) => [...all, made]);
          }}
        >
          Add an entrance
        </Button>
      </div>
    </div>
  );
}

/**
 * One entrance's fields changed — the same spread-over-the-object rule
 * [hook-form.ts](./hook-form.ts) keeps one level up, so a field a newer build
 * wrote into an entrance survives an edit to its label.
 *
 * *And the same `undefined` removes the key*, for `patchHook`'s reason read one
 * level down: `note` is the entrance's one optional field, and a blanked box has
 * to leave it the way `newEntrance` leaves it.
 */
function patchEntrance(
  entrances: Entrance[],
  id: string,
  fields: { [K in keyof Entrance]?: Entrance[K] | undefined },
): Entrance[] {
  return entrances.map((entrance) => {
    if (entrance.id !== id) return entrance;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...entrance, ...fields })) {
      if (value !== undefined) next[key] = value;
    }
    return next as unknown as Entrance;
  });
}

/**
 * A blank entrance.
 *
 * **`uuidv7` rather than an index or a slug of the label**, because
 * `primaryEntranceId` points at this id and both of the cheaper alternatives
 * move: an index changes when an entrance above it is removed, and a label is
 * the field an author is most likely to rewrite. The shared minter is the one
 * every other id in the repository comes from
 * ([ids.ts](../../../shared/src/ids.ts)), so an entrance written here and one
 * written by an importer are the same sort of thing.
 *
 * `note` is absent rather than empty: it is optional, and an entrance whose
 * author has not said when it fits has not said it fits nowhere.
 */
function newEntrance(): Entrance {
  return { id: uuidv7(), label: '', text: '' };
}

/** The heading over one entrance — a whole phrase, so no sentence is a shape. */
function entranceHeading(at: number): string {
  return `Entrance ${String(at + 1)}`;
}

/** The button's accessible name, built whole for the same reason. */
function removeEntranceLabel(entrance: Entrance): string {
  return entrance.label.trim() === '' ? 'Remove this entrance' : `Remove ${entrance.label.trim()}`;
}

/** What an entrance is called in a picker, when its author has not said. */
function nameOfEntrance(entrance: Entrance): string {
  return entrance.label.trim() === '' ? 'Unlabelled entrance' : entrance.label;
}

/** The name a hook is offered under, which is also what a control says. */
export function nameOfHook(hook: PlotHook): string {
  return hook.title.trim() === '' ? 'Untitled hook' : hook.title;
}
