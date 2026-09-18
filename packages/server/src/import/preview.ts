// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  IMPORT_DESTINATIONS,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  LOREBOOK_SCHEMA,
  type ImportDestination,
  type ImportNote,
  type ImportPreview,
  type ImportPreviewBlock,
  type ImportPreviewParam,
  type ImportPreviewReimport,
  type Preset,
  type PresetBlock,
} from '@storyengine/shared';

import type { LibraryContext } from '../library.js';

import { convertScenario } from './aventuras/scenario.js';
import { identify, stampImported } from './identity.js';
import { nameOf, PRESET_CONVERTERS } from './preset-converters.js';
import type { ImportCandidate } from './source.js';

/**
 * What a commit of one hand-picked file would do, worked out without writing it.
 *
 * **The whole feature is one negative claim: nothing here writes.** Everything
 * else — the block list, the params, the losses — is presentation. `preview.test.ts`
 * asserts the negative first and loudest, because it is the property a later
 * convenience is most likely to cost and the one nobody would notice losing.
 *
 * **Why this exists at all**, given that [10 §5](../../../../docs/design/10-ui-surfaces.md)
 * struck *"let the user fix it before committing"*: P4 §1.4's three arguments
 * are about scale and staging — a staging area is a second library, dangling
 * references are survivable by stance, a three-hundred-object sweep gated
 * per-object is a chore — and none of them reaches one file somebody just chose
 * in a dialog. A sweep still commits first and reports. This is the other case.
 *
 * **And no staging area appears.** Nothing is written and nothing is held: the
 * bytes stay in the browser and are sent again on confirm, so the commit
 * re-derives from the file rather than trusting what was predicted here. That
 * means the two can disagree — if the file changed underneath, the commit's
 * report is the true one and the preview was a prediction that expired. That is
 * the honest posture rather than a gap: the alternative is a server-side
 * scratch copy, which is the second library §1.4 refused.
 *
 * It reaches the converters through `PRESET_CONVERTERS` rather than through
 * `Writer.write`, every arm of which ends in a store.
 */

export interface PreviewRequest {
  library: LibraryContext;
  /** Whose library the re-import question is asked about. */
  handle: string;
  /** The file as it arrived. Never a path ([21 §4.1.1]). */
  filename: string;
  candidate: ImportCandidate;
  /**
   * Which sampler parameters this build's adapter puts on the wire.
   *
   * **Passed in rather than imported**, so this module stays as ignorant of
   * transport as `source.ts` requires the converters to be. *Which params reach
   * a model* is a fact about the provider adapter; the caller knows one and this
   * knows the other, and the seam is what keeps `import/` from growing an
   * opinion about what a provider is.
   */
  forwarded: ReadonlySet<string>;
  /**
   * Which kind the preview should be computed for, when the file has a choice.
   *
   * **The preview is where the choice is made, which is why it is here and not
   * only on the commit.** A control that changed what a commit produced without
   * changing what the look showed would be a look at something else.
   */
  destination?: ImportDestination;
}

export async function previewOne(request: PreviewRequest): Promise<ImportPreview> {
  const { candidate, filename } = request;

  // The second kind with a summary, and the first with a question in it.
  if (candidate.format === 'aventuras.scenario') return previewScenario(request);

  const convert = PRESET_CONVERTERS[candidate.format];

  if (convert === undefined) {
    /**
     * Converts, and this build has no summary for its kind yet.
     *
     * Cards and lorebooks land here. The flow is deliberately the same for them
     * — a look, then a word — and only the richness of the look varies, because
     * a preview that fired for preset JSON and not for the card PNG most people
     * upload first would be [P4 §7.1]'s defect committed a second time on
     * purpose. `reimport: 'unknown'` rather than a guess: working it out needs
     * the converted object, and converting is what this arm does not do.
     */
    return {
      source: filename,
      disposition: 'converted',
      notes: [],
      advisories: [],
      object: { kind: 'opaque', name: nameOf(filename) },
      reimport: 'unknown',
    };
  }

  const converted = convert(candidate.payload, nameOf(filename));
  if (!converted.ok) {
    // The same row `refusedItem` builds in the sweep, in the same vocabulary: a
    // file that refuses should say the same thing whichever door it came in by.
    return {
      source: filename,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.file.refused',
          params: { file: filename, refusal: converted.refusal },
          level: 'warn',
        },
      ],
      advisories: [],
      object: null,
      reimport: 'unknown',
    };
  }

  const { preset, notes } = converted.value;

  /**
   * Stamped and identified exactly as a commit would, and both are read-only
   * here: `stampImported` writes two fields on an object that is about to be
   * thrown away, and `identify` reads the index and compares encodings without
   * touching the store. Doing it any other way — guessing at the re-import
   * answer, or asking a cheaper question — would be a preview that disagrees
   * with the commit about the one thing the person is being asked to decide.
   */
  stampImported(preset, filename);
  const identity = await identify(request.library, request.handle, PRESET_SCHEMA, preset);

  const params = paramsOf(preset, request.forwarded);
  const inert = params.filter((param) => !param.reaches);

  return {
    source: filename,
    disposition: identity.kind === 'unchanged' ? 'unchanged' : 'converted',
    notes,
    advisories: advisoriesFor(inert),
    object: {
      kind: 'preset',
      name: preset.name,
      blocks: preset.blocks.map(blockOf),
      params,
      maxContextTokens: preset.budget.maxContextTokens,
      preferredModelIds: preset.modelHint?.preferredModelIds ?? [],
      /**
       * **Names, never values** — the rule that keeps this screen from being the
       * *"import as-is"* affordance [04 §8.4.4] refuses to have anywhere. The
       * converters strip credentials before this point, so it is belt as well as
       * braces; the property worth having is that no route here carries a value,
       * not that something upstream was careful.
       */
      compatKeys: Object.keys(preset.compat ?? {}),
    },
    reimport: identity.kind satisfies ImportPreviewReimport,
  };
}

