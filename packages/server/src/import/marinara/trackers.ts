// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type { ChatStateValue, ForeignRef } from '../chat/types.js';
import { plotSwitches } from './plot.js';

/**
 * ***Marinara's agent state, as Scene's tracker channels*** —
 * [P13 §2.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * second table, built at [P13.5a]:
 *
 * | Marinara | Here |
 * |---|---|
 * | `game_state_snapshots` row for a message's swipe | the six tracker values on the turn holding it |
 * | `activeAgentIds`, `manualTrackers` | the tracker switches, and the cadence's `manual` |
 * | field locks, hidden tracker fields | `se.track.locks` and `se.track.hidden` |
 *
 * ***Pure, and it spells Scene's channel ids.*** That is the builder's
 * `SCENE_CHAT` posture, for the same reason: an import converts *into* the mode
 * chats are imported into (`CHAT_IMPORT_MODE_ID`), the SDK boundary keeps that
 * mode's package out of the server's reach, and what a Marinara snapshot means
 * as a Scene value must not move on the day the mode's declarations do without
 * somebody deciding it should. The ids, versions and empty values are pinned to
 * the registered channels by `trackers.test.ts`, and every value this file
 * builds is validated there against the registered schema — so a drift is a
 * failing test, not an effect the session later quarantines.
 *
 * *What is not carried, and said*: agent **models** (global in Marinara, on
 * `agent_configs.connection_id`, never per chat — here the session's
 * `stepRoles` at `se.scene.track`), a per-agent manual switch
 * (`manualTrackerAgentTypes`: here manual is one cadence for all six, so
 * {@link trackerSwitches} makes it manual or leaves those trackers off), a
 * quest's stage *number* (an index into a lorebook quest's stages that did not
 * come with it), a character's emoji, and lock keys that name a row by index
 * where the snapshot has no such row.
 */

/**
 * ***The channels, as this import spells them*** — id, version, and the value
 * the channel reads before anything writes it (its `init`), which is what the
 * builder measures *"did this move"* against.
 */
export const SCENE_TRACKERS = {
  world: {
    id: 'se.track.world',
    version: 1,
    init: {
      date: '',
      time: '',
      location: '',
      weather: '',
      temperature: '',
      fields: [],
      recent: [],
    },
  },
  character: {
    id: 'se.track.character',
    version: 1,
    init: { mood: '', appearance: '', outfit: '', thoughts: '', fields: {}, stats: [] },
  },
  persona: { id: 'se.track.persona', version: 1, init: { status: '', stats: [] } },
  quests: { id: 'se.track.quests', version: 1, init: [] },
  inventory: {
    id: 'se.track.inventory',
    version: 1,
    init: { currencies: [], equipped: [], inventory: [] },
  },
  custom: { id: 'se.track.custom', version: 1, init: [] },
  locks: { id: 'se.track.locks', version: 1, init: [] },
  hidden: { id: 'se.track.hidden', version: 1, init: [] },
  cadence: { id: 'se.track.cadence', version: 1, init: { everyNTurns: 1, manual: false } },
} as const;

type TrackerName = 'world' | 'character' | 'persona' | 'quests' | 'inventory' | 'custom';

/**
 * ***Which Marinara agent is which tracker*** — its built-in agent type ids
 * (`BUILT_IN_AGENT_IDS`, `shared/src/types/agent.ts`), which is what
 * `activeAgentIds` holds. `inventory-tracker` is the roleplay inventory agent,
 * which ships as a package rather than in that list.
 */
const AGENT_TRACKERS: Readonly<Record<string, TrackerName>> = {
  'world-state': 'world',
  'character-tracker': 'character',
  'persona-stats': 'persona',
  quest: 'quests',
  'inventory-tracker': 'inventory',
  'custom-tracker': 'custom',
};

/** The switch channel a tracker waits on — `se.track.<tracker>.on`, `tracking.ts`'s `toggle`. */
function switchOf(tracker: TrackerName): string {
  return `${SCENE_TRACKERS[tracker].id}.on`;
}

/** A tracker switch's version — every switch is a version-1 boolean. */
const SWITCH_VERSION = 1;

// Schema ceilings — `tracking.ts`'s, so an imported value is one the channel takes.
const LINE = 500;
const NAME = 120;

type Row = Readonly<Record<string, unknown>>;

