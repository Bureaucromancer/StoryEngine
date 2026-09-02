// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportNote } from './import.js';

/**
 * What a commit of these bytes *would* do, worked out without writing any of it.
 *
 * **Beside the review rather than inside it, and the split is the same one
 * `preview.ts` makes beside `turn.ts`**: an `ImportReport` is written to disk
 * (the sweep's job ledger keeps one), and none of this ever is. Putting the two
 * in one file would invite somebody to store a preview, and a stored prediction
 * is a claim that goes stale the moment anything around it changes.
 *
 * **Why it exists at all.** [05 §5](../../../docs/design/05-ui-surfaces.md)
 * struck *"let the user fix it before committing"* in favour of committing first
 * and reporting loudly, and [P4 §1.4] argues it in full — a staging area is a
 * second library, dangling references are survivable by stance, and a
 * three-hundred-object sweep gated per-object on a human is a chore rather than
 * a review. All three of those are arguments about *scale and staging*, and none
 * of them reaches one file somebody just picked out of a dialog. So a sweep
 * still commits first and reports; one hand-picked file reports first and
 * commits on a word.
 *
 * **No staging area appears, which is the load-bearing claim.** Nothing here is
 * written, and nothing here is held: the bytes stay in the browser's own file
 * handle and are sent a second time on confirm, so the commit re-derives
 * everything from the file rather than trusting a prediction. Nothing is built
 * to be discarded ([01 §2.2]) because nothing is built.
 *
 * **A summary rather than the object.** This carries statements *about* what
 * would land, never the converted `Preset` itself, for two reasons that both
 * matter. A review is a set of statements about an object rather than a dump of
 * one; and a `Preset` carries `compat`, whose values are the file's own
 * unrecognised fields. See `compatKeys`.
 */
export interface ImportPreview {
  /** The file as it arrived. Never a path ([13 §4.1.1]). */
  source: string;
  /**
   * The disposition the commit is expected to report.
   *
   * A **prediction**, and the field is named as one in the type's own docs
   * because it is not a record of anything: the file could change underneath,
   * and the commit's answer is the real one.
   */
  disposition: ImportDisposition;
  /** The converter's own notes — everything lossy about this file. */
  notes: ImportNote[];
  /**
   * Facts about **this build** rather than about this file.
   *
   * A separate array because they must never be stored, which is the same rule
   * near-miss `suggestions` already follow beside a sweep report. *Which sampler
   * settings the adapter forwards* changes when the adapter changes, without the
   * file changing — so an advisory frozen into a saved report would start lying
   * on an upgrade, while the notes beside it stay true.
   */
  advisories: ImportNote[];
  /** What would land, or `null` when nothing would. */
  object: ImportPreviewObject | null;
  /** What a commit would do about something already in the library. */
  reimport: ImportPreviewReimport;
}

/**
 * Whether this file has been imported here before, and whether it has changed.
 *
 * The first three are `identify()`'s own answers, asked without writing — so
 * *replace or keep both* becomes a question the person can be asked before the
 * write rather than told about after it.
 *
 * **`unknown` is the fourth, and it is an answer rather than a failure.**
 * Working the question out means converting the file and comparing the result,
 * and the kinds this build has no preview summary for are exactly the kinds it
 * has not converted by this point. Guessing `new` there would put a *this is
 * fresh* claim on a screen next to a button, which is the one place a guess
 * costs something. A caller that sees `unknown` offers no conflict choice.
 */
export type ImportPreviewReimport = 'new' | 'unchanged' | 'changed' | 'unknown';

export type ImportPreviewObject =
  | ImportPreviewPreset
  /**
   * A root in a file — an archive, or one of Marinara's export envelopes. It
   * sweeps, and a sweep keeps committing first: previewing one means a dry-run
   * of the whole walk, which is a different and much larger change.
   *
   * Named rather than refused so that the *flow* stays the same for every
   * hand-picked file — a look, then a word — and only the richness of what the
   * look can say varies. A preview that fired for preset JSON and not for the
   * card PNG most people upload first would be [P4 §7.1]'s defect on purpose.
   */
  | { kind: 'sweep' }
  /** Converts, and this build has no summary for its kind yet. */
  | { kind: 'opaque'; name: string };

export interface ImportPreviewPreset {
  kind: 'preset';
  /** What the preset would be called — the file's own stem, per `nameOf`. */
  name: string;
  blocks: ImportPreviewBlock[];
  params: ImportPreviewParam[];
  /** `budget.maxContextTokens`, when the source set one. */
  maxContextTokens: number | null;
  /** `modelHint.preferredModelIds` — a wish, never a binding ([10 §3]). */
  preferredModelIds: string[];
  /**
   * The **names** of the fields kept verbatim under `compat`, and never their
   * values.
   *
   * **This is the rule that keeps a preview from becoming the "import as-is"
   * affordance [10 §8.4.4] refuses to have anywhere.** A screen that showed what
   * was in the file would show a proxy password to whoever was handed the file —
   * turning a look-before-you-commit into a credential viewer, which is a worse
   * feature than the one being added.
   *
   * Credentials are stripped by the converters before this is built, so this is
   * belt as well as braces. It is written down as a rule anyway: the converters
   * were only doing it on one path of three until this stage, and the property
   * worth having is *no route carries a value here* rather than *the converter
   * upstream is careful*.
   */
  compatKeys: string[];
}

export interface ImportPreviewBlock {
  id: string;
  label: string;
  kind: 'slot' | 'text';
  role: 'system' | 'user' | 'assistant';
  enabled: boolean;
  at: 'sequence' | 'in-history';
  /** Messages from the end, for `in-history`. ST counts messages and so do we. */
  fromEnd?: number;
  /** For a slot, what it fills — the source's `of`. Absent on a text block. */
  fills?: string;
  /** The call kinds this block applies to; empty means every call. */
  appliesTo: string[];
}

export interface ImportPreviewParam {
  /** Our own name — `temperature`, `topA` — as the preset will store it. */
  name: string;
  value: number;
  /**
   * Whether this build's adapter actually puts it on the wire.
   *
   * `false` for the five `GenerationParams` fields that convert faithfully from
   * a SillyTavern preset and never reach a model
   * (`server/src/providers/forwarded-params.ts`). Carried per-param rather than
   * as one list so the screen can mark the row itself: *"6 sampler settings
   * carried over"* beside a table where two of them say *not sent* is a sentence
   * that explains itself.
   */
  reaches: boolean;
}
