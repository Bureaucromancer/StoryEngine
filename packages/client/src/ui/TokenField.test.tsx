// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.js';
import { TokenField, type TokenOption } from './TokenField.js';

/**
 * The combobox contract — [05](../../../../docs/design/05-tagging.md).
 *
 * Nearly every test here is a **key**, because the keyboard is the half of this
 * component that cannot be seen and therefore the half that rots without being
 * noticed. Two of them are behaviours the surface this imitates does not have:
 * Enter committing what you typed without arrowing onto it first, and Backspace
 * removing the last chip. They are the two things somebody tries once.
 * *(The second is a tag field's alone since 2026-10-10: under `strict`
 * Backspace moves to the last chip's remove button and does not press it —
 * the strict describe, at the end.)*
 *
 * The last describe is the collision worth its own test: `useFocusTrap` binds
 * Escape on `document`, so a popup that does not stop the event closes the
 * dialog it is standing in.
 */

const VOCABULARY = ['noir', 'city', 'napoleonic'];

function options(term: string, held: readonly string[]): TokenOption[] {
  const offerable = VOCABULARY.filter((name) => !held.includes(name));
  const hits = offerable.filter((name) => name.includes(term.toLowerCase()));
  const rows: TokenOption[] = hits.map((name) => ({ value: name, label: name }));
  if (term !== '' && !VOCABULARY.includes(term.toLowerCase())) {
    return [{ value: term, label: term, create: true }, ...rows];
  }
  return rows;
}

/** A controlled host, because the field is controlled and the test is about commits. */
function Host(props: { initial?: string[]; onChange?: (values: string[]) => void }): JSX.Element {
  const [values, setValues] = useState<string[]>(props.initial ?? []);
  return (
    <TokenField
      label="Tags"
      values={values}
      onChange={(next) => {
        setValues(next);
        props.onChange?.(next);
      }}
      optionsFor={(term) => options(term, values)}
      renderToken={(value) => <span>{value}</span>}
    />
  );
}

function box(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Tags' });
}

function chips(): string[] {
  return [...document.querySelectorAll('li button')].map((node) =>
    (node.getAttribute('aria-label') ?? '').replace('Remove ', ''),
  );
}

/** What the field's one live region last said. */
function said(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
}

describe('the popup', () => {
  it('opens on focus with nothing typed, so the field can be browsed', async () => {
    render(<Host />);

    expect(box().getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(box());

    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual(VOCABULARY);
  });

  it('narrows as it is typed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'no');

    // The typed term is offered first as the create option, then the matches.
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual(['no', 'noir']);
  });

  it('points aria-activedescendant at an option that exists', async () => {
    render(<Host />);
    await userEvent.click(box());
    await userEvent.keyboard('{ArrowDown}');

    const id = box().getAttribute('aria-activedescendant');
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? '')?.getAttribute('role')).toBe('option');
  });

  it('leaves the options unfocusable, so a dialog trap cannot land on them', async () => {
    render(<Host />);
    await userEvent.click(box());

    for (const option of screen.getAllByRole('option')) {
      expect(option.hasAttribute('tabindex')).toBe(false);
    }
    expect(document.activeElement).toBe(box());
  });
});

describe('committing', () => {
  /**
   * **The first improvement over the reference**, whose input does nothing at
   * all when you type a new tag and press Enter — you have to arrow onto the
   * option showing your own text first.
   */
  it('takes what you typed on Enter, with no arrowing at all', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin{Enter}');

    expect(chips()).toEqual(['ronin']);
    expect(box()).toHaveProperty('value', '');
  });

  it('takes the arrowed-onto option instead, when one has been moved to', async () => {
    render(<Host />);
    await userEvent.type(box(), 'no');
    // The create option showing your own text is active from the first
    // keystroke, so one press down is the existing tag underneath it.
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(chips()).toEqual(['noir']);
  });

  it('takes a comma as an end-of-tag, the way the reference does', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin,');

    expect(chips()).toEqual(['ronin']);
  });

  it('commits a clicked option', async () => {
    render(<Host />);
    await userEvent.click(box());
    await userEvent.click(screen.getByRole('option', { name: 'city' }));

    expect(chips()).toEqual(['city']);
  });

  /**
   * Typing a tag and clicking Save is the flow people actually hit. Discarding
   * the term on blur is silent data loss in exactly that flow.
   */
  it('commits a term left in the box when focus leaves', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin');
    await userEvent.tab();

    expect(chips()).toEqual(['ronin']);
  });

  /**
   * ***A tag is still trimmed*** (2026-10-10) — the half of *committed exactly
   * as given* that is not the strict field's: what somebody typed with a space
   * either side is the word, and a chip called `  ronin  ` is nobody's tag.
   * Falsified by the commit taking every value as given, strict or not.
   */
  it('trims what was typed, under no strictness', async () => {
    const changed = vi.fn();
    render(<Host onChange={changed} />);
    await userEvent.type(box(), '  ronin  {Enter}');

    expect(changed).toHaveBeenLastCalledWith(['ronin']);
    expect(said()).toBe('Added ronin. 1 in the list.');
  });

  it('refuses a duplicate rather than carrying it twice', async () => {
    render(<Host initial={['noir']} />);
    await userEvent.type(box(), 'noir{Enter}');

    expect(chips()).toEqual(['noir']);
  });

  it('never submits the form it is standing in', async () => {
    const submit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Host />
      </form>,
    );

    await userEvent.type(box(), 'ronin{Enter}');

    // The editors put this field inside their save form; an Enter that reached
    // it would save the actor mid-tag.
    expect(submit).not.toHaveBeenCalled();
    expect(chips()).toEqual(['ronin']);
  });
});

