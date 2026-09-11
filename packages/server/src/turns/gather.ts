// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Accounts } from '../auth/accounts.js';
import { DEFAULT_MODE_ID, defaultMode, modeById } from '../modes/registry.js';
import type { Mode } from '../modes/types.js';
import { readBindings, readSystemBindings } from '../providers/bindings.js';
import type { RoleBindings } from '../providers/roles.js';
import type { Connection } from '../providers/connections.js';
import { resolveConnections } from '../providers/connections.js';
import { walkPath } from '../sessions/segments.js';
import { readSession, readTurns, reconstructAlong, snapshotIsAt } from '../sessions/store.js';
import type { SessionContext } from '../sessions/store.js';
import type { ChannelState, SessionFile, Turn } from '../sessions/types.js';
import { readRegistry } from '../tags/store.js';
import { resolveCast, type CastMember } from './cast.js';
import { resolveLore, type ResolvedLore } from './lore.js';

/**
 * Everything an assembly needs, read once — [P3.4].
 *
 * **This exists so a preview and a real turn cannot disagree.** [P3 §1.6]
 * builds the stateless preview by stopping the call path before dispatch, and
 * [P3 §1.7] asks for *assemble-without-dispatch as a parameterised function*
 * so P5's keyword tester is a text box over machinery that already exists. A
 * second gather written beside this one would compile, pass its own tests, and
 * drift on exactly the values that fail **silently**: the mode's
 * `historyWindow` (a slip grows every previewed prompt until the budgeter
 * starts dropping, and both sides are `Turn[]`, so the type checker cannot
 * help), the `callKind` that drives `appliesTo` filtering, and the capability
 * default below, which was wrong in production from P2.5 until P3.
 *
 * **Every read here is keyed by `(account, sessionId, parentTurnId)`.** None of
 * it needs a job, a turn id or a draft — which is the property that makes the
 * preview possible at all, and the property to preserve if anything moves in.
 *
 * **Facts out; the logging stays with the caller.** The runner logs the
 * substituted mode and the ignored connections because an operator searches
 * for those lines when somebody reports a turn behaving oddly. A preview fires
 * every time somebody pauses typing, and a shared helper that logged would
 * write `mode.substituted` into the log a few times a sentence.
 */
export interface AssemblyInputs {
  session: SessionFile | null;
  /** Every turn in the session, by id — the steps' `filterReads` needs the whole map. */
  turnsById: Map<string, Turn>;
  /** The path from the head, oldest first. */
  history: Turn[];
  /** `history`, cut to the mode's `historyWindow`. **What the collector is given.** */
  windowed: Turn[];
  channels: Record<string, ChannelState>;
  usable: Connection[];
  /** Personal connections this account may not use. The caller logs the count. */
  disabled: Connection[];
  bindings: RoleBindings;
  defaults: RoleBindings;
  mode: Mode;
  /** What the session declared, which differs from `mode` when it was substituted. */
  declaredMode: string;
  preset: Mode['definition']['assembly']['defaultPreset'];
  cast: { persona: CastMember | null; actors: CastMember[] };
  /**
   * The treatment, and the books the retriever scans — [P5 §1.10].
   *
   * Gathered here rather than read by the retrieval step itself, because that
   * is this module's whole reason for existing: a preview and a real turn must
   * not be able to disagree about which books were in play. A step that read
   * the library on its own would compile, pass its own tests, and then drift on
   * exactly the kind of value whose drift is invisible — a book that resolves
   * during the preview and not during the turn makes the prompt shorter and
   * raises nothing anywhere.
   */
  lore: ResolvedLore;
}

export interface GatherContext {
  sessions: SessionContext;
  accounts: Accounts;
}

