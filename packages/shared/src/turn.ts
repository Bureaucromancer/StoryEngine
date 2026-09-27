// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { RenditionReport } from './rendition.js';
import type { HookPacing, Ref } from './schema/common.js';
import type { Span } from './matching.js';
import type { GenerationParams } from './schema/preset.js';

/**
 * The turn record — [03 §8](../../../docs/design/03-data-model.md),
 * [21 §1](../../../docs/design/21-internal-contracts.md) — as plain types the
 * server writes and the client reads.
 *
 * **Internal tier, deliberately, and unlike everything under `schema/`.**
 * [21 §1] and [04 §1] put these shapes in the *free to move* tier: no `schema`
 * field, no `$id`, no entry in `PORTABLE_SCHEMAS`, no emitted JSON Schema, no
 * validation on import — changing any of it is a refactor, not a
 * compatibility event, because a turn record never crosses an install
 * boundary. They live in this package only so the client can stop re-declaring
 * them ([P3.0] — the workbench is the first surface that needs more of them
 * than a chat view does). ~~**Session export ([25 B12]) is the event that ends
 * this freedom**: the day a stored turn becomes a portable artefact, these
 * graduate to `schema/` and the registry, and not before.~~
 *
 * ***That day was 2026-09-17, at [P11.10](../../../docs/design/workplan/28-p11-implementation.md).***
 * `session-export.ts` publishes these records, so **a change here is now a
 * compatibility event** rather than a refactor: an install that exported a
 * session is a file another install reads. What the freeze actually obliges is
 * [18 §3](../../../docs/design/18-session-import.md)'s four consequences, and
 * the first is the one a change would violate without anybody noticing —
 * ***`input`, `output`, `request`, `cost` and `steps` stay optional***, because
 * that is what lets a turn which never ran a model exist, and ours always have
 * them.
 *
 * **They did not graduate to `schema/` and the registry, and that is a
 * decision.** The sentence above assumed *portable* and *validated on import*
 * were one thing; [18 §3] is the argument that they are not. A registry entry
 * would mean validating a foreign turn against **our** shape — and consequences
 * 1 and 2 are both about tolerating shapes we did not write, so the registry
 * would enforce exactly what the format exists not to enforce. *The freeze is a
 * promise not to tighten, which a schema cannot express and a test can*:
 * `export.test.ts` holds the three, and this docstring holds the reason.
 *
 * ~~**`spans` is the one field of [03 §8] still absent**~~ — **present since
 * [P7.7]**, which built the `extract` step it was fenced to. It is an overlay of
 * resolved references over `input.text` and `output.text` ([06 §8.2]), and the
 * text itself is never rewritten with markup.
 *
 * *~~`mentions`~~, and the rename is the point rather than tidying.* 03 §8
 * called the field `mentions` and its type `MentionSpan`, with `ref:
 * Ref<Actor>` baked in; [13 §13] needs one span shape serving mentions,
 * machine-written provenance and beat positions, so the type is `TextSpan` with
 * a **tagged** target and one arm at 1.0. Corrected in 03 §8 on 2026-09-11,
 * while nothing implements it and the rename is free — which is the whole
 * argument for doing it before the first span is stored rather than after.
 *
 * Pure types plus one constant, per this package's header rule: no I/O and no
 * runtime behaviour. The machinery that *produces* these — the assembler, the
 * runner, the `Rng` — stays in the server.
 */

/**
 * The roles a step can ask for. Steps name roles, never models —
 * [19 §5.1](../../../docs/design/19-tech-stack.md) — which is what makes an
 * install portable and an extension safe to share.
 */
export const MODEL_ROLES = [
  'prose',
  'fast',
  'reasoning',
  'vision',
  'image',
  'video',
  'speech',
  'embedding',
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * A rendered message, on its way to a provider — [21 §2].
 *
 * `fromBlocks` is the requirement merging must not break: the workbench maps
 * every sent byte back to the block that produced it, and a merge that
 * concatenates six blocks into one string without recording which six destroys
 * that mapping quietly, and only noticeably when somebody is debugging.
 */
export interface RenderedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Which blocks produced this message, in order. Non-empty always. */
  fromBlocks: string[];
  /**
   * ***The message in order, when it carries a picture*** — [25 E15], R1.
   *
   * Absent on every message with no picture in it, which is almost all of them
   * and every one written before 2026-09-27. When present, **its text parts
   * joined are exactly `content`**, so `content` stays what the frozen contract
   * says it is — the whole text rendering — and a reader that knows nothing of
   * pictures reads the same message it always did. An image part names its
   * bytes **by digest**, never by value: the call record is a line in a JSONL
   * file, and the pixels are loaded for the wire and never persisted.
   */
  parts?: MessagePart[];
}

/** One piece of a {@link RenderedMessage} that carries a picture. */
export type MessagePart =
  | { kind: 'text'; text: string }
  | {
      kind: 'image';
      /** The block the picture belongs to, so the record maps it back. */
      blockId: string;
      /** `sha256:<hex>` of the bytes in the session's attachment store. */
      digest: string;
      mime: string;
    };

/**
 * One picture on a player's move — [25 E15](../../../docs/design/25-open-questions.md), R1.
 *
 * ***An annotation on the move, never a replacement for its words.*** The
 * player's text stays in `input.text` untouched, and the picture rides beside
 * it with a text rendering of its own — the caption, or a placeholder when
 * there is none — which is what any model that cannot see it is given instead.
 * Nothing about a turn that carries one records that the session is
 * "multimodal": whether the pixels are sent is decided per call, from the model
 * that call resolved to, so a session that used a picture once continues on a
 * text-only model exactly as it would have.
 */
export interface TurnAttachment {
  /**
   * Stable within the turn, and copied unchanged by a redo — the assembled
   * block's id is keyed by it, so the workbench can pair two siblings' pictures.
   */
  id: string;
  /**
   * What it is. **An open string**, so a later kind needs no migration; a reader
   * that does not know one gives any model its text rendering and never its
   * bytes.
   */
  kind: string;
  /**
   * `sha256:<hex>` of the bytes in `sessions/<id>/attachments/`, read by the
   * server from its own store rather than taken from a client. Optional so a
   * record can say a picture was there when the bytes never arrived — an
   * importer without them.
   */
  digest?: string;
  mime?: string;
  bytes?: number;
  /** What the player wrote about the picture, in their own words. */
  caption?: string;
}

