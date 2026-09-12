// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Connection } from './connections.js';
import { type Binding, type ModelRole, MODEL_ROLES } from './types.js';

export type { Binding };

/**
 * Role bindings — [19 §5.1](../../../../docs/design/19-tech-stack.md).
 *
 * **Steps never name a model. They name a role, and the install binds roles to
 * connections.** Nothing in a mode, step or extension refers to a provider or a
 * model id, which is what makes an install portable, an extension safe to
 * share, and an actor's `modelHint` resolvable as a *request*.
 *
 * ## The `[OPEN]` in §5.1, closed
 *
 * *"Whether `hi`/`lo` are real named tiers in the data model or purely a
 * setup-flow convenience over eight independent bindings."*
 *
 * **Closed as the convenience reading**, which §5.1 itself leans to. The data
 * model is eight independent bindings; `hi` and `lo` are what the first-run
 * flow asks for and {@link defaultBindings} spreads across them. Two reasons
 * the simpler reading is also the more honest one here:
 *
 * - A tier is a *third* thing to keep consistent — a binding, a tier, and the
 *   mapping between them — and the moment someone overrides one role the tier
 *   is either a lie or has to be recomputed from the bindings, at which point
 *   it was a view of them all along.
 * - The tier reading's advantage is expressing "use the cheap one for this"
 *   without knowing which roles are involved. Nothing in P2 needs to say that,
 *   and a step that did would be reaching past the role vocabulary it is
 *   supposed to speak. If P7 finds a real use, a tier is derivable from
 *   bindings without a migration; the reverse is not true.
 *
 * ## The policy the defaults encode
 *
 * > **The expensive model writes. Everything else uses the cheap one.**
 *
 * `prose` is narration — the thing the user reads and judges the product by.
 * Nearly everything else judges, extracts or classifies, and several of those
 * run *every turn*: bound to `hi` by accident they multiply a session's cost
 * for no perceptible gain, and it is experienced as "this app is expensive"
 * without anyone seeing why.
 */

/** Which of the two first-run models a role defaults onto. */
export const ROLE_TIER_DEFAULTS: Record<ModelRole, 'hi' | 'lo' | 'unset'> = {
  prose: 'hi',
  reasoning: 'hi',
  fast: 'lo',
  vision: 'lo',
  embedding: 'lo',
  // Unset until a matching connection exists: there is no sensible text-model
  // fallback for an image, and a binding that resolves to one would fail at the
  // call rather than at the setup.
  image: 'unset',
  video: 'unset',
  speech: 'unset',
};

/** What an account has bound. A role with no entry is unbound, not defaulted. */
export type RoleBindings = Partial<Record<ModelRole, Binding>>;

/**
 * The first-run answer: two models, spread across the eight roles.
 *
 * Eight separate pickers is too much setup for anyone, and a single system-wide
 * default is not enough. So the question is *a good one and a cheap one*, and
 * this is where that answer becomes eight bindings.
 */
export function defaultBindings(hi: Binding, lo: Binding): RoleBindings {
  const bindings: RoleBindings = {};
  for (const role of MODEL_ROLES) {
    const tier = ROLE_TIER_DEFAULTS[role];
    if (tier === 'hi') bindings[role] = hi;
    else if (tier === 'lo') bindings[role] = lo;
  }
  return bindings;
}

/**
 * Why a role resolved the way it did.
 *
 * The order is fixed and stated in §5.1: **install default → role binding →
 * session override → step override → actor hint.** Most people set two models
 * and never see the rest.
 *
 * `'default'` is the install layer, added at
 * [P2B §2.1](../../../../docs/design/workplan/10-p2b-provider-configuration.md). Recorded rather
 * than merged into `'binding'`, and that is the whole reason the two binding
 * maps stay separate: a merged map answers every resolvable role correctly and
 * cannot say *inherited from the install* against *yours*, which is the
 * substance of [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s one place a user sees
 * which of their bindings are personal. This type would have been lied to.
 *
 * `'session'` and `'step'` still have no caller outside tests — they are P7's,
 * with the mode contract that would use them ([P2B §1.5]).
 */
