// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlotHook, Ref } from '@storyengine/shared';

import { HookFields } from './HookFields.js';
import { newHook, patchHook } from './hook-form.js';

/**
 * ***The hook editor's two id pickers, picked and never typed*** (2026-10-10) —
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md).
 *
 * `involves` and `blockedBy` are lists of **ids** drawn through `TokenField`,
 * which was built for tags: Enter, a comma and leaving the box all committed
 * whatever had been typed. For a tag that is the point; for an id it made a
 * reference to something called by its own name. In `involves` that is the
 * sharp case — 03 §4.1 retires a hook whose cast is gone *quietly*, so a typo
 * disabled the hook without a word — and in `blockedBy` the typed title drew
 * exactly like the sibling it named while gating on nothing.
 *
 * ***Rendered on their own, with the actors handed in***, rather than through
 * `HookList` and a mocked library, because the claims here are about the two
 * controls and the one input that changes what they draw is *has the library
 * answered*: `undefined` and a list are both props here, and a rerender is the
 * answer arriving. That the list really is `undefined` while the request is in
 * flight is `HookList.test.tsx`'s claim, where the request is.
 *
 * `latest` is what the assertions read, for `HookList.test.tsx`'s reason: the
 * interesting half of every claim is the hook handed back, not what was drawn.
 */

const VERA = { id: 'actor-vera', name: 'Vera Kohl' };
const ASH = { id: 'actor-ash', name: 'Ash' };
const CAST = [VERA, ASH];

/** What the old field made of *Old Tom* typed and Entered — a name where an id goes. */
const OLD_TOM: Ref = { id: 'Old Tom', name: 'Old Tom' };

let latest: PlotHook;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * One hook, held the way `HookList` holds it: each patch applied by
 * `patchHook` to the hook as it is.
 */
function Harness(props: {
  hook: PlotHook;
  siblings?: PlotHook[];
  actors: { id: string; name: string }[] | undefined;
}): JSX.Element {
  const [hook, setHook] = useState(props.hook);
  return (
    <HookFields
      hook={hook}
      siblings={props.siblings ?? []}
      actors={props.actors}
      onPatch={(patch) => {
        setHook((was) => {
          const next = patchHook([was], was.id, patch)[0] ?? was;
          latest = next;
          return next;
        });
      }}
      onIntroduce={(update) => {
        setHook((was) => {
          const next = patchHook([was], was.id, { introduces: update(was.introduces) })[0] ?? was;
          latest = next;
          return next;
        });
      }}
    />
  );
}

function mount(
  hook: PlotHook,
  options: { siblings?: PlotHook[]; actors?: { id: string; name: string }[] | undefined } = {},
): ReturnType<typeof render> {
  latest = hook;
  return render(
    <Harness
      hook={hook}
      actors={'actors' in options ? options.actors : CAST}
      {...(options.siblings === undefined ? {} : { siblings: options.siblings })}
    />,
  );
}

function hook(title: string, over: Partial<PlotHook> = {}): PlotHook {
  return { ...newHook(title), ...over };
}

function involves(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Involves' });
}

function blockedBy(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Blocked by' });
}

/**
 * Everything a chip draws, its `×` aside — the half of *what you see is what
 * you hear* that a query by the button's name cannot reach, since the name is
 * `nameOf`'s and the chip is `renderToken`'s.
 */
function chipOf(remove: HTMLElement): string {
  const chip = remove.closest('li');
  if (chip === null) throw new Error('no chip around this button');
  return chip.textContent.replace(/×$/, '');
}

/**
 * What the field says under the box, as the box's description — the words a
 * screen reader reads at the field, and the only ones a touch screen or a
 * keyboard reaches, where a `title` reaches neither.
 */
function describedBy(box: HTMLElement): string {
  const id = box.getAttribute('aria-describedby');
  return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
}

/**
 * The three ways a tag field commits a term, as keystrokes after the term:
 * Enter, a comma, and leaving the box.
 */
const COMMITS_A_TAG = [
  ['Enter', '{Enter}'],
  ['a comma', ','],
  ['leaving the box', '{Tab}'],
] as const;