/** Provider-reported token usage. Never estimated — see `ModelCall.usage`. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * How a call failed, in the vocabulary the record and the UI both use.
 *
 * The class is what lets the UI offer the right recovery rather than surfacing
 * a provider string ([21 §1.4]).
 */
export type ErrorClass = 'transient' | 'retryable' | 'terminal';

/**
 * Why generation stopped, in the vocabulary a reader can act on.
 *
 * Narrower than any SDK's, deliberately: this is what reaches a turn record
 * and eventually a person, and a class travels where a provider's own string
 * must not ([21 §1.4]).
 */
export type FinishReason = 'stop' | 'length' | 'filtered' | 'tool' | 'unknown';

export type DrawKind =
  'int' | 'float' | 'bool' | 'chance' | 'pick' | 'weightedPick' | 'shuffle' | 'dice';

/**
 * One recorded draw — [19 §14.6](../../../docs/design/19-tech-stack.md).
 *
 * `detail` is what makes the workbench legible: `skill-check:persuasion d20 →
 * 7` rather than an anonymous list of numbers.
 */
export interface Draw {
  /** `site:purpose#index`. Stable across a rewrite that takes the same path. */
  key: string;
  site: string;
  purpose: string;
  index: number;
  kind: DrawKind;
  /** How the draw was asked for — `d20`, `p=0.3`, `0..5`. */
  detail: string;
  /** What it produced. JSON, because the tape is part of the turn record. */
  value: unknown;
  /** True when this value came off a tape rather than from the source. */
  replayed: boolean;
}

/** A turn's draws, in the order they happened. */
export type Tape = Draw[];

/**
 * Where a block came from — **one vocabulary, used from both ends**
 * ([21 §1.1]). A preset slot names a source, the assembler fills it, and the
 * resulting block records where it came from: same names, both ends. The
 * identifiers are what make provenance clickable — *which* lore entry, not "a
 * lore entry".
 */
