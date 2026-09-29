// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  CARD_PROMPT_SECTION_IDS,
  CONVENTIONAL_SECTION_IDS,
  newActor,
  type Actor,
  type ImportNote,
  type Lorebook,
  type Section,
  type SectionPlacement,
} from '@storyengine/shared';

import { CHAT_IMPORT_MODE_ID } from '../../mode-registry.js';
import { stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';
import { convertLorebook } from './lorebook.js';

/**
 * SillyTavern V2/V3 character cards → `Actor`
 * ([P4 §1.10](../../../../../docs/design/workplan/16-p4-implementation.md),
 * rewriting [03 §2.7]'s table in the shipped schema's own terms).
 *
 * **The row that matters most is `personality`**, because it is where this
 * converter and the preset converter meet. The preset's `charPersonality`
 * marker points at `profile.traits`; if this routed `personality` anywhere else,
 * the two would each be individually correct and produce a slot that resolves
 * empty forever, hidden by `omitWhenEmpty`. That pair is what
 * [testing §5.1](../../../../../docs/design/workplan/03-testing.md) exists to
 * catch and what the fixture-pair gate asserts.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fields that reach `compat` by name rather than by being unrecognised.
 *
 * ~~`system_prompt`, `post_history_instructions`, `depth_prompt` and
 * `talkativeness` were here~~ until [P13.3], which gave each a destination the
 * engine reads: the three prompt fields are sections the Scene pack places, and
 * talkativeness is `modeData` the speaker policy rolls against. See
 * {@link applyCardPrompts} and {@link applyTalkativeness}.
 */
const COMPAT_FIELDS = ['creator', 'creator_notes', 'character_version'];

/**
 * ***The card fields [P13.3] honours***, read here and so neither preserved as
 * unknown nor copied to `compat`. `depth_prompt` and `talkativeness` are
 * V1's top-level spellings; V2 and V3 carry them under `extensions`, which
 * {@link EXTENSIONS_CONSUMED} covers.
 */
const HONOURED = ['system_prompt', 'post_history_instructions', 'depth_prompt', 'talkativeness'];

/** The `extensions.*` keys [P13.3] reads, and so does not also keep in `compat`. */
const EXTENSIONS_CONSUMED = new Set(['depth_prompt', 'talkativeness']);

/** Fields this converter reads, and so does not also preserve as unknown. */
const CONSUMED = new Set([
  ...HONOURED,
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'alternate_greetings',
  'mes_example',
  'tags',
  'character_book',
  'extensions',
  ...COMPAT_FIELDS,
]);

export interface ConvertedCard {
  actor: Actor;
  /** Extracted from `character_book`, already linked from the actor. */
  lorebook: Lorebook | null;
  /**
   * The card's `scenario` text, for the caller to turn into a Treatment.
   *
   * **Returned rather than created here**, because §1.10 wants *one treatment
   * per distinct scenario text within a sweep* — and a converter handed one card
   * cannot know what the others said. Deduplication is a property of the sweep,
   * so it belongs to the sweep.
   */
  scenario: string | null;
  notes: ImportNote[];
}

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/**
 * The V2/V3 envelope: `{ spec, spec_version, data: { … } }`, or a bare V1 object.
 *
 * A card that is already unwrapped is not an error — plenty of tools write the
 * inner object straight into the chunk, and refusing one would be refusing a
 * card over a wrapper.
 */
function unwrap(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  const data = input['data'];
  if (isRecord(data)) return data;
  return typeof input['name'] === 'string' ? input : null;
}

export function convertCard(input: unknown, fallbackName: string): ParseOutcome<ConvertedCard> {
  const card = unwrap(input);
  if (card === null) return refused('wrong-shape');
  if (typeof card['name'] !== 'string' || card['name'].length === 0) {
    return refused('missing-field', 'name');
  }

  const notes: ImportNote[] = [];
  const actor = newActor(card['name'] || fallbackName);

  // The card's prose with its own name written where it left a placeholder,
  // before anything reads it — see `inOwnName`.
  const named = inOwnName(card, actor.name);
  if (named.written > 0) {
    notes.push(note('import.card.ownNameWritten', { actor: actor.name, count: named.written }));
  }
  if (named.player) {
    notes.push(note('import.card.playerPlaceholderKept', { actor: actor.name }, 'warn'));
  }

  applyProfile(named.card, actor, notes);
  applyCardPrompts(named.card, actor, notes);
  applyTalkativeness(named.card, actor);
  applyOpenings(named.card, actor);
  applySample(named.card, actor);
  applyTags(card, actor);

  const lorebook = extractBook(named.card, actor, notes);
  const compat = buildCompat(card);
  if (Object.keys(compat).length > 0) actor.compat = compat;

  const scenario = typeof named.card['scenario'] === 'string' ? named.card['scenario'].trim() : '';

  return parsed({ actor, lorebook, scenario: scenario.length > 0 ? scenario : null, notes });
}

/**
 * ***A card's own name, where it left a placeholder for it*** (2026-09-27) —
 * [00 §2.1], [triage §6.1].
 *
 * SillyTavern resolves a card's `{{char}}` when it sends a message, so a card
 * says `{{char}}` wherever it means itself: in its description, its openings,
 * its example dialogue, the entries of the book it carries. Nothing here reads
 * a body as a template — [P4 §1.6]'s fence, and the reason a `{{` in prose is
 * prose — so every one of those reached the model as braces. [00 §2.1] makes
 * macros an **import-time transform**, and for these it is exact: a card is
 * one character, and its placeholder for itself can only ever mean its name.
 * The forms are the ones SillyTavern's own `evaluateMacros` resolves to the
 * character — `{{char}}` and `{{charIfNotGroup}}`, and the legacy `<BOT>`,
 * `<CHAR>` and `<CHARIFNOTGROUP>` — matched without regard to case, as it
 * matches them.
 *
 * ***The player's placeholder is kept, and said.*** `{{user}}` means whoever
 * is playing, which a card cannot know and a session decides; writing any one
 * name in would be wrong for every other session, and a stand-in like *the
 * player* reads wrongly in half the sentences it lands in. [triage §6.1] leaves
 * open whether any macro survives into authoring, and a flag loses nothing
 * while that is open, so the review says this card uses it.
 *
 * *What changes identity*: an opening's id is derived from its text, so a card
 * imported before this and imported again reports its openings changed, once.
 */
const OWN_NAME = /\{\{(?:char|charifnotgroup)\}\}|<(?:bot|char|charifnotgroup)>/gi;
const PLAYER = /\{\{user\}\}|<user>/i;

/**
 * The prose fields a card's text reaches the model through — ***and its own
 * prompts since [P13.3]***, which reach it as sections now: a card's
 * `system_prompt` says `{{char}}` meaning itself exactly as its description
 * does, and [P13 §1.5] asks for each card's prompts *"rendered with its own
 * `{{char}}"*. Written in here, once, because a section body is never read as a
 * template (the fence above).
 */
const PROSE_FIELDS = [
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'post_history_instructions',
];

function inOwnName(
  card: Readonly<Record<string, unknown>>,
  name: string,
): { card: Record<string, unknown>; written: number; player: boolean } {
  let written = 0;
  let player = false;
  const rewrite = (text: string): string => {
    if (PLAYER.test(text)) player = true;
    return text.replace(OWN_NAME, () => {
      written += 1;
      return name;
    });
  };

  const out: Record<string, unknown> = { ...card };
  for (const field of PROSE_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = rewrite(value);
  }
  const greetings = out['alternate_greetings'];
  if (Array.isArray(greetings)) {
    out['alternate_greetings'] = greetings.map((one: unknown) =>
      typeof one === 'string' ? rewrite(one) : one,
    );
  }
  // The depth prompt, wherever the card's version keeps it ([P13.3]).
  const depth = depthPromptOf(out);
  if (depth !== null && typeof depth.value['prompt'] === 'string') {
    const rewritten = { ...depth.value, prompt: rewrite(depth.value['prompt']) };
    if (depth.at === 'top') {
      out['depth_prompt'] = rewritten;
    } else {
      out['extensions'] = {
        ...(out['extensions'] as Record<string, unknown>),
        depth_prompt: rewritten,
      };
    }
  }
  // The book it carries is its own too, so `{{char}}` in an entry is this
  // character. A world book on its own is not, and is not touched here.
  const book = out['character_book'];
  if (isRecord(book)) {
    const entries = book['entries'];
    const entry = (one: unknown): unknown =>
      isRecord(one) && typeof one['content'] === 'string'
        ? { ...one, content: rewrite(one['content']) }
        : one;
    if (Array.isArray(entries)) {
      out['character_book'] = { ...book, entries: entries.map(entry) };
    } else if (isRecord(entries)) {
      out['character_book'] = {
        ...book,
        entries: Object.fromEntries(Object.entries(entries).map(([key, one]) => [key, entry(one)])),
      };
    }
  }
  return { card: out, written, player };
}

/**
 * `description` and `personality`, which is where the only heuristic lives.
 *
 * **Only the sections the mapping fills are created** ([P4 §1.10]).
 * `se.appearance`, `se.voice` and `se.background` stay absent, so three of the
 * five actor blocks in the default Scene preset render empty — legal and quiet
 * under `omitWhenEmpty`, and said here so the gate does not discover it.
 * Splitting `description` into appearance and voice by heuristic would be
 * inventing structure the source does not have.
 */
function applyProfile(
  card: Readonly<Record<string, unknown>>,
  actor: Actor,
  notes: ImportNote[],
): void {
  const description = typeof card['description'] === 'string' ? card['description'].trim() : '';
  const personality = typeof card['personality'] === 'string' ? card['personality'].trim() : '';

  const paragraphs: string[] = [];
  if (description.length > 0) paragraphs.push(description);

  if (personality.length > 0) {
    const traits = asTraits(personality);
    if (traits === null) {
      // Prose, so it belongs in the summary as its own paragraph rather than
      // being chopped into pseudo-traits.
      paragraphs.push(personality);
      notes.push(note('import.card.personalityAsProse', { actor: actor.name }));
    } else {
      actor.profile.traits = traits;
      notes.push(
        note('import.card.personalityAsTraits', { actor: actor.name, count: traits.length }),
      );
    }
  }

  if (paragraphs.length > 0) {
    actor.profile.sections = [
      {
        id: CONVENTIONAL_SECTION_IDS.summary,
        title: 'Summary',
        body: paragraphs.join('\n\n'),
        disposition: 'always',
      },
    ];
  }
}

/**
 * Is this a list of traits, or a paragraph about someone?
 *
 * **A starting point, not a claim** ([P4 §1.10]) — the result is user-editable
 * either way and the review says which happened. Short comma-separated
 * fragments with no sentence punctuation is what a trait list looks like;
 * anything with a full stop in it, or a fragment long enough to be a clause, is
 * prose that happens to contain a comma.
 */
function asTraits(personality: string): string[] | null {
  if (personality.includes('\n') || /[.!?]/.test(personality)) return null;
  const parts = personality
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  return parts.every((part) => part.length <= 40) ? parts : null;
}

/**
 * ***A card's own prompts, as sections the pack places*** — [P13 §1.5]'s table,
 * [P13.3].
 *
 * | Card field | Section |
 * |---|---|
 * | `system_prompt` | `se.card.system` |
 * | `post_history_instructions` | `se.card.post-history` |
 * | `extensions.depth_prompt` (V1: `depth_prompt`) | `se.card.depth`, with its `depth` and `role` as the section's placement (default 4, `system`: ST's `depth_prompt_depth_default` and `depth_prompt_role_default`, `script.js:549-550`) |
 *
 * **They stack; nothing is replaced.** The pack sends its own instruction and
 * then the card's — §1.5's decision against ST's `prefer_character_prompt`.
 * That is also why ~~`import.card.wantsPromptOverride`~~ no longer fires for
 * having them: the card no longer *wants* something this build will not do.
 *
 * ***What still cannot be honoured, and is still said.*** ST lets a card's
 * prompt spell `{{original}}` for *"the main prompt, here"*
 * (`prefer_character_prompt`'s splice). With stacking the main prompt is
 * already sent, before the card's, so the placeholder is taken out and the
 * review names the field under the old warning — the card asked to arrange the
 * prompt around itself, and that request is the one left unmet.
 *
 * *Blank fields make no section*, as a blank description makes no summary.
 */
function applyCardPrompts(
  card: Readonly<Record<string, unknown>>,
  actor: Actor,
  notes: ImportNote[],
): void {
  const sections: Section[] = [];
  const unmet: string[] = [];
  const text = (field: string, value: unknown): string => {
    if (typeof value !== 'string') return '';
    if (ORIGINAL.test(value)) unmet.push(field);
    return value.replace(ORIGINAL_ALL, '').trim();
  };

  const system = text('system_prompt', card['system_prompt']);
  if (system.length > 0) {
    sections.push(section(CARD_PROMPT_SECTION_IDS.system, 'System prompt', system));
  }
  const post = text('post_history_instructions', card['post_history_instructions']);
  if (post.length > 0) {
    sections.push(
      section(CARD_PROMPT_SECTION_IDS['post-history'], 'Post-history instructions', post),
    );
  }
  const depth = depthPromptOf(card);
  if (depth !== null) {
    const prompt = text('depth_prompt', depth.value['prompt']);
    if (prompt.length > 0) {
      sections.push({
        ...section(CARD_PROMPT_SECTION_IDS.depth, 'Depth prompt', prompt),
        placement: placementOf(depth.value),
      });
    }
  }

  if (sections.length > 0) actor.profile.sections = [...actor.profile.sections, ...sections];
  if (unmet.length > 0) {
    notes.push(note('import.card.wantsPromptOverride', { fields: unmet.join(', ') }, 'warn'));
  }
}

/** ST's *"the main prompt goes here"*, which a stack has already sent. */
const ORIGINAL = /\{\{original\}\}/i;
const ORIGINAL_ALL = /\{\{original\}\}/gi;

function section(id: string, title: string, body: string): Section {
  return { id, title, body, disposition: 'always' };
}

/**
 * The depth prompt object, wherever this card's version keeps it: under
 * `extensions` for V2 and V3, at the top for V1 — or null.
 */
function depthPromptOf(
  card: Readonly<Record<string, unknown>>,
): { at: 'extensions' | 'top'; value: Record<string, unknown> } | null {
  const extensions = card['extensions'];
  if (isRecord(extensions) && isRecord(extensions['depth_prompt'])) {
    return { at: 'extensions', value: extensions['depth_prompt'] };
  }
  const top = card['depth_prompt'];
  return isRecord(top) ? { at: 'top', value: top } : null;
}

/**
 * A depth prompt's depth and role, with ST's defaults for anything missing or
 * unreadable — a depth ST's own editor writes as a string (`'4'`) is read as
 * the number it spells.
 */
function placementOf(value: Readonly<Record<string, unknown>>): SectionPlacement {
  const depth = Number(value['depth']);
  const role = value['role'];
  return {
    fromEnd: Number.isInteger(depth) && depth >= 0 ? depth : DEPTH_PROMPT_DEPTH,
    role: role === 'user' || role === 'assistant' || role === 'system' ? role : 'system',
  };
}

/** ST's `depth_prompt_depth_default` (`script.js:549`). */
const DEPTH_PROMPT_DEPTH = 4;

/**
 * ***Talkativeness, where the speaker policy rolls against it*** — [P13 §1.3],
 * [P13.3]: `actor.modeData[<the chat-import mode>].talkativeness`, a number in
 * `[0, 1]`.
 *
 * **`modeData`, not a section**, because it is participation rather than
 * prompt: §1.3 puts it there, and `turns/speakers.ts`' `talkativenessOf` reads
 * it through the session's mode id. ***Keyed by `CHAT_IMPORT_MODE_ID`***, not
 * by a literal: engine code spells no mode id (`tools/repo-shape.test.ts`), and
 * the mode a SillyTavern chat is imported into is the mode its cards' chattiness
 * is for. A card imported on its own and seated in some other mode's session
 * rolls against the default there, which is the honest reading — how chatty a
 * card is in a group chat says nothing about how another mode plays it.
 *
 * *ST's own spellings*: V2 and V3 keep it under `extensions`, V1 at the top,
 * and ST's editor writes it as a **string** (`'0.6'`). A value that does not
 * read as a finite number is left out, so the member rolls against ST's
 * default (`TALKATIVENESS_DEFAULT`), which is what ST does with it
 * (`group-chats.js:1282-1284`). Clamped, as the reader clamps.
 */
function applyTalkativeness(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  const extensions = card['extensions'];
  const raw =
    isRecord(extensions) && 'talkativeness' in extensions
      ? extensions['talkativeness']
      : card['talkativeness'];
  if (raw === undefined || raw === null || raw === '') return;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return;
  const held = actor.modeData[CHAT_IMPORT_MODE_ID];
  actor.modeData[CHAT_IMPORT_MODE_ID] = {
    ...(isRecord(held) ? held : {}),
    talkativeness: Math.min(1, Math.max(0, value)),
  };
}

/** `first_mes` and `alternate_greetings`, first as primary. */
function applyOpenings(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  const texts: string[] = [];
  if (typeof card['first_mes'] === 'string' && card['first_mes'].trim().length > 0) {
    texts.push(card['first_mes']);
  }
  if (Array.isArray(card['alternate_greetings'])) {
    for (const greeting of card['alternate_greetings']) {
      if (typeof greeting === 'string' && greeting.trim().length > 0) texts.push(greeting);
    }
  }
  if (texts.length === 0) return;

  // Derived rather than minted, so converting the same card twice produces the
  // same object — which is what makes re-import identity a byte comparison
  // rather than a guess ([P4 §1.3]).
  actor.openings.written = texts.map((text, index) => ({
    id: stableId('opening', actor.name, String(index), text),
    label: index === 0 ? 'Opening' : `Alternate ${String(index)}`,
    text,
  }));
  actor.openings.primaryWrittenId = actor.openings.written[0]?.id ?? null;
}

/**
 * `mes_example` → **one writing sample**, enabled, titled from the card.
 *
 * The destination moved after [03 §2.7] was written: dialogue examples stopped
 * being a `Section`, because a `Section` carries no `priority` and [00 §2.6]
 * requires one. A redirect rather than new import surface — still one row, still
 * one destination ([P4 §1.10]).
 */
function applySample(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  const example = typeof card['mes_example'] === 'string' ? card['mes_example'].trim() : '';
  if (example.length === 0) return;

  actor.writingSamples = [
    {
      id: stableId('sample', actor.name),
      title: `${actor.name} — dialogue examples`,
      body: example,
      enabled: true,
      // The author's own words about the sample, and an importer has none: the
      // card said nothing about why these examples are here. Empty rather than
      // a manufactured "imported from SillyTavern", which would put our
      // sentence in a field meant for theirs.
      note: '',
    },
  ];
}

function applyTags(card: Readonly<Record<string, unknown>>, actor: Actor): void {
  if (!Array.isArray(card['tags'])) return;
  actor.tags = card['tags'].filter((tag): tag is string => typeof tag === 'string');
}

/** `character_book` → a real Lorebook, linked from the actor rather than embedded. */
function extractBook(
  card: Readonly<Record<string, unknown>>,
  actor: Actor,
  notes: ImportNote[],
): Lorebook | null {
  const book = card['character_book'];
  if (!isRecord(book)) return null;

  const converted = convertLorebook(book, `${actor.name}'s lore`);
  if (!converted.ok) {
    notes.push(
      note('import.card.bookRefused', { actor: actor.name, refusal: converted.refusal }, 'warn'),
    );
    return null;
  }

  const lorebook = converted.value.lorebook;
  // Scoped to the character it travelled with, which is what an embedded book
  // meant. `linked` rather than `global`: it was never a world book.
  lorebook.scope = { kind: 'linked', actorIds: [actor.id] };
  actor.lore = [{ id: lorebook.id, name: lorebook.name }];

  notes.push(...converted.value.notes);
  notes.push(note('import.card.bookExtracted', { actor: actor.name, book: lorebook.name }));
  return lorebook;
}

/**
 * The card's authorship fields, its unread extensions and anything else it
 * carried, preserved rather than interpreted.
 *
 * ~~`system_prompt`, `post_history_instructions` and `depth_prompt` are a card
 * asking to rewrite the prompt, which cards cannot do here ([00 §2.4]) — so they
 * land in `compat` and the review surfaces *this card wants to override prompts;
 * review*. `talkativeness` joins them~~ — *until [P13.3]*, which moved all four
 * to destinations the engine reads ({@link applyCardPrompts},
 * {@link applyTalkativeness}). [00 §2.4] still holds: the prompts are sections,
 * and a pack decides whether and where they are sent. *Existing imports pick
 * this up on re-import*, which converts the card again.
 */
function buildCompat(card: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const compat: Record<string, unknown> = {};

  for (const field of COMPAT_FIELDS) {
    const value = card[field];
    if (value === undefined || value === null || value === '') continue;
    compat[field] = value;
  }

  // `extensions.*` verbatim ([00 §2.4]), including Marinara's fifteen engine
  // fields when the card came through that way — less the two [P13.3] reads.
  if (isRecord(card['extensions'])) {
    for (const [key, value] of Object.entries(card['extensions'])) {
      if (EXTENSIONS_CONSUMED.has(key)) continue;
      compat[`extensions.${key}`] = value;
    }
  }

  for (const [key, value] of Object.entries(card)) {
    if (!CONSUMED.has(key)) compat[key] = value;
  }

  return compat;
}