/**
 * An Aventuras scenario, summarised — and asked about.
 *
 * **It converts twice as far as a preset preview does and no further.** The
 * object is built, stamped and identified exactly as the commit would, for
 * `previewOne`'s stated reason one screen up: a preview that asked a cheaper
 * question than the commit would disagree with it about the very thing the
 * person is deciding. Nothing is written, and the cast is *not* stored — which
 * is why `reimport` here answers about the treatment alone, and the actors
 * beside it are named rather than counted as new or unchanged.
 *
 * **The cast is read off the conversion rather than the file**, so the names
 * shown are the ones that would land: an npc with no name is dropped by the
 * converter, and a preview that counted the raw array would promise an actor
 * that never arrives.
 */
async function previewScenario(request: PreviewRequest): Promise<ImportPreview> {
  const { candidate, filename } = request;
  const destination = request.destination ?? 'treatment';
  const converted = convertScenario(candidate.payload, nameOf(filename), destination);

  if (!converted.ok) {
    return {
      source: filename,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.file.refused',
          params: { file: filename, refusal: converted.refusal },
          level: 'warn',
        },
      ],
      advisories: [],
      object: null,
      reimport: 'unknown',
    };
  }

  const { treatment, lorebook, cast, notes } = converted.value;
  const object = treatment ?? lorebook;
  if (object === null) {
    return {
      source: filename,
      disposition: 'unrecognised',
      notes,
      advisories: [],
      object: null,
      reimport: 'unknown',
    };
  }

  stampImported(object, filename);
  const identity = await identify(
    request.library,
    request.handle,
    treatment === null ? LOREBOOK_SCHEMA : TREATMENT_SCHEMA,
    object,
  );

  const framing = treatment === null ? (lorebook?.entries[0]?.content ?? '') : treatment.framing;

  return {
    source: filename,
    disposition: identity.kind === 'unchanged' ? 'unchanged' : 'converted',
    notes,
    advisories: [],
    object: {
      kind: 'scenario',
      name: object.name,
      blurb: treatment === null ? (lorebook?.description ?? '') : treatment.blurb,
      framingChars: framing.length,
      cast: cast.map((member) => member.actor.name),
      openings: treatment === null ? 0 : treatment.openings.written.length,
      destination,
      alternatives: [...IMPORT_DESTINATIONS],
    },
    reimport: identity.kind satisfies ImportPreviewReimport,
  };
}

/**
 * The sampler settings, each marked whether it reaches a model.
 *
 * **Numbers only, and that is complete rather than lazy** for what this path
 * produces: `GenerationParams` has one non-numeric field, `stop`, and neither
 * SillyTavern converter maps anything to it — so a `stop` here would be a
 * parameter no import can create. `seed: null` is skipped for the same reason it
 * is harmless: it means *leave it to the provider*, which is what omitting it
 * does anyway.
 */
function paramsOf(preset: Preset, forwarded: ReadonlySet<string>): ImportPreviewParam[] {
  return Object.entries(preset.params)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, value]) => ({ name, value, reaches: forwarded.has(name) }));
}

/**
 * Facts about this build rather than about the file.
 *
 * One note however many settings are inert, naming them, because the sentence a
 * person needs is *these do not reach the model* rather than five copies of it —
 * and because it sits directly beside `import.preset.paramsCarried`'s *"N
 * sampler settings carried over"*, which it exists to qualify.
 */
function advisoriesFor(inert: readonly ImportPreviewParam[]): ImportNote[] {
  if (inert.length === 0) return [];
  return [
    {
      key: 'import.preset.samplerNotForwarded',
      params: { fields: inert.map((param) => param.name).join(', '), count: inert.length },
      // `warn` on `text-completion.ts`'s own reasoning: the object will look
      // fine and part of it does nothing, which is the case a person most needs
      // pointed out.
      level: 'warn',
    },
  ];
}

function blockOf(block: PresetBlock): ImportPreviewBlock {
  const common = {
    id: block.id,
    label: block.label,
    role: block.role,
    enabled: block.enabled,
    at: block.placement.at,
    ...(block.placement.at === 'in-history' ? { fromEnd: block.placement.fromEnd } : {}),
    appliesTo: [...block.appliesTo],
  };

  // `fills` is the slot's `of` and nothing more — the screen says *history* or
  // *persona*, not the whole `SlotSource`, because a person deciding whether to
  // keep a preset is asking what goes in the hole rather than which section id
  // fills it.
  return block.kind === 'slot'
    ? { ...common, kind: 'slot', fills: block.source.of }
    : { ...common, kind: 'text' };
}