/**
 * ***What the chat's metadata switches on*** — `ChatSettings.state` for the
 * family's opening turns.
 *
 * **Marinara runs an agent only when both say so**: `enableAgents` for the
 * chat and the agent's type in `activeAgentIds` (`generate.routes.ts:1755`,
 * `shouldEnableAgentsForGeneration`). A chat with agents off and a stale list
 * ran none of them, and switching them on here would be the import deciding to
 * spend somebody's model calls. `manualTrackers` is the cadence's `manual`.
 * Only what is *on* is written: every switch here starts off.
 */
export function trackerSwitches(
  metadata: Readonly<Record<string, unknown>>,
  chat: string,
  notes: ImportNote[],
): ChatStateValue[] {
  const out: ChatStateValue[] = [];
  const active = metadata['enableAgents'] === true ? stringsOf(metadata['activeAgentIds']) : [];
  const on = new Set<TrackerName>();
  for (const agent of active) {
    const tracker = AGENT_TRACKERS[agent];
    if (tracker !== undefined) on.add(tracker);
  }
  /**
   * ***Per-agent manual*** (`manualTrackerAgentTypes`) strips just those
   * trackers from Marinara's automatic pipeline (`generate.routes.ts:4439-4447`)
   * — they ran only on request. Here manual is one cadence for all six, so
   * the per-agent word cannot land as it is; carrying those trackers as
   * automatic would spend a model call every turn that Marinara never spent,
   * which is what the rule above refuses (correction, 2026-09-29 — they were
   * imported as every-turn trackers). So: when *every* switched-on tracker was
   * per-agent manual, the cadence is manual, as `manualTrackers` would have
   * made it; when only some were, those stay switched off — the automatic
   * ones keep running as they did, and a person switches the others on and
   * runs them with *Update trackers*. Making all six manual instead would have
   * stopped trackers Marinara ran every turn. The note says which happened.
   */
  const perAgent = recordOf(metadata['manualTrackerAgentTypes']);
  const manualAll = metadata['manualTrackers'] === true;
  const perAgentManual = new Set<TrackerName>();
  for (const [agent, manual] of Object.entries(perAgent)) {
    const tracker = AGENT_TRACKERS[agent.trim()];
    if (manual === true && tracker !== undefined && on.has(tracker)) perAgentManual.add(tracker);
  }
  const everyOnIsManual = perAgentManual.size > 0 && perAgentManual.size === on.size;
  if (!manualAll && !everyOnIsManual) {
    for (const tracker of perAgentManual) on.delete(tracker);
  }
  for (const tracker of [
    'world',
    'character',
    'persona',
    'quests',
    'inventory',
    'custom',
  ] as const) {
    if (on.has(tracker)) {
      out.push({ channelId: switchOf(tracker), version: SWITCH_VERSION, init: false, value: true });
    }
  }
  if (manualAll || everyOnIsManual) {
    out.push({
      channelId: SCENE_TRACKERS.cadence.id,
      version: SCENE_TRACKERS.cadence.version,
      init: SCENE_TRACKERS.cadence.init,
      value: { everyNTurns: 1, manual: true },
    });
  }
  if (Object.values(perAgent).some((one) => one === true)) {
    notes.push({ key: 'import.chat.manualTrackersPerAgent', params: { chat }, level: 'info' });
  }
  /**
   * ***The director*** ([P13.5b]): its push is a per-turn flag here, available
   * whatever the chat had on, so there is nothing of it to carry — and its
   * secret plot's switch and cadence are `plotSwitches`'.
   */
  out.push(...plotSwitches(metadata, active));
  /**
   * *Agents that are neither trackers nor the director* — the prose guardian,
   * the echo chamber — come with [P13.5c]; until then their switches are a
   * note, which is what `agentsNotCarried` has said since [P13.10], now about
   * the rest rather than all of them.
   */
  const others = active.filter(
    (agent) => AGENT_TRACKERS[agent] === undefined && agent !== 'director',
  );
  if (others.length > 0) {
    notes.push({ key: 'import.chat.agentsNotCarried', params: { chat }, level: 'info' });
  }
  if (on.size > 0) {
    notes.push({ key: 'import.chat.agentModelsNotCarried', params: { chat }, level: 'info' });
  }
  return out;
}

