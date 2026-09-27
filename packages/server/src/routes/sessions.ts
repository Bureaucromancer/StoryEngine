// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  Goal,
  PlotHook,
  Preset,
  PRESET_SCHEMA,
  SETUP_SCHEMA,
  uuidv7,
  type Setup,
} from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { LibraryError, read } from '../library.js';
import { walkPath } from '../sessions/segments.js';
import {
  childrenByParent,
  createBranchRef,
  createSession,
  deleteBranchRef,
  deleteSession,
  listSessionFiles,
  moveHead,
  readSession,
  setPreset,
  reconcileHandEdits,
  renameBranchRef,
  setCast,
  setLore,
  setSessionHooks,
  addSessionGoal,
  setSessionRoles,
  readTurns,
  readTurnById,
  setArchived,
  setMemoryConfig,
  setRenditionSelection,
  setName,
  undoTurn,
  writeChannel,
  type BranchRefOutcome,
} from '../sessions/store.js';
import { castRows } from '../sessions/cast.js';
import { poolFor, resolvableActors } from '../sessions/hook-pool.js';
import { promoteSessionHook, type PromoteTarget } from '../sessions/promote.js';
import type { HookSource } from '../sessions/types.js';
import { goalRows, readableGoals, readConcluded } from '../sessions/goals.js';
import { hookRows, malformedRows, readPacing } from '../sessions/hooks.js';
import { readPool } from '../sessions/pool-shape.js';
import { presentSession } from '../sessions/present.js';
import { presetOf } from '../sessions/preset-of.js';
import { setupMisfit } from '../sessions/setup.js';
import { ownerKey } from '../index-db/ingest.js';
import { listSessionRows } from '../index-db/sessions.js';
import { userOwner } from '../storage/layout.js';
import { rememberThis } from '../memory/capture.js';
import type { SessionMemoryConfig } from '../memory/config.js';
import { memoryPanel } from '../memory/panel.js';
import { readRendition, readRenditions } from '../renditions/store.js';
import { illustrateTurn } from '../renditions/illustrate.js';
import { assetPath } from '../renditions/worker.js';
import { readFileBytes } from '../storage/files.js';
import { resolveLore } from '../turns/lore.js';
import { channelInPlay, modeSurfaces, sessionSurfaces } from '../mode-registry.js';
import { degradedChannels, splitChannelKey } from '../sessions/channels.js';
import { DIAL_CHANNELS, packLevels, readDial, resolveLevel } from '../sessions/dials.js';
import { DEFAULT_MODE_ID, modeById, setupPlanFor } from '../mode-registry.js';
import { attachToSession, formatCursor, parseCursor } from '../stream/attach.js';
import { SseWriter } from '../stream/sse.js';
import { activeJob, readJob, submitTurn } from '../state/jobs.js';
import { exportSession } from '../sessions/export.js';
import { importSession } from '../sessions/import.js';
import { Cancelled } from '../turns/calls.js';
import { impersonate } from '../turns/impersonate.js';
import { previewAssembly } from '../turns/preview.js';
import { readSuggesting } from '../turns/suggest.js';
import { readBackdropOn, readIllustration, SE_BACKDROP_ON } from '../turns/render.js';
import { PathEscapeError } from '../storage/paths.js';
// The one route in this file that writes a *library* object rather than a
// session answers the library's refusals in the library's own statuses, from
// the module where that vocabulary is decided. A second spelling of the mapping
// is how a caller comes to learn *403 means the system library* from one route
// and something else from another.
import { respondToLibraryError } from './library.js';
import { disconnectSignal } from './disconnect.js';
import type { Tape } from '../rng/rng.js';

/**
 * Sessions, turns, and the stream — [P2 §2.10], [09 §3.1], [19 §8].
 *
 * **Every route resolves its session from the account, never from a parameter.**
 * There is no `:handle` here any more than there is in the library routes: the
 * path is the owner ([09 §4.3]), so a missing session and somebody else's are
 * the same 404. Confirming that a session id exists elsewhere would leak the one
 * fact the separation exists to keep.
 *
 * **Querystring numbers and booleans are strings.** This app replaced Fastify's
 * validator with the storage layer's Ajv, which has `coerceTypes: false` (F2) —
 * so `Type.Integer()` on a query parameter rejects `?limit=10` with *must be
 * integer*. Measured, on a route that shipped that way. The schemas below say
 * what is on the wire and the handlers convert.
 */

const SessionParams = Type.Object({ sessionId: Type.String() });

/** A rendition is addressed by its own id, which names its file — [P9.2]. */
const RenditionParams = Type.Object({
  sessionId: Type.String(),
  renditionId: Type.String(),
});

/** Choosing among a turn's siblings — [P9.3]. */
const TurnRenditionParams = Type.Object({
  sessionId: Type.String(),
  turnId: Type.String(),
});

const SelectRenditionBody = Type.Object({ renditionId: Type.String({ minLength: 1 }) });

/** **Illustrate** and **Set the scene** — [06 §10.6], [P9.4]. */
const IllustrateBody = Type.Object({
  purpose: Type.Optional(Type.Union([Type.Literal('illustration'), Type.Literal('background')])),
});

/**
 * A channel write addresses the **map key**, not the channel id — [P7.1].
 *
 * A scoped channel has one value per key (`se.lore.timing#<entryId>`), so a
 * route taking an id could only ever reach the unscoped value. `maxLength` is
 * generous rather than meaningful: a key is an id plus a uuid.
 */
const ChannelParams = Type.Object({
  sessionId: Type.String(),
  key: Type.String({ minLength: 1, maxLength: 400 }),
});

/**
 * `value` is unconstrained here and validated against the **channel's own
 * schema** downstream, which is where the declaration lives. A body schema that
 * guessed would be a second, weaker copy of it.
 *
 * *Wrapped in an object rather than sent bare so that `null` is expressible: a
 * bare body of `null` and a missing body are the same thing to a JSON parser,
 * and null is a value a channel may legitimately hold.*
 */
const ChannelBody = Type.Object({ value: Type.Unknown() }, { additionalProperties: false });

/**
 * A binding is a connection and one of its models — [19 §5.1].
 *
 * **Validated for shape and not for existence**, which is `setSessionRoles`'
 * argument: a binding naming a removed connection resolves as `dangling`, and
 * `resolveRole` keeps that distinct from `unbound` because the remedies differ.
 * Refusing the write would trade a diagnosable state for a rejected request.
 */
const BindingBody = Type.Object(
  { connectionId: Type.String({ maxLength: 200 }), modelId: Type.String({ maxLength: 400 }) },
  { additionalProperties: false },
);

/**
 * Both override layers in one body, and **both replaced wholesale**: a partial
 * update cannot express *clear this override*, and clearing one is the commoner
 * act. Omitting a key means an empty map, which is *no overrides* — the state a
 * session written before [P7.3] is in.
 */
const RolesBody = Type.Object(
  {
    roles: Type.Optional(Type.Record(Type.String(), BindingBody)),
    stepRoles: Type.Optional(Type.Record(Type.String(), BindingBody)),
  },
  { additionalProperties: false },
);
const JobParams = Type.Object({ sessionId: Type.String(), jobId: Type.String() });
const TurnParams = Type.Object({ sessionId: Type.String(), turnId: Type.String() });

/**
 * What a session is created as.
 *
 * `mode` and `cast` are here because without them half the shipped preset is
 * unreachable: the persona and actor slots resolve empty, so every prompt built
 * by this server used 4 of its 12 blocks and every test over assembly asserted
 * on absent input. ~~The preset is **not** a parameter — a session copies its
 * mode's default, and choosing a different pack is P7's surface.~~
 *
 * **Amended at P4.1 ([P4 §1.9]), rather than silently contradicted.** The
 * preset *is* a parameter now, and only just: an optional id, copied at
 * creation. ~~P7 keeps the **surface** — browsing, previewing, switching
 * mid-session~~ — and this is the minimum that makes PLAYABLE possible at all,
 * because a library full of imported presets that no session can play is a
 * library nobody can evaluate. The session still copies rather than links
 * ([03 §8]): editing a preset must not silently change a game in progress.
 *
 * ***The surface is [P7B](../../../../docs/design/workplan/24-p7b-presets-and-prompts.md)'s,
 * not P7's, and it has arrived*** (corrected 2026-09-14). P7 closed through
 * P7.14 with browsing and previewing and no pack surface at all, which is the
 * deferral [P7B §0.1] traces through six documents. Switching mid-session is
 * `PUT /sessions/:sessionId/preset` below, written at P7B.2 — so this comment's
 * last remaining claim is the one that never moved: the copy.
 *
 * *[P7B §1.7](../../../../docs/design/workplan/24-p7b-presets-and-prompts.md)
 * asked for this correction in the stage that falsified it and P7B.2 missed it;
 * the sweep at P7B.5 is the net under that rule, not a replacement for it.*
 */
const CastBody = Type.Object(
  {
    persona: Type.Union([Type.String(), Type.Null()]),
    actors: Type.Array(Type.String(), { maxItems: 32 }),
  },
  { additionalProperties: false },
);

/**
 * ***A hook as a session takes one*** (2026-09-27): the shared `PlotHook`, with
 * the id optional because a session's own hook has no object upstream to keep
 * one from, so the server mints it.
 *
 * The creation route and the add route both took any object and stored it as a
 * `PlotHook` by a cast, on the reasoning that a hook the schema would refuse is
 * an authoring mistake to show rather than a request to reject. Nothing showed
 * it. One without `involves` made every read of the session a 500 and every
 * turn a failure, since the actor lookup iterates `involves` on every gather,
 * and the panel whose Remove could fix it was the page that would not load. A
 * mistake is a `400` naming the field now, before anything is kept; one that
 * reaches the file another way is `malformed` on the panel (`pool-shape.ts`).
 */
const HookInput = Type.Object(
  { ...PlotHook.properties, id: Type.Optional(PlotHook.properties.id) },
  { additionalProperties: false },
);

const CreateBody = Type.Object(
  {
    /**
     * **Optional, and `''` means the same thing as absent.**
     *
     * A session is id-addressed — its folder is the uuidv7, `resolveFreeSlug`
     * never runs for one, and nothing anywhere resolves a session by name. So
     * starting one freezes nothing, which is exactly the constraint that made
     * the library defer creation until a name existed
     * ([05 §3](../../../../docs/design/05-tagging.md) has the contrasting case).
     * Demanding a name here bought a form somebody had to fill in before they
     * could play, and bought it for nothing.
     *
     * `minLength` goes as well as the field becoming optional, deliberately:
     * a caller sending `{"name": ""}` and one sending `{}` mean the same
     * thing, and a 400 for one of them would be the API drawing a distinction
     * the product does not.
     */
    name: Type.Optional(Type.String({ maxLength: 200 })),
    mode: Type.Optional(Type.String({ maxLength: 100 })),
    /**
     * A preset from the library, copied instead of the mode's default
     * ([P4 §1.9]). Omitted = the mode's default, which is what every session
     * before this got.
     */
    preset: Type.Optional(Type.String({ maxLength: 200 })),
    cast: Type.Optional(CastBody),
    /**
     * The world — [P5.6], [03 §8].
     *
     * **Links, unlike `preset` two fields up**, and validated no harder than
     * `cast` is: an id that resolves to nothing is a session with no books, not
     * a rejected request. Refusing here would be the one place in the codebase
     * where a dangling link blocks, and [00 §3.3] says the opposite — the
     * retriever reports what it could not read, every turn, where somebody
     * playing can actually see it.
     *
     * `lore` is extras *beyond* whatever the treatment already links ([03 §7]),
     * so both may be given, and giving neither is the pre-P5.6 session.
     */
    treatment: Type.Optional(Type.String({ maxLength: 200 })),
    lore: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 64 })),
    /**
     * The wizard's answers — [06 §7.3], [P7.4].
     *
     * ***`modeConfig` rather than `setup`, corrected before anything depended on
     * it.*** The first draft called this `setup`, which collides with the
     * **Setup** object below — two different things one word apart, which is
     * the collision [P7.4]'s own cell warns about — and stored it in a session
     * field beside `mode`, where `mode.config` has meant *how it was
     * configured* since P2.3 and been written `null` ever since. The portable
     * `Setup` names the same value the same way.
     *
     * **Open at the schema and closed at the handler**, which is the split that
     * matters: what may be in here is the mode's own declaration, and a schema
     * written out in this file could only be a second copy of it. So the shape
     * is checked below against `setupAnswerSchema(mode.definition.setup)` —
     * derived from the declaration, so a mode that adds a field is asked for it
     * without a second edit here.
     *
     * *The bound is on the document rather than on the fields, because a field
     * count is the mode's business and an unbounded body is not.*
     */
    modeConfig: Type.Optional(Type.Object({}, { additionalProperties: true })),
    /**
     * A **Setup** from the library — [04 §7], [P7.4], and the consumer that kind
     * has never had.
     *
     * *How to start playing*, in one object: a mode and its config, a preset, a
     * treatment, a cast to choose from, lore, hooks and goals. Everything it
     * carries is a **default** that a parameter sent beside it overrides, which
     * is [04 §6.1b]'s layering — *a Treatment proposes, a Setup overrides, and
     * the running session owns it* — with the session's own parameters as the
     * last word.
     *
     * The session keeps a **copy**, so editing the Setup afterwards cannot reach
     * a running game ([00 §3.1]) — the same asymmetry the preset has.
     */
    setup: Type.Optional(Type.String({ maxLength: 200 })),
    /**
     * The session's **own** hooks — [03 §4.1]'s fourth source, [P7.5].
     *
     * That section calls adding one to a running session *the primary path*, and
     * until this there was no field for them anywhere. They join the pool beside
     * the treatment's, the setup's and the lorebooks', attributed as the
     * session's own — which is the one source with no object to navigate to,
     * because the session is what you are already looking at.
     *
     * ~~*Unvalidated beyond the shape the handler reads, like `cast` and `lore`:
     * a hook the schema would refuse is an authoring mistake to show rather than
     * a request to reject, and the selector's filter is where a broken one stops
     * being eligible.*~~ ***Checked as hooks*** (2026-09-27): nothing showed one
     * and the filter never saw it, because the actor lookup before it fell over
     * a hook with no `involves`, and so did every read of the session after.
     * See {@link HookInput}.
     */
    hooks: Type.Optional(Type.Array(HookInput, { maxItems: 256 })),
  },
  { additionalProperties: false },
);

const ListQuery = Type.Object({ archived: Type.Optional(Type.String()) });
/**
 * `?from=<turnId>` walks to that node instead of to the head —
 * [10 §12.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***The reading view's *"any node, not just the head"*, and it is one
 * parameter rather than a route.*** §12.1 says the two surfaces *"read the same
 * turn records and share nothing else"* — which is a statement about what they
 * render, not about how they fetch. A second route would be a second place for
 * the walk, the limit and the sibling map to drift, over a difference that is
 * one argument to `walkPath`.
 *
 * *A string, because Fastify's validator runs with `coerceTypes: false`* and a
 * querystring value arrives as text — the same rule `search.ts` states for its
 * own `limit`.
 */
