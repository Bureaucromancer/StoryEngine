// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare const count: number;
declare const name: string;
declare const kind: string;
declare const slug: string;
declare const code: string;

const PANEL_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-slate-500';

/**
 * Everything the assembly rule must leave alone — which is most of a component.
 *
 * A rule that fired on these would be worked around within a day, and the
 * negative cases are what keep it honest: the class list is the one that
 * matters most, because it is a long string full of spaces and is not prose.
 */
export function Good() {
  // One message with a value substituted into it — the shape ICU wants, and
  // what an extraction sweep turns into a catalogue entry.
  const message = `You have ${String(count)} unread messages`;
  const copy = `${name} (copy)`;
  // A code, not a sentence.
  const branch = code === 'not-found' ? 1 : 2;
  // A string method over values that are not prose: a file extension, a
  // prefix of an id, one word.
  const searched = name.endsWith('.json') || code.startsWith('import.') || name.includes('draft');

  return (
    <div className={PANEL_CLASS}>
      <span>{message}</span>
      <span>{copy}</span>
      <span>{branch}</span>
      <span>{String(searched)}</span>
      {/* A value on its own is not a sentence. */}
      <span>{name}</span>
      {/* A path is not a sentence either, which is why the text has to hold
          two letters before it counts. */}
      <code>
        {kind}/{slug}/
      </code>
      {/* One word beside a value stays legible as a label rather than prose. */}
      <span>v{count}</span>
    </div>
  );
}
