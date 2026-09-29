// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***A group reply, cleaned as both sources clean one*** —
 * [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)
 * point 3, built at [P13.2].
 *
 * A model asked to write one member's reply in a group does two things often
 * enough that both sources ship a remedy for each: it **labels the reply with
 * the speaker's name**, as though it were writing a script, and it **carries on
 * as somebody else**, writing the next member's line — or the player's — after
 * its own. Left alone, the first puts `Vera:` in front of every line Vera says,
 * and the second puts words in the mouth of a member whose own call has not
 * run yet, which that member then contradicts.
 *
 * **What each source does, at the pins:**
 *
 * - *SillyTavern.* `cleanGroupMessage` (`public/script.js:3112-3142`) cuts the
 *   reply at the first match of `(^|\n)Name:` for every group member but the
 *   one speaking. `cleanUpMessage` around it (`:6433-6457`) does the same for
 *   the **user's** name whatever the chat — `trimWrongNames`, which deletes a
 *   reply that opens as the user and cuts one that turns into them — then
 *   strips the speaker's own `Name:` from the start of **every** line
 *   (`:6494-6497`, `(^|\n)Name:\s*`, which runs by default because
 *   `allow_name2_display` is false, `power-user.js:191`), and then trims a
 *   leading `Name:` again (`:6507-6519`).
 * - *Marinara.* The individual-group-generation branch
 *   (`packages/server/src/routes/generate.routes.ts:6652-6732`) strips a
 *   leading `Name:` (and a bare `Name` line) of the target's, then, where the
 *   reply opens as somebody else, looks for the target's own line further down
 *   or drops paragraphs until it finds one, and in its conversation mode cuts
 *   at the first later line opened by another member.
 *
 * **What this does is the part they agree on**, in the order ST applies it:
 * the text is cut at the first line that opens with another member's name
 * followed by a colon, and then the speaker's own label goes from the start
 * of every line — ST's per-line strip, taken whole (~~the speaker's own
 * leading label~~, *corrected 2026-09-29, at the [P13.2] review*: only the
 * first line's went, and a reply written as a script kept `Vera:` on every
 * line after it). The cut runs first, so a reply that opens `Vera: Lund:`
 * keeps Lund's name as words Vera said, where stripping first would have cut
 * her line to nothing; a name mid-line is never touched. The persona counts
 * as another member here, which is ST's `trimWrongNames` rather than
 * `cleanGroupMessage` and is the most useful of the three — a reply that goes on
 * to write the player's next line is the failure a group chat is most
 * complained about.
 *
 * ***Deliberately not taken:*** Marinara's paragraph-dropping search for the
 * speaker's own line in a reply that opens as somebody else. It is a guess at
 * which part of a confused reply was meant, and a wrong guess keeps the wrong
 * person's words under the right person's name. A reply that opens as another
 * member is cut to nothing here, as ST cuts it — and nothing is lost, because
 * the caller keeps the model's words as `original` whenever this changed them.
 *
 * *Case-sensitive and exact about the name*, as ST's regexes are: a character
 * called Will is not cut at a line beginning *"will:"*. Whitespace around the
 * colon is forgiven, as Marinara forgives it, because a model that writes
 * `Lund :` is still writing Lund's line.
 */

/**
 * The reply cut where another member's line begins, with the speaker's own
 * label stripped from the start of each line.
 *
 * `others` is everybody the reply must not speak as — the rest of the cast and
 * the persona. A name equal to the speaker's is ignored, so two members who
 * share a name do not cut each other's replies to nothing. **Returns the reply
 * itself when nothing matched**, whitespace and all, so a caller comparing the
 * two can tell *cleaned* from *untouched* by equality.
 */
export function cleanReply(reply: string, speaker: string, others: readonly string[]): string {
  const own = speaker.trim();
  let text = reply;

  let cut: number | null = null;
  for (const name of others) {
    const other = name.trim();
    if (other.length === 0 || other === own) continue;
    // `(^|\n)` as ST writes it, so the cut lands on the newline itself and
    // never inside a line of the speaker's own.
    const line = new RegExp(`(^|\\n)[ \\t]*${escaped(other)}[ \\t]*:`);
    const found = line.exec(text);
    if (found !== null && (cut === null || found.index < cut)) cut = found.index;
  }
  if (cut !== null) text = text.slice(0, cut).trimEnd();

  if (own.length > 0) {
    const label = new RegExp(`^\\s*${escaped(own)}[ \\t]*:\\s*`);
    if (label.test(text)) text = text.replace(label, '');
    // And at every later line start, as ST's per-line pass does — a reply
    // written as a script labels each of the speaker's lines, not the first.
    // Horizontal whitespace only after the colon, so the line keeps its break.
    const each = new RegExp(`\\n[ \\t]*${escaped(own)}[ \\t]*:[ \\t]*`, 'g');
    if (each.test(text)) text = text.replace(each, '\n');
  }

  // Only the edits above ever touch `text`, and each only when it matched, so
  // a reply none matched is returned as the very string it came in as.
  return text;
}

/** A name as a regular expression that matches exactly it. */
function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
