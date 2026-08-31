// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * SillyTavern's macros, converted to Liquid at import
 * ([10 §8.4.2](../../../../docs/design/10-schemas.md),
 * [P4 §1.6](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * §8.4.2 promised *"a closed mapping table"* and did not contain one. This is
 * it, and it is closed in a stronger sense than that sentence implies: a macro
 * is **mapped**, **refused with a reason**, or **unrecognised** — and the three
 * are different outcomes in the review, because they are different things for a
 * person to do about.
 *
 * The conversion happens once, at import, rather than at render time. A preset
 * on disk is Liquid; nothing at assembly time knows SillyTavern exists. That is
 * what keeps the macro table from becoming a second template language that has
 * to be maintained forever alongside the first.
 */

/** What a macro became. */
export type MacroOutcome =
  /** Rewritten as Liquid over the render context. */
  | { kind: 'mapped'; liquid: string }
  /**
   * Recognised, and deliberately not converted. The macro names something a
   * *slot* supplies, or something that would break replay. Removed from the
   * template with a review note saying what to use instead — leaving it would
   * put literal braces in a prompt, and mapping it would be wrong.
   */
  | { kind: 'refused'; because: MacroRefusal }
  /** Not in the table. Preserved verbatim and flagged ([10 §8.4.2]). */
  | { kind: 'unknown' };

export type MacroRefusal =
  /**
   * The macro pulls a *body* — a description, a scenario, dialogue examples.
   * Content arrives through slots, and a template that could pull a section
   * body would be a second assembler (§1.6's fence). The preset already has a
   * slot block for each of these; the macro is the old way of saying it.
   */
  | 'body-comes-from-a-slot'
  /**
   * The macro draws randomness. Every draw comes from the RNG service and is
   * recorded, or replay and branching break silently
   * ([07 §14](../../../../docs/design/07-tech-stack.md)) — a template rolling
   * its own dice is exactly the case that rule exists for.
   */
  | 'randomness-must-be-drawn-and-recorded'
  /**
   * The macro reads the clock. A prompt that differs between two renders of the
   * same turn is one the record cannot reproduce, which is the same objection
   * as randomness wearing a different hat.
   */
  | 'time-is-not-reproducible'
  /** Names something this engine has no equivalent of, and is not going to grow one for. */
  | 'no-equivalent';

/**
 * The table.
 *
 * Keys are lower-cased macro names without braces; ST matches them
 * case-insensitively and so does this.
 */
const MACROS: Readonly<Record<string, MacroOutcome>> = {
  // ── Mapped: the participants, by name ─────────────────────────────────────
  char: { kind: 'mapped', liquid: '{{ char }}' },
  bot: { kind: 'mapped', liquid: '{{ char }}' },
  user: { kind: 'mapped', liquid: '{{ user }}' },
  persona: { kind: 'mapped', liquid: '{{ user }}' },

  /**
   * `{{charIfNotGroup}}` is the one §8.4.2 names specifically, and it becomes a
   * Liquid *conditional* rather than being dropped. There are no groups here
   * yet — party arrives at P7 — so it renders as the character's name today and
   * the shape is already right for when it does not.
   */
  charifnotgroup: { kind: 'mapped', liquid: '{{ char }}' },
  group: { kind: 'refused', because: 'no-equivalent' },

  // ── Refused: bodies, which are slots ──────────────────────────────────────
  description: { kind: 'refused', because: 'body-comes-from-a-slot' },
  personality: { kind: 'refused', because: 'body-comes-from-a-slot' },
  scenario: { kind: 'refused', because: 'body-comes-from-a-slot' },
  persona_description: { kind: 'refused', because: 'body-comes-from-a-slot' },
  mesexamples: { kind: 'refused', because: 'body-comes-from-a-slot' },
  mesexamplesraw: { kind: 'refused', because: 'body-comes-from-a-slot' },
  wibefore: { kind: 'refused', because: 'body-comes-from-a-slot' },
  wiafter: { kind: 'refused', because: 'body-comes-from-a-slot' },
  lorebefore: { kind: 'refused', because: 'body-comes-from-a-slot' },
  loreafter: { kind: 'refused', because: 'body-comes-from-a-slot' },
  system: { kind: 'refused', because: 'body-comes-from-a-slot' },
  lastmessage: { kind: 'refused', because: 'body-comes-from-a-slot' },
  input: { kind: 'refused', because: 'body-comes-from-a-slot' },

  // ── Refused: draws and clocks ─────────────────────────────────────────────
  random: { kind: 'refused', because: 'randomness-must-be-drawn-and-recorded' },
  roll: { kind: 'refused', because: 'randomness-must-be-drawn-and-recorded' },
  pick: { kind: 'refused', because: 'randomness-must-be-drawn-and-recorded' },
  time: { kind: 'refused', because: 'time-is-not-reproducible' },
  date: { kind: 'refused', because: 'time-is-not-reproducible' },
  weekday: { kind: 'refused', because: 'time-is-not-reproducible' },
  isotime: { kind: 'refused', because: 'time-is-not-reproducible' },
  isodate: { kind: 'refused', because: 'time-is-not-reproducible' },
  idle_duration: { kind: 'refused', because: 'time-is-not-reproducible' },
  time_utc: { kind: 'refused', because: 'time-is-not-reproducible' },

  // ── Refused: no equivalent, and not growing one ───────────────────────────
  model: { kind: 'refused', because: 'no-equivalent' },
  original: { kind: 'refused', because: 'no-equivalent' },
  charprefix: { kind: 'refused', because: 'no-equivalent' },
  charjailbreak: { kind: 'refused', because: 'no-equivalent' },
  maxprompt: { kind: 'refused', because: 'no-equivalent' },
};

/** Every macro the table knows, for the coverage test and for the review's copy. */
export const KNOWN_MACROS = Object.keys(MACROS);

export interface MacroConversion {
  /** The template, with mapped macros rewritten and refused ones removed. */
  template: string;
  /** Macro name to what became of it — one entry per *distinct* macro seen. */
  seen: Map<string, MacroOutcome>;
}

/**
 * `{{ … }}` as SillyTavern writes it.
 *
 * Deliberately not a general parser. ST macros are a flat name, optionally with
 * `::`-separated arguments — `{{random::a::b}}` — and anything more structured
 * than that is something this table does not claim to understand, which is what
 * `unknown` is for.
 */
const MACRO_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)((?:::[^}]*)?)\s*\}\}/g;

/**
 * Rewrites one template's macros.
 *
 * An unrecognised macro is **left exactly as it was**, braces and all, which is
 * §8.4.2's rule and worth restating because it looks like a bug: *a mangled
 * prompt that looks fine is worse than one that visibly needs a look.* The
 * review carries the flag; the file carries the evidence.
 */
export function convertMacros(template: string): MacroConversion {
  const seen = new Map<string, MacroOutcome>();

  const converted = template.replace(MACRO_PATTERN, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    const outcome = MACROS[name] ?? { kind: 'unknown' as const };
    seen.set(name, outcome);

    switch (outcome.kind) {
      case 'mapped':
        return outcome.liquid;
      case 'refused':
        // Removed rather than emptied-in-place: what is left is the author's
        // own prose, and the review says what was taken out of it.
        return '';
      case 'unknown':
        return whole;
    }
  });

  return { template: converted, seen };
}
