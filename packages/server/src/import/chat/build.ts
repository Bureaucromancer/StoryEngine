// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  outputFromMessages,
  SESSION_EXPORT_SCHEMA,
  type BranchRef,
  type ChannelEffect,
  type ImportNote,
  type OutputMessage,
  type Ref,
  type Turn,
} from '@storyengine/shared';

import { PRESENCE_CHANNEL, SE_PRESENCE } from '../../sessions/cast.js';
import { SPEAKER_DEFAULTS } from '../../sessions/chat-settings.js';
import { applyEffects } from '../../sessions/store.js';
import type { SessionFile } from '../../sessions/types.js';
import {
  effectKey,
  nodeKey,
  placeTime,
  readableTime,
  refKey,
  sessionKey,
  uuidv7Shaped,
  type NodeContent,
} from './ids.js';
import { roundsOf, type Round } from './rounds.js';
import type {
  BuildContext,
  ChatBuild,
  ChatFamily,
  ChatMessage,
  ChatResolution,
  ChatSettings,
  ChatSourceChat,
  ForeignRef,
  ResolvedRef,
} from './types.js';

/**
 * ***The chat tree builder*** —
 * [P13.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md):
 * one family of foreign chats in, one `SessionExport` out, and nothing touched
 * on the way.
 *
 * **Every path into a session ends in `importSession`** ([P13 §2.1]): a folder
 * sweep, a zip, a Marinara profile, one uploaded `.jsonl`. That reader already
 * mints the session id, stamps `origin`, marks turns foreign, refuses a
 * collision and indexes, and the backup import is the precedent for handing it
 * a document somebody else assembled (`backup/import.ts:305`). So an importer
 * does not write sessions; it writes the file another install would have
 * exported, and the one reader loads it. *A second writer would be a second
 * opinion about what a valid session is*, and the first place it disagreed with
 * the export round-trip would be a session that opens here and nowhere else.
 *
 * ***Pure, and that is a property of the signature rather than a promise.***
 * No I/O, no library, no clock, no randomness: the chats, what the library
 * knows about them ([P13 §2.5]'s resolution, P13.8's work), the account and the
 * time all arrive as arguments. That is what lets [P13.6]'s proof obligation be
 * a property test over generated families rather than a handful of fixtures —
 * hand-written fixtures are linear, and the bugs are in the forks.
 *
 * The build, in the order [P13 §2] decides it:
 *
 * 1. **Rounds** ([P13 §2.2], `rounds.ts`): each chat's lines grouped into turns.
 * 2. **Swipes** ([P13 §2.3]): each alternative a sibling from the message it
 *    belongs to.
 * 3. **Identity** ([P13 §2.4], `ids.ts`): every node keyed by its content and
 *    its parent's key, so the family's chats collapse onto one tree.
 * 4. **Refs and resolution** ([P13 §2.5]): a ref per chat, the head on the
 *    root chat's, speakers named by the library where it knows them.
 * 5. **Settings** ([P13 §2.6]): the Scene chat fields, from the source where it
 *    said and from Scene's chat defaults where it did not — and the one setting
 *    that is state rather than a field, a group's muted members, as effects on
 *    the opening turns with the head cache to match ({@link mutedEffects}).
 */

/**
 * ***Scene, as a chat*** — the three fields [P13 §1.2] declares, as an import
 * writes them when the source says nothing.
 *
 * **Written explicitly, never left absent**, and the reason is
 * `chatSettingsOf`'s rule 2: a Scene session carrying none of `voice`,
 * `dispatch` and `speakers` is read as one written before P13.0, and plays as
 * the mode's `legacy` — narrator, merged, fixed. An imported chat was played
 * in the characters' own voices, one reply each, and [P13]'s revision exists so
 * that it lands in a mode that plays the way the chat did. Absent would quietly
 * re-voice every import as a narrated story.
 *
 * *Scene's P13 values rather than whatever the mode declares today*: this
 * module cannot read the mode (the SDK boundary puts `packages/modes/scene` out
 * of the server's reach), and a chat's settings should not change meaning on
 * the day the mode's declared values move, which [P13 §1.2] says they do. In a
 * single-character chat `per-actor` and `merged` are the same one call.
 */
const SCENE_CHAT = {
  voice: 'embodied',
  dispatch: 'per-actor',
  policy: 'natural',
} as const satisfies {
  voice: NonNullable<SessionFile['voice']>;
  dispatch: NonNullable<SessionFile['dispatch']>;
  policy: NonNullable<SessionFile['speakers']>['policy'];
};

/**
 * The most actors a cast may name — [P13 §1.2]'s *"`participants.maxActors`
 * rises to 32, the cast route's own ceiling"* (`CastBody.actors.maxItems`). A
 * bound on a request body rather than a claim about groups, and so a bound on
 * what an import may write into the same field.
 */
const CAST_CEILING = 32;

/** One message of a node, before resolution has named its speaker. */
interface Line {
  speaker: ForeignRef | null;
  text: string;
  reasoning?: string;
  carried: boolean;
  hidden: boolean;
  /** The source line this is, for counting what was hidden once per line. */
  line: string;
}

