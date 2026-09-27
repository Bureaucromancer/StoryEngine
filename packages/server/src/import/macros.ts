// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ownEntry } from './parse.js';

/**
 * SillyTavern's macros, converted to Liquid at import
 * ([04 §8.4.2](../../../../docs/design/04-schemas.md),
 * [P4 §1.6](../../../../docs/design/workplan/16-p4-implementation.md)).
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
  /** Not in the table. Preserved verbatim and flagged ([04 §8.4.2]). */
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
   * ([19 §14](../../../../docs/design/19-tech-stack.md)) — a template rolling
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
  /**
   * ~~`persona` → `{{ user }}`~~ ***A body, not a name*** (2026-09-27).
   * SillyTavern binds `{{persona}}` to the persona's **description**
   * (`environment.persona = fields.persona`, beside `description`, `scenario`
   * and the rest), not to its name — so the mapping put the player's name where
   * a preset asked for the player's whole description. It is a body, and the
   * persona slot supplies it.
   */
  persona: { kind: 'refused', because: 'body-comes-from-a-slot' },

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

const UNKNOWN: MacroOutcome = { kind: 'unknown' };

export interface MacroConversion {
  /** The template, with mapped macros rewritten and refused ones removed. */
  template: string;
  /**
   * Macro name to what became of it — one entry per *distinct* macro seen,
   * until the budget it was given is spent.
   */
  seen: Map<string, MacroOutcome>;
}

/**
 * ***How many macros one converted object names in its review*** (2026-09-27).
 *
 * A note per distinct macro, per block, is what makes a review readable — and
 * with no limit it was a way to spend the server's memory: a million distinct
 * `{{mN}}` in a ten-megabyte file became a million notes, and at the upload
 * limit the notes no longer fitted in one string, so the reply and the ledger
 * row threw after the work was done. The limit is per converted object, shared
 * by all its blocks, because a limit per block is beaten by having many blocks.
 * Past it, uses are **counted** into one note rather than named — every one is
 * still converted exactly as before; only the telling stops.
 */
export const MACRO_NOTE_LIMIT = 100;

export interface MacroNoteBudget {
  /** Distinct macros still to name. */
  left: number;
  /** Uses of macros past the limit: counted, not named. */
  unlisted: number;
}

export function macroNoteBudget(): MacroNoteBudget {
  return { left: MACRO_NOTE_LIMIT, unlisted: 0 };
}

/**
 * `{{ … }}` as SillyTavern writes it.
 *
 * Deliberately not a general parser. ST macros are a flat name, optionally with
 * `::`-separated arguments — `{{random::a::b}}` — and anything more structured
 * than that is something this table does not claim to understand, which is what
 * `unknown` is for.
 *
 * ***Linear, and a macro inside an argument is taken whole*** (2026-09-27).
 * The pattern this replaces, `\{\{\s*(name)((?:::[^}]*)?)\s*\}\}`, was
 * quadratic twice over: the argument's `[^}]*` and the trailing `\s*` could
 * both take the same spaces, and `[^}]*` ran on past every later `{{` to the
 * next `}`, so every start scanned to the same distant brace. `{{a::` and a
 * quarter of a megabyte of spaces cost 25.5 seconds of synchronous work, on
 * the thread every account shares, and a file at the upload limit would have
 * taken weeks. An argument now stops at any brace, and may carry up to eight macros
 * of its own: `{{random::{{char}} smiles::{{user}} frowns}}` is ordinary
 * SillyTavern text, and the obvious linear pattern stopped at the inner `{{`,
 * missed `random` altogether, and left `{{random::` for the model to read.
 * Bounded at eight rather than unbounded because a repetition of a group is
 * what overflows V8's backtracking stack on a file of this size.
 */
const MACRO_PATTERN =
  /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:(::[^{}]*(?:\{\{[^{}]*\}\}[^{}]*){0,8})|\s*)\}\}/g;

/**
 * Rewrites one template's macros.
 *
 * An unrecognised macro is **left exactly as it was**, braces and all, which is
 * §8.4.2's rule and worth restating because it looks like a bug: *a mangled
 * prompt that looks fine is worse than one that visibly needs a look.* The
 * review carries the flag; the file carries the evidence.
 */
export function convertMacros(
  template: string,
  budget: MacroNoteBudget = macroNoteBudget(),
  options: { angles?: boolean } = {},
): MacroConversion {
  const seen = new Map<string, MacroOutcome>();

  const replace = (whole: string, rawName: string): string => {
    const name = rawName.toLowerCase();
    // Own entries only: `{{constructor}}` looked up `Object`, and came out as
    // the text `undefined` with no note (2026-09-27).
    const outcome = ownEntry(MACROS, name) ?? UNKNOWN;
    if (!seen.has(name)) {
      if (outcome.kind === 'mapped') {
        // Never a note, and there are five of them.
        seen.set(name, outcome);
      } else if (budget.left > 0) {
        seen.set(name, outcome);
        budget.left -= 1;
      } else {
        budget.unlisted += 1;
      }
    }

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
  };

  /**
   * ***SillyTavern's legacy forms, for the converters that read its files***
   * (2026-09-27). Its `evaluateMacros` still resolves `<USER>`, `<BOT>`,
   * `<CHAR>`, `<CHARIFNOTGROUP>` and `<GROUP>`, in any case, before any curly
   * macro; they are the same names by another spelling and go through the
   * same table. Asked for rather than always done, because in another format a
   * `<char>` may be markup.
   */
  const unangled = options.angles === true ? template.replace(ANGLES, replace) : template;
  return { template: unangled.replace(MACRO_PATTERN, replace), seen };
}

/** The legacy names SillyTavern resolves in angle brackets. */
const ANGLES = /<(user|bot|char|charifnotgroup|group)>/gi;