/**
 * ***The snapshots, by message and swipe*** — `(messageId, swipeIndex)` to the
 * values that snapshot establishes, which the chat parser hangs on the line or
 * swipe they belong to.
 *
 * **One snapshot per `(message, swipe)`, the latest kept.** Marinara writes a
 * fresh row each time the trackers run over the same swipe (an *Update
 * trackers* there, a retry), and the last is the one its HUD shows.
 * *Latest* is `createdAt`, then id — its own order.
 */
export function snapshotStates(rows: readonly Row[]): Map<string, Map<number, ChatStateValue[]>> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const messageId = str(row['messageId']);
    if (messageId === '') continue;
    const key = `${messageId}\u0000${String(swipeIndexOf(row))}`;
    const held = latest.get(key);
    if (held === undefined || later(row, held)) latest.set(key, row);
  }
  const out = new Map<string, Map<number, ChatStateValue[]>>();
  for (const row of latest.values()) {
    const messageId = str(row['messageId']);
    const bySwipe = out.get(messageId) ?? new Map<number, ChatStateValue[]>();
    bySwipe.set(swipeIndexOf(row), stateOf(row));
    out.set(messageId, bySwipe);
  }
  return out;
}

/**
 * How many distinct lock and hidden keys a chat's snapshots held that could not
 * be read as a field path — see {@link pathOfKey}. *Distinct*, because
 * Marinara carries its locks forward onto every later snapshot, and one key
 * counted once per turn would be a number about the chat's length.
 */
export function unreadKeys(rows: readonly Row[]): number {
  const unread = new Set<string>();
  for (const row of rows) {
    const shape = snapshotShape(row);
    for (const set of [recordOf(row['fieldLocks']), recordOf(row['hiddenTrackerFields'])]) {
      for (const [key, on] of Object.entries(set)) {
        if (on === true && pathOfKey(key, shape) === null) unread.add(key);
      }
    }
  }
  return unread.size;
}

function later(a: Row, b: Row): boolean {
  const at = str(a['createdAt']);
  const bt = str(b['createdAt']);
  return at !== bt ? at > bt : str(a['id']) > str(b['id']);
}