/** One turn-to-be: a key, where it hangs, when, and what it says. */
interface Node {
  key: string;
  parentKey: string | null;
  time: number;
  /**
   * `input` and `lines` are replaced, never mutated, when another chat of the
   * family hides one of them (see `place`): a round and its swipes' siblings
   * share the objects they were built from, and each is merged on its own.
   */
  input: { text: string; hidden: boolean; line: string } | null;
  lines: Line[];
  /** `Turn.foreign.id` — see {@link foreignIdOf}. */
  foreignId: string;
}

/** What the walk over one chat leaves behind: its active path, root first. */
interface Walked {
  chat: ChatSourceChat;
  keys: string[];
}

/**
 * Builds one session document from one family of chats.
 *
 * `settings` is the source's say about how the chat is played ([P13 §2.6]);
 * without it the session gets Scene's chat defaults. The answer's `notes` are
 * everything the person should be told, and never a sentence (`ImportNote`).
 */
export function buildSession(
  family: ChatFamily,
  resolution: ChatResolution,
  context: BuildContext,
  settings: ChatSettings = {},
): ChatBuild {
  const notes: ImportNote[] = [];
  const hiddenLines = new Set(settings.hidden ?? []);

  /**
   * ***The tree, keyed by content, in the order nodes were first met.*** A
   * `Map` because insertion order is first occurrence, which is the order the
   * cast is read in and the one place the order of chats matters.
   */
  const nodes = new Map<string, Node>();
  let swipesAdded = 0;
  /**
   * Lines one chat of the family hid and another showed, by the foreign id of
   * the line as it was first placed — so a line is counted once however many
   * chats disagree about it, and a swipe's carried copy of it is not a second
   * line.
   */
  const hiddenDisagrees = new Set<string>();

  /**
   * Places a node, or finds it already placed by an earlier round of an earlier
   * chat — which is the whole of how a branch's copied prefix collapses onto
   * the root's path ([P13 §2.4]). A node found keeps everything it was first
   * placed with, its time included, so a later chat cannot move an id.
   *
   * ***Everything but its hiding.*** The chats of a family are separate files,
   * and SillyTavern's `/hide` acts on one of them: a branch can hide lines of
   * the prefix it copied, or show lines its parent has hidden since. The key
   * cannot say which, since hiding is not in it (`ids.ts`), and
   * `session.hidden` is per turn rather than per ref — so there is one answer
   * for the family, and it is ***hidden in any chat is hidden here***. Of the
   * two rules that is the one that sends the model nothing a chat of the family
   * kept from it; the other, the root chat's word, would quietly put a branch's
   * `/hide` back into the branch's prompt. Either way a line the chats disagree
   * about is counted, and the person is told ([P13 §2.6]'s *"a note, never
   * silence"*). [P13 §2.7]'s hidden merge has to apply the same rule, or a
   * sync would undo what the first import decided.
   *
   * The key holds each message's speaker and text and their count, so the
   * lines found and the lines offered are the same messages in the same order,
   * and are merged index by index.
   */
  const place = (
    chat: ChatSourceChat,
    parent: Node | null,
    input: Node['input'],
    lines: Line[],
    at: number | null,
    foreignId: string,
  ): { node: Node; added: boolean } => {
    const key = nodeKey(context.account, family.key, parent?.key ?? null, contentOf(input, lines));
    const found = nodes.get(key);
    if (found !== undefined) {
      if (found.input !== null && input !== null && found.input.hidden !== input.hidden) {
        hiddenDisagrees.add(found.input.line);
        found.input = { ...found.input, hidden: true };
      }
      found.lines = found.lines.map((line, index) => {
        const offered = lines[index];
        if (offered === undefined || offered.hidden === line.hidden) return line;
        hiddenDisagrees.add(line.line);
        return { ...line, hidden: true };
      });
      return { node: found, added: false };
    }
    const node: Node = {
      key,
      parentKey: parent?.key ?? null,
      time: placeTime(at, parent?.time ?? null, chat.createdAt),
      input,
      lines,
      foreignId,
    };
    nodes.set(key, node);
    return { node, added: true };
  };

  const walked: Walked[] = [];
  for (const chat of family.chats) {
    const keys: string[] = [];
    let parent: Node | null = null;

    for (const round of roundsOf(chat.messages)) {
      const input = round.input === null ? null : inputOf(round.input, hiddenLines);
      const lines = round.replies.map((reply) => lineOf(reply, hiddenLines));
      const at = roundTime(round);
      const { node } = place(chat, parent, input, lines, at, round.opening.foreignId);

      swipesAdded += placeSwipes(round, lines, (swiped, foreignId) =>
        place(chat, parent, input, swiped, at, foreignId),
      );

      keys.push(node.key);
      parent = node;
    }
    walked.push({ chat, keys });
  }

  // -------------------------------------------------------------------------
  // Ids, and the order the document lists them in
  // -------------------------------------------------------------------------

  const idOf = new Map<string, string>();
  for (const node of nodes.values()) idOf.set(node.key, uuidv7Shaped(node.time, node.key));
  const id = (key: string): string => idOf.get(key) ?? key;

  /**
   * ***Turns in id order***, which is `exportSession`'s own order and so the
   * order a document from anywhere is expected in. It is also the order
   * `importSession` appends in, and since {@link placeTime} put every child
   * strictly after its parent and the time leads the id, no turn is appended
   * before the turn it names as its parent.
   */
  const ordered = [...nodes.values()].sort((one, two) => (id(one.key) < id(two.key) ? -1 : 1));

  // -------------------------------------------------------------------------
  // Resolution — [P13 §2.5]
  // -------------------------------------------------------------------------

  /**
   * *Who spoke, as the session names them.* A speaker the library has becomes
   * `{ id, name }` of the actor. One it does not keeps `{ id: <foreign key>,
   * name }`, which `Ref` shows by name and flags as missing
   * (`schema/common.ts:43`): the transcript keeps its names either way, and
   * nothing is invented to fill the gap.
   */
  const refOf = (speaker: ForeignRef): Ref => {
    const resolved = resolution.speakers.get(speaker.key) ?? null;
    return resolved === null
      ? { id: speaker.key, name: speaker.name }
      : { id: resolved.id, name: resolved.name };
  };

  const cast: string[] = [];
  const beyondCast = new Set<string>();
  const unresolved = new Map<string, string>();
  const meet = (speaker: ForeignRef): void => {
    const resolved = resolution.speakers.get(speaker.key) ?? null;
    if (resolved === null) {
      if (!unresolved.has(speaker.key)) unresolved.set(speaker.key, speaker.name);
    } else if (!cast.includes(resolved.id)) {
      if (cast.length < CAST_CEILING) cast.push(resolved.id);
      else beyondCast.add(resolved.id);
    }
  };
  /**
   * ***The roster first, in the group's order, then whoever else spoke*** —
   * `ChatFamily.roster`. A group's members are its cast whether or not they
   * said a word, and the order is the group's because `list` answers in cast
   * order ([P13 §1.3]): reading it off the lines instead would reorder the
   * round by who happened to speak first.
   */
  for (const member of family.roster ?? []) meet(member);
  for (const node of nodes.values()) {
    for (const line of node.lines) {
      if (line.speaker !== null) meet(line.speaker);
    }
  }

  const sessionTime = headOf(walked, nodes)?.time ?? 0;
  const sessionId = uuidv7Shaped(sessionTime, sessionKey(context.account, family.key));
  const muted = mutedMembers(family, settings, resolution, cast, notes);
  const turns = ordered.map((node) =>
    turnOf(node, {
      id: id(node.key),
      parentTurnId: node.parentKey === null ? null : id(node.parentKey),
      sessionId,
      source: family.source,
      persona: resolution.persona,
      refOf,
      effects: node.parentKey === null ? mutedEffects(node, id(node.key), muted) : [],
    }),
  );

  // -------------------------------------------------------------------------
  // Hidden — [P13 §2.6]: imported, and hidden, no longer dropped
  // -------------------------------------------------------------------------

  const hidden: Record<string, true | number[]> = {};
  /** Lines the source hid, which `hiddenKept` counts. */
  const keptHidden = new Set<string>();
  const shownInputs = new Set<string>();
  /**
   * ***Lines hidden by the import rather than by the source*** —
   * `ChatMessage.hiddenByImport`, a SillyTavern tool call's record. Hidden like
   * the rest, and left out of `hiddenKept`, whose sentence says the source hid
   * them: it did not, it sent them, and the parser's own note says so. Two
   * sentences telling the person opposite things about one line would leave
   * them believing neither.
   */
  const hiddenOnTheWay = new Set(
    family.chats.flatMap((chat) =>
      chat.messages.flatMap((message) =>
        message.hiddenByImport === true && !hiddenInSource(message, hiddenLines)
          ? [message.foreignId]
          : [],
      ),
    ),
  );
  for (const node of ordered) {
    const indices = node.lines.flatMap((line, at) => (line.hidden ? [at] : []));
    const inputHidden = node.input?.hidden === true;
    /**
     * ***Whole when everything the turn holds is hidden***, which for an
     * output-only turn is every message and for any other also its input.
     * Otherwise the message indices, which is `session.hidden`'s other arm.
     */
    const whole = (node.input === null || inputHidden) && indices.length === node.lines.length;
    if (whole) {
      hidden[id(node.key)] = true;
      if (node.input !== null && !hiddenOnTheWay.has(node.input.line)) {
        keptHidden.add(node.input.line);
      }
    } else if (indices.length > 0) {
      hidden[id(node.key)] = indices;
    }
    /**
     * ***A hidden player's line under replies that are not hidden has no exact
     * home.*** `session.hidden` hides a whole turn or some of its messages, and
     * an input is neither — [P13 §1.6]'s hide works on the same two arms, so
     * Part A cannot express it either. Splitting the line into a turn of its own
     * would express it, and would make the round boundaries depend on hiding,
     * which `rounds.ts` explains a sync cannot survive. So the line is shown,
     * and the person is told.
     */
    if (inputHidden && !whole && node.input !== null) shownInputs.add(node.input.line);
    for (const at of indices) {
      const line = node.lines[at];
      if (line !== undefined && !line.carried && !hiddenOnTheWay.has(line.line)) {
        keptHidden.add(line.line);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Refs, the head and the remembered path — [P13 §2.5]
  // -------------------------------------------------------------------------

  const branchRefs: BranchRef[] = [];
  for (const { chat, keys } of walked) {
    const last = keys.at(-1);
    const first = keys[0];
    if (last === undefined || first === undefined) {
      notes.push({ key: 'import.chat.emptyChat', params: { chat: chat.name }, level: 'info' });
      continue;
    }
    /**
     * *The ref's time is the chat's own creation*, falling back to its first
     * turn's, so the id is fixed for the chat's lifetime and a sync can find
     * the ref again when the chat has grown.
     */
    const time = readableTime(chat.createdAt) ?? nodes.get(first)?.time ?? 0;
    branchRefs.push({
      id: uuidv7Shaped(time, refKey(context.account, family.key, chat.id)),
      name: chat.name,
      headTurnId: id(last),
    });
  }

  const head = headOf(walked, nodes);
  const lastSelectedChild = rememberedPath(walked, nodes, id);

  /**
   * ***The head cache, folded from the effects by the one fold there is.***
   * `session.channels` is *"state at `headTurnId`. Derived."* (`SessionFile`),
   * and this document now carries effects, so an empty map would not be a
   * cache that has not been filled: it would be a hand edit.
   * `reconcileHandEdits` reads a file whose map disagrees with the replay as a
   * person having deleted those keys, and records that as a user-attributed
   * effect on the first read — which here would unmute every muted member the
   * moment the session was opened. So the map is the head path's effects
   * through `applyEffects`, the same function the replay uses, and the two
   * agree by construction rather than by a second opinion about what a mute
   * looks like as state.
   */
  const byKey = new Map(turns.map((turn, at) => [ordered[at]?.key ?? '', turn]));
  const headPath: Turn[] = [];
  for (let key = head?.key ?? null; key !== null; key = nodes.get(key)?.parentKey ?? null) {
    const turn = byKey.get(key);
    if (turn !== undefined) headPath.unshift(turn);
  }
  const channels = headPath.reduce<SessionFile['channels']>(
    (state, turn) => applyEffects(state, turn.effects),
    {},
  );

  // -------------------------------------------------------------------------
  // Notes — every one under `import.chat.*`, where `note-labels.test.ts` looks
  // -------------------------------------------------------------------------

  const inFamily = new Set(family.chats.map((chat) => chat.id));
  for (const chat of family.chats) {
    /**
     * *A pointer to a chat that is not here.* Grouping is the caller's
     * ([P13 §2.5]); the builder was handed this chat as part of the family and
     * builds it as one — content decides where it joins, if anywhere, and the
     * note says its stated parent was missing.
     */
    if (chat.parentId !== undefined && !inFamily.has(chat.parentId)) {
      notes.push({
        key: 'import.chat.parentMissing',
        params: { chat: chat.name, parent: chat.parentId },
        level: 'warn',
      });
    }
  }
  for (const name of unresolved.values()) {
    notes.push({ key: 'import.chat.speakerUnresolved', params: { name }, level: 'warn' });
  }
  if (beyondCast.size > 0) {
    notes.push({
      key: 'import.chat.castCapped',
      params: { count: beyondCast.size, limit: CAST_CEILING },
      level: 'warn',
    });
  }
  if (keptHidden.size > 0) {
    notes.push({
      key: 'import.chat.hiddenKept',
      params: { count: keptHidden.size },
      level: 'info',
    });
  }
  if (shownInputs.size > 0) {
    notes.push({
      key: 'import.chat.hiddenInputShown',
      params: { count: shownInputs.size },
      level: 'warn',
    });
  }
  if (hiddenDisagrees.size > 0) {
    notes.push({
      key: 'import.chat.hiddenDisagrees',
      params: { count: hiddenDisagrees.size },
      level: 'warn',
    });
  }
  if (swipesAdded > 0) {
    notes.push({ key: 'import.chat.swipes', params: { count: swipesAdded }, level: 'info' });
  }

  // -------------------------------------------------------------------------
  // The session document
  // -------------------------------------------------------------------------

  const said = settings.speakers ?? {};
  const rootCreated = readableTime(family.chats[0]?.createdAt);
  const session: SessionFile = {
    schema: 'storyengine.session/1',
    id: sessionId,
    name: family.name,
    createdAt: context.now,
    updatedAt: context.now,
    headTurnId: head === null ? null : id(head.key),
    /**
     * ***Where [P13 §2.7]'s sync will look for this session again*** — the
     * family's root, as the library's re-import rule keys an object on
     * `originalFilename` (`import/identity.ts`).
     *
     * **`importSession` overwrites this today**, with an `origin` of its own
     * whose `originalFilename` is null: it was written for exports from another
     * install, which have no source file to name. Written here anyway, so the
     * document says what it is, and so the stage that teaches `importSession`
     * to keep it — [P13.10a], with the `extend` arm that reads it — changes one
     * reader rather than every converter. Until then, nothing finds a session
     * by this, and a second import of the same family is refused
     * `already-here` rather than extended.
     */
    origin: {
      source: 'import',
      creator: null,
      version: null,
      license: null,
      originalFilename: family.key,
      createdAt: rootCreated === null ? context.now : new Date(rootCreated).toISOString(),
      updatedAt: context.now,
    },
    channels,
    mode: { id: context.modeId, config: null },
    cast: { persona: resolution.persona?.id ?? null, actors: cast },
    lore: [...resolution.lore],
    branchRefs,
    lastSelectedChild,
    ...(Object.keys(hidden).length === 0 ? {} : { hidden }),
    voice: settings.voice ?? SCENE_CHAT.voice,
    dispatch: settings.dispatch ?? SCENE_CHAT.dispatch,
    speakers: {
      policy: said.policy ?? SCENE_CHAT.policy,
      allowSelfResponses: said.allowSelfResponses ?? SPEAKER_DEFAULTS.allowSelfResponses,
      namesInHistory: said.namesInHistory ?? SPEAKER_DEFAULTS.namesInHistory,
      maxPerRound: said.maxPerRound ?? SPEAKER_DEFAULTS.maxPerRound,
    },
    ...(settings.note === undefined ? {} : { note: { ...settings.note } }),
  };

  return {
    document: {
      schema: SESSION_EXPORT_SCHEMA,
      /**
       * *No version*: this build did not export the session, a converter
       * assembled it, and a version here would claim an install wrote it.
       */
      exportedBy: { version: null, at: context.now },
      session: { ...session },
      turns,
      renditions: [],
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Swipes — [P13 §2.3]
// ---------------------------------------------------------------------------

/**
 * ***Swipes are siblings from the message they belong to*** —
 * [P13 §2.3](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * which is [P13 §1.6]'s swipe read backwards.
 *
 * For a character line at index *k* of a round, every swipe but the active one
 * becomes a sibling of the round's turn: the same parent, the same input,
 * messages `0..k-1` of the round marked `carried`, then the swipe by the same
 * speaker — **and nothing after it**. That is exactly the turn Part A writes
 * when a person swipes message *k*: the messages before it were not
 * regenerated, and the ones after it were never written, because they answered
 * the active swipe.
 *
 * So:
 * - **continuations hang off the active swipe only**, because that is where
 *   the source hung them — the round's own turn, which the next round names as
 *   its parent;
 * - **a swipe array on an older message becomes leaves**, because nothing ever
 *   followed them;
 * - **greetings-as-swipes become sibling opening turns** — an output-only first
 *   round's alternates are siblings at the root, which is [P13 §1.7];
 * - **swipes on a player's or narrator's line are ignored.** A swipe is a
 *   reply regenerated, and neither is a reply anybody generated.
 *
 * Returns how many siblings were new, which is the count the person is told.
 * A swipe whose sibling is already in the tree — the same alternative, copied
 * into a branch, or the round itself in a chat that showed that swipe — is one
 * turn, not two.
 */
function placeSwipes(
  round: Round,
  lines: readonly Line[],
  place: (lines: Line[], foreignId: string) => { added: boolean },
): number {
  let added = 0;
  for (const [k, reply] of round.replies.entries()) {
    const own = lines[k];
    if (reply.role !== 'character' || reply.swipes === undefined || own === undefined) continue;
    for (const [index, swipe] of reply.swipes.entries()) {
      if (isActiveSwipe(reply, index)) continue;
      const swiped: Line[] = [
        ...lines.slice(0, k).map((line) => ({ ...line, carried: true })),
        {
          speaker: own.speaker,
          text: swipe.text,
          ...(swipe.reasoning === undefined ? {} : { reasoning: swipe.reasoning }),
          carried: false,
          // A hidden line is hidden whichever of its swipes is showing: the
          // flag is on the message in both sources, not on the swipe.
          hidden: own.hidden,
          line: own.line,
        },
      ];
      // The sibling's time is the round's, whichever swipe it holds: see
      // `roundTime`, for why no swipe's own time can be part of an id.
      if (place(swiped, foreignIdOf(reply, index)).added) added += 1;
    }
  }
  return added;
}

/**
 * ***A round's time, and every one of its siblings'*** — [P13 §2.4]'s *"the
 * send time, forced strictly above the parent's"*, read as the round's own
 * send time and never a swipe's.
 *
 * **The rule is that no id may depend on which swipe was showing**, because
 * the person changes that, and [P13 §2.7]'s sync has to find every turn it
 * already holds when they have. A round and its swipes' siblings are one set of
 * nodes seen from whichever swipe is active: switch the swipe and the round
 * becomes a sibling and a sibling the round. So they must all take a time that
 * does not change when the active swipe does — and the one time a round has
 * that answers to that is:
 *
 * - ***its player's line***, when it has one, which no swipe touches;
 * - ***for an output-only round, the earliest time of its opening line's
 *   swipes***, the line's own included. The opening line may itself be the one
 *   swiped — a greeting's alternates, a force-talk regenerated — and its own
 *   time is then whichever swipe is showing: SillyTavern copies the active
 *   swipe's `send_date` onto the line when it switches (`syncSwipeToMes`,
 *   `script.js:6953`) and back when it leaves (`syncMesToSwipe`, `:6877`), and
 *   the parser gives the active swipe the line's time. So the *set* of those
 *   times is the same from every side, and its least member is one answer.
 *   Also the first-generated: a swipe is appended as it is generated.
 *
 * *What it costs, said so it is not rediscovered.* The alternatives of one
 * round tie on time, before {@link placeTime} lifts them above their parent,
 * and ties between siblings are broken by the hash bits of their ids — an order
 * nobody chose, which is the order the sibling strip lists them in. The other
 * rules each gave the same node two ids: a swipe's own time for a sibling and
 * the round's for the round (the node moved when it swapped sides), or the
 * last reply's active swipe (the node moved the first time its message gained
 * an alternative, since a line with one swipe has none). And where a swipe
 * carries no time — SillyTavern before `swipe_info`, which `ensureSwipes`
 * backfills with the line's time of the day it ran — the earliest is only as
 * stable as what the file kept; a round with a player's line does not care.
 */
function roundTime(round: Round): number | null {
  if (round.input !== null) return readableTime(round.input.at);
  const { opening } = round;
  // Swipes on a narrator's line are ignored everywhere else, so here too.
  const swipes = opening.role === 'character' ? (opening.swipes ?? []) : [];
  // One pass, not `Math.min(...times)`: a round with an absurd number of
  // swipes would exceed the spread's argument limit and throw.
  let earliest: number | null = null;
  for (const at of [opening.at, ...swipes.map((swipe) => swipe.at)]) {
    const time = readableTime(at);
    if (time !== null && (earliest === null || time < earliest)) earliest = time;
  }
  return earliest;
}

/**
 * ***Which swipe is the one on screen.*** `activeSwipe` when it is a usable
 * index — the parser has already made that swipe's text authoritative
 * ([P13 §0.3]). A missing or out-of-range index is read by content instead: the
 * swipe holding the line's own text is the active one, since `text` is the
 * authoritative copy of whatever was showing. Either way the active swipe is
 * the round's own turn and never a sibling of it.
 */
function isActiveSwipe(reply: ChatMessage, index: number): boolean {
  const active = reply.activeSwipe;
  const swipes = reply.swipes ?? [];
  if (active !== undefined && Number.isInteger(active) && active >= 0 && active < swipes.length) {
    return index === active;
  }
  return swipes[index]?.text === reply.text;
}

/**
 * ***`Turn.foreign.id`, and why it is the round's first line*** — a decision
 * of this stage, and the reason is below.
 *
 * A turn is a range of the source's lines, and the source's own name for a
 * range is where it starts: the player's line that opened the round, or the
 * first reply of an output-only one. SillyTavern's lines have no ids, so this is
 * `"<chat path>#<index>"` there, and a person holding the file can find the turn
 * by it. It is provenance, not identity — `importSession` keeps a `foreign` the
 * document already carries rather than overwriting it with the exporting
 * session's id, which is what makes this worth writing at all.
 *
 * *A swipe's sibling names its swipe*, as `"<line>:swipe:<index>"` of the line
 * it regenerates: every sibling starts where the round does, so the round's
 * first line would name them all alike, and the one thing each holds of its own
 * is the swipe.
 */
function foreignIdOf(reply: ChatMessage, swipe: number): string {
  return `${reply.foreignId}:swipe:${String(swipe)}`;
}

// ---------------------------------------------------------------------------
// Refs and the head — [P13 §2.5]
// ---------------------------------------------------------------------------

/**
 * ***The head is the root chat's head*** — [P13 §2.5]: the imported session
 * opens where the chat the person was playing did. A root chat with nothing in
 * it has no head, and then the first chat that has one gives it, rather than a
 * session that opens on nothing while it holds turns.
 */
function headOf(walked: readonly Walked[], nodes: ReadonlyMap<string, Node>): Node | null {
  for (const { keys } of walked) {
    const last = keys.at(-1);
    if (last !== undefined) return nodes.get(last) ?? null;
  }
  return null;
}

/**
 * ***`lastSelectedChild`, along the root chat's path first*** — [P13 §2.3]'s
 * *"`lastSelectedChild` names the active sibling"* and [P13 §2.5]'s head.
 *
 * **Keyed as `moveHead` keys it**: parent turn id to child turn id, for each
 * step of a path (`sessions/store.ts`). *Only where there is a choice* — a node
 * with two or more children — because `resumeFrom` already follows an only
 * child, and an entry per turn of a ten-thousand-line chat would be ten
 * thousand entries saying nothing.
 *
 * ***Roots have no entry, and cannot.*** The map is keyed by parent id and a
 * root has none; `moveHead` records `path[at - 1]` and never a root. Which of
 * several opening turns is showing — a greeting's alternates — is decided by
 * the head, whose walk back reaches exactly one of them.
 *
 * ***Where chats disagree, the root chat wins.*** Two chats of a family that
 * went different ways from one node both have an answer for it; chats are
 * visited root first and the first answer stands. A branch's own choice still
 * counts everywhere past its fork, where the root has none, so returning to a
 * branch by its ref resumes along the branch.
 */
function rememberedPath(
  walked: readonly Walked[],
  nodes: ReadonlyMap<string, Node>,
  id: (key: string) => string,
): Record<string, string> {
  const children = new Map<string, number>();
  for (const node of nodes.values()) {
    if (node.parentKey !== null) {
      children.set(node.parentKey, (children.get(node.parentKey) ?? 0) + 1);
    }
  }

  const remembered: Record<string, string> = {};
  for (const { keys } of walked) {
    for (let at = 1; at < keys.length; at += 1) {
      const parent = keys[at - 1];
      const child = keys[at];
      if (parent === undefined || child === undefined) continue;
      if ((children.get(parent) ?? 0) < 2 || Object.hasOwn(remembered, id(parent))) continue;
      remembered[id(parent)] = id(child);
    }
  }
  return remembered;
}

// ---------------------------------------------------------------------------
// Muted members — [P13 §2.6], [P13.9]
// ---------------------------------------------------------------------------

/** A muted member the session can name: their foreign key, and the actor they are. */
interface Muted {
  key: string;
  actorId: string;
}

/**
 * ***Which muted members a presence effect can be written for*** — those the
 * library resolved, and who are in the cast.
 *
 * `se.presence` is scoped per actor, so its scope key is a library id, and a
 * member the library does not have has none. Writing the effect under the
 * foreign key instead would put a name into the channel map that no cast
 * member answers to — and `resolveCast` unions the actors the channels name
 * into the cast, so it would be a phantom member, muted. Such a member is said
 * instead: their lines keep their name ([P13 §2.5]) and the note says the mute
 * did not come across. *In the cast too*, for the same reason, and the roster
 * puts every resolved member there unless the cast ceiling was reached — a
 * member left out by the ceiling is *in* the library, so `mutedUnresolved`
 * would be false of them; `castCapped` has already said who is missing and
 * why, and a member who is not in the session needs no mute.
 */
function mutedMembers(
  family: ChatFamily,
  settings: ChatSettings,
  resolution: ChatResolution,
  cast: readonly string[],
  notes: ImportNote[],
): Muted[] {
  const muted: Muted[] = [];
  const seen = new Set<string>();
  for (const key of settings.muted ?? []) {
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolution.speakers.get(key) ?? null;
    if (resolved !== null) {
      if (cast.includes(resolved.id)) muted.push({ key, actorId: resolved.id });
      continue;
    }
    const name = family.roster?.find((member) => member.key === key)?.name ?? key;
    notes.push({ key: 'import.chat.mutedUnresolved', params: { name }, level: 'warn' });
  }
  return muted;
}

/**
 * ***A group's muted members, as the state the session opens in*** —
 * [P13 §2.6]'s *"ST `disabled_members` … → presence `false` (muted)"*.
 *
 * **The decision, and the exception to [P13 §2.2] it is.** Presence is the
 * `se.presence` channel (`sessions/cast.ts`): a value at a node, which only an
 * effect on a turn writes. §2.2 has an imported turn carry `effects: []` and
 * *"nothing fabricated"* — and the reason for that rule is a `TurnRequest` or
 * a cost built from fields the source never had. A muted member is not that.
 * SillyTavern *says* who is muted; the only question is where the saying goes,
 * and a session has one place for it. Leaving it out would import a group whose
 * muted member speaks up on the first turn, which is the source contradicted,
 * not respected.
 *
 * - ***On every opening turn***, not only the first: a group's greetings can
 *   come in as several sibling openings ([P13 §1.7]), each the root of its own
 *   path, and a mute on one of them would hold on that path alone. The
 *   source's state is the group's, not a greeting's. And *on the opening*
 *   rather than at the head: SillyTavern keeps the group's mute as it is now,
 *   not when it began, so there is no turn it truly belongs to — and the
 *   opening is the one place every branch of the family inherits it from,
 *   where the head would leave every other ref playing with the member back
 *   in the room.
 * - ***`proposedBy: engine`***, the same arm [P13 §2.6] gives Marinara's
 *   tracker snapshots, and for the same reason. The other three would each be
 *   a false statement: no model call exists to name (`model`), no step ran
 *   (`step`), and `user` is what `reconcileHandEdits` writes for a person's
 *   own edit *in this install* — which this was not, and which the workbench
 *   would show as something the person did here. `engine` is the arm for a
 *   value the engine recorded rather than one proposed to it, and the turn's
 *   `foreign` already says where the engine got it.
 * - ***Applied, built here rather than through `acceptEffect`.*** Presence is
 *   `model-proposed`, which admits `engine`, and `false` is its schema's, so
 *   `acceptEffect` would apply it too; it is not called because it mints a
 *   random id and this builder is a function of its arguments. The id comes
 *   from `effectKey` instead, over the turn's key and the member's foreign key.
 * - ***`before: null`***, which is what `acceptEffect` records for a channel
 *   nothing has written yet — an opening turn's running map is empty.
 */
function mutedEffects(node: Node, turnId: string, muted: readonly Muted[]): ChannelEffect[] {
  return muted.map((member) => ({
    id: uuidv7Shaped(node.time, effectKey(node.key, SE_PRESENCE, member.key)),
    turnId,
    channelId: SE_PRESENCE,
    scopeKey: member.actorId,
    op: { type: 'set', path: '/' },
    before: null,
    after: false,
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: PRESENCE_CHANNEL.version,
    scope: 'session',
  }));
}

// ---------------------------------------------------------------------------
// One node, one turn
// ---------------------------------------------------------------------------

function inputOf(message: ChatMessage, hiddenLines: ReadonlySet<string>): Node['input'] {
  return { text: message.text, hidden: hiddenHere(message, hiddenLines), line: message.foreignId };
}

/** The source hid it: on the line, or where the source keeps hiding instead. */
function hiddenInSource(message: ChatMessage, hiddenLines: ReadonlySet<string>): boolean {
  return message.hidden === true || hiddenLines.has(message.foreignId);
}

/** Hidden in the session: the source hid it, or the import had to. */
function hiddenHere(message: ChatMessage, hiddenLines: ReadonlySet<string>): boolean {
  return hiddenInSource(message, hiddenLines) || message.hiddenByImport === true;
}

/**
 * A reply as a line of a node. *A narrator line has no speaker whatever the
 * parser put there*: [P13 §2.2] makes it a `speaker: null` message, and a
 * speaker on it would be one the chat never showed.
 */
function lineOf(message: ChatMessage, hiddenLines: ReadonlySet<string>): Line {
  return {
    speaker: message.role === 'narrator' ? null : (message.speaker ?? null),
    text: message.text,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    carried: false,
    hidden: hiddenHere(message, hiddenLines),
    line: message.foreignId,
  };
}

function contentOf(input: Node['input'], lines: readonly Line[]): NodeContent {
  return {
    input: input?.text ?? null,
    messages: lines.map((line) => ({
      speakerKey: line.speaker?.key ?? null,
      text: line.text,
    })),
  };
}

/**
 * ***A turn nothing ran*** — [P13 §2.2]'s *"`status: 'complete'`,
 * `effects: []`, `tape: []`, and nothing fabricated."* — *with the one
 * exception [P13.9] makes*: an opening turn carries the muted members'
 * presence, which is the source's state and not a fabrication
 * ({@link mutedEffects}).
 *
 * **No `request`, `cost` or `steps`.** [18 §3]'s first consequence keeps them
 * optional precisely so a turn that never ran a model can exist, and
 * [P13 §2.6] is blunt about the temptation: *"A `TurnRequest` built from three
 * of its fields is a fabrication of the other twenty."*
 *
 * - **`input.kind` is `do`**, verbatim in every shipped pack; **`actorId`** is
 *   the family's persona when the library has it.
 * - **`output`** is `outputFromMessages`, so `text` and `reasoning` are derived
 *   the one way everything else derives them, and a reader that predates
 *   `messages` reads a group round as its paragraphs.
 */
function turnOf(
  node: Node,
  on: {
    id: string;
    parentTurnId: string | null;
    sessionId: string;
    source: ChatFamily['source'];
    persona: ResolvedRef | null;
    refOf: (speaker: ForeignRef) => Ref;
    effects: ChannelEffect[];
  },
): Turn {
  const messages: OutputMessage[] = node.lines.map((line) => ({
    speaker: line.speaker === null ? null : on.refOf(line.speaker),
    text: line.text,
    ...(line.reasoning === undefined ? {} : { reasoning: line.reasoning }),
    ...(line.carried ? { carried: true as const } : {}),
  }));
  return {
    id: on.id,
    sessionId: on.sessionId,
    parentTurnId: on.parentTurnId,
    createdAt: new Date(node.time).toISOString(),
    status: 'complete',
    ...(node.input === null
      ? {}
      : {
          input: {
            actorId: on.persona?.id ?? null,
            kind: 'do',
            text: node.input.text,
            raw: node.input.text,
          },
        }),
    ...(messages.length === 0 ? {} : { output: outputFromMessages(messages) }),
    foreign: { source: on.source, id: node.foreignId },
    effects: on.effects,
    tape: [],
  };
}
