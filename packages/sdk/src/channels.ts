// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * What a channel declares about itself —
 * [21 §1.3](../../../docs/design/21-internal-contracts.md).
 *
 * ~~**Deliberately short of the documented type**, and the absences are a
 * schedule rather than an oversight. `schema`, `init: InitPolicy`, `migrate`
 * and `surface?: WidgetSpec` are all specified and none is here.~~
 *
 * **`schema` and `init` arrived at [P7.1](../../../docs/design/workplan/23-p7-implementation.md)**,
 * which is the stage
 * [21 §6](../../../docs/design/21-internal-contracts.md) was waiting for: it
 * defers `InitPolicy` and `WidgetSpec` on the grounds that they *"want the mode
 * contract built first"*, and that contract is this package. Designing them
 * before it existed would have been the one thing worse than leaving them out —
 * a shape other code starts depending on before the section that owns it exists.
 *
 * **Still absent, and still a schedule**: `migrate`, which [21 §1.3] makes
 * optional and which [06 §4.2] wants only for *"the genuine minority"* of schema
 * changes, so it acquires a consumer or it does not arrive; and
 * `surface?: WidgetSpec`, which is the HUD half of [10 §8]'s vocabulary and a
 * different thing from `schema` — this one says what the value *is*, that one
 * says how it looks.
 *
 * **Moved out of the engine at [P7.0], and that move is what dissolves a cycle
 * the engine had been routing around.** `sessions/channels.ts` used to declare
 * this type *and* `CLOCK_CHANNEL`, and said why in as many words — the clock's
 * definition lives engine-side because `retrieval/timing.ts` needs the type and
 * a mode importing the value while the engine imported the mode would be a
 * `const` cycle and a TDZ `ReferenceError` at load. With the type in a third
 * package that neither imports, a mode can declare its own channels and the
 * engine can read them, and nothing has to be defined in the wrong place to
 * avoid a loop.
 */
/**
 * Where a channel's value comes from before anything has changed it —
 * [06 §4](../../../docs/design/06-modes-and-turn-pipeline.md)'s *"literal
 * default, from treatment, or generated at start"*, built at
 * [P7.1](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Two arms of the three, and the third is deferred for a reason that is not
 * "no consumer yet".** A *generated* init means a draw or a call at session
 * start, and session start is not a turn: the RNG tape is keyed
 * `site:purpose#index` and lives on a turn record
 * ([19 §14.6](../../../docs/design/19-tech-stack.md)), so a value drawn before
 * the first turn has nowhere to be recorded — and replay-from-zero, which
 * [07 §4](../../../docs/design/07-branching.md) makes a CI assertion, could not
 * reproduce it. The two arms below are pure functions of declarations the
 * session already stores, which is what makes them replay-safe for free.
 *
 * So *generated* is not one more arm on this union. It is **init becoming a
 * recorded effect** on the first turn that needs the channel, which is a
 * mechanism rather than a case, and the day something needs it that is the
 * change to make. Stated here rather than discovered then, because 06 §4 names
 * three arms and a published type that silently ships two is the divergence
 * [P7.0] spent a commit correcting elsewhere.
 */
export type InitPolicy =
  /** The value a channel starts at, written into the declaration. */
  | { kind: 'literal'; value: unknown }
  /**
   * An advisory value the author wrote down, wherever they wrote it.
   *
   * **`authored` rather than `treatment`, though 06 §4 says "from treatment".**
   * [04 §6.1b](../../../docs/design/04-schemas.md) settles where such a value
   * may be written and the answer is both: *"a Treatment proposes, a Setup
   * overrides, and the running session owns it"*. A name that said `treatment`
   * would be wrong the first time a Setup won, and a published name is
   * expensive to correct.
   *
   * `fallback` is what an unauthored session gets, and it is required: absent
   * means *unspecified*, which 04 §6.1b is explicit does not mean the middle
   * value of the range. The channel says what unspecified resolves to.
   */
  | { kind: 'authored'; field: string; fallback: unknown };

export interface ChannelDefinition {
  id: string;
  /**
   * Who owns this channel — a mode, an extension, or a package
   * ([06 §4.1](../../../docs/design/06-modes-and-turn-pipeline.md)).
   *
   * Accepting a package id from the first channel definition written is one of
   * two things §4.1 says 1.0 owes, because widening it afterwards is a
   * migration over every stored channel. It is already exercised: the
   * retriever's timing channel is owned by `storyengine.lore`, which is a
   * package and not a mode.
   */
  owner: string;
  version: number;
  scope: 'session' | 'actor' | 'entry';
  update: 'model-proposed' | 'engine-computed' | 'user-only';
  visibility: 'player' | 'hidden';
  /** Tokens the channel may spend when rendered into a prompt. Null for none. */
  budget: number | null;
  /**
   * The state shape, as JSON Schema — [06 §4.2], [25 B7], built at [P7.1].
   *
   * **Required rather than optional, which is 06 §4's own shape and not a
   * tightening.** A channel without one cannot be validated, so it cannot be
   * coerced, migrated or quarantined either — the whole
   * validate-coerce-migrate-quarantine ladder is downstream of this field
   * existing. Making it optional would make the ladder optional, and the ladder
   * is what keeps *a session must always open* true when a mode changes shape
   * under a three-month-old game.
   *
   * `object` rather than a JSON Schema type: this is what Ajv compiles, the
   * validator the workspace already carries, and importing a schema type into
   * the published contract would put a dependency in front of every extension
   * author for a field they write as a literal.
   */
  schema: object;
  /**
   * How the value reads when a preset injects it — [06 §4], [P7.1].
   *
   * **A Liquid template over the channel's own value, and nothing else.** The
   * same engine a preset block's `template` uses, with a context that is the
   * channel value rather than
   * [06 §5](../../../docs/design/06-modes-and-turn-pipeline.md)'s closed
   * participant namespace: a clock declaring `Day {{day}}, {{hour}}:{{minute}}`
   * is the mode saying how its own state reads in a prompt, which is exactly the
   * declarative contract [10 §8](../../../docs/design/10-ui-surfaces.md) draws
   * for the HUD, applied to text.
   *
   * **This is the *injection* half of the channel contract and it did not
   * exist.** `{ of: 'channel', channelId }` has been a legal preset slot since
   * P2, and the collector returned nothing for it — so an author could name a
   * channel in a preset and get silence, with no error and nothing to read. That
   * is also why `budget` had no reader: there was no path that spent tokens.
   *
   * **Optional, and absent is a real answer**: a channel with no template is one
   * with nothing worth saying to a model. Lore timing is the shipped example —
   * `sticky`, `cooldown` and `fired` are bookkeeping, and a player asking why an
   * entry fired gets a reason from the workbench rather than from the prompt.
   *
   * *A template rather than a function, for the reason nothing on this type is a
   * function: a mode is data ([06 §2]), and a `render()` here would be the back
   * door that section says means the contract is wrong.*
   */
  render?: string;
  /**
   * Where the value starts. See {@link InitPolicy}.
   *
   * **Required, and that is the point of adding it.** `CLOCK_START` and
   * `NO_TIMING` were engine constants beside the code that read them, so a
   * channel's initial value was something the *engine* knew and the declaration
   * did not — the same shape of gap `ModeDefinition.channels` had before [P7.0]
   * gave it teeth. A mode that cannot say where its own channel starts has not
   * declared the channel.
   */
  init: InitPolicy;
}