export type ResolutionSource = 'step' | 'session' | 'binding' | 'default' | 'hint';

export type RoleResolution =
  | {
      ok: true;
      role: ModelRole;
      connection: Connection;
      modelId: string;
      /** Which layer won, recorded because "why is this turn different" needs an answer. */
      via: ResolutionSource;
      /**
       * True when an actor's `modelHint` asked for a model this connection does
       * not offer. The call still happens — a hint is a preference, never a
       * binding, and an imported card may never repoint anyone's provider.
       */
      hintUnmet?: boolean;
    }
  | {
      ok: false;
      role: ModelRole;
      /**
       * `unbound` — nothing is bound to this role.
       * `dangling` — something is, and the connection it names is gone.
       *
       * Told apart because the remedies differ: the first is setup, the second
       * is an admin having removed a system connection out from under a
       * binding, and the user is told to pick another rather than being blocked
       * ([00 §3.3](../../../../docs/design/00-stance.md)).
       */
      reason: 'unbound' | 'dangling';
      connectionId?: string;
    };

/**
 * One row of the role table — [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
 * stage P2B.3, and the answer to *"why did this turn use that model"* before
 * anybody has to ask it.
 *
 * **It carries the resolution rather than re-deriving it.** [19 §5.1]'s
 * layering lives in {@link resolveRole} and nowhere else; a surface that
 * inspected the two binding maps and worked out which one would win would be a
 * second implementation of the resolution order, wrong the first time a layer
 * is added and wrong silently. So the table asks the resolver and renders what
 * it says.
 *
 * `tier` is the one thing the resolution genuinely cannot supply, because it is
 * a statement about *policy* rather than about state: `image` reporting
 * `unbound` on a fresh install is {@link ROLE_TIER_DEFAULTS} working, and
 * `prose` reporting `unbound` is an install nobody can play on. Same
 * resolution, opposite meanings, and a surface that showed them identically
 * would send an admin looking for a fault that is not there.
 */
export interface RoleRow {
  role: ModelRole;
  tier: 'hi' | 'lo' | 'unset';
  resolution: RoleResolution;
}

/**
 * One row as the wire carries it — [P2B §3], lifted here at [P7.3].
 *
 * **One shape for two surfaces.** The admin table answers *what has the install
 * got* and the user's answers *what will my turns do*; they resolve different
 * layers and produce the same row, and the client parses both into one
 * `RoleRow`. Two hand-written mappings would be two chances for that to stop
 * being true — and the drift would be silent, because each route's own test
 * would still pass.
 *
 * **The label travels and the connection's secrets do not.** That is
 * `PublicConnection`'s rule rather than a judgement made here: a label is the
 * half of a connection that is not a credential, and a table of uuids answers
 * nothing.
 */
export function presentRoleRow({ role, tier, resolution }: RoleRow): {
  role: ModelRole;
  tier: 'hi' | 'lo' | 'unset';
  ok: boolean;
  via?: ResolutionSource;
  connectionId?: string;
  connectionLabel?: string;
  modelId?: string;
  reason?: 'unbound' | 'dangling';
} {
  return {
    role,
    tier,
    ...(resolution.ok
      ? {
          ok: true as const,
          via: resolution.via,
          connectionId: resolution.connection.id,
          connectionLabel: resolution.connection.label,
          modelId: resolution.modelId,
        }
      : {
          ok: false as const,
          reason: resolution.reason,
          ...(resolution.connectionId === undefined
            ? {}
            : { connectionId: resolution.connectionId }),
        }),
  };
}

/** Every role, resolved against one set of layers, in the vocabulary's own order. */
export function roleTable(options: Omit<ResolveOptions, 'role'>): RoleRow[] {
  return MODEL_ROLES.map((role) => ({
    role,
    tier: ROLE_TIER_DEFAULTS[role],
    resolution: resolveRole({ ...options, role }),
  }));
}