const TurnsQuery = Type.Object({
  limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,4}$' })),
  from: Type.Optional(Type.String({ maxLength: 200 })),
});
const StreamQuery = Type.Object({ after: Type.Optional(Type.String({ maxLength: 200 })) });
/**
 * Whose next message to draft — [06 §3.1], [P11.4]. Absent is the persona,
 * which is the case §3.1 describes; naming another member is [06 §8]'s *more
 * than one member may be `control: 'player'`* followed through.
 */
const ImpersonateBody = Type.Object({ actorId: Type.Optional(Type.String({ maxLength: 200 })) });

/**
 * What a `PATCH /sessions/:sessionId` may change — archiving, and the name.
 *
 * **Widened rather than joined by a verb**, which is the opposite of the call
 * [05 §4](../../../../docs/design/05-tagging.md) makes for `POST /tags/:id/rename`, and the
 * difference is worth stating because the two sit one file apart. A tag rename
 * is not a property edit: a lore entry's `actorTagFilter` holds author-written
 * *names*, compared exactly, so renaming one changes which lore fires, reaches
 * the user's object files, and has to answer with a report. A verb is right
 * when an operation has consequences beyond *here is the new state*.
 *
 * A session name has none of that. Nothing resolves a session by it, nothing
 * matches on it, and it lives in exactly two places — the JSON field and the
 * denormalised index column. That is an ordinary property edit, and `PATCH` is
 * what an ordinary property edit is. This file already renames a branch ref
 * through `PATCH .../refs/:refId`, so a session's name arriving at a different
 * *kind* of endpoint would be an inconsistency with nothing behind it.
 *
 * `minProperties: 1` so that `PATCH {}` is refused rather than answering 200
 * to a request that did nothing — `archived` relaxing from required to
 * optional is what makes an empty body expressible at all.
 */