describe('removing', () => {
  /**
   * **The second improvement.** The reference has no keydown handling on its
   * tag input at all, so a chip can only go by finding its small `×`.
   *
   * *Still so for tags after 2026-10-10*, when `strict` stopped doing it (the
   * strict describe's Backspace tests): a tag removed by accident can be typed
   * back. Falsified by the strict branch's move taken for every field.
   */
  it('drops the last chip on Backspace in an empty box', async () => {
    render(<Host initial={['noir', 'city']} />);
    await userEvent.click(box());
    await userEvent.keyboard('{Backspace}');

    expect(chips()).toEqual(['noir']);
  });

  it('leaves the chips alone while there is a term to delete instead', async () => {
    render(<Host initial={['noir']} />);
    await userEvent.type(box(), 'ab{Backspace}');

    expect(chips()).toEqual(['noir']);
    expect(box()).toHaveProperty('value', 'a');
  });

  /**
   * ***And a tag's `×` takes Enter and Space, never Backspace*** (2026-10-10,
   * the strict fix's own review). Backspace on a remove button is the strict
   * field's second press — the box sent focus there — and the handler doing it
   * sat on every remove button, so a tag field had gained a deletion key it
   * never had, on a button reached only by Tab. Falsified by the button's
   * Backspace taken for every field: `noir` goes.
   */
  it("leaves a tag's remove button alone on Backspace", async () => {
    const changed = vi.fn();
    render(<Host initial={['noir', 'city']} onChange={changed} />);
    // The chips come before the box, so the first Tab is the first `×`.
    await userEvent.tab();
    const button = screen.getByRole('button', { name: 'Remove noir' });
    expect(document.activeElement).toBe(button);

    await userEvent.keyboard('{Backspace}');

    expect(changed).not.toHaveBeenCalled();
    expect(chips()).toEqual(['noir', 'city']);
    expect(document.activeElement).toBe(button);
    expect(said()).toBe('');
  });

  it('labels each remove button with the tag it removes', async () => {
    render(<Host initial={['noir']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove noir' }));

    expect(chips()).toEqual([]);
  });
});

describe('escape', () => {
  it('closes the popup and keeps what was typed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ron');
    expect(box().getAttribute('aria-expanded')).toBe('true');

    await userEvent.keyboard('{Escape}');

    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box()).toHaveProperty('value', 'ron');
  });

  it('clears the term on a second press, once the popup is already closed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}{Escape}');

    expect(box()).toHaveProperty('value', '');
  });

  /**
   * The collision this component was written knowing about. `useFocusTrap`
   * listens on `document`, so without `stopPropagation` one press would close
   * the popup and the dialog together — which is the bug the reference surface
   * carries a purpose-built guard for on its own colour picker.
   */
  it('does not close the dialog the field is standing in', async () => {
    const dismiss = vi.fn();
    render(
      <Dialog role="dialog" labelledBy="heading" onDismiss={dismiss}>
        <h2 id="heading">Manage tags</h2>
        <Host />
      </Dialog>,
    );

    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}');

    expect(dismiss).not.toHaveBeenCalled();
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('still lets the dialog close once the popup is out of the way', async () => {
    const dismiss = vi.fn();
    render(
      <Dialog role="dialog" labelledBy="heading" onDismiss={dismiss}>
        <h2 id="heading">Manage tags</h2>
        <Host />
      </Dialog>,
    );

    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}{Escape}{Escape}');

    expect(dismiss).toHaveBeenCalled();
  });
});

