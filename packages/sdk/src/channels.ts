// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * What a channel declares about itself —
 * [21 §1.3](../../../docs/design/21-internal-contracts.md).
 *
 * **Deliberately short of the documented type**, and the absences are a
 * schedule rather than an oversight. `schema`, `init: InitPolicy`, `migrate`
 * and `surface?: WidgetSpec` are all specified and none is here:
 * [21 §6](../../../docs/design/21-internal-contracts.md) defers `InitPolicy`
 * and `WidgetSpec` on the grounds that they *"want the mode contract built
 * first"*, which is this package, and
 * [P7.1](../../../docs/design/workplan/23-p7-implementation.md) is the stage
 * that designs them against their first real consumer. Guessing them here would
 * be the one thing worse than leaving them out: a shape other code starts
 * depending on before the section that owns it exists.
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
}