export interface ResolveOptions {
  role: ModelRole;
  /** The account's own bindings. Overrides {@link ResolveOptions.defaults} per role. */
  bindings: RoleBindings;
  /**
   * The install defaults, from `system/bindings.json` ([P2B §2.1]).
   *
   * Optional so every existing caller keeps working and reads as *no install
   * layer*, which is what an install with no such file has.
   */
  defaults?: RoleBindings;
  /** Everything the account may use, already capability-filtered. */
  usable: Connection[];
  /** A session-wide override — one narrator for one session. */
  sessionOverride?: Binding;
  /** A step override — a cheap model for one noisy step. */
  stepOverride?: Binding;
  /** An actor's preference. Never a binding: it can only pick among models this connection offers. */
  hint?: { preferredModelIds?: string[] };
}

/**
 * Resolves a role to a connection and a model.
 *
 * The layering is the point. A hint is applied *last and weakest*: it may
 * choose among the models the resolved connection already offers, and it may
 * never change the connection — which is what stops an imported actor card
 * repointing somebody's provider.
 */
function isBinding(value: unknown): value is Binding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Binding).connectionId === 'string' &&
    typeof (value as Binding).modelId === 'string'
  );
}

export function resolveRole(options: ResolveOptions): RoleResolution {
  const { role, usable } = options;

  /**
   * Typed `unknown` rather than `Binding | undefined`, which is not
   * defensiveness for its own sake.
   *
   * Two of these come from **hand-written JSON** ([10 §4]), and a reader that
   * hands back the file's own shape can hand back anything the parse accepted —
   * `{"prose": null}` is well-formed JSON. `readBindingsAt` now drops entries
   * that are not `{connectionId, modelId}`, so in practice this loop is handed
   * what the type promised; declaring the promise here anyway is what stops the
   * *next* caller reintroducing the crash a P2B review found, where `null`
   * cleared an `undefined` check and threw on the property access below.
   */
  const layered: [unknown, ResolutionSource][] = [
    [options.stepOverride, 'step'],
    [options.sessionOverride, 'session'],
    [options.bindings[role], 'binding'],
    [options.defaults?.[role], 'default'],
  ];

  /**
   * **The first layer that *resolves*, not the first that exists.**
   *
   * This used to take the strongest binding and then fail if its connection was
   * gone, which made `dangling` terminal — and left
   * [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md)'s promise that a removed
   * system connection *"falls back to system bindings"* describing something the
   * code could not do, because there was no second layer to fall back to
   * ([P2B §1.2]).
   *
   * Now a personal binding whose connection is gone drops through to the install
   * default and the turn keeps working. **`dangling` survives as the answer only
   * when every layer that bound something failed**, which is the honest
   * remainder — and it reports the *strongest* such layer's connection id,
   * because that is the binding whose owner needs to fix it.
   */
  let chosen: { binding: Binding; via: ResolutionSource; connection: Connection } | null = null;
  let dangled: string | undefined;

  for (const [entry, via] of layered) {
    // A layer that did not bind a usable shape did not bind anything, which is
    // the same answer a string or a number already got by accident and the one
    // null used to throw on.
    if (!isBinding(entry)) continue;
    const binding = entry;
    const connection = usable.find((candidate) => candidate.id === binding.connectionId);
    if (connection) {
      chosen = { binding, via, connection };
      break;
    }
    dangled ??= binding.connectionId;
  }

  if (chosen === null) {
    // Nothing bound anything, versus something bound something that is gone —
    // an admin removing a system connection, or a personal one disabled by a
    // revoked capability. The remedies differ, so the answers do.
    return dangled === undefined
      ? { ok: false, role, reason: 'unbound' }
      : { ok: false, role, reason: 'dangling', connectionId: dangled };
  }

  const { binding, via, connection } = chosen;
  const preferred = options.hint?.preferredModelIds ?? [];
  const wanted = preferred.find((modelId) => connection.models.includes(modelId));

  return {
    ok: true,
    role,
    connection,
    modelId: wanted ?? binding.modelId,
    via: wanted === undefined ? via : 'hint',
    ...(preferred.length > 0 && wanted === undefined ? { hintUnmet: true } : {}),
  };
}