export type BlockSource =
  /**
   * The persona is an actor too ([P3.0]): `actorId` is what makes the block
   * clickable through to the object it came from, and `contentHash` addresses
   * the bytes that were *used* rather than the object with that id today.
   * Both null when the session has no persona — a persona slot with
   * `omitWhenEmpty: false` still emits over nothing, and null is that claim.
   */
  | { kind: 'persona'; actorId: string | null; contentHash: string | null }
  /**
   * `contentHash` since [P3.0] — the cast is a *link* read fresh every turn,
   * so the id alone resolves to whatever the actor is *now*; the hash is what
   * gate step 4 clicks through to the actor as it was sent.
   */
  | {
      kind: 'actor';
      actorId: string;
      contentHash: string;
      sectionId?: string;
      field?: 'traits' | 'visual';
    }
  /**
   * One lorebook entry the retriever activated.
   *
   * ***`bookId` since [P8.4], and its absence was a real gap rather than an
   * omission.*** [P8 §1.6]: *"`retrieval/blocks.ts` builds the candidate with no
   * **book id**, though the activation carries one — so even the demo's *the
   * workbench names the entry and its origin* is unanswerable from the record."*
   * Two books can hold entries with the same id (importing one source twice is
   * the ordinary way there), so the entry id alone does not identify an entry;
   * the block's own `id` has been namespaced by both since P5.6 and this is the
   * same fact in the shape a reader can follow.
   *
   * **What it buys is a link.** A memory block can say which book it came from,
   * and a book knows which session wrote it — which is how the workbench answers
   * *the entry, its origin session and why it was retrieved*, the sentence
   * [P8]'s demo turns on.
   *
   * Absent on every record written before P8.4, so a reader links when it is
   * there and labels when it is not — `persona`'s rule for a session with none.
   */
  | { kind: 'lore'; entryId: string; phase: 'before' | 'after'; bookId?: string }
  /**
   * One half of one past turn — F36: `part` because a turn is **two** blocks,
   * the player's words as `user` and the model's as `assistant`. `turnId` is
   * the identity ([P3.0]); `range` is an index into the *window* and stays as
   * display information — where in this prompt the turn sat.
   */
  | {
      kind: 'history';
      turnId: string;
      range: [number, number];
      /**
       * `attachment` since 2026-09-27 ([25 E15]): one picture on the turn's
       * input, emitted inside the `history` expansion rather than as a source of
       * its own — a new top-level arm would become a slot any preset could
       * position ([21 §1.1]'s derivation), and a picture belongs where its turn
       * is.
       */
      part: 'input' | 'output' | 'attachment';
      /** Which picture, when `part` is `attachment`. */
      attachmentId?: string;
    }
  /**
   * One writing sample, from whichever kind carried it — [04 §3.1].
   *
   * `owner` rather than a bare `actorId` because the sample slot outgrew the
   * actor: a Treatment and a Lorebook carry samples too, and the block table
   * has to be able to say *which object this prose came from* to stay
   * clickable. `sampleId` addresses the sample within it, so a block survives
   * the author reordering the list.
   *
   * `contentHash` for the reason the `actor` arm carries one ([P3.0]): every
   * carrier of a sample is reached by *link* and read fresh each turn, so the
   * id alone resolves to whatever that object is **now**. The hash is what gate
   * step 4 clicks through to the sample as it was actually sent.
   */
  | {
      kind: 'samples';
      owner: { kind: 'actor' | 'treatment' | 'lore'; id: string; contentHash: string };
      sampleId: string;
    }
  | { kind: 'channel'; channelId: string }
  | { kind: 'treatment'; part: 'framing' | 'tone' }
  | { kind: 'goal'; goalId: string }
  /**
   * One fragment of one dial's level — [06 §7.3.1], [06 §7.3.2], [P7.8].
   *
   * **`axis` and `levelId` rather than a rendered string**, because the whole
   * claim [04 §8] makes for putting this in the pack is that *"someone who
   * dislikes how 'hard' behaves can read the fragment that caused it and change
   * it"* — which requires the block to say which level it came from and which
   * dial that level was on. A block recording only the text would leave a reader
   * with the sentence and no way back to the file it is in.
   *
   * `fragmentIndex` addresses it within the level, so the workbench can line two
   * turns' blocks up when a pack is edited between them and the text has moved.
   * *Index rather than an id, because {@link DifficultyLevel}'s fragments have
   * none* — they are a ranked array, and giving them ids would be a portable
   * schema change made for a debugging affordance.
   */
  | {
      kind: 'difficulty';
      axis: 'difficulty' | 'directedness';
      levelId: string;
      fragmentIndex: number;
    }
  /**
   * The guidance slot — [06 §5.1]. `producer` because one slot has several
   * producers — the user's box, a rule's `giveGuidance`, a Narrative Director
   * push — and the workbench should say which.
   */
  | { kind: 'guidance'; producer: 'user' | 'rule' | 'step' }
  /**
   * The previous attempt a guided redo showed the model — [06 §5.1], [07 §7].
   *
   * `turnId` names the sibling whose output was shown, which is what makes
   * *what did the instruction refer to* answerable from the record rather than
   * from memory: the block table can say which attempt, and the compare view
   * can put the two side by side. The first slot whose content is another
   * turn's output, so it carries an identity the way `history` does and the
   * advisory marker the way `guidance` does.
   *
   * Null only when a preset emits the slot over nothing (`omitWhenEmpty:
   * false`) — the claim `persona`'s nulls make, and for the same reason: the
   * block exists because the author asked for it, and there was no attempt.
   */
  | { kind: 'attempt'; turnId: string | null }
  /**
   * What the player just did — the turn that is happening, not history. With
   * `part: 'attachment'`, one picture on it ([25 E15]); absent is the words.
   */
  | { kind: 'input'; part?: 'attachment'; attachmentId?: string }
  /**
   * One link of the summary chain — [07 §5.1], [P8.1].
   *
   * `linkKey` is the content address: the hash of the previous link's key, the
   * keys of the units it covers, and the resolved summariser. It is the
   * identity, and it is *why* the block table can say anything at all about a
   * summary — a chain keyed on its inputs is a chain whose links can be named,
   * where a mutated running total would have had nothing to name.
   *
   * `range` is the inclusive span of **path indices counted from the root**,
   * which is a meaningful thing to record only because
   * `sessions/summary-chain.ts` anchors boundaries there: on a head-relative
   * scheme the same numbers would mean something different on every turn. This
   * is what [P8]'s gate step 1 means by *which summary links covered which
   * turns*.
   *
   * *Indices rather than turn ids, which is a real limit.* A reader who wants
   * to click through to the turns has to walk the path to resolve them. The
   * alternative is a list of up to twenty ids on every summary block of every
   * turn record, which is a persisted-shape cost paid on every turn for a
   * navigation affordance no surface asks for yet.
   */
  | { kind: 'summary'; linkKey: string; range: [number, number] }
  // The two a slot can never name, because no preset positions them.
  /**
   * A block the preset authored, rather than a slot it positioned.
   *
   * `presetId` is optional and arrived at P4.4 ([P4 §2]): a session's pack is a
   * *copy* ([03 §8]), so for a long time there was nothing on the other end of a
   * link — but a copy keeps the id of the object it was copied from, which
   * means an **imported** preset's blocks can point back at the file they came
   * out of. That is what the phase's demo turns on: reading a converted preset's
   * block list in the workbench and clicking through to the preset itself.
   *
   * Absent on every record written before then — so the client links when it is
   * there and labels when it is not, exactly as `persona` already does for a
   * session without one.
   *
   * ~~And on any session whose pack came from a mode default rather than the
   * library.~~ ***No longer true from [P7B.0]***: the field was always written
   * for a mode default as well, and what was missing was the object at the other
   * end. Materialising each mode's pack into the system library gives every one
   * of those links a destination, including on records written before that
   * phase — because the id in them never changed.
   */
  | { kind: 'preset'; blockId: string; presetId?: string }
  | { kind: 'step'; stepId: string }
  /**
   * **The engine's own JSON instruction** — [P7.4], for an endpoint that cannot
   * be handed a schema.
   *
   * The one arm that is not content. Everything else here came from an object
   * somebody authored or from the story so far; this is protocol — the same
   * class of thing as `systemMessage: 'fold-into-first-user'`, the caller
   * rewriting a request to suit what an endpoint can take. Since
   * `openai-compatible` declares `supportsStructuredOutput: false` by default,
   * this is the *ordinary* path for a self-hosted install rather than a fallback.
   *
   * **It is a block rather than a message spliced in below the record**, because
   * `RenderedMessage.fromBlocks` is non-empty always: a message the block table
   * cannot explain would make the workbench's account of a prompt quietly
   * incomplete, on precisely the calls whose output is hardest to debug. It
   * carries no identifier, because there is nothing to click through to — the
   * schema it was composed from is the step's declaration, not an object in
   * anybody's library.
   */
  | { kind: 'schema' };

/**
 * A call's declared appetite — [06 §6]. `effects` and `verdict` are the two
 * that may not see advisory content. (`CallPurpose`, not `CallKind` — that
 * name is taken by the portable `appliesTo` vocabulary in `schema/preset`.)
 */
export type CallPurpose = 'prose' | 'effects' | 'verdict';

/**
 * Why a slot collected nothing — [P3.0], the [P3 §7.5] decision. A class, not
 * prose, per the rule progress events are held to: the panel maps class to
 * sentence, and nothing durable grows another free-English field.
 *
 * - `disabled` — the author switched the block off.
 * - `not-applicable` — `appliesTo` excludes this call's kind.
 * - `no-producer` — the source has no producer at this phase (lore is P5,
 *   goals are Setup-borne, a channel has no text renderer…).
 * - `empty-source` — the producer ran and yielded nothing: an empty guidance
 *   box, an empty cast, a first turn with no history.
 * - `unknown-slot` — a slot kind from a newer build, skipped rather than
 *   thrown.
 */
export type NotFilledReason =
  'disabled' | 'not-applicable' | 'no-producer' | 'empty-source' | 'unknown-slot';

/**
 * A preset block that emitted no candidate — the record's answer to *why is
 * there no lore in this prompt*. A **second list** beside the blocks, never a
 * third `included` state: a slot that produced nothing has no text, no tokens
 * and no budget ruling, so `blocks` keeps meaning exactly *what was
 * assembled*.
 */
export interface NotFilledSlot {
  /** The preset block that positioned the slot. */
  blockId: string;
  /**
   * The slot's source kind — `'preset'` for a skipped text block, the
   * foreign word itself for an `unknown-slot`.
   */
  source: BlockSource['kind'] | (string & {});
  reason: NotFilledReason;
}

