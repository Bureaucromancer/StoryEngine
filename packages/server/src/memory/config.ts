// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The two toggles and the list — [08 §4](../../../../docs/design/08-cross-session-memory.md),
 * [08 §7], [P8.4].
 *
 * **Two per session, both defaulting on, and the asymmetry is the useful part.**
 * 08 §4 enumerates all four combinations and each one is a thing somebody wants:
 *
 * | share | intake | use |
 * |---|---|---|
 * | on | on | the default — a continuing relationship |
 * | **off** | **on** | an experiment. Learns from history without polluting it |
 * | on | off | a fresh start that still becomes canon going forward |
 * | off | off | a sealed alternate universe |
 *
 * *That table is why these are two controls rather than one*, and why the gate
 * walks all four rather than the two a single switch would have.
 *
 * ***And 08 §4 notices the pattern is not memory's.*** Marinara's Noodle
 * carryover has the same shape — a toggle pushing activity *into* chats and a
 * per-chat toggle letting it flow back — and Messages mode's autonomous messages
 * are the same idea with the toggles implicit. **Three features converging on
 * two opt-in switches governing context flow between separate activity streams**
 * suggests a mechanism worth naming rather than implementing three times. Not
 * generalised here, because one instance is not a pattern; recorded because the
 * second one will be built by somebody who should know.
 */

/**
 * ***A tri-state, not a boolean*** — [08 §4]'s own emphasis.
 *
 * *"A plain boolean cannot express **exclude this one specific session despite
 * intake being on**, which is precisely the control the requirement asks for."*
 * Absent from the map means **auto**: governed by `intake`, and shown that way
 * rather than hidden, so the effective result is visible rather than inferred.
 *
 * **Manual association overrides the toggles in both directions**, per the
 * requirement: `'always'` pulls a session in even when `intake` is off, and
 * `'never'` excludes one that would otherwise qualify.
 */
export type Association = 'always' | 'never';

export interface SessionMemoryConfig {
  /** This session contributes memories to its actors' books. */
  share: boolean;
  /** This session draws on memories from its actors. */
  intake: boolean;
  /** Per-origin-session overrides, keyed by session id. Absent = auto. */
  associations: Record<string, Association>;
  /**
   * ***Remember across personas*** — [08 §3]'s *"a default, not a law"*.
   *
   * Persona scope is the non-obvious axis and the one worth defending: *"If you
   * play two personas, Vera remembering what she did with persona A while
   * talking to persona B is both a coherence failure and a spoiler. She is
   * talking to a different person, and she should know a different history."*
   *
   * **Widening is a setting because for some installs the distinction is
   * invisible anyway** — 08 §3 says so in as many words for a single-persona
   * install — and because *"this actor remembers across all my personas"* is a
   * thing some people will want. What it never widens is the user axis, which
   * [08 §3] calls *not a toggle, not overridable*: that one is the path, not a
   * field, so nothing here could widen it even by mistake.
   */
  acrossPersonas: boolean;
}

/**
 * **Both defaulting on**, which is 08 §4's shape and [08 §1]'s requirement: *a
 * character defaults to having prior sessions available, unless turned off*.
 *
 * *08 §4 leaves `share: true` marked `[OPEN]`* — *"every throwaway session
 * contributes"* — with the mitigation that isolating a session must be **one
 * obvious action rather than two toggles found in a drawer**. [P8.5] builds the
 * one obvious action at session creation; this is the default it isolates from.
 */
export const DEFAULT_MEMORY_CONFIG: SessionMemoryConfig = {
  share: true,
  intake: true,
  associations: {},
  acrossPersonas: false,
};

/**
 * The session's answer, read out of whatever is in the file.
 *
 * **Guarded field by field** for `resolveLore`'s stated reason: `readSession`
 * validates nothing beyond the id being a string, and hand-editing
 * `session.json` is a supported way to get data in ([03 §5.1]). Every absent or
 * malformed field falls to the default, which is the state every session written
 * before this phase is in.
 */
export function readMemoryConfig(session: unknown): SessionMemoryConfig {
  if (typeof session !== 'object' || session === null) return DEFAULT_MEMORY_CONFIG;
  const held = (session as { memory?: unknown }).memory;
  if (typeof held !== 'object' || held === null) return DEFAULT_MEMORY_CONFIG;

  const config = held as Record<string, unknown>;
  const associations: Record<string, Association> = {};
  const listed = config['associations'];
  if (typeof listed === 'object' && listed !== null) {
    for (const [sessionId, value] of Object.entries(listed as Record<string, unknown>)) {
      if (value === 'always' || value === 'never') associations[sessionId] = value;
    }
  }

  return {
    share: config['share'] !== false,
    intake: config['intake'] !== false,
    associations,
    acrossPersonas: config['acrossPersonas'] === true,
  };
}

/**
 * Whether a memory written in `originSessionId` may be read here.
 *
 * ***The one function all four of [08 §4]'s combinations run through***, which
 * is what makes the gate's *four combinations, four outcomes* a claim about one
 * predicate rather than about four code paths. `intake` is the default and the
 * list overrides it **in both directions** — that asymmetry is the tri-state's
 * whole reason for existing.
 *
 * *A memory whose origin is this session itself is always admitted*, whatever
 * the toggles say: intake governs what comes in **from elsewhere**, and a
 * session refusing to read what it wrote ten turns ago would be a different
 * feature wearing this one's switch.
 */
export function admits(
  config: SessionMemoryConfig,
  thisSessionId: string,
  originSessionId: string | null,
): boolean {
  if (originSessionId === null) return config.intake;
  if (originSessionId === thisSessionId) return true;
  const said = config.associations[originSessionId];
  if (said === 'always') return true;
  if (said === 'never') return false;
  return config.intake;
}