/**
 * ***Ids rather than words*** — [P16.2]'s scope pickers. A tag is whatever
 * somebody types; an id is not, so under `strict` the text only narrows and a
 * value is committed only by choosing an option — and `nameOf` is how a chip
 * whose value is a uuid is spoken.
 */
describe('a strict field, over ids', () => {
  const PEOPLE = [
    { value: 'id-mira', label: 'Mira' },
    { value: 'id-ossian', label: 'Ossian, the elder' },
  ];

  /**
   * `people` stands in for a library whose ids are not tidy — a hand-edited
   * file's, with a space at either end — and `onChange` is the value list
   * exactly as committed, which a chip's name cannot show.
   */
  function StrictHost(props: {
    initial?: string[];
    people?: { value: string; label: string }[];
    onChange?: (values: string[]) => void;
  }): JSX.Element {
    const [values, setValues] = useState<string[]>(props.initial ?? []);
    const people = props.people ?? PEOPLE;
    const names = new Map(people.map((one) => [one.value, one.label] as const));
    return (
      <TokenField
        label="Characters"
        values={values}
        onChange={(next) => {
          setValues(next);
          props.onChange?.(next);
        }}
        strict
        nameOf={(value) => names.get(value) ?? value}
        optionsFor={(term) =>
          people.filter(
            (one) =>
              !values.includes(one.value) && one.label.toLowerCase().includes(term.toLowerCase()),
          )
        }
        renderToken={(value) => <span>{names.get(value) ?? value}</span>}
      />
    );
  }

  function field(): HTMLElement {
    return screen.getByRole('combobox', { name: 'Characters' });
  }

  it('commits the option Enter is on, by its value', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'mir{Enter}');

    expect(chips()).toEqual(['Mira']);
  });

  it('commits nothing for text no option matches, and says so', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'Nobody{Enter}');

    expect(chips()).toEqual([]);
    expect(screen.getByText('Nothing matches Nobody.')).toBeTruthy();
  });

  /**
   * Escape closes the popup and keeps the term; Enter then reopens the options
   * the term matches rather than saying nothing matches, and a second Enter
   * commits the one it is on.
   */
  it('reopens the options on Enter after Escape, rather than saying nothing matches', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'mir{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('Nothing matches mir.')).toBeNull();
    expect(screen.getByRole('option', { name: 'Mira' })).toBeTruthy();

    await userEvent.keyboard('{Enter}');
    expect(chips()).toEqual(['Mira']);
  });

  /** A name can hold a comma, so under `strict` it is a character and not an end-of-tag. */
  it('takes a comma as part of the search', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'ossian,{Enter}');

    expect(chips()).toEqual(['Ossian, the elder']);
  });

  it('leaves a term in the box when focus leaves, rather than committing it', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'Mira');
    await userEvent.tab();

    expect(chips()).toEqual([]);
    expect(field()).toHaveProperty('value', 'Mira');
  });

  it('names each remove button by the name, not the id', () => {
    render(<StrictHost initial={['id-mira', 'id-gone']} />);

    // An id with no name is spoken as itself — still removable, and still there.
    expect(chips()).toEqual(['Mira', 'id-gone']);
  });

  /**
   * ***An offered id is committed byte for byte*** (2026-10-10, [P16.2]'s
   * review of the hook editor's id pickers). `Id` is unpatterned, and a
   * hand-edited file can hold one with a space at either end; every commit
   * trimmed, so picking it stored an id that resolved to nothing — and the
   * live region, speaking through `nameOf`, found no name for the trimmed id
   * and read it out instead. Falsified by the strict commit trimming again:
   * the list gets `id-vera`, and the region says *Added id-vera*.
   */
  it('commits an offered id exactly as given, and speaks it by its name', async () => {
    const changed = vi.fn();
    render(
      <StrictHost people={[...PEOPLE, { value: ' id-vera ', label: 'Vera' }]} onChange={changed} />,
    );
    await userEvent.type(field(), 'vera{Enter}');

    expect(changed).toHaveBeenLastCalledWith([' id-vera ']);
    expect(chips()).toEqual(['Vera']);
    expect(said()).toBe('Added Vera. 1 in the list.');
  });

  /**
   * ***And a duplicate is the same value byte for byte*** — so an id that
   * differs from one already held only by a space is another id, and is not
   * turned away as *already here*. Falsified by the duplicate check comparing
   * trimmed values: `id-mira ` would be refused as `Mira`.
   */
  it('carries two ids that differ only by a space as two', async () => {
    const changed = vi.fn();
    render(
      <StrictHost
        initial={['id-mira']}
        people={[...PEOPLE, { value: 'id-mira ', label: 'Mira, the other' }]}
        onChange={changed}
      />,
    );
    await userEvent.type(field(), 'the other{Enter}');

    expect(changed).toHaveBeenLastCalledWith(['id-mira', 'id-mira ']);
    expect(said()).toBe('Added Mira, the other. 2 in the list.');
  });

  /**
   * ***Backspace on an empty box moves to the last chip's remove button, and
   * does not press it*** (2026-10-10, the same review). The last chip here is
   * an id nothing names — `id-gone`, the *Missing* case — which this field
   * will never offer again, so removing it by a key that was only clearing a
   * search took it for good. The removal is now a second press, of a button
   * whose name says what it removes; Backspace there is that press, and so is
   * Enter. Nothing is said on the move, since nothing was removed. Falsified
   * by the strict branch taken out of the box's Backspace (the first press
   * removes `id-gone`), and by the button's own Backspace handler taken out
   * (the second press does nothing).
   */
  it('moves to the last remove button on Backspace, and removes only when it is pressed', async () => {
    const changed = vi.fn();
    render(<StrictHost initial={['id-mira', 'id-gone']} onChange={changed} />);
    await userEvent.click(field());
    await userEvent.keyboard('{Backspace}');

    expect(changed).not.toHaveBeenCalled();
    expect(chips()).toEqual(['Mira', 'id-gone']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove id-gone' }));
    expect(said()).toBe('');

    await userEvent.keyboard('{Backspace}');

    expect(changed).toHaveBeenLastCalledWith(['id-mira']);
    expect(said()).toBe('Removed id-gone.');
    // Back to the box, so the next Backspace is the same two-step again.
    expect(document.activeElement).toBe(field());

    await userEvent.keyboard('{Backspace}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Mira' }));
    await userEvent.keyboard('{Enter}');

    expect(changed).toHaveBeenLastCalledWith([]);
  });

  /**
   * ***The button it moves to wears the app's focus ring*** (2026-10-10, the
   * fix's own review). The second press is deliberate only if the move can be
   * seen: the caret leaves the box, and a `×` drawn without
   * `focus-visible:outline-focus` showed whatever the user agent draws, or
   * nothing — every other control here carries the ring (`Button`'s `BASE`,
   * `classes.ts`' `control`). Read off the rendered button rather than the
   * source, so a comment naming the classes cannot pass it. Falsified by the
   * two classes taken off the remove button.
   */
  it('draws the focus ring on the remove button Backspace moves to', async () => {
    render(<StrictHost initial={['id-mira']} />);
    await userEvent.click(field());
    await userEvent.keyboard('{Backspace}');

    const button = screen.getByRole('button', { name: 'Remove Mira' });
    expect(document.activeElement).toBe(button);
    expect(button.className.split(' ')).toEqual(
      expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-focus']),
    );
  });

  /**
   * ***A held Backspace clears the search and stops at the button*** — the
   * accident itself: one key held to empty the box, auto-repeating on past
   * the last character. The repeats that reach the button are ignored, or the
   * move would be the old removal one repeat later. Falsified by the
   * button's `event.repeat` check taken out: the held key removes `id-gone`,
   * returns to the box, moves to *Mira*, and removes her too.
   */
  it('never removes a chip on a held Backspace', async () => {
    const changed = vi.fn();
    render(<StrictHost initial={['id-mira', 'id-gone']} onChange={changed} />);
    await userEvent.type(field(), 'oss');
    await userEvent.keyboard('{Backspace>8}');

    expect(field()).toHaveProperty('value', '');
    expect(changed).not.toHaveBeenCalled();
    expect(chips()).toEqual(['Mira', 'id-gone']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove id-gone' }));
  });

  /**
   * ***Expanded only over a listbox that is drawn*** (2026-10-10, the same
   * review). A term that matches nothing leaves the popup *open* with nothing
   * to show; the box said `aria-expanded="true"` over no list and named in
   * `aria-controls` a listbox absent from the document. The APG combobox
   * pattern: expanded while the popup is visible, and `aria-controls` *"only
   * needs to be set when the popup is visible"*. Falsified by either attribute
   * read off `open` again.
   */
  it('says expanded, and names its listbox, only while one is drawn', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'Nobody');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);

    await userEvent.clear(field());
    await userEvent.type(field(), 'mir');

    const listbox = screen.getByRole('listbox');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('aria-controls')).toBe(listbox.id);
  });
});