/** A candidate the budgeter has ruled on — [03 §8]. */
export interface AssembledBlock {
  id: string;
  source: BlockSource;
  /** Why it is here, in the words the workbench shows — a product feature, not a debug string. */
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  /** The estimate that decided; the measured figure is per call, on `usage`. */
  tokens: number;
  included: boolean;
  /** Which budget rule dropped it. Absent when it was included. */
  droppedBy?: string;
  /**
   * Carried from the candidate ([P3.0]): with `purpose` on the call, this is
   * what makes [testing §1]'s invariant — no advisory block in an
   * effect-producing call — expressible over a committed record. Absent means
   * not advisory.
   */
  advisory?: true;
  /**
   * ***The picture this block stands for, and whether its pixels went*** —
   * [25 E15], R1. Absent on every block that is not a picture.
   *
   * `sent: false` is the ordinary case and carries its reason, because a block
   * that was included and sent only its text rendering *did* emit something —
   * so this is a disclosure on the block rather than a not-filled slot.
   */
  image?: BlockImage;
}

/**
 * Why a picture went as words rather than pixels — the per-call send rule of
 * [25 E15]:
 *
 * - `model-text-only` — the model this call resolved to is not one its
 *   connection lists as seeing images;
 * - `outside-window` — a picture from an earlier turn (R1 sends the current
 *   turn's only);
 * - `missing-bytes` — the bytes are not in this session's store, which is the
 *   ordinary state after an import from an export;
 * - `not-user-role` — the block sits in a system or assistant message, which
 *   cannot carry a picture;
 * - `unknown-kind` — an attachment kind this build does not send.
 */
export type ImageWithheld =
  'model-text-only' | 'outside-window' | 'missing-bytes' | 'not-user-role' | 'unknown-kind';

export interface BlockImage {
  attachmentId: string;
  /** Null when the record never had the bytes' digest. */
  digest: string | null;
  /** The bytes' type, as the store read it. Null when the bytes never arrived. */
  mime: string | null;
  sent: boolean;
  /** Present exactly when `sent` is false. */
  withheld?: ImageWithheld;
}

/**
 * The window a turn may spend, and the honest account of where it came from —
 * [21 §1.5], reshaped by [P3.0]. `source` names the origin of the **ceiling**
 * — whichever side won: the endpoint's declared window, the preset's absolute
 * cap, or the config default (`'user'`, live-editable). The preset's
 * `contextShare` narrows the ceiling to `tokens` without relabelling it.
 *
 * Invariants: `share` present ⇒ a preset budget was in play and
 * `tokens === floor(ceiling × share)`; absent ⇒ `tokens === ceiling`.
 */
export interface BudgetLimit {
  /** The spendable window the budgeter enforces. */
  tokens: number;
  /** The resolved window before the share narrowed it. */
  ceiling: number;
  source: 'provider' | 'preset' | 'user';
  /** The preset's contextShare, when one applied. */
  share?: number;
}

/** [21 §1.5]. */
export interface BudgetVerdict {
  limit: BudgetLimit;
  /** Held back for the completion. */
  reserved: number;
  spent: number;
  /**
   * Ordered as considered. **Every block appears, including the included
   * ones** — a verdict listing only drops cannot answer "what falls out next".
   */
  decisions: {
    blockId: string;
    tokens: number;
    included: boolean;
    /** The rule, in the language the workbench shows. */
    rule: string;
  }[];
  /**
   * What would drop on the next turn at current pressure. The UI promises this
   * is answerable *before* it happens, which requires computing it.
   */
  nextToDrop: string[];
}

/**
 * One model call — [21 §1.4].
 *
 * `resolved` records what the role actually became, because the binding can
 * change between turns and *"why is this turn different"* needs an answer.
 * **It carries the connection's id and never the connection** — a
 * `Connection` holds `apiKey` and `baseUrl`, and this record is a line in a
 * JSONL file on somebody's disk.
 */
export interface ModelCall {
  id: string;
  stepId: string;
  role: ModelRole;
  /**
   * **The four fields below arrived together at [P3.0], and are optional for
   * one reason: a record on disk may be older than this build.**
   *
   * *Free to move* ([04 §1]) says the shape may change without ceremony, and
   * it does — but it never said the files vanish. Every install that ran P2
   * has turns whose calls predate this repair sitting in its data directory,
   * and a reader is a reader over **what is on disk**, not over what today's
   * writer would produce. Typing them as always-present made that a lie the
   * compiler enforced, and the workbench paid for it by throwing
   * `call.blocks.filter` on the first P2-era turn somebody opened.
   *
   * The alternative — backfilling `[]` on read — was refused: it would say
   * *this call assembled no blocks*, a claim about the prompt, when the truth
   * is *nobody recorded them*, a claim about the build. That is exactly the
   * absent-versus-empty line [03 §8] draws and the workbench is built on.
   *
   * **This build always writes all four**; the runner mints a `ModelCall`
   * only downstream of assembly, including the provisional in-flight entry it
   * checkpoints before dispatch. Absence means *old*, never *empty*.
   */

  /**
   * What this call was allowed to produce — the committed half of
   * [testing §1]'s invariant, beside `advisory` on the block ([P3.0]). Not
   * derivable after the fact: it is computed from the step's declared
   * `contributes` and `writes`, and `StepOutcome` records neither — only
   * their counts.
   */
  purpose?: CallPurpose;
  resolved: { connectionId: string; modelId: string };
  /**
   * The blocks this call assembled and the verdict that ruled them — [P3.0],
   * making [10 §3]'s *"one per model call"* the shape rather than a promise.
   * The turn's blocks are a derived union — readers fold over
   * `request.calls`; nothing stores the union.
   */
  blocks?: AssembledBlock[];
  budget?: BudgetVerdict;
  /**
   * The preset blocks that emitted nothing for this call, each with a reason
   * class — [P3.0]'s §7.5 decision. Empty when a step supplied its own
   * candidates: the preset was not consulted, so it honestly has nothing to
   * say — which is why *absent* here cannot mean empty.
   */
  notFilled?: NotFilledSlot[];
  messages: RenderedMessage[];
  params: GenerationParams;
  /** Provider-reported, or null. Never estimated — the estimate decides, the measurement records. */
  usage: TokenUsage | null;
  cost: { amount: number; currency: string } | null;
  wallMs: number;
  /**
   * Why the model stopped — the field that tells a *truncated* answer from a
   * finished one. Null on a call that never returned.
   */
  finishReason: FinishReason | null;
  /**
   * `refused` is a provider content filter; `truncated` a ceiling reached;
   * `incomplete` a stream that stopped without saying why; `cancelled` a
   * person's Stop landing mid-call (finding 2 in [16]) — not an `error`,
   * because nothing failed. There is deliberately **no un-sent value**: that
   * arrives with P3.7's dry run.
   */
  outcome: 'ok' | 'refused' | 'truncated' | 'incomplete' | 'error' | 'cancelled';
  /** Classified, so the UI can offer the right recovery rather than a provider string. */
  error: { class: ErrorClass; message: string } | null;
  retries: number;
}

