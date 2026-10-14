// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***Whether a keystroke is the text's, not the dock's*** — two questions the
 * workbench asks of a key's target, in one file since a second asker arrived
 * (2026-10-14, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.5, after review). The chord's guard was `useToggleChord`'s alone; the
 * dock's Escape needed the same test, narrowed, and two spellings of *is the
 * keyboard in something you type into* would drift the first time either was
 * corrected.
 */

/**
 * The three form controls, plus contenteditable both ways: the property is
 * the browser's answer and carries the inheritance rules (a child of an
 * editable region is editable), and the attribute walk beside it is not
 * test-only decoration — it is also correct in a browser for every region an
 * author marks — but it is *load-bearing* in jsdom, which has never
 * implemented `isContentEditable` and would otherwise report every editable
 * region as fair game, making the guard's contenteditable arm untestable.
 *
 * *The chord's guard*: Ctrl+` is inert on every one of these, a select and a
 * check box included, because a chord that fired out of a form control would
 * trade a keystroke meant for the control for a panel jump.
 */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return isContentEditable(target);
}

/**
 * The input types a person types text into — the ones that can be holding a
 * draft. Everything else an `<input>` can be (a check box, a radio, a range, a
 * colour, a file) is answered in one press and keeps nothing unsaved.
 */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'number',
  'email',
  'url',
  'tel',
  'password',
]);

/**
 * ***Somewhere text is being typed***, which is narrower than `isEditable`,
 * and the narrowing is the point: this is the dock's Escape guard.
 *
 * Since P12A.5 the dock's Session section holds editors with unsaved drafts —
 * the pack's block editor, the author's note, a sampler setting — and the dock
 * unmounts when it closes, so an Escape that closed it from inside one threw
 * the draft away. Escape in a text box is the text's: it dismisses an input
 * method's candidates or a browser's autocomplete, and out of habit it is
 * pressed to mean *not that*, never *throw this away*. *A check box, a radio or
 * a select keep no draft*, so Escape on one still closes the dock — a keyboard
 * user who has just ticked a switch is not left without the one key that gets
 * them out. (A select's own open list is the browser's to close, and the key
 * never reaches the page while it is open.)
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_TYPES.has(target.type);
  return isContentEditable(target);
}

function isContentEditable(target: HTMLElement): boolean {
  return (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}
