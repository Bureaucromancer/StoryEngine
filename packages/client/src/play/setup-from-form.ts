// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newSetup, type Setup } from '@storyengine/shared';

/**
 * A **Setup** built from the session form — [04 §7](../../../../docs/design/04-schemas.md),
 * [10 §5](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The `setups/` kind's *making* surface, and it is not a third hand-written
 * editor.** That kind has had CRUD, a shelf and a factory since P1 and no way to
 * produce one; [P7.4]'s cell records it as *"no surface for making one"*. The
 * cell also records why a bespoke Setup form would be the wrong answer — *"every
 * editor and settings pane is hand-written JSX"* is the complaint, not the
 * remedy.
 *
 * **So the making surface is the form that already exists.** A Setup *is* how to
 * start playing — a mode, its wizard's answers, a preset, a treatment, lore, a
 * persona to offer — and the session form collects exactly that, control for
 * control. Saving one is naming a configuration somebody has already made, which
 * is [10 §5]'s *create and edit are one question* answered from the other end:
 * the thing you create with is the thing you configure with.
 *
 * **Round-trip symmetry is the property worth holding**, and both halves are
 * tested against it: what this writes, `POST /api/sessions` reads back out of a
 * Setup. A field this builds that creation does not read would be a promise the
 * library keeps and the game does not.
 *
 * *What is deliberately absent is everything the session form has no control
 * for: `hooks`, `goals`, `openings`, `media`, `blurb`. A Setup carrying them is
 * a Setup somebody imported or hand-wrote, and it stays that way until the
 * stages that own those vocabularies build their controls — [P7.5] for hooks and
 * [P7.6] for goals. Writing empty ones is `newSetup`'s doing rather than this
 * function's, and empty is what those fields mean when nobody has said
 * otherwise.*
 */
export interface SessionForm {
  name: string;
  mode: string;
  modeConfig: Record<string, unknown>;
  treatment: string;
  preset: string;
  persona: string;
  lore: string[];
  /** Ids to names, for the `Ref`s a Setup stores. Missing is the id twice. */
  names: Record<string, string>;
}

export function setupFromForm(form: SessionForm): Setup {
  const made = newSetup(form.name.trim());
  return {
    ...made,
    mode: {
      id: form.mode,
      /**
       * **`null` when nothing was collected**, not `{}` — the same distinction
       * the session file draws at `mode.config`, and the reason a Setup for a
       * mode with no wizard does not claim one answered nothing.
       */
      config: Object.keys(form.modeConfig).length === 0 ? null : form.modeConfig,
    },
    treatment: ref(form.treatment, form.names),
    preset: ref(form.preset, form.names),
    cast: {
      /**
       * **The persona as an *option*, which is the shape's own word.** A Setup
       * offers personas and a session has one; `POST /api/sessions` takes the
       * first of these, so one in and one out is a round trip and a list of
       * several is a Setup somebody built by hand.
       */
      personaOptions: form.persona === '' ? [] : [refOf(form.persona, form.names)],
      // Not written, because the party is `se.party` since [P7.3] and seeding it
      // means writing effects ~~— which the session-creation path does not do
      // either. Empty here and unread there is one honest gap rather than two
      // halves that disagree.~~
      //
      // *Corrected 2026-10-03, at the P15 merge*: the creation path has read
      // `partyDefault` since P15.3 — it seats each member and makes them
      // `companion` on `se.party`, on a turn of its own when there is no
      // opening — so this is no longer a gap both halves share. It stays empty
      // because the form's *Characters* are a cast, which Start seats without
      // making anyone a companion: writing them here would make a saved Setup
      // start a different session from the one the form starts. A Setup saved
      // from a form that picked characters therefore starts with nobody
      // seated — recorded at [P7.4](../../../../docs/design/workplan/23-p7-implementation.md),
      // with what closing it would take (a cast on a Setup that is not a party),
      // and since 2026-10-04 an open question of its own,
      // [26 B19](../../../../docs/design/26-open-questions.md).
      partyDefault: [],
      narrator: null,
    },
    lore: form.lore.map((id) => ({ ref: refOf(id, form.names), required: false })),
  };
}

function ref(id: string, names: Record<string, string>): { id: string; name: string } | null {
  return id === '' ? null : refOf(id, names);
}

/**
 * **Both halves of a `Ref`**, because [04 §3] resolves one by id *and* by name:
 * an id that no longer resolves is saved by the name beside it. A Setup that
 * stored bare ids would travel to another install and resolve to nothing.
 */
function refOf(id: string, names: Record<string, string>): { id: string; name: string } {
  return { id, name: names[id] ?? id };
}