/**
 * Why a step failed, in the vocabulary a client can act on. The provider's
 * own words go to the log; a class is what crosses to a reader.
 */
export type StepFailureReason =
  ErrorClass | 'cancelled' | 'advisory-leak' | 'unbound' | 'dangling' | 'internal';

/**
 * ***What a person could do about it*** — [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P11.6](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **A second axis beside {@link StepFailureReason}, not a replacement for it.**
 * The class says how the engine treated the failure — whether it retried,
 * whether it gave up — and it is the right thing to put on a record. It is the
 * wrong thing to put in front of a person: *The turn failed (transient)* is what
 * this surface said until P11.6, and *transient* is a word about our retry
 * ladder rather than about their evening.
 *
 * ***Derived, never recorded.*** Two of the three inputs are facts about **now**
 * — whether this server can reach the internet, and whether the endpoint a role
 * resolved to is on this network — and a turn record that stored them would be
 * claiming last Tuesday's network as part of what happened. So a remedy travels
 * on the live event and the notification, and
 * [18 §3](../../../docs/design/18-session-import.md)'s export format never sees
 * it.
 *
 * ***The distinction that pays for the whole type is `-offline` against
 * `-online`.*** [09 §6.5] asks for *"this server appears to have no internet
 * access"* instead of a raw connection error, and the trap is that a failure to
 * reach one endpoint is not evidence about the internet. An install whose
 * endpoints are all on the LAN is **a legitimate, fully-functional deployment
 * whose operator chose it deliberately**, and telling that operator they are
 * offline every time their model server is down would be worse than saying
 * nothing. So locality is asked first, and connectivity only for the remote
 * case — and `endpoint-silent` is the honest answer when nothing has looked.
 *
 * The sentences live on the client, keyed by these values, which is
 * [19 §12.4](../../../docs/design/19-tech-stack.md)'s rule and what lets
 * [P11.8](../../../docs/design/workplan/28-p11-implementation.md) fold them into
 * a catalogue without touching this file.
 */
export type FailureRemedy =
  /** Nothing answered, at an address on this network. The model server is down. */
  | 'endpoint-silent-local'
  /** Nothing answered out on the internet, and this server has no internet. */
  | 'endpoint-silent-offline'
  /** Nothing answered out on the internet, and this server's internet works. */
  | 'endpoint-silent-online'
  /** Nothing answered out on the internet, and nothing has checked the internet. */
  | 'endpoint-silent'
  /** The endpoint answered, and was busy or broken — a 429 or a 5xx. */
  | 'endpoint-busy'
  /** The endpoint answered and said no. A key, a permission, a model name. */
  | 'endpoint-refused'
  /** The endpoint accepted the request and then went quiet past the idle limit. */
  | 'endpoint-stalled'
  /** No connection is bound to the role this step asked for, or it points at nothing. */
  | 'not-bound'
  /** Nothing about the network. This build did something it should not have. */
  | 'engine';

/** Why a step did not run. [06 §6]'s three condition arms, from the other side. */
export type StepSkipReason = 'cadence' | 'stage' | 'not-armed';

/**
 * ***Where in a text, and what it points at*** — [03 §8], [06 §8.2],
 * [10 §13.1](../../../docs/design/10-ui-surfaces.md), built at [P7.7].
 *
 * **An overlay, never a rewrite.** 06 §8.2 is explicit: *"spans on the turn
 * record — never a rewrite of the message text."* The prose a model wrote is
 * what it wrote; what the engine understood about it sits beside it, and a
 * reader that wanted neither can ignore the field entirely.
 *
 * *Built on `Span` from `matching.ts` rather than beside it*, which is
 * [P7 §1.7]'s pricing: the scanner's three functions already produced the
 * geometry anonymously, so **this is that plus a target** rather than a second
 * shape with the same two numbers.
 */
export interface TextSpan extends Span {
  /**
   * Which text this indexes into — the turn stores two, separately.
   *
   * *This union is the turn's*, and 03 §8 says so: a different record supplies
   * its own field names. It is why 06 §8.2's original four-field shape was
   * ambiguous and now points here.
   */
  field: 'input' | 'output';
  target: SpanTarget;
  /**
   * How the span came to be asserted — [10 §13.1].
   *
   * *"Rendered differently per method, because a tentative match that looks
   * certain is worse than no highlighting."* `explicit` is a person having said
   * so; `matched` is the scanner having found an alias; `proposed` is a model
   * suggesting somebody the session does not have, which is the arm that must
   * **offer** rather than create.
   */
  method: 'explicit' | 'matched' | 'proposed';
  /** Only meaningful for `proposed`. */
  confidence: number | null;
}

/**
 * What a span points into — ***tagged, from the first span ever written***.
 *
 * **One arm at 1.0, and the tag is the whole point** ([13 §13], [P7 §1.7]).
 * Write needs three consumers of one span shape — mentions, machine-written
 * provenance and beat positions — and the second two are 2.0's, so adding them
 * has to be an **arm rather than a migration**.
 *
 * ***A tag was required rather than merely tidy, and the reason is phantom
 * types.*** [04 §3] makes a `Ref` `{ id, name, fingerprint? }`, so the `<Actor>`
 * in `Ref<Actor>` is documentation that **erases into JSON**. A stored span
 * whose `ref` had no `kind` would be a span that cannot say what it points at,
 * and a reader added later could not tell an actor span from a beat span without
 * guessing from context.
 *
 * *Shaped like {@link BlockSource} deliberately*: this codebase already has one
 * tagged-reference vocabulary and does not need a second.
 *
 * ***The arm is named and the union is one line, which is a concession to two
 * tools disagreeing and turned out to be the better shape anyway.*** A one-arm
 * union written inline is a type alias for an object literal, which
 * `consistent-type-definitions` rejects; written with a leading pipe to say
 * *union*, Prettier removes the pipe and eslint rejects it again. Naming
 * {@link ActorSpanTarget} settles it — and unlike making `SpanTarget` itself an
 * `interface`, it keeps the growth story the paragraph above insists on: the
 * second arm is `| BeatSpanTarget` on the line below, not an unpicking of a
 * declaration that said *this is one shape*.
 */