function swipeIndexOf(row: Row): number {
  const index = Number(row['swipeIndex'] ?? 0);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/**
 * ***A snapshot's columns, read as Marinara's `GameState`*** — each column a
 * value or JSON text of one, as every Marinara row is.
 */
interface Shape {
  world: Row;
  characters: Row[];
  player: Row;
  personaStats: Row[] | null;
}

function snapshotShape(row: Row): Shape {
  return {
    world: row,
    characters: rowsOf(row['presentCharacters']),
    player: recordOf(row['playerStats']),
    personaStats: jsonOf(row['personaStats']) === null ? null : rowsOf(row['personaStats']),
  };
}

/**
 * ***One snapshot, as tracker values*** — [P13 §1.9.2]'s table read
 * backwards, each field as the code that applies Marinara's results stores it
 * (`game-state.ts`):
 *
 * - **world**: `date`, `time`, `location`, `weather`, `temperature` as they
 *   are; `worldCustomFields` as `fields`; `recentEvents` as `recent`, the
 *   newest ten.
 * - **character**, per present character *with a card* (`characterId`):
 *   `mood`, `appearance`, `outfit`, `thoughts`; `customFields` as `fields`;
 *   `stats` as they are. One with no card is somebody the story mentioned and
 *   the library has no actor for — [P13 §1.9.2]'s channel is per actor, so
 *   there is nowhere to put them, and the builder's note counts whoever it
 *   cannot place.
 * - **persona**: `playerStats.status`, and `personaStats` (or, before the
 *   persona-stats agent existed, `playerStats.stats`).
 * - **quests**: `playerStats.activeQuests`, without the stage number.
 * - **inventory**: the inventory tracker's three groups, and persona-stats'
 *   own `inventory` folded into *carrying* — *"one place a sword can be"*,
 *   [P13 §1.9.2]'s table — by name, the tracker's row first.
 * - **custom**: `playerStats.customTrackerFields`.
 * - **locks** and **hidden**: the field-lock and hidden-field maps, each key
 *   translated by {@link pathOfKey}.
 *
 * Every tracker, every time: a snapshot is a whole state, and the builder
 * writes only what moved along the path.
 */
function stateOf(row: Row): ChatStateValue[] {
  const shape = snapshotShape(row);
  const { world, player } = shape;
  const out: ChatStateValue[] = [];
  const put = (tracker: keyof typeof SCENE_TRACKERS, value: unknown, member?: ForeignRef): void => {
    const channel = SCENE_TRACKERS[tracker];
    out.push({
      channelId: channel.id,
      version: channel.version,
      init: channel.init,
      value,
      ...(member === undefined ? {} : { member }),
      ...(tracker === 'locks' || tracker === 'hidden' ? { paths: true as const } : {}),
    });
  };

  put('world', {
    date: line(world['date']),
    time: line(world['time']),
    location: line(world['location']),
    weather: line(world['weather']),
    temperature: line(world['temperature']),
    fields: named(rowsOf(world['worldCustomFields']), 50).map((one) => ({
      name: name(one['name']),
      value: line(one['value']),
    })),
    recent: stringsOf(world['recentEvents'])
      .slice(-10)
      .map((one) => clip(one, LINE)),
  });

  for (const character of shape.characters) {
    const key = str(character['characterId']).trim();
    if (key === '') continue;
    const fields = Object.entries(recordOf(character['customFields']))
      .filter(([field]) => field.trim() !== '')
      .slice(0, 30)
      .map(([field, value]) => [field, line(value)] as const);
    put(
      'character',
      {
        mood: line(character['mood']),
        appearance: line(character['appearance']),
        outfit: line(character['outfit']),
        thoughts: line(character['thoughts']),
        fields: Object.fromEntries(fields),
        stats: stats(character['stats']),
      },
      { key, name: str(character['name']) },
    );
  }

  put('persona', {
    status: line(player['status']),
    stats: stats(shape.personaStats ?? player['stats']),
  });

  put(
    'quests',
    named(rowsOf(player['activeQuests']), 50).map((quest) => ({
      name: name(quest['name']),
      objectives: rowsOf(quest['objectives'])
        .filter((one) => str(one['text']).trim() !== '')
        .slice(0, 30)
        .map((one) => ({ text: line(one['text']), completed: one['completed'] === true })),
      completed: quest['completed'] === true,
    })),
  );

  const carried = items(player['inventoryTrackerInventory'], 100);
  for (const item of rowsOf(player['inventory'])) {
    const itemName = name(item['name']);
    if (itemName === '' || carried.some((one) => one.name === itemName)) continue;
    if (carried.length >= 100) break;
    const qty = Number(item['quantity']);
    carried.push(Number.isFinite(qty) && qty !== 1 ? { name: itemName, qty } : { name: itemName });
  }
  put('inventory', {
    currencies: items(player['inventoryTrackerCurrencies'], 50),
    equipped: items(player['inventoryTrackerEquipped'], 50),
    inventory: carried,
  });

  put(
    'custom',
    named(rowsOf(player['customTrackerFields']), 50).map((one) => ({
      name: name(one['name']),
      value: scalar(one['value']),
    })),
  );

  put('locks', pathsOf(row['fieldLocks'], shape));
  put('hidden', pathsOf(row['hiddenTrackerFields'], shape));
  return out;
}

function pathsOf(value: unknown, shape: Shape): string[] {
  const out = new Set<string>();
  for (const [key, on] of Object.entries(recordOf(value))) {
    if (on !== true) continue;
    const path = pathOfKey(key, shape);
    if (path !== null) out.add(path);
  }
  return [...out];
}

/**
 * ***A Marinara lock key, as a field path*** — its grammar
 * (`tracker-field-locks.ts`) onto `tracking.ts`'s: dotted segments, a row as
 * `name:<encoded>` (an objective `text:`, a character or quest `id:` first),
 * each segment URI-encoded with `.` as `%2E` so a dot always separates. Ours is
 * a channel key and a JSON Pointer, a row addressed by its `name`.
 *
 * **Coarser where ours is**: Marinara locks a row's `name` and `value` apart;
 * a path here locks the row, since a row whose name changed is another row.
 * So both keys of one row become one path. A character's lock names them by
 * the source's key (`se.track.character#<characterId>/…`) and the builder
 * rewrites it to the actor. `null` for what this cannot place — an `index:`
 * ref past the end of the snapshot's list, an emoji, a field we do not keep —
 * and {@link unreadKeys} counts those.
 */
function pathOfKey(key: string, shape: Shape): string | null {
  const parts = key.split('.');
  const [head, ...rest] = parts;
  const path = (channel: string, ...segments: string[]): string =>
    [channel, ...segments.map(pointer)].join('/');

  switch (head) {
    case 'world': {
      const [field, ref] = rest;
      if (field === undefined) return null;
      if (['date', 'time', 'location', 'weather', 'temperature'].includes(field)) {
        return rest.length === 1 ? path(SCENE_TRACKERS.world.id, field) : null;
      }
      if (field !== 'custom') return null;
      if (ref === undefined) return path(SCENE_TRACKERS.world.id, 'fields');
      const row = rowName(ref, rowsOf(shape.world['worldCustomFields']));
      return row === null ? null : path(SCENE_TRACKERS.world.id, 'fields', row);
    }
    case 'persona': {
      const [field, ref] = rest;
      if (field === 'status' && rest.length === 1) return path(SCENE_TRACKERS.persona.id, 'status');
      if (field !== 'stats') return null;
      if (ref === undefined) return path(SCENE_TRACKERS.persona.id, 'stats');
      const row = rowName(ref, shape.personaStats ?? rowsOf(shape.player['stats']));
      return row === null ? null : path(SCENE_TRACKERS.persona.id, 'stats', row);
    }
    case 'player': {
      const [field, group, ref] = rest;
      if (field === 'inventory') {
        if (group === undefined) return path(SCENE_TRACKERS.inventory.id, 'inventory');
        const row = rowName(group, rowsOf(shape.player['inventory']));
        return row === null ? null : path(SCENE_TRACKERS.inventory.id, 'inventory', row);
      }
      if (field === 'inventoryTracker') {
        const groups: Readonly<Record<string, string>> = {
          currencies: 'inventoryTrackerCurrencies',
          equipped: 'inventoryTrackerEquipped',
          inventory: 'inventoryTrackerInventory',
        };
        const column = group === undefined ? undefined : groups[group];
        if (group === undefined || column === undefined) return null;
        if (ref === undefined) return path(SCENE_TRACKERS.inventory.id, group);
        const row = rowName(ref, rowsOf(shape.player[column]));
        return row === null ? null : path(SCENE_TRACKERS.inventory.id, group, row);
      }
      if (field === 'custom') {
        if (group === undefined) return SCENE_TRACKERS.custom.id;
        const row = rowName(group, rowsOf(shape.player['customTrackerFields']));
        return row === null ? null : path(SCENE_TRACKERS.custom.id, row);
      }
      return null;
    }
    case 'characters': {
      const [ref, field, sub] = rest;
      if (ref === undefined || field === undefined) return null;
      const character = characterOf(ref, shape.characters);
      if (character === null) return null;
      const key = `${SCENE_TRACKERS.character.id}#${character.key}`;
      if (['mood', 'appearance', 'outfit', 'thoughts'].includes(field) && rest.length === 2) {
        return path(key, field);
      }
      if (field === 'stats') {
        if (sub === undefined) return path(key, 'stats');
        const row = rowName(sub, rowsOf(character.row['stats']));
        return row === null ? null : path(key, 'stats', row);
      }
      if (field === 'custom' && sub !== undefined) return path(key, 'fields', decoded(sub));
      return null;
    }
    case 'quests': {
      const [ref, field, objectiveRef] = rest;
      if (ref === undefined) return null;
      const quests = rowsOf(shape.player['activeQuests']);
      const quest = questOf(ref, quests);
      if (quest === null) return null;
      if (field === 'objectives') {
        if (objectiveRef === undefined) return path(SCENE_TRACKERS.quests.id, quest, 'objectives');
        const objective = objectiveOf(
          objectiveRef,
          rowsOf(quests.find((one) => name(one['name']) === quest)?.['objectives']),
        );
        return objective === null
          ? null
          : path(SCENE_TRACKERS.quests.id, quest, 'objectives', objective);
      }
      /**
       * *A quest's field locks stay per field* — not the row's coarsening —
       * because a quest nests its objectives: Marinara's `completed` lock
       * (`mergeQuestsWithLocks`, `tracker-field-locks.ts:908`) still lets the
       * objectives move, and a lock on the whole row here would freeze them
       * (correction, 2026-09-29). `name`, or no field, is the row, since a
       * row is matched by its name; the stage number is not kept.
       */
      if (field === 'completed') return path(SCENE_TRACKERS.quests.id, quest, 'completed');
      if (field === undefined || field === 'name') return path(SCENE_TRACKERS.quests.id, quest);
      return null;
    }
    default:
      return null;
  }
}

/** A JSON Pointer segment — `trackerPath`'s escaping. */
function pointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Marinara's `encodeSegment` undone: URI-encoded, `_` for empty. */
function decoded(segment: string): string {
  if (segment === '_') return '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A `name:` or `index:` row ref, as the row's name. */
function rowName(ref: string, rows: readonly Row[]): string | null {
  if (ref.startsWith('name:')) return decoded(ref.slice(5)).trim() || null;
  if (ref.startsWith('index:')) {
    const found = name(rows[Number(ref.slice(6))]?.['name']);
    return found === '' ? null : found;
  }
  return null;
}

function questOf(ref: string, quests: readonly Row[]): string | null {
  if (ref.startsWith('id:')) {
    const id = decoded(ref.slice(3));
    const found = name(quests.find((one) => str(one['questEntryId']) === id)?.['name']);
    return found === '' ? null : found;
  }
  return rowName(ref, quests);
}

function objectiveOf(ref: string, objectives: readonly Row[]): string | null {
  if (ref.startsWith('text:')) return decoded(ref.slice(5)).trim() || null;
  if (ref.startsWith('index:')) {
    const found = line(objectives[Number(ref.slice(6))]?.['text']);
    return found === '' ? null : found;
  }
  return null;
}

function characterOf(ref: string, characters: readonly Row[]): { key: string; row: Row } | null {
  const byKey = (row: Row | undefined): { key: string; row: Row } | null => {
    const key = str(row?.['characterId']).trim();
    return row === undefined || key === '' ? null : { key, row };
  };
  if (ref.startsWith('id:')) {
    const id = decoded(ref.slice(3));
    return byKey(characters.find((one) => str(one['characterId']) === id)) ?? null;
  }
  if (ref.startsWith('name:')) {
    const wanted = decoded(ref.slice(5));
    return byKey(characters.find((one) => str(one['name']) === wanted));
  }
  if (ref.startsWith('index:')) return byKey(characters[Number(ref.slice(6))]);
  return null;
}

// ---------------------------------------------------------------------------
// Values, clipped to what the channels take
// ---------------------------------------------------------------------------

function stats(value: unknown): { name: string; value: number; max: number; color?: string }[] {
  return named(rowsOf(value), 20).flatMap((one) => {
    const at = Number(one['value']);
    const max = Number(one['max']);
    if (!Number.isFinite(at) || !Number.isFinite(max)) return [];
    const color = str(one['color']).slice(0, 32);
    return [{ name: name(one['name']), value: at, max, ...(color === '' ? {} : { color }) }];
  });
}

function items(value: unknown, limit: number): { name: string; qty?: number }[] {
  return named(rowsOf(value), limit).map((one) => {
    const qty = Number(one['qty']);
    return one['qty'] !== undefined && Number.isFinite(qty)
      ? { name: name(one['name']), qty }
      : { name: name(one['name']) };
  });
}

/** Rows with a usable name, one per name, the first kept — a name is how a row is matched. */
function named(rows: readonly Row[], limit: number): Row[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = name(row['name']);
      if (key === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function scalar(value: unknown): string | number | boolean {
  return typeof value === 'number' || typeof value === 'boolean' ? value : line(value);
}

function line(value: unknown): string {
  return clip(str(value), LINE);
}

function name(value: unknown): string {
  return clip(str(value).trim(), NAME);
}

function clip(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

// ---------------------------------------------------------------------------
// Reading a column that may be JSON text — `chat.ts`'s helpers, for its reason
// ---------------------------------------------------------------------------

function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Row {
  const parsed = jsonOf(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Row)
    : {};
}

function rowsOf(value: unknown): Row[] {
  const parsed = jsonOf(value);
  return Array.isArray(parsed)
    ? parsed.filter((row): row is Row => typeof row === 'object' && row !== null)
    : [];
}

function stringsOf(value: unknown): string[] {
  const parsed = jsonOf(value);
  return Array.isArray(parsed)
    ? parsed.filter((one): one is string => typeof one === 'string' && one !== '')
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}