describe('involves', () => {
  /**
   * ***The flaw itself***, three ways. Each falsifies on `strict` taken off
   * `ActorRefs` — by the box, since `pickable` was added on review: the term is
   * committed, announced as *Added Old Tom* and cleared from the box, and the
   * guard then refuses to write it. With the guard off as well, the term
   * becomes `{ id: 'Old Tom', name: 'Old Tom' }` and the hook is retired by it,
   * which is the first two assertions' case.
   */
  it.each(COMMITS_A_TAG)(
    'commits nothing typed that no actor matches, on %s',
    async (_way, keys) => {
      const one = hook('The war');
      mount(one);

      await userEvent.type(involves(), `Old Tom${keys}`);

      expect(latest.involves).toEqual([]);
      expect(latest).toBe(one);
      // Left in the box, comma and all — a search, not a value thrown away.
      expect(involves()).toHaveProperty('value', keys === ',' ? 'Old Tom,' : 'Old Tom');
    },
  );

  /** A key that does nothing silently is the failure `TokenField` exists to avoid. */
  it('says so when Enter finds no actor to take', async () => {
    mount(hook('The war'));

    await userEvent.type(involves(), 'Old Tom{Enter}');

    expect(screen.getByText('Nothing matches Old Tom.')).toBeTruthy();
  });

  /**
   * Enter on an offered option stores **the id**, under the actor's name —
   * and says so by the name. Falsified by `nameOf` taken away (the live region
   * reads *Added actor-ash*), and by `rebuilt` building the ref from the id
   * alone.
   */
  it('takes the actor Enter is on, as a ref by id under its name', async () => {
    mount(hook('The war'));

    await userEvent.type(involves(), 'as{Enter}');

    expect(latest.involves).toEqual([{ id: 'actor-ash', name: 'Ash' }]);
    expect(screen.getByText('Added Ash. 1 in the list.')).toBeTruthy();
  });

  /**
   * ***What you see is what you hear.*** The chip says *Vera Kohl*; the button
   * that removes it says the same, and so does the live region after it.
   * Falsified by `nameOf` taken off `ActorRefs`, and — since 2026-10-10's
   * review, which found the chip itself unasserted — by `renderToken` drawing
   * the id while the button still says the name.
   */
  it('names the remove button by the actor, not by the id', async () => {
    mount(hook('The war', { involves: [{ ...VERA }] }));

    expect(screen.queryByRole('button', { name: 'Remove actor-vera' })).toBeNull();
    const remove = screen.getByRole('button', { name: 'Remove Vera Kohl' });
    expect(chipOf(remove)).toBe('Vera Kohl');
    await userEvent.click(remove);

    expect(latest.involves).toEqual([]);
    expect(screen.getByText('Removed Vera Kohl.')).toBeTruthy();
  });

  /**
   * ***A ref the old field made is still the author's.*** It is drawn under
   * its stored name; it is marked *Missing* only once the library has
   * answered — a list in flight is not a deletion — and then, with a title
   * saying what it does to the hook; and a person can remove it.
   *
   * Falsified by dropping `answered` from the badge's condition (the badge is
   * drawn while the list is still `undefined`), and by drawing it never.
   */
  it('keeps a typed-in actor under its stored name, Missing only once the library answers', async () => {
    const one = hook('The war', { involves: [OLD_TOM] });
    const view = mount(one, { actors: undefined });

    expect(screen.getByText('Old Tom')).toBeTruthy();
    expect(screen.queryByText('Missing')).toBeNull();

    view.rerender(<Harness hook={one} actors={CAST} />);

    const badge = screen.getByText('Missing');
    expect(badge.getAttribute('title')).toMatch(/^Not in your library/);
    // The badge is the chip's, not the button's: the button says the name.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Old Tom' }));

    expect(latest.involves).toEqual([]);
    expect(screen.getByText('Removed Old Tom.')).toBeTruthy();
  });

  /**
   * ***The realistic Missing actor is a deleted one***, whose id is a uuid and
   * whose stored name is not — where *Old Tom* above, id and name alike, cannot
   * tell the two apart (2026-10-10's review). The chip, the badge beside it,
   * the button and the live region all say the stored name, and the id is said
   * nowhere. Falsified by `nameOf` reading the library alone (`known.get(id) ??
   * id`), and by `Unresolved` drawn under the id.
   */
  it('keeps a deleted actor under its stored name, never its id', async () => {
    const gone: Ref = { id: 'actor-gone-7f3c', name: 'Gone Guy' };
    mount(hook('The war', { involves: [gone] }));

    const remove = screen.getByRole('button', { name: 'Remove Gone Guy' });
    expect(chipOf(remove)).toBe('Gone GuyMissing');
    expect(screen.queryByText(/actor-gone-7f3c/)).toBeNull();

    await userEvent.click(remove);

    expect(latest.involves).toEqual([]);
    expect(screen.getByText('Removed Gone Guy.')).toBeTruthy();
  });

  /**
   * ***The stored name before the library's*** — `nameOf`'s order, and the
   * file's word over a newer one: what this hook says is what every export of
   * it will say. Falsified by `nameOf` preferring the library's name, or
   * reading the library alone.
   */
  it('draws and says a held ref’s stored name over the library’s', () => {
    mount(hook('The war', { involves: [{ id: VERA.id, name: 'Vera' }] }));

    const remove = screen.getByRole('button', { name: 'Remove Vera' });
    expect(chipOf(remove)).toBe('Vera');
    expect(screen.queryByRole('button', { name: 'Remove Vera Kohl' })).toBeNull();
  });

  /**
   * ***A blank stored name is no name*** — the library's, then the id, rather
   * than a chip with nothing on it and a button called *Remove*. Falsified by
   * the `trim() !== ''` taken out of `nameOf`.
   */
  it('reads a blank stored name as no name', () => {
    mount(
      hook('The war', {
        involves: [
          { id: VERA.id, name: '  ' },
          { id: 'actor-gone-7f3c', name: '' },
        ],
      }),
    );

    expect(chipOf(screen.getByRole('button', { name: 'Remove Vera Kohl' }))).toBe('Vera Kohl');
    expect(chipOf(screen.getByRole('button', { name: 'Remove actor-gone-7f3c' }))).toBe(
      'actor-gone-7f3cMissing',
    );
  });

  /**
   * ***What Missing does to the hook, said in words at the field*** — the
   * badge's title reaches neither a touch screen nor a keyboard (`CastPanel`'s
   * rule), so the sentence is the field's description too, `MembersField`'s
   * visible `missingNote` read where the box is. Not while the list is in
   * flight, and gone with the last missing actor. Falsified by the sentence
   * taken out of the hint, and by it drawn before the library answers.
   */
  it('says in words, at the field, that a hook naming somebody missing will not fire', async () => {
    const one = hook('The war', { involves: [{ ...VERA }, OLD_TOM] });
    const view = mount(one, { actors: undefined });
    expect(describedBy(involves())).not.toMatch(/marked Missing/);

    view.rerender(<Harness hook={one} actors={CAST} />);

    expect(describedBy(involves())).toMatch(
      /A character marked Missing is not in your library, and this hook will not fire while it names somebody missing\./,
    );
    expect(screen.getByText(/A character marked Missing/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Old Tom' }));

    expect(describedBy(involves())).not.toMatch(/marked Missing/);
  });

  /**
   * ***Nobody to choose while the library is read***, said at the field
   * before Enter is pressed — or *Nothing matches Vera* would be the field
   * blaming the name for a request still in flight, or one that failed.
   * Falsified by the sentence taken out, and by it left in once the list
   * answers.
   */
  it('says at the field that nobody can be chosen until the library answers', () => {
    const one = hook('The war');
    const view = mount(one, { actors: undefined });

    expect(describedBy(involves())).toMatch(
      /Nobody can be chosen until your library has been read\.$/,
    );

    view.rerender(<Harness hook={one} actors={CAST} />);

    expect(describedBy(involves())).not.toMatch(/until your library has been read/);
  });

  /**
   * ***An id the library holds with a space at either end is stored as it
   * is*** (2026-10-10's review). `Id` is unpatterned and a hand-edited file
   * keeps what it was given, and `TokenField` trims what it commits, an
   * option's value included — so picking *Vera Kohl* handed back `vera`, and
   * the ref built around it named nobody: the dangling entry this field exists
   * not to write. ~~Falsified by `pickable` taken out of `ActorRefs`'
   * `onChange`.~~ *Corrected 2026-10-10, the same day*: `TokenField` no longer
   * trims under `strict`, so the id comes back as offered and `pickable`'s
   * remap never fires — taking `pickable` out no longer fails this. It is held
   * twice now, and falsified only by both together: `TokenField`'s strict trim
   * put back *and* `pickable` taken out. `TokenField.test.tsx` holds the first
   * on its own, and the test below holds it at this field.
   */
  it('stores the id the library holds, a space around it and all', async () => {
    mount(hook('The war'), { actors: [{ id: 'vera ', name: 'Vera Kohl' }] });

    await userEvent.type(involves(), 'kohl{Enter}');

    expect(latest.involves).toEqual([{ id: 'vera ', name: 'Vera Kohl' }]);
  });

  /**
   * ~~***And writes nothing when it cannot tell which was meant*** — two ids
   * that trim alike. Absurd as data; the claim is the rule behind it, that
   * this field never writes an id nobody offered. Falsified by `pickable`
   * keeping the id it could not place.~~
   *
   * ***Two ids that trim alike are two ids, and each is stored as offered***
   * (rewritten 2026-10-10, the same day). Struck above, this test asserted
   * that picking *Vera Kohl* wrote nothing, because `TokenField`
   * handed back `vera` and `pickable` could not tell which of two padded ids
   * was meant. `TokenField` now commits an offered id exactly under `strict`,
   * so there is nothing to tell apart: the pick is `vera ` and goes in, and
   * that assertion became the defect's description rather than the rule's.
   * `pickable`'s `null` is now unreachable from this field — a guard that
   * never fires, as its note says — so what is held here is the fix itself, at
   * the field: falsified by `TokenField` trimming a strict commit again, which
   * sends both picks into `pickable`'s ambiguity and writes neither.
   */
  it('tells two ids that trim alike apart, storing each as offered', async () => {
    mount(hook('The war'), {
      actors: [
        { id: 'vera ', name: 'Vera Kohl' },
        { id: ' vera', name: 'Vera Lind' },
      ],
    });

    await userEvent.type(involves(), 'kohl{Enter}');
    await userEvent.type(involves(), 'lind{Enter}');

    expect(latest.involves).toEqual([
      { id: 'vera ', name: 'Vera Kohl' },
      { id: ' vera', name: 'Vera Lind' },
    ]);
  });

  /**
   * An actor the library does list is never marked. Falsified by a badge drawn
   * on every chip once the list has answered.
   */
  it('marks nobody Missing whom the library lists', () => {
    mount(hook('The war', { involves: [{ ...VERA }] }));

    // By the button rather than by the text: the arrival's select, folded
    // further down, carries *Vera Kohl* as an option too.
    expect(screen.getByRole('button', { name: 'Remove Vera Kohl' })).toBeTruthy();
    expect(screen.queryByText('Missing')).toBeNull();
  });

  /**
   * ***Held refs come through by identity*** — the fingerprint of one linked
   * here, and the typed-in one beside it, untouched by an actor added after
   * them. Falsified by `rebuilt` building every ref afresh, which keeps the
   * ids and loses the fingerprint and the identity.
   */
  it('keeps every held ref by identity when another actor is added', async () => {
    const linked: Ref = { ...VERA, fingerprint: 'sha256:vera-as-she-was' };
    mount(hook('The war', { involves: [linked, OLD_TOM] }));

    await userEvent.type(involves(), 'ash{Enter}');

    expect(latest.involves).toHaveLength(3);
    expect(latest.involves[0]).toBe(linked);
    expect(latest.involves[1]).toBe(OLD_TOM);
    expect(latest.involves[2]).toEqual({ id: 'actor-ash', name: 'Ash' });
  });

  /**
   * ***One actor named twice by a hand-edited file comes back twice***, each
   * ref as it was. The combobox cannot make this file — it refuses a value it
   * already carries — but it can be handed one. Falsified by looking each id
   * up in a map, which returns the last ref under it for both.
   */
  it('keeps two refs to one actor apart when another is added', async () => {
    // `TokenField` keys its chips by value, so React reports the repeated key.
    // That is the field's limit, not this claim's subject — silenced here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first: Ref = { ...VERA, fingerprint: 'sha256:first' };
    const second: Ref = { ...VERA, fingerprint: 'sha256:second' };
    mount(hook('The war', { involves: [first, second] }));

    await userEvent.type(involves(), 'ash{Enter}');

    expect(latest.involves[0]).toBe(first);
    expect(latest.involves[1]).toBe(second);
    expect(latest.involves[2]).toEqual({ id: 'actor-ash', name: 'Ash' });
  });
});

describe('blocked by', () => {
  const marriage = hook('The marriage');
  const siblings = [marriage];

  /**
   * The flaw again, over hooks: a typed title became an id no hook carries.
   * Falsified by `strict` taken off `SiblingHooks`, by the box as above.
   */
  it.each(COMMITS_A_TAG)(
    'commits nothing typed that no hook matches, on %s',
    async (_way, keys) => {
      const one = hook('The war');
      mount(one, { siblings });

      await userEvent.type(blockedBy(), `The coronation${keys}`);

      expect(Object.hasOwn(latest, 'blockedBy')).toBe(false);
      expect(latest).toBe(one);
      expect(blockedBy()).toHaveProperty(
        'value',
        keys === ',' ? 'The coronation,' : 'The coronation',
      );
    },
  );

  it('says so when Enter finds no hook to take', async () => {
    mount(hook('The war'), { siblings });

    await userEvent.type(blockedBy(), 'The coronation{Enter}');

    expect(screen.getByText('Nothing matches The coronation.')).toBeTruthy();
  });

  /** Enter on an offered hook stores its id, and says its title. */
  it('takes the hook Enter is on, by id', async () => {
    mount(hook('The war'), { siblings });

    await userEvent.type(blockedBy(), 'marr{Enter}');

    expect(latest.blockedBy).toEqual([marriage.id]);
    expect(screen.getByText('Added The marriage. 1 in the list.')).toBeTruthy();
  });

  /**
   * Falsified by `nameOf` taken off `SiblingHooks`: the button says the uuid.
   * And by `renderToken` drawing the id beside a button that says the title —
   * the chip's own words, unasserted until 2026-10-10's review.
   */
  it('names the remove button by the hook’s title, not by the id', async () => {
    mount(hook('The war', { blockedBy: [marriage.id] }), { siblings });

    expect(screen.queryByRole('button', { name: `Remove ${marriage.id}` })).toBeNull();
    const remove = screen.getByRole('button', { name: 'Remove The marriage' });
    expect(chipOf(remove)).toBe('The marriage');
    await userEvent.click(remove);

    expect(Object.hasOwn(latest, 'blockedBy')).toBe(false);
    expect(screen.getByText('Removed The marriage.')).toBeTruthy();
  });

  /**
   * ***A gate on a hook this object does not carry*** — `NotBefore`'s case,
   * one field over. Drawn under its id, since `blockedBy` stores nothing else
   * to call it; marked *Missing* at once, since the siblings are never still
   * loading; kept through an edit beside it; removable. Falsified by the badge
   * condition dropped.
   */
  it('keeps a gate naming no hook here, marked Missing, and lets it go', async () => {
    mount(hook('The war', { blockedBy: ['a-hook-elsewhere'] }), { siblings });

    expect(screen.getByText('a-hook-elsewhere')).toBeTruthy();
    expect(screen.getByText('Missing').getAttribute('title')).toMatch(
      /^Not one of the other hooks/,
    );

    await userEvent.type(blockedBy(), 'marr{Enter}');
    expect(latest.blockedBy).toEqual(['a-hook-elsewhere', marriage.id]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove a-hook-elsewhere' }));
    expect(latest.blockedBy).toEqual([marriage.id]);
  });

  /**
   * ***What a Missing gate does, said in words at the field*** — the
   * involves sentence's twin, and harmless where that one is not: a blocker
   * no hook in play carries never fires, so never blocks. Gone with the last
   * missing gate. Falsified by the sentence taken out of the hint.
   */
  it('says in words, at the field, what a gate on a missing hook does', async () => {
    mount(hook('The war', { blockedBy: ['a-hook-elsewhere'] }), { siblings });

    expect(describedBy(blockedBy())).toMatch(
      /A hook marked Missing is not one of the other hooks on this object\./,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove a-hook-elsewhere' }));

    expect(describedBy(blockedBy())).not.toMatch(/marked Missing/);
  });

  /**
   * ***A sibling's id with a space around it is stored as it is*** — the
   * involves case, one field over: `TokenField`'s trim handed back an id no
   * hook carries. ~~Falsified by `pickable` taken out of `SiblingHooks`.~~
   * *Corrected 2026-10-10, the same day*: the trim is gone under `strict`, so
   * this is falsified only by it put back *and* `pickable` taken out — the
   * involves case's note, above.
   */
  it('stores the id the sibling carries, a space around it and all', async () => {
    const padded = { ...hook('The coronation'), id: 'hook-coronation ' };
    mount(hook('The war'), { siblings: [padded] });

    await userEvent.type(blockedBy(), 'coron{Enter}');

    expect(latest.blockedBy).toEqual(['hook-coronation ']);
  });
});