export interface ActorSpanTarget {
  kind: 'actor';
  /** Somebody in the session's cast. */
  ref: Ref;
}

export type SpanTarget = ActorSpanTarget;

/**
 * Why a hook is not eligible — a **class, not prose**.
 *
 * [06 §6.1](../../../docs/design/06-modes-and-turn-pipeline.md) wants an author
 * to see *"which are blocked **and by what**"*, and this codebase's standing
 * rule for a durable reason is the one progress events and `NotFilledReason` are
 * held to: a reader maps a class to a sentence, and nothing grows another
 * free-English field. Each arm is a different remedy, which is the test for
 * whether it earns its place:
 *
 * - `fired` / `pending` — this hook already went. Nothing to do.
 * - `book-inactive` — its lorebook is no longer in the session. Re-add the book.
 * - `blocked` — a `blockedBy` hook has fired. Nothing to do; it is by design.
 * - `too-early` — `notBefore`. Wait, or lower the bound.
 * - `cast-gone` — an `involves` member is unresolvable, dead, or never met.
 * - `subject-gone` — the subject of an introduction does not resolve. **The one
 *   arm that is an authoring error rather than a state**:
 *   [04 §6.1a](../../../docs/design/04-schemas.md) makes a dangling
 *   `introduces.actor` *"a broken hook, not a retired one… ineligible with a
 *   visible reason, and the author is told"*, where a dangling `involves` entry
 *   retires a hook quietly. Same field type, opposite treatment.
 * - `subject-met` — they are already introduced, which is the whole point of the
 *   hook being spent.
 * - `subject-unavailable` — dead, the persona, or already in the party.
 *
 * **Here rather than in the engine, because it is a record vocabulary** — [P7.5]
 * stage three. It was written beside the filter that produces it and moved the
 * moment the selector's line landed on a turn: a class the client renders is
 * `shared`'s the same way `StepSkipReason` and `NotFilledReason` are, and a
 * second copy of a nine-arm union is the thing that drifts.
 */
export type HookRefusal =
  | 'fired'
  | 'pending'
  | 'book-inactive'
  | 'blocked'
  | 'too-early'
  | 'cast-gone'
  | 'subject-gone'
  | 'subject-met'
  | 'subject-unavailable';

/**
 * What the plot-hook selector did this turn — [06 §6.1], [P7 §1.5], [P7.5].
 *
 * ***A field of its own because a step's skip reason could not carry it, and
 * that is the section's own argument rather than a shape convenience.***
 * [06 §6.1]: *"A selector that returns early because of pacing is
 * indistinguishable, from the outside, from one that ran and judged none — and
 * a step's skip reason is derived from its condition, so it cannot carry this."*
 * {@link StepSkipReason} is the closed set derived from `StepCondition`'s three
 * arms — `cadence`, `stage`, `not-armed` — with no free-form member, and
 * `contributed` counts blocks and effects without saying what they were. So this
 * lands on the turn.
 *
 * **The standard is the one the assembler already meets** when it records why a
 * slot was not filled ({@link NotFilledSlot}): every candidate accounted for,
 * each with a class a reader can turn into a sentence. Without it *"which are
 * blocked and by what"* is answerable in the abstract but never for the turn in
 * front of you.
 *
 * *On the turn rather than in a channel, and the two are not competing.*
 * `se.hook` is what **happened** to a hook and has to branch; this is what the
 * selector **decided** on one turn, which is already a thing a turn record
 * carries and which a channel would have to overwrite every turn to express.
 */
export interface HookSelection {
  /**
   * What the selector answered.
   *
   * `held` and `nothing-eligible` are separated because they are different
   * remedies: *held* invites somebody to turn the dial up, and turning it up
   * changes nothing when the pool is empty. `cooling` is separated from `held`
   * for the same reason one rung down — waiting is the remedy, not the dial.
   * `judged-none` means the call happened and answered *none*, which
   * [06 §6.1] permits in as many words and which a correctly-quiet session must
   * be distinguishable by.
   */
  verdict: 'held' | 'cooling' | 'nothing-eligible' | 'judged-none' | 'fired';
  /**
   * The dial as it stood at this node — [04 §6.1b]'s three rungs already
   * resolved.
   *
   * Recorded rather than looked up later because the value branches: a reader
   * asking *why was this turn quiet* a hundred turns on would otherwise get
   * today's answer for a decision taken under a different one.
   */
  pacing: HookPacing;
  /** The hook that fired. Present only on `fired`. */
  hookId?: string;
  /**
   * **Every hook in the pool, refused or not** — *"nothing about a held hook may
   * be invisible"*. Ids rather than hooks: the pool is on the session and a turn
   * that copied premises into the record would be [08 §6]'s hidden content
   * written into a file the workbench renders.
   *
   * `committed` is present when a person's Commit is carrying the hook, and its
   * `overrode` is the clause that carried it past — [06 §6.1]'s first rule for
   * keeping Commit honest: *"skipping the filter must say what it skipped"*.
   * `null` there means there was nothing to skip.
   */
  considered: readonly {
    hookId: string;
    refusal: HookRefusal | null;
    committed?: { overrode: HookRefusal | null };
    /**
     * Present when a person **force-fired** it — [06 §6.1]'s other hand control,
     * and the one that means *no judgement call at all*. A `fired` verdict with
     * this on the hook it names is the record saying nobody was asked; the same
     * verdict without it is the record of a call that chose.
     */
    forced?: { overrode: HookRefusal | null };
  }[];
  /**
   * Commitments that ran out of patience on this turn — [06 §6.1], [P7.5].
   *
   * ***A field of its own rather than a sixth verdict, because a lapse is not
   * what the selector decided.*** Three turns pass, the hook goes back in the
   * pool, and the selector still goes on to judge whatever else is eligible —
   * so a turn can lapse a commitment **and** fire something, or lapse one and be
   * held. A verdict that had to be one or the other would lose whichever it did
   * not name.
   *
   * *It is here at all because [06 §6.1] requires it*: the deadline *"returns it
   * to the pool and **says so**, because a silent lapse is worse than either
   * outcome"* — worse than firing late and worse than waiting forever, both of
   * which at least leave the person able to tell what happened. Absent is the
   * ordinary turn; it is never written empty.
   */
  lapsed?: readonly string[];
}

