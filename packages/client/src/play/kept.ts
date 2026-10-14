// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***What was typed in the Session section, kept past the dock's close***
 * (2026-10-14, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)'s
 * final audit).
 *
 * Since P12A.5 the panels that say how a session is set up live in the
 * workbench's **Session** section, and two of them hold a draft behind a Save:
 * the author's note (`ChatSettingsPanel`'s `NoteEditor`) and the pack's block
 * that *Edit in the pack* opens (`SessionPanel`'s `BlockEditor`). The dock is
 * unmounted when it closes — [P3.1](../../../../docs/design/workplan/15-p3-implementation.md)'s
 * *closed is unmounted, not hidden: no queries run* — so whatever had been
 * typed and not saved went with it, by any of the four ways it closes: Escape
 * (which P12A.5's review had already made leave a text box alone), *Close*,
 * the header's *Workbench* and the chord. **On a phone, closing is the only
 * way back to the story**, since there the open dock is the view: a person
 * who closed it to read the last turn before finishing the note lost the
 * note. Reopened, the box showed what was stored and nothing said a draft had
 * gone.
 *
 * *Module state*, as `workbench/jump.ts`'s `landing` is, and for the same
 * reason: what it outlives is the dock, so nothing inside the dock can hold
 * it, and it is not something the address or the account should carry — a
 * draft is not a place and not a preference. **Its lifetime is the page
 * load**: a reload starts with nothing kept, which is what the boxes always
 * did. *Two rejected shapes*: keeping the dock mounted while closed would
 * reverse P3.1's decision and break P12A.5's *a dock opened from shut starts
 * at its top*, which leans on the remount; and a question on every close
 * would make a person on a phone choose between reading the story and keeping
 * their note, and put a modal over a panel that is not modal.
 *
 * Keyed by the caller — the session, and for a block the block — and let go
 * when what holds the draft has written it, so a kept draft never outlives
 * the save it was waiting for.
 */
const held = new Map<string, unknown>();

/**
 * What was kept under `key`, if anything — `unknown`, so the caller says what
 * shape it expects and checks it, rather than this module promising one.
 */
export function kept(key: string): unknown {
  return held.get(key);
}

/** Keep `value` under `key` until it is let go or the page is reloaded. */
export function keep(key: string, value: unknown): void {
  held.set(key, value);
}

/** Forget what was kept under `key` — its draft was written, or overtaken. */
export function letGo(key: string): void {
  held.delete(key);
}