export async function gatherAssemblyInputs(
  context: GatherContext,
  request: { account: string; sessionId: string; parentTurnId: string | null },
): Promise<AssemblyInputs> {
  const session = await readSession(context.sessions, request.account, request.sessionId);
  const turnsById = await readTurns(context.sessions, request.account, request.sessionId);
  const history = walkPath(turnsById, request.parentTurnId);
  /**
   * **The channels at `parentTurnId`** — [P6.0b], with the rule and its argument
   * in `snapshotIsAt`.
   *
   * This preferred `session.channels` whenever the file could be read, which
   * assembles this history against *another* node's state the moment anything
   * asks for a node that is not the head. The effect log is the single source
   * of truth either way ([03 §5.5]), so the replay is the general case and the
   * file's map is the cheap answer for the one node it describes.
   *
   * **The same rule as `advanceHead`'s, and that is load-bearing rather than
   * tidy.** The runner chains its effects' `before` values from this map and
   * `advanceHead` folds those effects onto its own; two different rules would
   * record an inverse against a state the fold never had, and `before` is
   * exactly what P6.3's undo replays.
   */
  const channels: Record<string, ChannelState> = snapshotIsAt(session, request.parentTurnId)
    ? session.channels
    : await reconstructAlong(context.sessions, request.account, request.sessionId, history);

  /**
   * **The capability, not a literal** — [P2A §2.1], [09 §4.5].
   *
   * This passed `{ privateConnections: true }` from P2.5 until P3, which
   * defeated the one check [09 §4.5] calls load-bearing. It calls it that
   * precisely because the alternative — hiding personal connections in the
   * UI — is a trivial bypass for anyone with `fileAccess: "write"`, and a
   * turn is where a connection is actually *used*.
   *
   * An account that has vanished between reservation and run resolves to no
   * capabilities rather than to the defaults. Defaulting would mean a deleted
   * account's queued turn ran with more authority than a live one whose
   * capability had been revoked, which is the wrong way round.
   */
  const account = await context.accounts.find(request.account);
  const capabilities = account?.capabilities ?? { privateConnections: false };
  const { usable, disabled } = await resolveConnections(
    context.sessions.layout,
    request.account,
    capabilities,
  );

  // Two layers ([P2B §2.1]): the account's own, and the install defaults it
  // falls back to per role. Read together because a turn resolves every role
  // against both, and a second read per role would be the same two files.
  const bindings = await readBindings(context.sessions.layout, request.account);
  const defaults = await readSystemBindings(context.sessions.layout);

  /**
   * **What the session is playing decides what runs**, and an unknown mode
   * resolves to the default rather than refusing.
   *
   * [00 §3.3]: a session whose mode came from a newer build, or from an
   * extension that is not installed, is still somebody's story and should
   * still open. `declaredMode` travels out so the caller can say so.
   */
  const declaredMode = session?.mode?.id ?? DEFAULT_MODE_ID;
  const mode = modeById(declaredMode) ?? defaultMode();

  const preset = session?.preset ?? mode.definition.assembly.defaultPreset;
  // One library handle for both resolvers. They read the same store as the same
  // account, and building it twice would be two chances to disagree about the
  // history depth.
  const library = {
    db: context.sessions.index,
    layout: context.sessions.layout,
    keepHistoryPerObject: 0,
  };
  /**
   * Read once per turn, beside the bindings and connections this function
   * already awaits. The cast needs it so an actor reaches activation under the
   * names its tags have *now* — [05 §3](../../../../docs/design/05-tagging.md).
   */
  const tags = await readRegistry(context.sessions.layout, request.account);
  const cast = resolveCast(library, request.account, session?.cast, tags);
  /**
   * The cast is deliberately *not* passed: nothing about who is in the scene
   * decides which books are in play. A book is here because this session, or
   * the treatment it names, selected it — see `LoreRoute`.
   */
  const lore = resolveLore(library, request.account, session);
  const windowed = history.slice(-mode.definition.assembly.historyWindow);

  return {
    session,
    turnsById,
    history,
    windowed,
    channels,
    usable,
    disabled,
    bindings,
    defaults,
    mode,
    declaredMode,
    preset,
    cast,
    lore,
  };
}