export type StepStage = 'pre' | 'assemble' | 'generate' | 'extract' | 'post';

/**
 * What one step did — the durable counterpart of the `step.*` progress
 * events. [09 §3.3] opens by saying the live view **is** the turn record
 * being built, which only holds if every progress event has somewhere durable
 * to land.
 */
export interface StepOutcome {
  stepId: string;
  stage: StepStage;
  state: 'ok' | 'skipped' | 'failed';
  /** How the definition declared a failure should be handled. */
  failure?: 'abort' | 'warn' | 'ignore';
  skipReason?: StepSkipReason;
  error?: { reason: StepFailureReason; message: string };
  contributed: { blocks: number; effects: number };
  wallMs: number;
}

/**
 * What was assembled and asked for — [03 §8]'s `request`.
 *
 * Just the calls since [P3.0]: each carries its own blocks and verdict, so a
 * turn-level table would be either a copy or a lie. Absent on the turn when
 * nothing was assembled — *absent* and *empty* are different claims.
 */
export interface TurnRequest {
  calls: ModelCall[];
}

/**
 * The turn's totals — null means *nobody counted*, which is a different claim
 * from *counted, and it was nothing*. A cancelled turn's `{promptTokens: 0}`
 * was the bug; the cost view owes *unknown* a rendering distinct from *free*.
 */
export interface TurnCost {
  promptTokens: number | null;
  completionTokens: number | null;
  wallMs: number;
  /** The model that answered last, or null when nothing was called. */
  model: string | null;
  /**
   * ***What the turn cost in money, when every call's provider said*** — added
   * 2026-09-27, because until then this record had tokens and no money at all,
   * and [09 §4.5]'s *"turns already record cost"* was true only of tokens.
   *
   * **The sum of `ModelCall.cost`, under the same all-or-nothing rule as the
   * token totals**: a figure only when every call reported one and all of them
   * in one currency, and null otherwise — *not priced*, which is a different
   * claim from *free*. Null is the ordinary value today: no adapter in this
   * build prices a call, and [25 E16](../../../docs/design/25-open-questions.md)
   * is where the approach to changing that is recorded. The field lands first
   * so a turn priced later needs no migration to say so.
   *
   * **Optional**, so every turn written before it reads as absent rather than
   * as a claim; after the [P11.10] freeze an optional field is the only kind
   * this record can grow.
   */
  money?: { amount: number; currency: string } | null;
}

/**
 * One effect on one channel — [21 §1.2], the most load-bearing type in that
 * document. It carries reversibility, it crosses the worker boundary, it is
 * what a branch replays and what undo inverts — which is why `before` is
 * stored rather than derived.
 */
export interface ChannelEffect {
  id: string;
  turnId: string;
  channelId: string;
  /** Which value, when the channel is scoped per actor or per entry. */
  scopeKey: string | null;
  op: EffectOp;
  /** State before, for exactly the keys this effect touched. */
  before: unknown;
  after: unknown;
  /** Who proposed it, and who decided. */
  proposedBy:
    | { kind: 'model'; callId: string }
    | { kind: 'step'; stepId: string }
    | { kind: 'user' }
    | { kind: 'engine' };
  applied: boolean;
  /**
   * Present when `applied` is false. The two shipped refusals are classes —
   * `'engine-computed'` and `'user-only'` name *which* update policy refused,
   * plus `'unknown-channel'` ([P3.0]). Open vocabulary for extensions.
   */
  rejectedReason: string | null;
  /**
   * The effect this one replaced — [P3.0], and [10 §3]'s third outcome: when
   * the engine's own computation lands on a channel a same-turn proposal was
   * refused for, this carries the refusal's id. Null is data: this effect
   * superseded nothing.
   */
  supersedes: string | null;
  channelVersion: number;
  /**
   * Whether the effect stayed inside the session or escaped it. **P2 writes
   * only `session`** — the field exists so P6 needs a field rather than a
   * migration.
   */
  scope: 'session' | 'escaped';
  /**
   * Present when this effect is a **quarantine** — [06 §4.2], [P7.1].
   *
   * The last rung of the validate-coerce-migrate-quarantine ladder is *"preserve
   * the raw value verbatim, initialise the channel to its default, mark it
   * degraded, and carry on"*, and all four of those are writes. So a quarantine
   * is an ordinary effect: `before` is the value that stopped fitting, `after`
   * is the channel's declared `init`, and this says why.
   *
   * **A reason and not a raw value, because `before` already is the raw value.**
   * `ChannelState.degraded` carries `{ reason, raw }` and `applyEffects` composes
   * it from the two — duplicating the value here would create a second place for
   * it to be wrong, and `before` is load-bearing on this effect anyway: it is
   * what an undo replays, so a quarantine is reversible like everything else.
   *
   * **Why a field rather than a derivation.** `applyEffects` cannot tell a
   * quarantine from any other engine set to the same value, and the difference
   * is the whole of what a person needs told. The alternative considered was
   * overloading `rejectedReason` on an applied effect, which would mean a
   * record where *rejected* and *applied* are both true.
   */
  degraded?: { reason: string };
}

export type EffectOp =
  | { type: 'set'; path: string }
  | { type: 'merge'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'append'; path: string }
  | { type: 'increment'; path: string; by: number };

/** [21 §1.3]. */
export interface ChannelState {
  /** Which schema version the value was written against. */
  version: number;
  value: unknown;
  /**
   * Set when load-time validation failed and the value was quarantined.
   *
   * **No writer exists yet, and that is a recorded decision** ([P3.0]):
   * `ChannelDefinition` ships without `schema` ([21 §6] refuses to invent it
   * ahead of the mode contract), so a guard on a validation that cannot fail
   * would be dead code impersonating a mechanism. The writer arrives with the
   * first `ChannelDefinition.schema`; the panel renders the field whenever
   * present.
   */
  degraded?: { reason: string; raw: unknown };
}