const SessionPatch = Type.Object(
  {
    archived: Type.Optional(Type.Boolean()),
    name: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

/** What a session plays with — the same two links `CreateBody` takes. */
/**
 * One hook added to a running session — [03 §4.1], [P7.5].
 *
 * ~~*Open, like the creation route's `hooks` array and for the same stated
 * reason*: a hook the schema would refuse is an authoring mistake to **show**
 * rather than a request to reject, and the filter is where a broken one stops
 * being eligible with a class the panel can turn into a sentence.~~ ***Checked
 * as a hook*** (2026-09-27), for {@link HookInput}'s reason. The envelope is
 * closed as it was — one hook, under one key, so a client cannot post an array
 * and expect a pool.
 */
const HookBody = Type.Object({ hook: HookInput }, { additionalProperties: false });

/**
 * One goal written at a completion — [06 §7.3.4]'s *"or one written now"*,
 * [P7.6].
 *
 * ~~*Open past the envelope*, like the hook body beside it and for the stated
 * reason: a goal the schema would refuse is an authoring mistake to show rather
 * than a request to reject. What is closed is the envelope — one goal, under one
 * key.~~
 *
 * ***The shared `Goal`, with the id optional*** (2026-09-27). Nothing showed a
 * goal the schema would refuse: it was stored behind an `as unknown as Goal`,
 * and the first read that trusted the type fell over it. A goal without a
 * `completion` made every read of the session a 500 and every turn a failure,
 * and no route could take it out again. A mistake is shown now as a `400` that
 * names the field, before anything is written. The id stays optional because
 * a goal written here has no object upstream to keep one from, so the route
 * mints it.
 */
const GoalBody = Type.Object(
  {
    goal: Type.Object(
      { ...Goal.properties, id: Type.Optional(Goal.properties.id) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/** A hook id addresses one entry in the pool; it is URL-encoded like every id here. */
const HookParams = Type.Object({
  sessionId: Type.String(),
  hookId: Type.String({ maxLength: 200 }),
});

/**
 * Where a pooled hook is being saved to — [03 §4.1], [15 §5.1].
 *
 * ***Closed, which is the opposite of `HookBody` beside it, and the difference
 * is what the body carries.*** That one is open because it holds *a hook*, and a
 * hook the schema would refuse is an authoring mistake to show rather than a
 * request to reject. This one holds **no content at all** — it names an object
 * the server already has and a kind it must be. There is nothing here that could
 * be a mistake worth preserving, and an unrecognised `kind` is a client bug that
 * should fail where it is made rather than resolve to nothing three calls later.
 *
 * *`kind` is the pool's own vocabulary* — `treatment`, `setup`, `lore` — because
 * the targets are lined up against the pool's sources by eye on the panel, and a
 * second name for the lorebook arm would be a third spelling of one thing.
 *
 * ***`from` is which pooled row, and it exists because an id does not name
 * one.*** `poolFor` refuses to de-duplicate by id on purpose — *"the same hook
 * reaching a session through two sources is a real authoring situation"* — so a
 * pool legitimately holds two entries under one id with **different content**,
 * drawn as two rows each with its own control. Without this the handler takes
 * the first match, which is the row above the one that was pressed, and the
 * second attempt is then refused `already-there` forever: the hook the person
 * meant can never reach that object at all. The client sends the row's own
 * `source`, so the handler can resolve the entry rather than guess at it.
 *
 * *Optional, and the absence means the first match*, which is what a caller that
 * has only an id can honestly ask for. It carries no hook content either — a
 * `kind` and an id the server already holds — so it widens nothing the paragraph
 * above closes.
 */
const PromoteBody = Type.Object(
  {
    target: Type.Object(
      {
        kind: Type.Union([Type.Literal('treatment'), Type.Literal('setup'), Type.Literal('lore')]),
        id: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    from: Type.Optional(
      /**
       * `HookSource`'s own four arms, spelled out rather than loosened into one
       * object with an optional id: a `session` row has no id and the other
       * three always have one, and a body that allowed either everywhere would
       * accept `{ kind: 'lore' }` — which names every lorebook in the pool and
       * so resolves to none of them.
       */
      Type.Union([
        Type.Object({ kind: Type.Literal('session') }, { additionalProperties: false }),
        Type.Object(
          {
            kind: Type.Union([
              Type.Literal('treatment'),
              Type.Literal('setup'),
              Type.Literal('lore'),
            ]),
            id: Type.String({ minLength: 1, maxLength: 200 }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
  },
  { additionalProperties: false },
);

/**
 * A pack to switch to, or the session's own copy as edited — [P7B.2].
 *
 * **An id or an object, and never both.** `presetId` names a library preset the
 * server clones ([03 §8]'s *copy, never link* — editing the library's copy must
 * not rewrite a game in progress); `preset` is the session's own pack, sent
 * whole. The panel uses the first to switch and the second to edit in place,
 * and §1.1 records that those are the same operation with a pack of one.
 *
 * The literal `default` is the third arm and it means *whatever this mode
 * ships*, which is what the create form's blank option means too.
 */
const PresetBody = Type.Object(
  {
    presetId: Type.Optional(Type.String({ maxLength: 200 })),
    /**
     * ***A pack, checked as one*** (2026-09-27). It was any object, stored as
     * `Preset` by a cast, so a pack with no `blocks` was a session whose every
     * turn failed. The library checks a preset against this schema before it
     * keeps one; the session's own copy is checked the same way.
     */
    preset: Type.Optional(Preset),
  },
  { additionalProperties: false },
);

const LoreBody = Type.Object(
  {
    treatment: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    lore: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 64 }),
  },
  { additionalProperties: false },
);

/**
 * ***Remember this*** — [08 §2.1], [P8.3]'s cut form.
 *
 * **Four fields and none of them optional**, which is the honest shape for an
 * affordance whose whole claim is that the person pressing it knows what
 * mattered. The client prefills every one of them from the message and the
 * session; what lands is whatever they left in the boxes.
 *
 * `keys` is required rather than defaulted because an entry with no keys never
 * activates: a capture that quietly wrote one would produce a memory that
 * exists, is listed, is editable, and can never reach a prompt.
 */
/**
 * The two switches, the widening and the tri-state list — [08 §4], [08 §7].
 *
 * **Replaced whole**, per `setMemoryConfig`: a partial update has no way to say
 * *remove this association*, and a deletion sentinel would be a second
 * vocabulary for a map the client already holds entire.
 */
const MemoryBody = Type.Object(
  {
    share: Type.Boolean(),
    intake: Type.Boolean(),
    acrossPersonas: Type.Boolean(),
    associations: Type.Record(
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Union([Type.Literal('always'), Type.Literal('never')]),
    ),
  },
  { additionalProperties: false },
);

const RememberBody = Type.Object(
  {
    turnId: Type.String({ minLength: 1, maxLength: 200 }),
    actorId: Type.String({ minLength: 1, maxLength: 200 }),
    text: Type.String({ minLength: 1, maxLength: 4000 }),
    keys: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      minItems: 1,
      maxItems: 32,
    }),
  },
  { additionalProperties: false },
);

/**
 * What a preview is asked about — [P3.4].
 *
 * Field for field the half of `SubmitBody` that describes *what would be
 * sent*, so the preview's inputs cannot drift from the submission's. What it
 * deliberately lacks is the half about *committing*: no `idempotencyKey`,
 * because nothing is reserved, and no `headTurnId`, because nothing is
 * committed against one. Nor the two fields that make a submission a redo —
 * `rewriteOf` and `redoOf` — which do describe what would be sent, and are
 * absent because a redo is submitted from a turn's controls rather than
 * composed: the gestures submit, they do not preview.
 */
const PreviewBody = Type.Object(
  {
    input: Type.Optional(
      Type.Object(
        {
          text: Type.String({ maxLength: 100_000 }),
          actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          kind: Type.Optional(Type.String({ maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
    ),
    guidance: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

/**
 * A turn submission — [P2 §2.10].
 *
 * `guidance` is **its own field** and is never concatenated into `input.text`.
 * That is the whole point of the guidance slot ([06 §5.1]): typed into the
 * action it would land in history permanently, be summarised as narrative,
 * be scanned by keyword matching, be read back as dialogue, and appear in
 * exports — none of which the person typing it intended.
 */
const SubmitBody = Type.Object(
  {
    idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    headTurnId: Type.Union([Type.String(), Type.Null()]),
    /**
     * Branch from this node instead of extending the head — [P6.0c].
     *
     * Absent is every submission before P6: attach to `headTurnId`, and refuse
     * with `412` if that is no longer the head. Present says *I mean this one*,
     * and the head check does not apply to it. Explicit `null` branches from
     * the root.
     */
    parentTurnId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    /**
     * Replay this turn's draws — **rewrite** rather than reroll, [19 §14.5],
     * [P6.2].
     *
     * A turn id rather than a tape: the draws are read from the record on this
     * server, so a client cannot post the roll it wishes it had got. Absent is
     * a reroll, which is also every ordinary turn.
     */
    rewriteOf: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    /**
     * Show this turn's words to the model as the previous attempt — the other
     * half of a redo, [06 §5.1], [07 §7].
     *
     * A turn id rather than the text, for the reason `rewriteOf` is a turn id
     * rather than a tape: the words are read from this server's record, so the
     * model is shown what was written and not what a client says was. Absent
     * is every plain redo and every ordinary turn, whose prompt is exactly
     * what it was before this field existed.
     *
     * Independent of `rewriteOf`, because they answer different questions —
     * *whose draws* and *whose words*. A guided rewrite names both with one
     * id; a guided reroll names this one alone. Usually sent with `guidance`,
     * which is the instruction the attempt gives an *it* to, but the schema
     * does not couple them: an attempt shown without an instruction is a
     * legitimate, if blunt, request. Not required to be a sibling — see the
     * handler.
     */
    redoOf: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    input: Type.Object({
      text: Type.String({ maxLength: 100_000 }),
      actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      kind: Type.Optional(Type.String({ maxLength: 40 })),
    }),
    guidance: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

/**
 * Where to put the head — [P6.1].
 *
 * `resume` rather than a second route, because it is the same write with one
 * question answered differently: *this node*, or *this node and then wherever I
 * was going*.
 */
const HeadBody = Type.Object(
  {
    turnId: Type.String({ minLength: 1, maxLength: 200 }),
    resume: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** A name, and the node it bookmarks — [07 §3]. */
const RefBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    turnId: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const RefNameBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

const RefParams = Type.Object({
  sessionId: Type.String(),
  refId: Type.String(),
});

/**
 * The three ref writes answer the same four ways, so they say so once.
 *
 * A named node that is not in this session is a `404` rather than a `422` for
 * the reason the turn submission's `no-such-parent` gives: the request is well
 * formed and names something that is not there.
 */
function refReply(reply: FastifyReply, outcome: BranchRefOutcome): FastifyReply {
  switch (outcome.kind) {
    case 'no-session':
      return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    case 'no-turn':
      return reply
        .code(404)
        .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
    case 'no-ref':
      return reply.code(404).send({ error: 'no-such-ref', message: 'No such branch ref.' });
    case 'written':
      return reply.send({ session: presentSession(outcome.session) });
  }
}

export function registerSessionRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/sessions', { schema: { body: CreateBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as {
      name?: string;
      mode?: string;
      preset?: string;
      modeConfig?: Record<string, unknown>;
      setup?: string;
      /** Checked against `HookInput`, so a hook may arrive without its id. */
      hooks?: (Omit<PlotHook, 'id'> & { id?: string })[];
      cast?: { persona: string | null; actors: string[] };
      treatment?: string;
      lore?: string[];
    };

    /**
     * The Setup, read before anything else — [04 §7], [P7.4].
     *
     * **Everything it carries is a default a parameter overrides**, which is
     * [04 §6.1b]'s layering with the session's own parameters as the last word:
     * a person who picked a Setup and then changed the preset meant the preset
     * they picked. So it is resolved first and consulted below wherever a
     * parameter is absent.
     *
     * **Refused rather than ignored when it is not there.** A dangling
     * *treatment* or *lorebook* is a session missing a book, which [00 §3.3]
     * says to carry on with — a dangling Setup is a session that would be
     * created as something other than what was asked for, because the Setup is
     * *what to create*. Another account's is the same 422 by way of a 404
     * inside: the path is the owner.
     */
    let from: Setup | undefined;
    if (body.setup !== undefined) {
      try {
        const row = read(services.library, account.handle, body.setup, SETUP_SCHEMA);
        from = row.body as Setup;
      } catch {
        return reply.code(422).send({ error: 'unknown-setup', message: 'No such setup.' });
      }
    }

    /**
     * An unknown mode is refused **here** rather than resolved to the default.
     *
     * The runner falls back for a session that is *already* playing one this
     * build does not know — somebody else's story, which should still open
     * ([00 §3.3]). Creating a new session naming a mode that does not exist is a
     * different thing: nobody's story depends on it yet, and silently giving
     * them a different mode than they asked for is the surprise.
     */
    /**
     * **An empty mode id on a Setup means *unset*, not *a mode called ""***.
     * `newSetup` writes `{ id: '', config: null }`, so a Setup that never named
     * one would otherwise be refused as naming a mode this build does not have —
     * which is the same reading the preset resolution below already takes of an
     * empty id.
     */
    const named = body.mode ?? (from?.mode.id === '' ? undefined : from?.mode.id);
    const mode = modeById(named ?? DEFAULT_MODE_ID);
    if (mode === null) {
      return reply.code(422).send({ error: 'unknown-mode', message: 'No such mode.' });
    }

    /**
     * **The declaration held to, which is what stops it being decoration** —
     * [P7.4].
     *
     * A mode says what it needs before the first turn and creation refuses a
     * session that does not supply it. That is the whole of what makes a
     * declared wizard load-bearing rather than a description of a screen
     * somebody might build: a field the mode marked `required` cannot be
     * skipped, and a key the mode never asked for cannot be written into a
     * session file.
     *
     * **422 rather than 400**, and the same 422 the unknown mode above gets: the
     * body is well-formed JSON of the declared shape, and what is wrong is that
     * it does not satisfy *this mode's* requirements. A 400 would say the
     * request was malformed, which it is not.
     *
     * *The issues travel.* A wizard's refusal that said only *invalid* would
     * leave a person clicking Create and guessing which field, on a form the
     * engine generated and they did not design.
     */
    /**
     * The parameter, then the Setup's, then nothing — the layering above, for
     * the one value the Setup and the wizard both name. `Setup.mode.config` is
     * *"whatever the mode's own setup collected"*, which is exactly this.
     */
    const answers = body.modeConfig ?? asAnswers(from) ?? {};

    /**
     * The rest of the Setup's defaults, each overridden by its own parameter.
     *
     * **`personaOptions[0]` and not the whole list**, because a session's `cast`
     * holds one persona and a Setup holds the ones it *offers* — choosing is the
     * wizard's job, and until there is a control for it the first is the honest
     * default rather than a refusal to start.
     *
     * *`partyDefault` is not read here.* The party is `se.party` since [P7.3],
     * and seeding it means writing effects, which needs a turn — so it belongs
     * with the setup turn's parts rather than with the session file. Named
     * rather than silently dropped.
     */
    const cast =
      body.cast ??
      (from === undefined
        ? undefined
        : { persona: from.cast.personaOptions[0]?.id ?? null, actors: [] });
    const treatment = body.treatment ?? from?.treatment?.id;
    const lore = body.lore ?? from?.lore.map((link) => link.ref.id);
    const misfit = setupMisfit(mode.definition.setup, answers);
    if (misfit !== null) {
      return reply.code(422).send({
        error: 'setup-invalid',
        message: 'That is not what this mode asked for.',
        issues: misfit,
      });
    }

    // What the mode says it can seat ([06 §7.2]) — the first real consumer of
    // `ParticipantPolicy`, which was a declaration nothing read.
    const actors = body.cast?.actors ?? [];
    if (actors.length > mode.definition.participants.maxActors) {
      return reply.code(422).send({
        error: 'too-many-actors',
        message: 'That mode seats fewer actors than this session names.',
      });
    }

    /**
     * The named preset, or the mode's default ([P4 §1.9]).
     *
     * Read through the ordinary library door, so it is subject to the same
     * ownership rule as everything else: another account's preset is
     * `not-found`, never `forbidden`, because confirming that an id exists
     * elsewhere leaks the one fact that separation exists to keep ([09 §4.3]).
     *
     * `preset.modes` is deliberately **not** checked. It is advisory ([04 §8.2])
     * — a preset written for a mode you do not have still imports, still shows,
     * and still plays if you insist. Refusing here would turn a hint into a
     * gate, and the phase that fills a library with other people's presets is
     * the worst possible place to do that.
     */
    let preset;
    // The parameter, then the Setup's, then the mode's default — the layering
    // this route now has three rungs of.
    const presetId = body.preset ?? from?.preset?.id;
    if (presetId === undefined || presetId === '') {
      preset = structuredClone(mode.definition.assembly.defaultPreset);
    } else {
      let row;
      try {
        row = read(services.library, account.handle, presetId, PRESET_SCHEMA);
      } catch (error) {
        if (error instanceof LibraryError && error.code === 'not-found') {
          return reply.code(422).send({ error: 'unknown-preset', message: 'No such preset.' });
        }
        throw error;
      }
      // **Copied, not referenced** ([03 §8]), exactly as the default is: the
      // session owns its prompt pack from here, so editing the library's copy
      // never rewrites a game in progress.
      preset = structuredClone(row.body) as typeof mode.definition.assembly.defaultPreset;
    }

    try {
      const session = await createSession(services.sessions, account.handle, {
        // Trimmed here so `{"name": "   "}` cannot produce a session whose
        // list entry is an invisible link. It is not the only guard —
        // `session.json` is hand-editable by design ([03 §1]), so the client's
        // label helper trims too — but it is the one that stops the API being
        // the thing that made the mess.
        // The Setup's name when it was not given one, because a session made
        // from *The Fixer's Debt* and left unnamed is that, not *Untitled*.
        name: (body.name ?? from?.name ?? '').trim(),
        /**
         * **`config` is the wizard's answers**, which is what this field has
         * meant since P2.3 and what every creation wrote `null` into until now
         * ([P7.4]). `null` still, when there are none — *no wizard ran* and
         * *a wizard ran and collected nothing* are different, and every session
         * written before this is in the first state.
         */
        mode: {
          id: mode.definition.id,
          config: Object.keys(answers).length === 0 ? null : answers,
        },
        preset,
        ...(cast === undefined ? {} : { cast }),
        ...(treatment === undefined ? {} : { treatment }),
        ...(lore === undefined ? {} : { lore }),
        // A copy, so editing the Setup afterwards cannot reach this game
        // ([00 §3.1], [04 §7]) — the asymmetry the preset already has.
        ...(from === undefined ? {} : { setup: structuredClone(from) }),
        /**
         * **The hook pool, copied from all four sources** — [03 §4.1], [P7.5].
         *
         * Built here because the sources are library objects and this is where
         * the library is read: `resolveLore` already walks the treatment and the
         * books for the turn pipeline, so the pool is the same walk one moment
         * earlier. *Copied rather than resolved per turn, which is [06 §6.1]'s
         * "pulled, never pushed" over [00 §3.1] — and the copies keep their
         * sources' ids, which is [15 §5]'s obligation and what makes a
         * continuity possible later.*
         */
        ...(from?.goals === undefined || from.goals.length === 0
          ? {}
          : {
              /**
               * The goal chain, copied from the Setup — [04 §7.1], [06 §7.3.3],
               * [P7.6]. **A copy, for the reason the pool and the pack are**:
               * editing a Setup must not reach a game in progress ([00 §3.1]),
               * and *Advance* may write a goal that was never in the Setup at
               * all.
               */
              goals: structuredClone(from.goals),
            }),
        hooks: poolFor({
          lore: resolveLore(services.library, account.handle, { treatment, lore }),
          ...(from === undefined ? {} : { setup: from }),
          /**
           * ***With ids minted, as the add route mints them*** (2026-09-27). A
           * hook created with the session and no id was pooled as `se.hook#`
           * with nothing after it: it could not be committed, blocked, recorded
           * as fired or removed, since each of those keys on the id. Only the
           * session's own hooks are minted for; a copied one keeps its source's
           * id, which is [15 §5]'s obligation.
           */
          ...(body.hooks === undefined
            ? {}
            : {
                own: body.hooks.map((hook) => ({
                  ...hook,
                  id: hook.id !== undefined && hook.id !== '' ? hook.id : uuidv7(),
                })),
              }),
        }),
      });

      /**
       * **A mode that generates makes its world on the session's first turn** —
       * [06 §7.3], [P7.4].
       *
       * [00 §2.3] calls incremental generation the single biggest reliability
       * difference available versus the source, and 06 §7.3 spells the shape:
       * *"separate validated generations, each individually retryable, applied
       * as they succeed"*. Every clause of that is a property of the step loop,
       * so setup is a turn and the parts are its steps — no second pipeline, and
       * the record is the record a person already reads.
       *
       * **Reserved and started, then returned with the job**, which is exactly
       * what `POST /sessions/:id/turns` does: the client already knows how to
       * open a stream for a job and show per-step progress, and generation is a
       * thing you watch rather than a thing you wait out behind a spinner.
       *
       * *A mode with no parts reserves nothing.* An empty plan would commit a
       * turn that did nothing, which is a blank first entry in somebody's
       * transcript — the cost [P7.3] refused to pay for the roster, refused here
       * too and for the same reason.
       */
      /**
       * ***Warn when this treatment already has a session, and offer to start
       * isolated*** — [08 §6](../../../../docs/design/08-cross-session-memory.md)'s
       * cheapest mitigation, [P8.5].
       *
       * **Spoiler bleed is the sharp failure** — *"replay a package or start a
       * second story in the same treatment, and intake will happily import what
       * happened last time, including twists and plot hooks that fired"* — and
       * 08 §6 lists the mitigations *in order of how much they cost*. This is
       * the first: *"cheap and catches the common case."*
       *
       * ***After creation rather than before it, which is a decision.*** The
       * warning exists so somebody can seal the session, and **nothing has been
       * read yet**: a session is created with no turns, so intake has had no
       * occasion to import anything. Asking before creating would mean a second
       * round trip and a modal in front of the button people press most; saying
       * it beside the new session, with one control that turns both toggles off,
       * is the same protection at the moment it first matters. *And the control
       * is the one obvious action [08 §4]'s `[OPEN]` asks for* — *"isolating a
       * session must be one obvious action rather than two toggles found in a
       * drawer"*.
       *
       * Its own read rather than the panel's: at creation the question is only
       * *has this treatment been played before*, which is a walk over the
       * account's sessions and nothing else.
       */
      const sharesTreatmentWith =
        typeof treatment !== 'string' || treatment === ''
          ? []
          : await sessionsInTreatment(services, account.handle, session.id, treatment);
      const warn = sharesTreatmentWith.length === 0 ? {} : { sharesTreatmentWith };

      const parts = setupPlanFor(mode).steps.length;
      if (parts === 0) {
        return await reply.code(201).send({ session: presentSession(session), ...warn });
      }

      const reserved = await submitTurn(services.jobs, {
        account: account.handle,
        sessionId: session.id,
        // The session is new, so there is exactly one turn this key can name and
        // a retried create cannot start a second generation.
        idempotencyKey: `setup:${session.id}`,
        headTurnId: null,
      });
      if (reserved.kind !== 'created') {
        // Nothing else can have reserved a turn on a session created one line
        // ago. Answering with the session rather than an error is the honest
        // outcome if it somehow does: the session exists and is playable.
        return await reply.code(201).send({ session: presentSession(session), ...warn });
      }
      services.runner.start(reserved.job, { setup: true });
      return await reply
        .code(201)
        .send({ session: presentSession(session), activeJob: reserved.job, ...warn });
    } catch (error) {
      if (error instanceof PathEscapeError) {
        return reply.code(422).send({ error: 'refused-path', message: error.message });
      }
      throw error;
    }
  });

  app.get('/sessions', { schema: { querystring: ListQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { archived } = request.query as { archived?: string };
    const sessions = await listSessionFiles(services.sessions, account.handle, {
      includeArchived: archived === 'true',
    });
    return reply.send({ sessions: sessions.map(presentSession) });
  });

  app.get('/sessions/:sessionId', { schema: { params: SessionParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const session = await mine(services, request, reply);
    if (!session) return;

    // The active job travels with the session, because a client reloading
    // mid-turn needs to know there *is* one before it decides whether to open a
    // stream or offer a submit box.
    const job = activeJob(services.state.db, session.id);
    /**
     * **The health record travels too** — [06 §4.2], [P7.1].
     *
     * *"The session carries a health record — which channels are degraded, which
     * version they were written against, and why they failed."* Derived from the
     * markers `applyEffects` replays, and composed **here rather than on the
     * client**, which is the difference between one shape and two: a client
     * reading `session.channels` itself would have to split composite keys and
     * know the registry, and a second `splitChannelKey` in a React component is
     * the drift the server's own docstrings keep refusing.
     *
     * On the read route rather than a route of its own, because the banner it
     * feeds is on the session and a second request to learn whether to show it
     * is a request nobody would make.
     */
    /**
     * **`hud` travels with the session for the reason `health` does** — [10 §8],
     * [P7.1]. Composing it on the client would mean shipping the registry, the
     * declarations and a template engine to the browser to render a label and a
     * string; what crosses instead is the label and the string.
     */
    /**
     * **The cast panel's rows** — [10 §13.2], [P7.2].
     *
     * *Two axes out and one badge derived on the screen*, which is that
     * section's own division: *"the split is in the data, not on the screen"*.
     * Sending a pre-derived badge would put the derivation here and leave the
     * panel unable to offer *correct presence and status directly*, which is
     * what makes it worth building rather than a read-only complaint.
     *
     * **The path is read because two of the four fields are derived along it** —
     * `introduced` is monotone over presence and party effects, and an
     * unanswered death proposal is a refusal with no applied status effect
     * after it. Neither is stored, deliberately ([06 §8.1]: *"derived rather
     * than stored"*), and both cost the same walk the transcript route already
     * makes.
     */
    const path = walkPath(
      await readTurns(services.sessions, account.handle, session.id),
      session.headTurnId,
    );

    /**
     * **The hook panel's rows** — [10 §10.1], [06 §6.1], [P7.5].
     *
     * *"Which hooks have fired and when, which are eligible right now, and which
     * are blocked **with the clause that blocked them**."* And [10 §10.1] is
     * explicit that *eligibility is live rather than computed on demand, because
     * the selector's mechanical filter already runs every turn* — so this is the
     * same `filterHooks` the selector calls, over the same pool at the same node.
     *
     * **Two library reads, and both are the ones the turn makes.** The active
     * books decide whether a lorebook-borne hook is eligible at all ([03 §4.1]),
     * and `resolvableActors` answers whether an `introduces.actor` exists —
     * shared with `gather.ts` rather than reimplemented, because *a panel that
     * disagreed with the selector about why a hook is blocked would be worse than
     * no panel*.
     *
     * *Skipped entirely for a session with no pool*, which is every session
     * today: the reads are real, the route is on the path of every poll, and an
     * empty array costs nothing to send.
     */
    /**
     * ***What the engine can read, and what it can only show*** (2026-09-27).
     * One hook the schema refuses, with no `involves`, made this read a 500:
     * the actor lookup below iterated it. The engine takes `usable`; the panel
     * lists the rest as `malformed`, so the person who wrote it can find it.
     */
    const { usable: pool, malformed } = readPool(session.hooks);
    const library = {
      db: services.sessions.index,
      layout: services.sessions.layout,
      keepHistoryPerObject: 0,
    };
    const lore = pool.length === 0 ? null : resolveLore(library, account.handle, session);

    /**
     * **The dial travels with the rows, and it is not in the `hud`.**
     * [10 §10.1] puts it *in the panel*: *"the pacing dial sits here, because it
     * is the control that explains an empty panel — a session at `sparse` with
     * six eligible hooks and nothing firing is working correctly, and without the
     * dial in view that is indistinguishable from broken."* A `surface` on the
     * channel would put it in the strip above the transcript instead, which is a
     * different place and a different claim.
     *
     * *Resolved here rather than read off the channel*, because the value is
     * [04 §6.1b]'s three rungs — the session's own, a Setup's, a Treatment's —
     * and a control showing only the first would read as `normal` for every
     * session that authored one and never turned it.
     */
    const hooks = {
      pacing: readPacing(session.channels, {
        ...(isRecord(session.setup) ? { setup: session.setup } : {}),
        ...(isRecord(lore?.treatment?.treatment) ? { treatment: lore.treatment.treatment } : {}),
      }),
      rows: [
        ...(lore === null
          ? []
          : hookRows(pool, {
              channels: session.channels,
              path,
              activeBooks: new Set(lore.books.map((book) => book.id)),
              known: resolvableActors(library, account.handle, pool).known,
              persona: session.cast?.persona ?? null,
            })),
        ...malformedRows(malformed),
      ],
    };

    /**
     * **The goal panel's rows** — [06 §7.3.4], [10 §12], [P7.6].
     *
     * Reconstructed at the head like `cast` and `hooks` beside it: which goal
     * play is on, which are achieved and on which turn, and whether the story
     * has been ended. *The three offers are derived on the screen rather than
     * sent*, because they are the same three every time and what decides them is
     * `achieved` plus `next`, both of which travel.
     */
    const goals = {
      rows: goalRows(readableGoals(session.goals), session.channels, path),
      concluded: readConcluded(session.channels),
    };

    // What this session is playing, which three of the blocks below need and
    // none of them needed before a second mode declared anything.
    const modeId = session.mode?.id ?? DEFAULT_MODE_ID;

    /**
     * ***The two dials*** — [06 §7.3.1], [06 §7.3.2], [P7.8].
     *
     * **Sent only for a mode that declares them**, which is the whole shape of
     * [04 §7]'s answer: Scene and Messages have no difficulty because they
     * declare no such channel, and a payload that carried an empty dial for them
     * would put the distinction back where Setup had it — a blank field rather
     * than an absence.
     *
     * ***The levels travel with the value, and that is not padding.*** A control
     * needs the vocabulary it may write, and unlike hook pacing this vocabulary
     * is **the pack's** — [06 §7.3.1]: *"'Hard' meaning something different in
     * one prompt pack than another is a feature."* A client with a hard-coded
     * three-option list would be a control that produces recorded refusals the
     * day somebody ships a pack with four.
     *
     * *Resolved through the same functions the turn uses*, for the reason the
     * pacing dial is: a panel that disagreed with the assembler about which
     * level is in play would be worse than no panel. The `label` and `rank` are
     * what a control renders; the fragments are hidden content and stay off the
     * wire.
     */
    /**
     * *The same resolution `gather.ts` makes*, in the one line that is the whole
     * of it: a session's own copied preset, or the mode's default. Copied at
     * creation, so editing a preset does not change a game in progress ([03 §8])
     * — ***and through `presetOf` since 2026-09-27***, so a copy of the mode's
     * own pack has the level lists the mode shipped after it was taken, and a
     * dial the turn resolves is a dial this panel offers.
     */
    const packMode = modeById(modeId) ?? modeById(DEFAULT_MODE_ID);
    const preset = packMode === null ? session.preset : presetOf(session.preset, packMode);
    const dials: Record<
      string,
      { levelId: string | null; levels: { id: string; label: string }[] }
    > = {};
    for (const axis of ['difficulty', 'directedness'] as const) {
      // `channelInPlay` and not `channelDefinition`: Freeform declaring
      // `se.difficulty` must not give a **Scene** session a difficulty dial.
      if (preset === undefined || !channelInPlay(DIAL_CHANNELS[axis], modeId)) continue;
      const levels = packLevels(preset, axis);
      if (levels.length === 0) continue;
      dials[axis] = {
        levelId:
          resolveLevel(preset, axis, readDial(axis, session.channels, session.mode?.config))?.id ??
          null,
        levels: [...levels]
          .sort((left, right) => left.rank - right.rank)
          .map((level) => ({ id: level.id, label: level.label })),
      };
    }

    return reply.send({
      session: presentSession(session),
      activeJob: job,
      health: degradedChannels(session.channels),
      // **Narrowed to this session's mode** — [06 §4.1], [P7.9]. The registry is
      // process-wide; a session is not. Before a second mode declared channels
      // this walked the union and was right by accident.
      hud: sessionSurfaces(session.channels, modeId),
      /**
       * ***What this session's mode put where*** — [06 §9], [P7.11].
       *
       * Separate from `hud` rather than merged into it, because they answer
       * different questions and a client renders them in different places: `hud`
       * is every channel that declared itself worth a strip row, and this is
       * every placement a **mode** asked for. A contribution naming `hud`
       * appends to the strip; the other three regions have nowhere else to come
       * from.
       */
      surfaces: modeSurfaces(session.channels, modeId),
      cast: castRows(session.cast, session.channels, path),
      hooks,
      goals,
      dials,
      /**
       * ***What the player may send*** — `ModeDefinition.inputs`, [06 §1],
       * [06 §9], [P7.9].
       *
       * **Here rather than fetched from `GET /api/modes`**, which the play page
       * does not call and should not have to: the kinds are a property of *this
       * session's* mode, the page already polls this route, and a second request
       * to learn one array would make the input box's affordances arrive after
       * the box.
       *
       * *One kind means no selector*, which is what Scene sends and why nothing
       * appeared before this phase. The client decides that; the server says
       * what is accepted, which is the same list the submit route refuses
       * against.
       */
      inputs: modeById(modeId)?.definition.inputs ?? [],
      /**
       * Whether this session wants suggested actions — [R11], [P7.9].
       *
       * **Sent even though it is off by default**, which is the whole of why the
       * default could be off: [work plan §2.3] forbids configuration with no
       * surface, and a toggle a client cannot read is a toggle nobody finds. The
       * offers themselves travel on their turns, not here.
       */
      suggesting: readSuggesting(session.channels),
      /**
       * ***Whether this session makes pictures*** — [06 §10.6], [P9.4].
       *
       * `suggesting` one line up is the precedent and the argument is the same
       * one: [work plan §2.3] forbids configuration with no surface, and a
       * channel a client cannot read is a setting nobody finds. **Derived
       * rather than the raw channel**, because `readIllustration` is where
       * *absent means the declaration* is stated, and a client re-deriving it
       * from a bare value would be a second statement that could disagree.
       *
       * `backdrop` is **absent** for a mode that declares no `se.backdrop.on`,
       * which is the same three words `dials` uses for a mode with no
       * difficulty: nothing to render rather than a control that does nothing.
       * Scene declares it; Freeform does not.
       */
      renditions: {
        illustration: readIllustration(
          session.channels,
          modeById(modeId)?.definition.renditions?.illustration,
        ),
        ...(SE_BACKDROP_ON in session.channels
          ? { backdrop: readBackdropOn(session.channels) }
          : {}),
      },
    });
  });

  app.put(
    '/sessions/:sessionId/cast',
    { schema: { params: SessionParams, body: CastBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const body = request.body as { persona: string | null; actors: string[] };
      const mode = modeById(session.mode?.id ?? DEFAULT_MODE_ID);
      if (mode !== null && body.actors.length > mode.definition.participants.maxActors) {
        return reply.code(422).send({
          error: 'too-many-actors',
          message: 'That mode seats fewer actors than this session names.',
        });
      }

      const { sessionId } = request.params as { sessionId: string };
      // **Ids, not objects.** A cast entry is a link resolved fresh every turn,
      // so improving a character card reaches an ongoing game — the asymmetry
      // with the copied preset is the design ([03 §8]).
      const updated = await setCast(services.sessions, account.handle, sessionId, body);
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * Which treatment and which lorebooks this session plays with.
   *
   * **The sibling of the cast route, and it exists because selection is the
   * only way a book reaches a session.** A lorebook does not volunteer,
   * whatever its own `scope` says — so without this, a session started without
   * naming books could never gain a world, and every session written before the
   * field existed would be stuck without one permanently.
   *
   * Validated no harder than `cast` is: an id that resolves to nothing is a
   * session with a dangling link, not a rejected request. The retriever reports
   * what it could not read, every turn, where somebody playing can see it.
   */
  /**
   * A hook added to a **running** session, or taken out of one — [03 §4.1],
   * [06 §6.1], [P7.5].
   *
   * ***The primary path, and creation was the only way in.*** 03 §4.1 says a
   * session *"may add its own while running"* and calls it that; a treatment is
   * where hooks primarily live, but *I want this to happen in this game* is a
   * thought people have while playing rather than while configuring.
   *
   * **Not a channel write, which is the same section's other sentence**:
   * *"adding a hook mid-session is an authoring act, not a story event, and must
   * survive a rewind"*. So the pool is on the session file and only what has
   * *happened to* a hook is per-node. A hook added at turn forty is in the pool
   * at turn one, and rewinding does not un-add it.
   *
   * *Unvalidated beyond the shape the handler reads*, like `cast`, `lore` and
   * the creation route's own `hooks`: a malformed hook is an authoring mistake
   * to show rather than a request to reject, and the selector's filter is where
   * a broken one stops being eligible with a reason the panel can say.
   */
  app.post(
    '/sessions/:sessionId/hooks',
    { schema: { params: SessionParams, body: HookBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { hook } = request.body as { hook: Omit<PlotHook, 'id'> & { id?: string } };
      const { sessionId } = request.params as { sessionId: string };

      /**
       * ***An id is minted when there is none, and this is the one source where
       * that is right.*** Every other hook in the pool was **copied** from an
       * object that had one, and [15 §5]'s obligation is that copying keeps it —
       * a corpus whose hooks have unrelated ids cannot be retro-fitted into a
       * continuity. A session's own hook has no upstream to keep an id from, and
       * without one it cannot be committed, blocked, or recorded as fired: every
       * one of those keys on `hook.id`.
       */
      const id = hook.id !== undefined && hook.id !== '' ? hook.id : uuidv7();
      const updated = await setSessionHooks(services.sessions, account.handle, sessionId, {
        add: { ...hook, id },
      });
      if (updated === null) {
        return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
      }
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * Taking a hook back out — the other half, and it takes **any** of them.
   *
   * The pool was copied at creation, so a treatment-borne entry in it is this
   * session's copy; declining to remove it would make the copy a binding, which
   * is the thing [00 §3.1]'s prefill-not-binding rules out. *What it does not do
   * is reach the treatment*: the same asymmetry running the other way.
   *
   * **The session comes back, like every other mutation here**, so a panel that
   * just removed a row has the pool it is now looking at rather than a promise
   * it has to go and check.
   *
   * *Removing a hook that is already gone succeeds.* It is the state the caller
   * asked for, and a 404 would make a double-click an error — where a missing
   * **session** stays a 404, because that is a different claim.
   */
  app.delete(
    '/sessions/:sessionId/hooks/:hookId',
    { schema: { params: HookParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId, hookId } = request.params as { sessionId: string; hookId: string };
      const updated = await setSessionHooks(services.sessions, account.handle, sessionId, {
        remove: hookId,
      });
      if (updated === null) {
        return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
      }
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * ***Saving a hook back out of a session*** — [03 §4.1], [06 §6.1],
   * [15 §5.1], and the valve `hook-pool.ts` never had a counterpart for.
   *
   * **The pair above only runs one way.** A session copies hooks in from all
   * four of 03 §4.1's sources at creation and may gain its own while playing,
   * and until this route there was no way back out: a hook realised mid-play —
   * *most of why the feature earns its place*, by 06 §6.1's reckoning — died
   * with the session it was realised in.
   *
   * **The work is in `sessions/promote.ts` and the reasoning with it**, which is
   * this file's habit for anything that is not about the wire: why promotion
   * cannot be a client-side read-modify-write (the panel is shown a redaction of
   * the pool and [08 §6] forbids widening it), why the copy keeps the hook's id,
   * and why the session is left exactly as it was.
   *
   * ***Three 404s, and they are three different claims*** — the session is gone,
   * this pool has no such hook, or the object you picked has been deleted since
   * the panel listed it. A person sent to the wrong one of those three looks in
   * the wrong place, so the route answers with the one that happened rather than
   * a shared *not found*.
   *
   * *Which is also why this one does not go through `mine`.* Its sibling routes
   * do, for the hand-edit reconciliation it performs on the outermost read of a
   * session — but that reconciliation writes a **turn**, and promotion is not a
   * move in the story; and `mine`'s own 404 says `not-found`, which would be a
   * fourth spelling shadowing the first of the three. The ownership it enforces
   * is not lost: `readSession` resolves under the account's handle, so somebody
   * else's session is the same absence it has always been ([09 §4.3]).
   *
   * **409 rather than a second copy, and never a fresh id.** Pressing the
   * control twice is a thing people do — the first press leaves the panel row
   * looking exactly as it did — so the second says *that one is already there*.
   * [15 §5.1] is why the alternative is not *rename it*: a re-minted id is the
   * one thing that cannot be repaired afterwards, because a corpus of sessions
   * whose hooks have unrelated ids cannot be retro-fitted into a continuity.
   *
   * ***And one library refusal is answered here rather than delegated*** — a
   * target that moved under the write is `409 target-moved` rather than the
   * shared `412 stale`, because that arm's body carries the whole object and
   * this is the one caller for which that object is hidden content. The catch
   * block below argues it.
   */
  app.post(
    '/sessions/:sessionId/hooks/:hookId/promote',
    { schema: { params: HookParams, body: PromoteBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, hookId } = request.params as { sessionId: string; hookId: string };
      const { target, from } = request.body as { target: PromoteTarget; from?: HookSource };

      let outcome;
      try {
        outcome = await promoteSessionHook(
          services.sessions,
          services.library,
          account.handle,
          sessionId,
          hookId,
          target,
          from,
        );
      } catch (error) {
        /**
         * ***`stale` is answered here rather than delegated, and it is the one
         * refusal this route may not pass through.*** `respondToLibraryError`'s
         * 412 arm attaches `current` — the **whole target object** — so that an
         * editor can offer reload-and-reapply. That envelope is a treatment's or
         * a lorebook's every hook, which means every **unfired** `premise` and
         * every `Entrance.text` on it, delivered to the play client: exactly the
         * content [08 §6](../../../../docs/design/08-cross-session-memory.md) and
         * [10 §10.1](../../../../docs/design/10-ui-surfaces.md) name as hidden,
         * at the surface they name it about, through the error path of the route
         * whose whole reason for being server-side is that redaction. It is
         * reachable without a race: a hand-edited `treatment.json` ([03 §1]
         * makes that first-class) promoted against before the watcher settles.
         *
         * **And the envelope buys nothing here.** There is no reload-and-reapply
         * for this act — the client never held the hook, and cannot merge one it
         * has never been shown — so the honest answer is *try again*, with the
         * `diverged` arm's shape and for the `diverged` arm's reason: a 409 that
         * cannot be read as *here is the newer state, resolve against it*.
         *
         * Everything else — `read-only`, `invalid`, `not-found`, `refused-path`,
         * `diverged` — keeps the shared mapping, which is right for each of them
         * and carries no object.
         */
        if (error instanceof LibraryError && error.code === 'stale') {
          return reply.code(409).send({
            error: 'target-moved',
            message: 'That object changed while you were saving. Try again.',
          });
        }
        /**
         * A system-library target (403 — *copy to my library* first, then
         * promote into the copy), a file the index has lost track of (409), a
         * path the layout refuses (422) — the library's own refusals, in the
         * library's own statuses, through the library routes' own mapping.
         * *`stale` is not in this list*, because the arm above took it; naming
         * it here as a 412 is what this comment said until the envelope it
         * carries turned out to be a spoiler leak.
         *
         * **`invalid` is reachable from here in a way it is not from those
         * routes**, and that is this call site's one piece of news: the add
         * route takes a hook the schema would refuse, on purpose, because *a
         * hook the schema would refuse is an authoring mistake to show rather
         * than a request to reject*. Promoting it is where that stops being
         * free — `update` runs the real validator, and the 400 carries the
         * issues saying which field.
         */
        respondToLibraryError(error, reply);
        return;
      }

      switch (outcome.kind) {
        case 'promoted':
          // The object, not the session: nothing about the session changed, and
          // returning it would invite a client to believe otherwise. What the
          // caller needs is somewhere to navigate to and something to name in
          // the confirmation.
          return reply.send({ object: outcome.object });
        case 'no-session':
          return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
        case 'no-such-hook':
          return reply
            .code(404)
            .send({ error: 'no-such-hook', message: 'This session has no hook with that id.' });
        case 'no-such-object':
          return reply.code(404).send({ error: 'no-such-object', message: 'That object is gone.' });
        case 'already-there':
          return reply.code(409).send({
            error: 'already-there',
            message: 'That object already carries this hook.',
          });
      }
    },
  );

  /**
   * A goal written at a completion — [06 §7.3.4], [P7.6].
   *
   * ***Advance's second arm, and the reason the chain is a session field.***
   * *"Set the next goal, either the authored `next` or one written now"* — the
   * authored half is a cursor write and needs no route; this is the other half,
   * and a goal written at a completion was never in the Setup.
   *
   * **It writes the chain and not the cursor**, which is two acts on purpose.
   * Adding the goal is an authoring act and lands on the session file; *moving
   * play onto it* is a move in the story and goes through the channel write,
   * where it becomes a turn. [06 §7.3.4] is emphatic that `thenDefault`
   * *"seeds the offer; it does not decide it"*, and a route that did both would
   * have decided it.
   */
  app.post(
    '/sessions/:sessionId/goals',
    { schema: { params: SessionParams, body: GoalBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { goal } = request.body as { goal: Omit<Goal, 'id'> & { id?: string } };
      const { sessionId } = request.params as { sessionId: string };

      /**
       * An id is minted when there is none, for the reason the hook route mints
       * one: a goal written here has no upstream object to keep an id from, and
       * without one it could be neither completed nor pointed at — `se.goal` is
       * scoped by it and `Goal.next` names it.
       */
      const id = goal.id !== undefined && goal.id !== '' ? goal.id : uuidv7();
      const updated = await addSessionGoal(services.sessions, account.handle, sessionId, {
        ...goal,
        id,
      });
      if (updated === null) {
        return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
      }
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * Which pack this session is assembled from — [P7B.2], and the route
   * [P6B §4](../../../../docs/design/workplan/20-p6b-playable.md) declined to add
   * because doing so *"is a question about what a session's preset is"*.
   * [P7B §1.1] answers it and this is the answer built.
   *
   * ~~`PATCH /sessions/:id` accepts only `name`~~ — **a sibling of `PUT …/lore`
   * and `PUT …/cast` instead**, which is the shape the last two selection
   * surfaces took and the one whose body is *the object* rather than a diff
   * ([P6B.0]: *ids, not objects* for links, and the whole document for the
   * thing the session owns).
   */
  app.put(
    '/sessions/:sessionId/preset',
    { schema: { params: SessionParams, body: PresetBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { presetId, preset } = request.body as {
        presetId?: string;
        preset?: Record<string, unknown>;
      };
      const { sessionId } = request.params as { sessionId: string };

      /**
       * **Exactly one, and checked by branching rather than by asserting.**
       *
       * Two would make the route decide which the caller meant and neither
       * leaves nothing to write — both are the caller's error and worth saying
       * plainly, because the caller sent both halves. Written as nested
       * branches so `presetId` narrows to a string where it is read: the
       * shorter `(a === undefined) === (b === undefined)` form is the same
       * claim and leaves the compiler unable to see it, which costs a
       * non-null assertion the lint rules forbid in both directions.
       */
      let next: Record<string, unknown>;

      if (presetId === undefined) {
        if (preset === undefined) {
          return reply.code(422).send({
            error: 'one-of',
            message: 'Send presetId to switch to a library preset, or preset, the pack itself.',
          });
        }
        next = preset;
      } else {
        if (preset !== undefined) {
          return reply.code(422).send({
            error: 'one-of',
            message: 'Send presetId or preset, never both — they say different things.',
          });
        }
        if (presetId === 'default') {
          const session = await readSession(services.sessions, account.handle, sessionId);
          if (session === null) return reply.code(404).send({ error: 'not-found' });
          const mode = modeById(session.mode?.id ?? DEFAULT_MODE_ID) ?? modeById(DEFAULT_MODE_ID);
          if (!mode) return reply.code(422).send({ error: 'unknown-mode' });
          next = structuredClone(mode.definition.assembly.defaultPreset);
        } else {
          let row;
          try {
            row = read(services.library, account.handle, presetId, PRESET_SCHEMA);
          } catch (error) {
            if (error instanceof LibraryError && error.code === 'not-found') {
              return reply.code(422).send({ error: 'unknown-preset', message: 'No such preset.' });
            }
            throw error;
          }
          // **Copied, not referenced** ([03 §8]) — the same clone session
          // creation makes, for the same reason.
          next = structuredClone(row.body) as Record<string, unknown>;
        }
      }

      const updated = await setPreset(
        services.sessions,
        account.handle,
        sessionId,
        next as NonNullable<Parameters<typeof setPreset>[3]>,
      );
      if (updated === null) return reply.code(404).send({ error: 'not-found' });
      return reply.send({ session: presentSession(updated) });
    },
  );

  app.put(
    '/sessions/:sessionId/lore',
    { schema: { params: SessionParams, body: LoreBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const body = request.body as { treatment: string | null; lore: string[] };
      const { sessionId } = request.params as { sessionId: string };
      const updated = await setLore(services.sessions, account.handle, sessionId, body);
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * Which model this session uses for a role, and for one step — [19 §5.1],
   * [P7 §1.9], [P7.3].
   *
   * **The surface §1.9 says P7 owes**, and it names the shape: *"a session-level
   * model override belongs beside the lore panel's disclosure and needs a route
   * that does not exist (`PATCH /sessions/:id` accepts only `name`)."* This is
   * that route, in the pattern the cast and lore routes already use.
   *
   * **The step layer is here too, which §1.9 routes elsewhere and 19 §5.1
   * forbids elsewhere.** That section opens with *"Nothing in a mode, step or
   * extension refers to a provider or a model id — which is what makes an
   * install portable, an extension safe to share"*, and a `Binding` names a
   * `connectionId` that exists on one install. So *a cheap model for one noisy
   * step* is an operator's decision about their own providers, and it lives
   * beside the session override it layers under rather than in a declaration
   * somebody might share.
   */
  app.put(
    '/sessions/:sessionId/roles',
    { schema: { params: SessionParams, body: RolesBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as {
        roles?: Record<string, { connectionId: string; modelId: string }>;
        stepRoles?: Record<string, { connectionId: string; modelId: string }>;
      };
      const updated = await setSessionRoles(services.sessions, account.handle, sessionId, {
        roles: body.roles ?? {},
        stepRoles: body.stepRoles ?? {},
      });
      if (updated === null) {
        return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
      }
      return reply.send({ session: presentSession(updated) });
    },
  );

  /**
   * A person writes one channel — [06 §4.2]'s recovery, [P7.1].
   *
   * **One route for all three offered recoveries**, which is why it takes a
   * value rather than naming an action. 06 §4.2 offers *"retry the migration
   * once the author ships a fix, edit the quarantined value by hand, or accept
   * the reset"*: retry sends the quarantined raw value back, edit sends whatever
   * the person typed, and accept sends the value already standing — which clears
   * the marker, because a `degraded` state is only ever written by an effect
   * that carries a reason.
   *
   * **The key, not the channel id**, because a scoped channel has one value per
   * key and a route addressing the id could only ever recover the unscoped one.
   * It is URL-encoded like every other id in this file.
   *
   * **Refusals come back as 200 with the effect**, not as an error status. A
   * retry that still does not fit is a *recorded refusal* — the whole point of
   * routing this through `acceptEffect` — and a 4xx would throw away the record
   * the workbench is supposed to show. The client reads `effect.applied`.
   */
  app.put(
    '/sessions/:sessionId/channels/:key',
    { schema: { params: ChannelParams, body: ChannelBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const { sessionId, key } = request.params as { sessionId: string; key: string };
      const { value } = request.body as { value: unknown };

      /**
       * ***Not a channel another mode declared*** — [06 §4.1], [P7.9].
       *
       * The registry is process-wide, so once a second mode declares a channel
       * this route would accept a write to it on **any** session — a Scene
       * session acquiring a `se.difficulty` nothing reads, which then sits in
       * `session.json` and in the effect log looking like state. `channelInPlay`
       * is the `owner` rule: a channel owned by a *mode* belongs to a session
       * playing it, and one owned by a *package* — cast, hooks, goals, lore —
       * is available everywhere, which is why those were registered outside a
       * mode to begin with.
       *
       * **A 404 rather than a 422**, and it is the same answer an unregistered
       * id gets: from this session's point of view there is no such channel, and
       * saying *that exists but not for you* would leak which modes the build
       * ships from a session route.
       */
      const { channelId } = splitChannelKey(key);
      if (!channelInPlay(channelId, session.mode?.id ?? DEFAULT_MODE_ID)) {
        return reply
          .code(404)
          .send({ error: 'no-such-channel', message: 'This session has no such channel.' });
      }

      const outcome = await writeChannel(services.sessions, account.handle, sessionId, key, value);
      if (outcome.kind === 'no-session') {
        return reply.code(404).send({ error: 'no-session', message: 'That session is gone.' });
      }
      if (outcome.kind === 'busy') return busy(services, reply, sessionId);

      return reply.send({
        session: presentSession(outcome.session),
        effect: outcome.effect,
        health: degradedChannels(outcome.session.channels),
        hud: sessionSurfaces(outcome.session.channels, session.mode?.id ?? DEFAULT_MODE_ID),
        surfaces: modeSurfaces(outcome.session.channels, session.mode?.id ?? DEFAULT_MODE_ID),
      });
    },
  );

  app.patch(
    '/sessions/:sessionId',
    { schema: { params: SessionParams, body: SessionPatch } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const body = request.body as { archived?: boolean; name?: string };
      const { sessionId } = request.params as { sessionId: string };

      /**
       * Two fields, two writes, on purpose rather than by accident.
       *
       * `withSessionLock` is not reentrant, so these cannot be nested, and
       * combining them would mean reimplementing `setArchived`'s
       * delete-then-maybe-re-add of `archivedAt` — which has other callers and
       * is the fiddly half. The cost is two `updatedAt` bumps and two index
       * upserts for a request no caller actually makes: every client sends one
       * field or the other. Sequential is honest about what they are, which is
       * two independent facts about a session.
       */
      let session = null;
      if (body.name !== undefined) {
        session = await setName(services.sessions, account.handle, sessionId, body.name.trim());
      }
      if (body.archived !== undefined) {
        session = await setArchived(services.sessions, account.handle, sessionId, body.archived);
      }
      return reply.send({ session: presentSession(session) });
    },
  );

  /**
   * ***A memory, written by the only judge who cannot be wrong about what
   * mattered*** — [08 §2.1](../../../../docs/design/08-cross-session-memory.md),
   * [P8 §5], [P8.3]'s cut form.
   *
   * **On the session rather than on the library**, because what it takes is a
   * session's answer to *whose memory* and *from which turn*: the actor has to
   * be in this session's cast, the persona comes from it, and the turn has to be
   * on it. A library route would have had to be handed all three and trust them.
   *
   * *The refusals are outcomes rather than exceptions*, which is what lets the
   * hidden-content one carry a sentence: [P8.5]'s remainder is **a refusal with
   * a reason rather than a filter**, and a 409 with an empty body would be a
   * filter with a status code.
   */
  app.post(
    '/sessions/:sessionId/remember',
    { schema: { params: SessionParams, body: RememberBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as {
        turnId: string;
        actorId: string;
        text: string;
        keys: string[];
      };

      const outcome = await rememberThis(
        services.sessions,
        services.library,
        account.handle,
        sessionId,
        body,
      );

      switch (outcome.kind) {
        case 'captured':
          return reply.code(201).send({ bookId: outcome.bookId, entryId: outcome.entryId });
        case 'no-session':
          return reply.code(404).send({ error: 'no-session', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'not-in-cast':
          return reply.code(400).send({
            error: 'not-in-cast',
            message: 'That character is not in this session’s cast.',
          });
        case 'empty':
          return reply.code(400).send({
            error: 'empty',
            message: 'A memory needs something to say and at least one keyword to fire on.',
          });
        case 'refused':
          // 409 rather than 400: the request is well formed and the *turn* is
          // what cannot be remembered, which is a state rather than a mistake.
          return reply.code(409).send({ error: 'hidden-content', message: outcome.reason });
        case 'busy':
          return busy(services, reply, sessionId);
      }
    },
  );

  /**
   * ***Whether this session shares its memories and draws on them***, and what
   * it would read if it did — [08 §4], [08 §7], [P8.4].
   *
   * Two routes on one path: the read builds the panel (the switches, the link to
   * each book, and the account's other sessions with the same actors), and the
   * write replaces the settings whole.
   *
   * **Off the session read deliberately.** `GET /sessions/:id` is fetched on
   * every turn by every open tab, and the panel walks every session file the
   * account owns — paying for that always, to serve a drawer somebody opens
   * occasionally, is the wrong trade. See `memory/panel.ts`.
   */
  app.get(
    '/sessions/:sessionId/memory',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      const panel = await memoryPanel(
        services.sessions,
        services.library,
        account.handle,
        sessionId,
      );
      if (panel === null) {
        return reply.code(404).send({ error: 'no-session', message: 'No such session.' });
      }
      return reply.send(panel);
    },
  );

  app.put(
    '/sessions/:sessionId/memory',
    { schema: { params: SessionParams, body: MemoryBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as SessionMemoryConfig;
      const session = await setMemoryConfig(services.sessions, account.handle, sessionId, body);
      if (session === null) {
        return reply.code(404).send({ error: 'no-session', message: 'No such session.' });
      }
      return reply.send({ memory: session.memory ?? body });
    },
  );

  /**
   * ***Every rendition this session holds*** — [06 §10], [P9.2].
   *
   * **Off the session read and off the transcript read, deliberately**, which is
   * `GET /sessions/:id/memory`'s argument one route up: a rendition's state
   * changes after its turn is written, so folding it into either would make two
   * reads that are cached differently disagree about whether a picture has
   * arrived. The transcript is the story; this is what has been made of it.
   *
   * *A map keyed by id rather than a list*, because that is how the client
   * applies a live `rendition` frame — an upsert into the same map — and two
   * shapes for one thing is how a page and a socket come to disagree.
   *
   * ***And the selection rides with them*** ([06 §10.7], [P9.4]). Which sibling
   * a turn shows is a pointer on the mutable half, and the alternative — a
   * second read of the session for one field — would put the set and the choice
   * on two cache entries that expire independently: the reader would then watch
   * a picture they did not choose for as long as the stale half survived.
   * `PUT …/turns/:turnId/rendition` writes it; this is the only reader.
   */
  app.get(
    '/sessions/:sessionId/renditions',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      const all = await readRenditions(services.sessions.layout, account.handle, sessionId);
      const session = await readSession(services.sessions, account.handle, sessionId);
      return reply.send({
        renditions: [...all.values()],
        selection: session?.renditionSelection ?? {},
      });
    },
  );

  /**
   * ***The pixels*** — [P9.2], and the shape `routes/library.ts` already
   * promised this phase.
   *
   * That file's `GET /library/:kind/:id/media/:mediaId` says it in as many
   * words: *"[P9] is the next consumer — a rendition's asset needs serving the
   * same way, and `MediaSelection`'s two arms are already the one shape both go
   * through."* So: `content-type` from the record, `etag` from the bytes' own
   * digest, and the buffer. No `sendFile`, no range support, and nothing this
   * build does not already do once.
   *
   * **The record is read to serve the bytes**, rather than the path being
   * derived from the id alone. It costs one file read and buys the two headers —
   * and it is the only thing that can tell an evicted rendition (`asset: null`,
   * a **404** and a placeholder) from one that was never made.
   */
  app.get(
    '/sessions/:sessionId/renditions/:renditionId/asset',
    { schema: { params: RenditionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId, renditionId } = request.params as {
        sessionId: string;
        renditionId: string;
      };
      const rendition = await readRendition(
        services.sessions.layout,
        account.handle,
        sessionId,
        renditionId,
      );
      if (rendition?.asset == null) {
        return reply.code(404).send({ error: 'no-asset', message: 'No pixels under that id.' });
      }

      const path = assetPath(services.sessions.layout, account.handle, sessionId, rendition);
      if (path === null) {
        return reply.code(404).send({ error: 'no-asset', message: 'No pixels under that id.' });
      }
      // The filesystem check the lexical rules cannot make, at the door where a
      // path becomes I/O — `readMedia`'s rule, and this path came out of a file.
      await services.sessions.layout.assertReal(path);
      const bytes = await readFileBytes(path);
      if (bytes === null) {
        /**
         * **A record that says `ready` and a file that is gone.** Which is not a
         * bug to guard against but the state [25 E3] describes: somebody emptied
         * `assets/`, and *"deleting one leaves `asset: null` and a picture that
         * can be made again"*. A 404 is what the placeholder renders from, and
         * the recipe on the record is what the retry runs.
         */
        return reply.code(404).send({ error: 'no-asset', message: 'No pixels under that id.' });
      }

      return await reply
        .header('content-type', rendition.asset.mime)
        .header('etag', rendition.asset.digest)
        .send(Buffer.from(bytes));
    },
  );

  /**
   * ***Which rendition of a turn is shown*** — [06 §10.7], [P9.3].
   *
   * **A pointer write and nothing else.** Every sibling stays on disk with its
   * own recipe, which is §10.7's first policy — *"regeneration must never be a
   * destructive act on something the user liked"* — and switching back is
   * another write of this route.
   *
   * *Illustrations only.* Which **backdrop** is showing is channel state
   * ([06 §10.1a]), because it has to rewind and branch, and it moves through
   * `PUT /sessions/:id/channels/se.backdrop` like any other engine-computed
   * value. Two questions that read alike and have different lifetimes.
   */
  app.put(
    '/sessions/:sessionId/turns/:turnId/rendition',
    { schema: { params: TurnRenditionParams, body: SelectRenditionBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId, turnId } = request.params as { sessionId: string; turnId: string };
      const { renditionId } = request.body as { renditionId: string };

      // The rendition has to exist and has to be this turn's: a pointer to
      // somebody else's picture would render one turn's moment under another's
      // prose, which is a worse outcome than a 404.
      const rendition = await readRendition(
        services.sessions.layout,
        account.handle,
        sessionId,
        renditionId,
      );
      if (rendition?.turnId !== turnId) {
        return reply
          .code(404)
          .send({ error: 'no-rendition', message: 'No such rendition on that turn.' });
      }

      const session = await setRenditionSelection(
        services.sessions,
        account.handle,
        sessionId,
        turnId,
        renditionId,
      );
      if (session === null) {
        return reply.code(404).send({ error: 'no-session', message: 'No such session.' });
      }
      return reply.send({ selected: renditionId });
    },
  );

  /**
   * ***Make a picture of this turn, now*** — [06 §10.6], [P9.4].
   *
   * ***One route and two verbs***, because they are one act under two purposes:
   * **Illustrate** is `purpose: 'illustration'` and **Set the scene** is
   * `'background'`, and §10.6 puts them on the same page as the same gesture
   * pointed at different subjects. Two routes would be two copies of the gather,
   * the resolution and the dispatch, differing in one string.
   *
   * ***Additive, never replacing*** — [06 §10.7]. The record is named
   * `<turnId>.<next free ordinal>`, so a turn that already has a picture gains a
   * sibling rather than losing one, and *"regeneration must never be a
   * destructive act on something the user liked"* is true because the name is
   * different rather than because something checked.
   *
   * **202 rather than 200**, which is the shape the submit route already uses
   * and for the same reason: what comes back is a `pending` record, the pixels
   * arrive on the stream, and a route that waited for them would be [06 §10.2]'s
   * failure — *"a story that stalls on either is unusable"* — moved from the
   * turn to a button.
   *
   * *A refusal is a 200 with a reason*, not an error: **nothing is bound to the
   * image role** is the ordinary state of every install ([19 §5.1]), and it is
   * an answer to *can you make a picture* rather than a failed request.
   */
  app.post(
    '/sessions/:sessionId/turns/:turnId/illustrate',
    { schema: { params: TurnRenditionParams, body: IllustrateBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId, turnId } = request.params as { sessionId: string; turnId: string };
      const { purpose } = request.body as { purpose?: 'illustration' | 'background' };

      /**
       * **The client's disconnect cancels the moment call**, because a call
       * nobody is waiting for is money spent on an answer that reaches nothing.
       * It is the same judgement `performCall`'s idle timeout makes about an
       * endpoint that has stopped talking.
       *
       * *Read off the reply, through `disconnectSignal`.* This used to be
       * `request.raw.on('close')`, which on a POST has already fired by the time
       * a handler has awaited anything, so it never cancelled anything; that
       * file has the measurements.
       */
      const signal = disconnectSignal(reply);

      let made: Awaited<ReturnType<typeof illustrateTurn>>;
      try {
        made = await illustrateTurn(
          {
            sessions: services.sessions,
            accounts: services.accounts,
            providers: services.providers,
            config: services.config,
          },
          {
            handle: account.handle,
            sessionId,
            turnId,
            purpose: purpose ?? 'illustration',
            signal,
          },
        );
      } catch (error) {
        /**
         * ***The cancellation this route caused ends here, silently.*** Nobody
         * is there to read an answer, and rethrowing would reach
         * `setErrorHandler` as an *Unhandled error*: a false alarm for every tab
         * that closed, in the log a person reads when something is really
         * wrong. Returning nothing to a destroyed socket is what Fastify itself
         * does with one. Anything else, including a failure that merely
         * coincides with the client leaving, still throws.
         */
        if (error instanceof Cancelled && signal.aborted) return;
        throw error;
      }

      if ('held' in made) {
        if (made.held === 'no-turn') {
          return reply.code(404).send({ error: 'no-turn', message: 'No such turn.' });
        }
        return reply.send({ held: made.held });
      }

      // Awaited as far as the record, which the dispatch writes after claiming
      // its job (2026-09-27): a client that refetches on this answer finds it.
      // The picture itself is still never waited for.
      await services.renditions(account.handle, sessionId, [made.rendition], turnId);
      return reply.code(202).send({ rendition: made.rendition });
    },
  );

  /**
   * ***Run this recipe again*** — [25 E3], [06 §10.2], [P9.4].
   *
   * ***Gate step 15, and it is structural rather than careful.*** *"Re-create an
   * evicted rendition and **no text call is made**: the moment is replayed from
   * `prompt`, not asked for again."* There is no assembly on this path and no
   * role to resolve — the record already holds the fragments, the separator, the
   * budget and the seed — so the assertion is about a code path that **does not
   * exist** rather than about a flag somebody remembered to check.
   *
   * It is also the retry button [06 §10.2] promises: *"a failed rendition is a
   * placeholder with a retry button, never a failed turn."* Same route, because
   * they are the same act — a record with no pixels, run again.
   *
   * ***Each press is a new job with the next attempt number, and the job is
   * claimed before the record is rewritten*** — `retryRendition` in
   * `renditions/worker.ts`. A press that arrives while a try is still in flight
   * is answered by that try, and gets the record back as it stands.
   */
  app.post(
    '/sessions/:sessionId/renditions/:renditionId/retry',
    { schema: { params: RenditionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId, renditionId } = request.params as {
        sessionId: string;
        renditionId: string;
      };
      const held = await readRendition(
        services.sessions.layout,
        account.handle,
        sessionId,
        renditionId,
      );
      if (held === null) {
        return reply.code(404).send({ error: 'no-rendition', message: 'No such rendition.' });
      }

      const again = await services.retryRendition(account.handle, sessionId, held);
      // `202`, like the illustrate route one up and for the same reason: what
      // comes back is the record set to `pending`, and the pixels arrive on the
      // stream. A `200` would read as *here is your picture*.
      return reply.code(202).send({ rendition: again });
    },
  );

  app.delete(
    '/sessions/:sessionId',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      const outcome = await deleteSession(services.sessions, account.handle, sessionId);
      // A turn in flight would put `sessions/<id>/` back beside the trashed one.
      if (outcome.kind === 'busy') return busy(services, reply, sessionId);
      // Moved to the trash rather than erased ([03 §10.3]) — 204 says the session
      // is gone from here, which is what the caller asked about.
      return reply.code(204).send();
    },
  );

  app.get(
    '/sessions/:sessionId/turns',
    { schema: { params: SessionParams, querystring: TurnsQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const byId = await readTurns(services.sessions, account.handle, session.id);
      const query = request.query as { limit?: string; from?: string };
      /**
       * ***A node this session does not have is a 404 rather than an empty
       * path*** — [P11.1].
       *
       * `walkPath` answers `[]` for an id it cannot find, which is
       * indistinguishable from *a session with no turns yet* and would render
       * as a blank reading view with nothing wrong. A pasted or stale link is
       * exactly how somebody arrives here with a bad id, so it is worth the one
       * check to say which.
       */
      if (query.from !== undefined && !byId.has(query.from)) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That session has no such turn.' });
      }
      // The path from the head, oldest first — not every turn in the file. A
      // session is a tree that P2 happens to use linearly, and a transcript is
      // one walk of it ([03 §5.5]).
      const path = walkPath(byId, query.from ?? session.headTurnId);
      /**
       * Floored as well as capped.
       *
       * `?limit=0` used to return **every turn in the file**: `slice(-0)` is
       * `slice(0)`, which is the whole array. A caller asking for none got
       * everything, which is the wrong direction for a parameter whose job is
       * to bound a response.
       */
      const limit =
        query.limit === undefined ? 100 : Math.min(Math.max(Number(query.limit), 1), 1000);

      /**
       * Which nodes on this path have siblings, and what they are — [§1.2],
       * [P6.3].
       *
       * **History shows the selected path only** ([07 §6]), so the alternatives
       * are not in `turns` and must be named some other way or they are
       * unreachable — which is what [P2C §5] meant by *a storage affordance with
       * no route*, and what [18 §4.3] predicted for an imported chat: swipes
       * land correctly in the tree and cannot be seen.
       *
       * Only nodes that actually have alternatives appear. A map of every turn
       * to its lone self would be a payload that grows with the transcript and
       * says nothing, and the surface's rule is that an affordance appears where
       * there is a choice.
       */
      const children = childrenByParent(byId);
      const siblings: Record<string, string[]> = {};
      for (const turn of path.slice(-limit)) {
        const here = (children.get(turn.parentTurnId) ?? []).map((child) => child.id);
        if (here.length > 1) siblings[turn.id] = here;
      }

      return reply.send({ turns: path.slice(-limit), siblings });
    },
  );

  /**
   * One turn by id, without the transcript riding along — [P3.0]. `GET
   * /turns` costs ~10.8 KB a turn and the whole path per request; the
   * workbench wants one turn, including one the head has passed — a re-run
   * sibling, a compare target — which the path walk never serves.
   *
   * The same 404 discipline as everything here: the session resolves from
   * the account, and a turn that exists in somebody else's session is the
   * same "No such turn." as one that never existed — the lookup is scoped to
   * *this* session inside the store, so a bare turn id cannot confirm
   * existence across the boundary.
   */
  app.get(
    '/sessions/:sessionId/turns/:turnId',
    { schema: { params: TurnParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const { turnId } = request.params as { turnId: string };
      const turn = await readTurnById(services.sessions, account.handle, session.id, turnId);
      if (turn === null) {
        return reply.status(404).send({ error: 'not-found', message: 'No such turn.' });
      }
      return reply.send({ turn });
    },
  );

  /**
   * What this turn *would* assemble to — the stateless preview ([P3.4]).
   *
   * **A POST that writes nothing**, and the two halves of that are separate
   * claims. POST because the body carries up to a hundred thousand characters
   * of somebody's prose, which cannot go in a URL — and because the CSRF
   * header rides along, so a cross-site page cannot loop this into re-reading
   * every turn on disk. Writes nothing because [P3 §1.6] scoped this stage
   * that way: no job is reserved, no draft is checkpointed, no record is
   * appended, and — through `readMine` rather than `mine` — no hand edit is
   * reconciled into a divergence turn.
   *
   * `input` is optional, matching the collector's own `input?`: *nothing typed
   * yet* is the same shape on the wire as it is in `CollectContext`, and it is
   * the reading the meter shows at rest. There is no `headTurnId` in the body
   * — the preview assembles against the session's current head and echoes back
   * which one that was; a stale preview corrects itself on the next keystroke,
   * where refusing would blank the meter at the moment somebody is watching it.
   */
  app.post(
    '/sessions/:sessionId/preview',
    { schema: { params: SessionParams, body: PreviewBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await readMine(services, request, reply);
      if (!session) return;

      const body = request.body as { input?: { text: string }; guidance?: string };
      const preview = await previewAssembly(
        {
          sessions: services.sessions,
          accounts: services.accounts,
          providers: services.providers,
          config: services.config,
        },
        {
          account: account.handle,
          sessionId: session.id,
          parentTurnId: session.headTurnId ?? null,
          ...(body.input === undefined ? {} : { input: body.input }),
          ...(body.guidance === undefined ? {} : { guidance: body.guidance }),
        },
      );

      return reply.send({ preview });
    },
  );

  /**
   * ***A session, whole, for another install*** — [25 B12], [10 §12.3],
   * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **`GET`, because it reads and changes nothing** — which is the opposite of
   * the route below it and for the opposite reason: this costs a few file reads
   * and is the one thing on this surface a person might reasonably want to
   * bookmark or `curl`.
   *
   * ***A file rather than a payload.*** `content-disposition` names it after the
   * session, because the thing somebody does with an export is put it somewhere
   * — and a browser that rendered it as JSON in a tab would have made them
   * copy it out by hand.
   */
  /**
   * ***And back in*** — [18 §3](../../../../docs/design/18-session-import.md),
   * [25 B12](../../../../docs/design/25-open-questions.md),
   * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10.
   *
   * The gate's row 10 is *"a session exported from this install **loads on
   * another one**, siblings and all"*, and a format with no reader makes that
   * sentence unwalkable rather than merely unwalked. This is the reader.
   *
   * **A body rather than an upload**, unlike the library's import: a session
   * export is one JSON document, the client already has it as a file, and a
   * multipart route would buy the ability to stream a document that is
   * megabytes at worst. *The size limit is the body parser's, which is the
   * limit every other route on this server already has.*
   *
   * ***It always makes a new session.*** [07 §3] makes a session a tree keyed
   * by parent, and merging two trees would mean deciding what a turn with an
   * unknown parent is — a question nobody has asked and whose every answer
   * loses something.
   */
  app.post('/sessions/import', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const result = await importSession(
      { sessions: services.sessions },
      account.handle,
      request.body,
    );
    if (!result.ok) {
      // A class, for the client to word — [21 §1.4], as everywhere else. A
      // session already here is a conflict with what is here rather than a
      // fault in the file.
      return reply
        .code(result.reason === 'already-here' ? 409 : 422)
        .send({ error: result.reason });
    }
    return reply.code(201).send(result);
  });

  app.get(
    '/sessions/:sessionId/export',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await readMine(services, request, reply);
      if (!session) return;

      const exported = await exportSession(
        { sessions: services.sessions, build: services.build },
        account.handle,
        session.id,
      );
      if (exported === null) {
        return reply.code(404).send({ error: 'not-found', message: 'That session is not there.' });
      }

      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileNameFor(session.name)}"`)
        .send(exported);
    },
  );

  /**
   * ***A draft of your own next message*** —
   * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
   * [P11.4](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **`POST` for a call and `GET` for nothing**, which reads oddly for something
   * that commits no state and is right: this dispatches a model call, which
   * costs money and time and must not be replayable by a browser deciding to
   * prefetch a link.
   *
   * ***Not refused while a turn is in flight***, which is the one thing this
   * route does differently from its neighbours and is deliberate. A submission
   * is refused mid-turn because two turns on one session is the state [P2 §2.10]
   * exists to prevent; a draft commits nothing, moves no head and can be thrown
   * away — and the moment somebody most wants one is while they are reading what
   * just arrived. *What it shares with them* is the per-session read and the
   * ownership check, because a draft in somebody else's story is somebody else's
   * prose.
   */
  app.post(
    '/sessions/:sessionId/impersonate',
    { schema: { params: SessionParams, body: ImpersonateBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await readMine(services, request, reply);
      if (!session) return;

      const body = request.body as { actorId?: string };

      /**
       * ***A draft nobody is waiting for is a draft nobody wants***, so the
       * client leaving is what cancels one. The signal comes from
       * `disconnectSignal`, for the reason the illustrate route gives.
       *
       * ***And no timeout here, on purpose.*** `limits.providerTimeoutMs` is
       * enforced inside `performCall`, per attempt, by `withIdleTimeout`, which
       * bounds **silence rather than duration** and reads `<= 0` as *switched
       * off*. Both are [21 §4]'s row and [P2C §1.3]'s semantics, and a draft
       * goes through that helper like every other call. This route used to add
       * its own copy as `AbortSignal.timeout(providerTimeoutMs)`, which broke
       * both halves of that row. It was a wall-clock ceiling on top of the idle
       * one, and when it fired it reported a hang as a cancellation rather than
       * a stall. At zero it was `AbortSignal.timeout(0)`, which aborts on the
       * next tick, so every draft failed for exactly the operators who had
       * switched the bound off because their endpoint is slow.
       */
      const signal = disconnectSignal(reply);

      const drafted = await impersonate(
        {
          sessions: services.sessions,
          accounts: services.accounts,
          providers: services.providers,
          config: services.config,
          // Read at failure time, since a completed check replaces it wholesale.
          online: () => services.updates.online,
        },
        {
          account: account.handle,
          sessionId: session.id,
          parentTurnId: session.headTurnId ?? null,
          ...(body.actorId === undefined ? {} : { actorId: body.actorId }),
          signal,
        },
      );

      if (!drafted.ok && drafted.reason === 'cancelled') {
        // Nobody is left to answer when this route's own signal did it, as in
        // the illustrate route. Anything else that stops a draft is the server
        // stopping, and the person waiting is told so.
        if (signal.aborted) return;
        return reply.code(503).send({
          error: 'cancelled',
          message: 'The server stopped before the draft was written.',
        });
      }

      if (!drafted.ok && drafted.reason === 'provider-failed') {
        /**
         * ***The class and the remedy, and never the prompt*** (2026-09-27).
         * One line with the fields a reader filters on, which is the runner's
         * `step.failed` shape, and a `502` because the server did its part and
         * the endpoint behind it did not. The client words the remedy with the
         * sentences a failed turn uses.
         */
        request.log.error(
          {
            event: 'impersonate.failed',
            sessionId: session.id,
            class: drafted.class,
            callId: drafted.callId,
            ...(drafted.detail === undefined ? {} : { detail: drafted.detail }),
          },
          'A draft could not be written',
        );
        return reply.code(502).send({
          error: 'provider-failed',
          class: drafted.class,
          remedy: drafted.remedy,
          message: 'The model endpoint could not write that draft.',
        });
      }

      if (!drafted.ok) {
        /**
         * **A class, and the client has the sentences.** The reasons point at
         * different places: a mode with no prose step is a mode that cannot do
         * this at all, a non-player member is the design's own line ([06 §8]'s
         * *"the difference between a party member and a second player"*), the
         * two role failures are the bindings surface, and a window too small
         * for the reply is the connection's or the pack's setting.
         */
        return reply.code(drafted.reason === 'not-a-player' ? 409 : 422).send({
          error: drafted.reason,
          message: 'That character’s next message could not be drafted.',
        });
      }
      return reply.send({ text: drafted.text });
    },
  );

  /**
   * Where you are in the tree — [07 §3], [P6.1].
   *
   * **Moving the head moves no turn data.** It re-derives the channel state at
   * the node ([P6.0b], through [P6.0d]'s cache) and records the path it
   * selected, so navigating back and forward again resumes rather than guesses.
   * `resume` is that forward gesture: from the node named, follow what was last
   * selected — or the only child, where there is nothing to choose between —
   * and stop at a fork nobody has been through.
   *
   * **Refused while a turn is in flight**, with the job, for the reason [P2
   * §2.10] gives about submissions: the running turn is going to set the head
   * when it commits, and a move that raced it would either be silently
   * overwritten or overwrite the turn's own parentage. One turn advances a
   * session at a time, and this is the same rule seen from the other side.
   */
  app.put(
    '/sessions/:sessionId/head',
    { schema: { params: SessionParams, body: HeadBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { turnId: string; resume?: boolean };

      // No account filter, matching `submitTurn`'s own busy check: a session
      // belongs to the directory it is in, so the job on it is this account's.
      const active = activeJob(services.state.db, sessionId);
      if (active !== null) {
        return reply.code(409).send({
          error: 'busy',
          message: 'This session already has a turn in flight.',
          job: active,
        });
      }

      const outcome = await moveHead(services.sessions, account.handle, sessionId, body.turnId, {
        ...(body.resume === undefined ? {} : { resume: body.resume }),
      });

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'moved':
          // With what the line being left still has out in the world — [07 §7]'s
          // honesty banner. Zero until something writes an escaped effect, and
          // the field is here so the first producer has somewhere to surface.
          return reply.send({
            session: presentSession(outcome.session),
            abandoned: outcome.abandoned,
          });
        case 'busy':
          return busy(services, reply, sessionId);
      }
    },
  );

  /**
   * Naming a node, renaming the name, and forgetting it — [07 §6]'s *promote*,
   * [P6.1].
   *
   * Three routes over one array in `session.json`, because that is all a
   * `BranchRef` is: an id, a name, and the node it bookmarks. None of them
   * reads or writes a turn, and the delete deletes a name — which is worth
   * saying in the routing layer as well as in the store, since *delete branch*
   * is a phrase that sounds like it removes a story.
   */

  /**
   * Undo — apply an effect's `before`, or refuse and offer the branch —
   * [§1.4], [21 §1.2.1], [P6.3].
   *
   * The refusal is the feature. `before` is an inverse only while nothing has
   * touched the same key since; applying it otherwise destroys the later change
   * and produces a state no turn ever wrote, plausibly enough that nothing
   * surfaces. So a turn that is no longer the tip for its keys is refused with
   * the keys that block it and the node to branch from instead — which is the
   * thing this phase spent four stages making cheap.
   */
  app.post(
    '/sessions/:sessionId/turns/:turnId/undo',
    { schema: { params: TurnParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, turnId } = request.params as { sessionId: string; turnId: string };

      // The same rule a head move follows: a running turn is about to write
      // state and move the head, and an undo racing it would be inverting
      // against a tip that is moving underneath.
      const active = activeJob(services.state.db, sessionId);
      if (active !== null) {
        return reply.code(409).send({
          error: 'busy',
          message: 'This session already has a turn in flight.',
          job: active,
        });
      }

      const outcome = await undoTurn(services.sessions, account.handle, sessionId, turnId);

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'off-path':
          return reply.code(409).send({
            error: 'off-path',
            message: 'That turn is not on the line this session is on.',
          });
        case 'nothing-to-undo':
          return reply
            .code(409)
            .send({ error: 'nothing-to-undo', message: 'That turn changed no channel state.' });
        case 'not-at-tip':
          // With what blocks it and where to branch from, because a bare "no"
          // leaves a UI able to offer only *try again*.
          return reply.code(409).send({
            error: 'not-at-tip',
            message: 'Something has written those channels since. Branch instead.',
            keys: outcome.keys,
            branchFrom: outcome.branchFrom,
          });
        case 'busy':
          return busy(services, reply, sessionId);
        case 'undone':
          return reply.send({ session: presentSession(outcome.session), turn: outcome.turn });
      }
    },
  );
  app.post(
    '/sessions/:sessionId/refs',
    { schema: { params: SessionParams, body: RefBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { name: string; turnId: string };
      const outcome = await createBranchRef(
        services.sessions,
        account.handle,
        sessionId,
        body.name,
        body.turnId,
      );
      return refReply(reply, outcome);
    },
  );

  app.patch(
    '/sessions/:sessionId/refs/:refId',
    { schema: { params: RefParams, body: RefNameBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, refId } = request.params as { sessionId: string; refId: string };
      const body = request.body as { name: string };
      const outcome = await renameBranchRef(
        services.sessions,
        account.handle,
        sessionId,
        refId,
        body.name,
      );
      return refReply(reply, outcome);
    },
  );

  app.delete(
    '/sessions/:sessionId/refs/:refId',
    { schema: { params: RefParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, refId } = request.params as { sessionId: string; refId: string };
      const outcome = await deleteBranchRef(services.sessions, account.handle, sessionId, refId);
      return refReply(reply, outcome);
    },
  );

  app.post(
    '/sessions/:sessionId/turns',
    { schema: { params: SessionParams, body: SubmitBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      /**
       * ***[09 §6.4]'s *"refuse new turns"*, and this is the only door it has
       * to be refused at*** — [P10.3]. A restart drains by waiting for the
       * turns in flight, which is pointless if one can be started while it
       * waits: the drain would never end, or it would end by aborting a turn
       * that began **after** somebody pressed the button.
       *
       * **503 with `retry-after`**, which is the honest pair: the server is
       * temporarily unable and will be back — that is the whole premise of a
       * supervised restart — and a client that reconnects is doing the right
       * thing rather than retrying into a wall.
       */
      if (services.draining) {
        return await reply.code(503).header('retry-after', '10').send({
          error: 'restarting',
          message: 'This server is restarting. Your next turn will go through once it is back.',
        });
      }

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as {
        idempotencyKey: string;
        headTurnId: string | null;
        parentTurnId?: string | null;
        rewriteOf?: string;
        redoOf?: string;
        input: { text: string; actorId?: string | null; kind?: string };
        guidance?: string;
      };

      /**
       * The tape a rewrite replays, read from the record — [P6.2].
       *
       * Read here rather than in the runner because this is where the request
       * is still a request: a turn id that names nothing in this session is a
       * refusal, and the runner's job starts after that question is settled.
       */
      let replay: Tape | undefined;
      if (body.rewriteOf !== undefined) {
        const rewritten = await readTurnById(
          services.sessions,
          account.handle,
          sessionId,
          body.rewriteOf,
        );
        if (rewritten === null) {
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session to rewrite.' });
        }
        replay = rewritten.tape;
      }

      /**
       * The attempt a guided redo shows the model, read from the record for
       * the same reason — [06 §5.1], [07 §7]. A guided rewrite names one turn
       * twice, once for its draws and once for its words, and the second read
       * is an index hit; sharing the first would save less than it costs in
       * hoisting.
       *
       * **Not required to be a sibling, and that is a decision.** `rewriteOf`
       * asks nothing beyond *in this session* either; the client sends
       * `redoOf: turn.id` beside `parentTurnId: turn.parentTurnId`, so the
       * attempt is a sibling by construction; and the record carries the id,
       * so a third-party client's odder choice is visible in the block table
       * rather than refused at the door. A check would also need the head for
       * a submission that left `parentTurnId` out, which is a session read
       * `submitTurn` is about to make under the lock.
       *
       * A failed attempt may have no output. Its text is then empty, the
       * shipped slot omits it, the guidance still travels, and the record's
       * `notFilled` says the slot was empty — which is the truth.
       */
      let attempt: { turnId: string; text: string } | undefined;
      if (body.redoOf !== undefined) {
        const previous = await readTurnById(
          services.sessions,
          account.handle,
          sessionId,
          body.redoOf,
        );
        if (previous === null) {
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session to redo.' });
        }
        attempt = { turnId: previous.id, text: previous.output?.text ?? '' };
      }

      /**
       * ***The input kind, checked against what the mode declares*** — [06 §1],
       * [06 §9], [P7.9].
       *
       * `ModeDefinition.inputs` has documented five kinds since P2 and been read
       * by one line of `presentMode`: **nothing validated a submission against
       * it**, so a client could send `kind: 'sing'` and the record would carry
       * it forever. [06 §9]'s list of what an extension mode must be able to do
       * includes *"define its own input kinds"*, and a declaration nothing
       * enforces is not a definition of anything.
       *
       * **A 422 rather than a silent coercion to `do`.** The kinds change what
       * the prompt says ([13 §8.3]'s per-kind block), so quietly narrating a
       * `think` as a `do` would put the player's private thought in the scene —
       * which is the one failure the kind exists to prevent. [00 §3.3]'s
       * visible-refusal posture, at the door where the request is still a
       * request.
       *
       * *One session read on the submit path*, which the poll path already makes
       * and `submitTurn` is about to make again under its lock. The alternative
       * was a new outcome arm through the job layer for a check that is about
       * the **request** rather than about scheduling.
       */
      const kind = body.input.kind;
      if (kind !== undefined) {
        const submitting = await readSession(services.sessions, account.handle, sessionId);
        const accepted = modeById(submitting?.mode?.id ?? DEFAULT_MODE_ID)?.definition.inputs;
        if (submitting !== null && accepted !== undefined && !accepted.includes(kind)) {
          return reply.code(422).send({
            error: 'unknown-input-kind',
            message: `This mode does not accept ${kind} input.`,
            accepted,
          });
        }
      }

      const outcome = await submitTurn(services.jobs, {
        account: account.handle,
        sessionId,
        idempotencyKey: body.idempotencyKey,
        headTurnId: body.headTurnId,
        // Spread rather than passed, because *absent* and *null* are different
        // requests here — see `SubmitRequest.parentTurnId`.
        ...('parentTurnId' in body ? { parentTurnId: body.parentTurnId } : {}),
      });

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });

        case 'busy':
          // The job travels with the refusal: a UI handed a bare "no" can only
          // offer "try again", which produces the same "no".
          return reply.code(409).send({
            error: 'busy',
            message: 'This session already has a turn in flight.',
            job: outcome.job,
          });

        case 'stale':
          /**
           * With the head it should have used, so a client can rebase rather
           * than reload everything.
           *
           * **Still a refusal after [P6.0c], and that is the decision rather
           * than a leftover.** A client whose head moved under it can now do
           * one of two things with this answer, where before it could only
           * rebase: resubmit against `head`, or resubmit naming
           * `parentTurnId` and keep the line it was composing on. The refusal
           * is what makes the second one a choice somebody made instead of a
           * branch the server invented — [P6 §1.7].
           */
          return reply.code(412).send({
            error: 'stale-head',
            message: 'The session has moved on since this was composed.',
            head: outcome.head,
          });

        case 'no-parent':
          // A named branch point that is not a turn of this session. A 404
          // rather than a 422: the request is well formed and names something
          // that is not there, which is the same answer `GET /turns/:turnId`
          // gives for the same id.
          return reply.code(404).send({
            error: 'no-such-parent',
            message: 'No such turn in this session to branch from.',
          });

        case 'existing': {
          /**
           * A retry. **Branching on the job's status, not on the outcome kind**
           * — `existing` is returned for a running or committed job too, and
           * restarting one of those would make a second provider call for a turn
           * that already happened.
           */
          if (outcome.job.status === 'queued') {
            services.runner.start(outcome.job, payloadOf(body, { replay, attempt }));
          }
          return reply.send(accepted(outcome.job, sessionId));
        }

        case 'created':
          services.runner.start(outcome.job, payloadOf(body, { replay, attempt }));
          // 202: the work is accepted, not done. The stream is where it happens.
          return reply.code(202).send(accepted(outcome.job, sessionId));
      }
    },
  );

  app.post(
    '/sessions/:sessionId/jobs/:jobId/cancel',
    { schema: { params: JobParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { jobId } = request.params as { jobId: string };
      const job = readJob(services.state.db, jobId);
      // `readJob` applies no owner filter and a job id in a URL is user input.
      if (job?.account !== account.handle) {
        return reply.code(404).send({ error: 'not-found', message: 'No such job.' });
      }
      if (job.finishedAt !== null) {
        return reply.code(409).send({ error: 'finished', message: 'That turn is already over.' });
      }

      services.runner.cancel(jobId);
      return reply.code(202).send({ jobId });
    },
  );

  /**
   * The session stream.
   *
   * **Everything that can produce a JSON reply happens before `writeHead`.**
   * Both framework defaults are wrong here and both were measured: *with*
   * `hijack()` a throw after the head is silently swallowed — status stays 200,
   * the stream stays open, and no log line is written, because the error handler
   * never runs. *Without* it, the same throw reaches `setErrorHandler`, which
   * sends unconditionally, Fastify calls `writeHead` a second time, and
   * `ERR_HTTP_HEADERS_SENT` kills the process.
   *
   * So: authenticate, check ownership, and only then take the socket.
   *
   * A `GET` carries no CSRF requirement (`isStateChanging` excludes it) and
   * authenticates by cookie — which is exactly what `EventSource` needs, since
   * it can send cookies and cannot set headers. **Nothing may later add a header
   * requirement to this route.**
   */
  app.get(
    '/sessions/:sessionId/stream',
    { schema: { params: SessionParams, querystring: StreamQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const query = request.query as { after?: string };
      const cursor = parseCursor(query.after ?? headerCursor(request));

      reply.hijack();

      /**
       * ***This is where *viewing* is answered from*** — [09 §3.1],
       * [P10 §1.3], [P10.1].
       *
       * A socket open on this session is the strongest presence signal 1.0 has,
       * and it is knowable only here: the session **store** could report *this
       * person read this session*, which is a different fact and is true of a
       * background poll. Held for exactly as long as the stream is, so the
       * routing rule — *if you are looking at the session, you are not told
       * about it* — is measured against something that closes when the tab does.
       */
      const watching = services.notifications.viewing(account.handle, session.id);

      const writer = new SseWriter(reply.raw, {
        keepaliveMs: services.config.sessions.streamKeepaliveMs,
        onClose: () => {
          watching();
          attachment?.detach();
          services.streams.delete(release);
        },
      });

      let attachment: { detach: () => void } | null = null;
      const release = (): void => {
        writer.close();
      };
      // Registered so closing the app can end it, in `preClose`, before the
      // listener waits for open responses: a stream never finishes on its own.
      // See `AppServices.streams`.
      services.streams.add(release);

      request.raw.on('close', release);
      reply.raw.on('error', release);

      try {
        attachment = attachToSession(
          { ...services.jobs, bus: services.bus },
          session.id,
          account.handle,
          cursor,
          (frame) => {
            writer.send(frame);
          },
        );
      } catch (error) {
        /**
         * Logged deliberately, because nothing else will: the error handler is
         * unreachable once the head is written.
         *
         * **With the session id**, which it did not carry — on the play
         * surface's own path, where the session id is the one thing a person
         * reporting a broken stream actually has.
         */
        request.log.error(
          { event: 'stream.failed', sessionId: session.id, err: error },
          'Could not open a stream',
        );
        writer.fail('internal');
      }
    },
  );
}

function payloadOf(
  body: {
    input: { text: string; actorId?: string | null; kind?: string };
    guidance?: string;
  },
  /**
   * What the route read off the record on the submission's behalf — the tape
   * a rewrite replays and the attempt a guided redo shows. An object rather
   * than two optional positionals, because `payloadOf(body, undefined,
   * attempt)` is the call somebody would eventually write.
   */
  fromRecord: {
    replay?: Tape | undefined;
    attempt?: { turnId: string; text: string } | undefined;
  },
): {
  input: { actorId: string | null; kind: string; text: string; raw: string };
  guidance?: string;
  attempt?: { turnId: string; text: string };
  replay?: Tape;
} {
  return {
    input: {
      actorId: body.input.actorId ?? null,
      kind: body.input.kind ?? 'do',
      text: body.input.text,
      // What the player typed, before anything normalised it. Kept because a
      // rewrite replays the original rather than the interpretation.
      raw: body.input.text,
    },
    ...(body.guidance === undefined ? {} : { guidance: body.guidance }),
    ...(fromRecord.attempt === undefined ? {} : { attempt: fromRecord.attempt }),
    ...(fromRecord.replay === undefined ? {} : { replay: fromRecord.replay }),
  };
}

function accepted(
  job: { id: string; turnId: string; parentTurnId: string | null; status: string },
  sessionId: string,
): Record<string, unknown> {
  const cursor = formatCursor({ jobId: job.id, seq: 0 });
  return {
    jobId: job.id,
    turnId: job.turnId,
    parentTurnId: job.parentTurnId,
    status: job.status,
    cursor,
    stream: `/api/sessions/${sessionId}/stream?after=${cursor}`,
  };
}

/** A browser's automatic reconnect header. Same cursor, a different door. */
function headerCursor(request: FastifyRequest): string | undefined {
  const header = request.headers['last-event-id'];
  return Array.isArray(header) ? header[0] : header;
}

/**
 * The session, if it is this account's — and a 404 if it is not there *or* not
 * theirs.
 *
 * One helper rather than the check repeated in seven handlers, which is how one
 * of them ends up without it.
 */
/**
 * The session, if it is this account's — **without `mine()`'s reconciliation**.
 *
 * For the one route that must not write: the preview ([P3.4]). `mine()`
 * reconciles hand edits, which takes the non-reentrant session lock and, when
 * the file has diverged, **appends a user-authored divergence turn**. Both are
 * correct for a read somebody performed once by opening a session, and wrong
 * for one that fires every time a person pauses typing: it would contend the
 * lock `finaliseTurn` needs, and it would make looking at a meter move the
 * head the meter is measuring against.
 *
 * Skipping reconciliation is consistent rather than a hole — `POST /turns`
 * does not reconcile either, and the door for it is the session read the play
 * surface already performs on arrival.
 */
async function readMine(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof readSession>>> {
  const { sessionId } = request.params as { sessionId: string };
  const handle = request.account?.handle ?? '';

  const session = await readSession(services.sessions, handle, sessionId);
  if (session === null) {
    await reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    return null;
  }
  return session;
}

/**
 * The same check, plus the reconciliation — the door every *other* session
 * route goes through. See {@link readMine} for the one that may not take it.
 */
async function mine(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof readSession>>> {
  const { sessionId } = request.params as { sessionId: string };
  const handle = request.account?.handle ?? '';

  /**
   * **Reconciled before it is answered** — [03 §8.1].
   *
   * The section says the engine compares the file's channel state against the
   * state replayed at head *on load*, and turns any divergence into a
   * user-authored effect. Until this call existed, `reconcileHandEdits` was
   * exported, unit-tested, and reached by nothing — so a hand edit was silently
   * absorbed into the head snapshot on the next turn and never entered the
   * effect log, which is the failure §8.1 exists to prevent.
   *
   * Here rather than inside `readSession`: the reconciler takes the session
   * lock, which is not reentrant, and `readSession` is called from inside that
   * lock in several places. This is the outermost read, and it holds nothing.
   */
  const reconciled = await reconcileHandEdits(services.sessions, handle, sessionId);
  if (reconciled.length > 0) {
    request.log.info(
      { event: 'session.diverged', sessionId, effects: reconciled.length },
      'A hand edit landed as a user-attributed effect',
    );
  }

  const session = await readSession(services.sessions, handle, sessionId);
  if (session === null) {
    await reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    return null;
  }
  return session;
}

/**
 * ***The one answer for a write refused because a turn is in flight*** —
 * `409 busy`, with the job, which is what head moves and undo have always
 * sent (2026-09-27). The store decides, under the session's lock; this reads
 * the job again only to say which one it was, and it may have finished by
 * then, which is why `job` can be null.
 */
function busy(services: AppServices, reply: FastifyReply, sessionId: string): FastifyReply {
  return reply.code(409).send({
    error: 'busy',
    message: 'This session already has a turn in flight.',
    job: activeJob(services.state.db, sessionId),
  });
}

/**
 * The wizard's answers a Setup carries, if it carries any.
 *
 * `Setup.mode.config` is `unknown` because [04 §7] keeps it *"stored verbatim,
 * never interpreted by the host"* — so a Setup written against a different
 * build, or hand-edited, can hold anything. Narrowed here rather than trusted:
 * what reaches the session is validated against the mode's declaration like any
 * other answers, and a `config` that is not an object is not answers at all.
 */
function asAnswers(setup: Setup | undefined): Record<string, unknown> | undefined {
  const config = setup?.mode.config;
  return typeof config === 'object' && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : undefined;
}

/**
 * A plain object, for the two authored values the pacing dial layers over.
 *
 * Both reach here as `unknown`: a Setup is stored on the session record and a
 * treatment comes back from a resolver that never throws, so a hand-edited file
 * puts a string or a number in either. `readPacing` validates the level itself;
 * this is only what makes the property access legal.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The account's other sessions played under the same treatment — [08 §6], [P8.5].
 *
 * **Files rather than an index query**, for `memory/panel.ts`'s reason: the
 * index's session row carries a name and a head and no treatment, and adding one
 * would be a schema change made to serve one warning — the direction
 * [03 §5.1]'s *the index is never the only home for a fact* says not to solve
 * this from.
 *
 * *Archived sessions count.* An archived session is fully intact ([03 §10.3])
 * and its memories are in the books either way, so hiding it here would hide
 * exactly the replay somebody is most likely to have forgotten about.
 */
async function sessionsInTreatment(
  services: AppServices,
  handle: string,
  exceptSessionId: string,
  treatment: string,
): Promise<{ sessionId: string; name: string }[]> {
  const found: { sessionId: string; name: string }[] = [];
  for (const row of listSessionRows(services.sessions.index, [ownerKey(userOwner(handle))], {
    includeArchived: true,
  })) {
    if (row.sessionId === exceptSessionId) continue;
    const other = await readSession(services.sessions, handle, row.sessionId);
    if (other?.treatment === treatment) found.push({ sessionId: row.sessionId, name: row.name });
  }
  return found;
}

/**
 * A filename a person can find again — [P11.10].
 *
 * ***ASCII and nothing else***, which is a fact about `content-disposition`
 * rather than about names: the header is latin-1 by specification, and a
 * session called *Дождливый город* would arrive as mojibake or as a header
 * some proxy refuses. The date makes two exports of one session distinguishable
 * in a downloads folder, which is where they land.
 */
function fileNameFor(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const day = new Date().toISOString().slice(0, 10);
  return `${slug === '' ? 'session' : slug}-${day}.session.json`;
}