/**
 * One turn, as it is written to a segment — [03 §8].
 *
 * `parentTurnId` from the very first turn: the turn store is a tree that P2
 * happens to use linearly. `request`, `output`, `cost` and `steps` are
 * **absent rather than empty when nothing happened** — an empty `request` on
 * a turn that never assembled would be a record claiming a prompt was built,
 * and the workbench renders the difference.
 */
export interface Turn {
  id: string;
  sessionId: string;
  /** Null for the first turn of a session. Every other turn names its parent. */
  parentTurnId: string | null;
  createdAt: string;
  status: 'complete' | 'failed' | 'suspended';
  input?: {
    actorId: string | null;
    kind: string;
    text: string;
    raw: string;
    /**
     * Pictures on this move — [25 E15], R1. **Optional, and absent on every turn
     * without one**, which is what keeps it an addition under the [P11.10]
     * freeze rather than a change to the record this project has the most of.
     */
    attachments?: TurnAttachment[];
  };
  output?: { text: string; reasoning?: string };
  /**
   * ***Where this turn came from, when it came from somewhere else*** —
   * [18 §3](../../../docs/design/18-session-import.md)'s second consequence,
   * [P11.10](../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **Added before the freeze, which is the last moment it is an edit.**
   * [04 §1](../../../docs/design/04-schemas.md) puts this record in the *free to
   * move* tier **because nothing exports it**, and [P11.10] ends that — so
   * afterwards this would be a migration of the record this project has the
   * most of. [18 §3] asks for it in as many words: *"a foreign message
   * identifier must have somewhere to go… and the absent case is not an edge,
   * it is the most widely deployed source of the three."*
   *
   * ***`source` is free text and deliberately not a union.*** The three surveyed
   * sources are SillyTavern, Marinara and Aventuras, and the fourth is whatever
   * somebody writes an importer for next. A closed union would make this field
   * useless to exactly the importer nobody has written yet, which is the one it
   * exists for.
   *
   * ***It round-trips whether or not this build understands it.*** A turn
   * exported from an install that knows a source this one does not is carried
   * through unchanged — which is the difference between a format and a dialect.
   */
  foreign?: { source: string; id: string };
  request?: TurnRequest;
  cost?: TurnCost;
  steps?: StepOutcome[];
  /**
   * What the plot-hook selector decided — [06 §6.1], [P7.5]. **Absent means the
   * selector did not run**, which is every turn of a session with no hook pool
   * and every turn taken by a build before P7.5; it never means *it ran and had
   * nothing to say*, which is what `nothing-eligible` is for.
   */
  hooks?: HookSelection;
  /**
   * What the player could do next — [06 §7.3]'s *suggested actions*,
   * [R11](../../../docs/design/workplan/22-walkthrough-refinements.md), [P7.9].
   *
   * ***On the turn, which is a persisted-shape decision rather than a
   * convenience*** — and [22 §4] says why it had to be made now rather than
   * later: *"R11's 'save unselected suggestions' is a persisted-shape
   * requirement, and that puts it on the critical path to P11's export freeze."*
   * The fork it names is *"generate them inside the turn as a `post` step, or
   * store them on the mutable half beside `lastSelectedChild`"*, and this is the
   * first: a suggestion is a **reading of one turn's ending**, so it belongs to
   * that turn the way `spans` and `hooks` do. A rewind takes it back, a branch
   * inherits it, and *kept, unselected* needs no mechanism because an
   * append-only record keeps what it recorded.
   *
   * **Absent means the step did not run** — the session has them off, or this
   * build predates them. It never means *it ran and offered nothing*, which is
   * the distinction every optional field on this record draws.
   *
   * *Strings and not ids.* A suggestion is text a player submits as their own
   * input, so selecting one is typing it faster rather than referring to it —
   * and an id would imply a thing to look up that the record does not have.
   */
  suggestions?: string[];
  /**
   * What the engine understood about the turn's text — [03 §8], [06 §8.2],
   * [P7.7].
   *
   * **Absent rather than empty when the extract step did not run**, which is
   * every turn taken before P7.7 and every turn of a session with no cast to
   * resolve against. *Empty* would claim a pass ran and found nothing, which is
   * a different fact and one a reader of [10 §13.1]'s overlay acts on
   * differently.
   */
  spans?: TextSpan[];
  /**
   * What the rendition step asked for — [06 §10](../../../docs/design/06-modes-and-turn-pipeline.md),
   * [P9.1].
   *
   * ***Ids and a verdict, never the records***, and unlike `suggestions` above
   * that split is forced rather than argued. A suggestion is produced *during*
   * the turn, so it can be a field on an append-only line; a rendition is
   * dispatched after the turn commits and then moves `pending → ready`
   * ([06 §10.2]), which a line that is never rewritten cannot express. So the
   * mutable half lives in `sessions/<id>/renditions/` and the turn keeps the one
   * thing that was true when it committed: what it asked for.
   *
   * *The direction matters as much as the split.* A rendition names its turn and
   * a turn does not name its renditions — which is the only direction that works
   * for one made by hand forty turns later, and is why `Turn.renditions` is a
   * report of this turn's own step rather than an index of everything hanging
   * off the node.
   *
   * **Absent means the step did not run** — every turn of a session with
   * renditions off, and every turn taken before this phase. It never means *it
   * ran and asked for nothing*, which is what `held` is for, and which is the
   * distinction every optional field on this record draws.
   */
  renditions?: RenditionReport;
  effects: ChannelEffect[];
  /** Every draw the turn consumed, keyed by site ([19 §14.6]). */
  tape: Tape;
  /** A tombstone the reader skips. */
  removed?: true;
}

/**
 * A name bookmarking a node — [07 §3](../../../docs/design/07-branching.md), and
 * *a name, nothing more*.
 *
 * **There is no `Branch` entity owning turns**, which is the decision that
 * whole section exists to record: a session is a tree of turns, a swipe is a
 * sibling nobody named, and a branch is a sibling somebody did. So this is a
 * bookmark on a node, like a git ref — promoting a swipe writes about fifty
 * bytes and moves no data, and deleting a ref deletes a name.
 *
 * `headTurnId` rather than `turnId` because that is what a ref points at: the
 * tip of a line somebody wants to come back to, which is a head they may later
 * move.
 */
export interface BranchRef {
  id: string;
  name: string;
  headTurnId: string;
}
