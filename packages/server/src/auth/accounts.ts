// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';
import { createValidator, uuidv7 } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import {
  ensureDirectory,
  fileExists,
  type FileFacts,
  moveTree,
  readFileBytes,
  statFile,
} from '../storage/files.js';
import { assertValidHandle, type Layout } from '../storage/layout.js';
import { hashPassword, verifyPassword } from './secrets.js';

/**
 * Accounts — docs/design/09-server-multiuser-deployment.md §4.2.
 *
 * **Authoritative state, so a file and never an index row**
 * ([P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md)). Deleting `index.sqlite` has
 * to stay a non-event ([21 §5](../../../../docs/design/21-internal-contracts.md)), and it
 * cannot be if losing it logs everyone out — or worse, loses the only admin.
 *
 * It sits at `data/accounts.json`, **outside every user directory**, so the file
 * browser can never serve a password hash whatever `fileAccess` a user is
 * granted ([10 §4.2.1](../../../../docs/design/10-ui-surfaces.md)). That section is worth
 * reading: an earlier draft rooted file access at the user's own directory and
 * thereby handed anyone with write access a one-line path to `role: "admin"`.
 *
 * Written through `atomic.ts` like everything else, so the no-direct-`fs` rule
 * needs no exemption for auth.
 */

/**
 * Flat, enumerated, and deliberately not a role system
 * ([09 §4.2.1](../../../../docs/design/09-server-multiuser-deployment.md)).
 *
 * The record was written at P1 because it is a persisted shape, and a persisted
 * shape added later is a migration over user data
 * ([work plan §2.1](../../../../docs/design/workplan/01-work-plan.md)). Enforcement was deferred on the
 * same reasoning — it is additive — and this comment said so until
 * [P2A](../../../../docs/design/workplan/09-p2a-configuration-surface.md) made the deferral false.
 *
 * **`privateConnections` is enforced now**, in `turns/runner.ts`, where
 * connections resolve. Never at the UI: [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md)
 * calls the loader-level check the load-bearing one precisely because a
 * UI-level one is a trivial bypass for anyone with `fileAccess: "write"`.
 *
 * The move was forced rather than opportunistic. A screen that *grants* a
 * capability changes the argument, because [work plan §2.2] forbids building a system
 * whose only purpose is to be replaced — and a switch labelled *may add their
 * own provider keys* that adds nothing is not a small version of the real
 * thing, it is a false front.
 *
 * ***`enableExtensions` has an owner since [P10.3], and it is not a phase*** —
 * 2026-09-16. [P10 §1.5]'s fork is closed: **1.0 needs extensions *loaded*, not
 * *installed***, the first-party reference extension ships inside the image the
 * way a built-in mode does, and acquiring one from outside is
 * [24 §3.2](../../../../docs/design/24-roadmap.md)'s. So this field stays and
 * stays inert on purpose — it is specified ([22 §7]), it costs a boolean, and
 * the settings surface says what it is rather than rendering it as though it
 * were live. *What changed is that the sentence below stopped being a dangling
 * owner written into code*: the deferral now has a row somebody can find.
 *
 * ~~**`fileAccess` and `enableExtensions` still gate nothing**~~ **`fileAccess`
 * gates the import sweep, since P4.4** ([10 §4.2.2](../../../../docs/design/10-ui-surfaces.md)).
 * `routes/import.ts` refuses `POST /api/import/sweep` when it reads `none`, so
 * the capability is enforced at the route the way `privateConnections` is
 * enforced at the loader — which is what moved it out of the settings surface's
 * *recorded for later* group at the P4 audit, three weeks after the enforcement
 * landed without it.
 *
 * The widening is deliberate and is argued in [10 §4.2.2] rather than implied
 * here: the capability was written for a file browser over the user's **own**
 * directory, and it now also permits naming a path **outside** `/data` for a
 * read-only sweep. `storage/local-source.ts` carves `/data` out so the two
 * halves cannot overlap. The file browser itself ([01 §4], roadmap) is still
 * unbuilt, so `read` and `write` differ only in what they will mean later.
 *
 * **`enableExtensions` still gates nothing**, and the settings surface says so
 * rather than rendering it as though it were live: extensions appear in no
 * phase list at all.
 */
export const Capabilities = Type.Object(
  {
    /**
     * May add and use their own connections. When false, only system
     * connections resolve for this user.
     *
     * Default true: the threat model is access separation among people who
     * trust each other, so permissive by default and an admin turns it off
     * deliberately.
     */
    privateConnections: Type.Boolean({ default: true }),
    /**
     * Two grants under one name ([10 §4.2](../../../../docs/design/10-ui-surfaces.md),
     * [§4.2.2](../../../../docs/design/10-ui-surfaces.md)): an in-UI file
     * browser over their own directory, which is unbuilt, and — for anything
     * above `none` — naming a host path outside `/data` for a read-only import
     * sweep, which ships. The second is why the default is `none` and why the
     * admin label names the sweep rather than the browser.
     */
    fileAccess: Type.Union([Type.Literal('none'), Type.Literal('read'), Type.Literal('write')], {
      default: 'none',
    }),
    /** May enable installed extensions. Installing stays admin-only ([22 §7]). */
    enableExtensions: Type.Boolean({ default: false }),
  },
  { title: 'Capabilities' },
);
export type Capabilities = Static<typeof Capabilities>;

export const DEFAULT_CAPABILITIES: Capabilities = {
  privateConnections: true,
  fileAccess: 'none',
  enableExtensions: false,
};

export const Account = Type.Object(
  {
    /** Stable, used for directory names, immutable. */
    handle: Type.String({ minLength: 1, maxLength: 63 }),
    displayName: Type.String(),
    passwordHash: Type.String(),
    salt: Type.String(),
    role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
    enabled: Type.Boolean(),
    /**
     * BCP-47, defaulted from `Accept-Language` on first login.
     *
     * Here at P1 because push notifications are rendered by the server with the
     * app closed, so it must know each user's language
     * ([19 §12.5](../../../../docs/design/19-tech-stack.md)) — cheap now, a migration later.
     */
    locale: Type.Union([Type.String(), Type.Null()]),
    capabilities: Capabilities,
    /**
     * Kept off the sign-in grid — [12 §4](../../../../docs/design/12-account-gallery.md),
     * [P10.4].
     *
     * ***Optional, and absent means listed.*** The polarity is chosen so that
     * absence is correct by construction: every account written before this
     * field existed is a listed account, and the filter that builds the gallery
     * — keep `enabled`, drop this — does the right thing to a record that has
     * never heard of it, with no default machinery to forget. *The positive
     * spelling (`listedInGallery`, default true) fails exactly there*: the
     * first reader that forgets the default hides every account created before
     * the feature shipped.
     *
     * ***Optional in the schema with the default applied in code, and that is a
     * constraint rather than a style choice.*** Account validation runs with
     * `useDefaults` off, every other field here is required, and this store
     * **blocks rather than degrades** on a file that fails validation — it is
     * the one that does. A required field would brick every existing install on
     * upgrade.
     *
     * **Not a fourth capability.** Capabilities are what an account *may do*,
     * enumerated so an admin can be shown each with its consequence
     * ([09 §4.2.1]); this grants nothing and withholds nothing — the account
     * signs in identically either way, by typing its handle
     * ([12 §2]'s lockout invariant). It is kin to `displayName`: a fact about
     * how the account is *shown*.
     *
     * **On `Account` rather than in `prefs.json`** because the server reads it
     * for a reader who is nobody yet. [10 §15.1] draws that line for the theme:
     * what only your own browser reads is a preference, what other people and
     * the server read is an account field, and a gallery is built before there
     * is a session to have preferences.
     */
    hiddenFromGallery: Type.Optional(Type.Boolean()),
    createdAt: Type.Integer(),
  },
  { title: 'Account' },
);
export type Account = Static<typeof Account>;

const AccountsFile = Type.Object(
  {
    schema: Type.Literal('storyengine.accounts/1'),
    accounts: Type.Array(Account),
  },
  { title: 'AccountsFile' },
);
type AccountsFile = Static<typeof AccountsFile>;

const ACCOUNTS_SCHEMA = 'storyengine.accounts/1';

export class AccountError extends Error {
  readonly code: 'exists' | 'not-found' | 'invalid' | 'last-admin';

  constructor(code: AccountError['code'], message: string) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

/** Everything the rest of the server may know about an account. */
export type PublicAccount = Omit<Account, 'passwordHash' | 'salt'>;

export function toPublic(account: Account): PublicAccount {
  // Built by picking rather than by omitting: a destructuring rest would let a
  // field added to Account later reach a client by default, and the fields most
  // likely to be added here are the ones that must not.
  return {
    handle: account.handle,
    displayName: account.displayName,
    role: account.role,
    enabled: account.enabled,
    locale: account.locale,
    capabilities: account.capabilities,
    /**
     * **Picked, which is this function's whole design working as intended** —
     * [12 §4]. A signed-in client needs it to render the toggle; an
     * unauthenticated one gets {@link toGalleryEntry}'s narrower shape instead,
     * which does not carry it because *whether you opted out* is not a thing to
     * publish to nobody.
     *
     * *Omitted rather than defaulted to `false`*, so a `PublicAccount` says the
     * same thing the record does: the field's presence marks a choice somebody
     * made, and `accounts.json` stays *"a plain document somebody can read"*.
     */
    ...(account.hiddenFromGallery === undefined
      ? {}
      : { hiddenFromGallery: account.hiddenFromGallery }),
    createdAt: account.createdAt,
  };
}

/**
 * One tile on the sign-in screen — [12 §6](../../../../docs/design/12-account-gallery.md),
 * [P10.4].
 *
 * ***Its own projection, never `PublicAccount`.*** {@link toPublic} is already
 * built by picking rather than omitting, on the argument that the fields most
 * likely to be added are the ones that must not leak — **and it is still too
 * wide for this socket**: it carries `role`, `enabled`, `capabilities`, `locale`
 * and `createdAt`, none of which belongs in front of an unauthenticated caller.
 *
 * So this is a second, narrower picking function with the same property, and
 * `gallery.test.ts` holds it to exactly three fields: a field added to
 * `Account` reaches the sign-in screen only when a line of code picks it.
 */
export interface GalleryEntry {
  handle: string;
  displayName: string;
  /**
   * A content-hash token for the uploaded face, or null when there is none —
   * in which case the client draws one ([12 §5.4]).
   *
   * *A token rather than a URL*, so the address is the client's to compose and
   * the cache-busting is structural: a changed face is a changed token is a
   * changed URL, and an unchanged one is a 304.
   */
  avatar: string | null;
}

/**
 * ***Typed over the fields it picks, not over `Account`***, which is the
 * picking argument one level up: a function that took a whole account could be
 * handed one and quietly start reading more of it, and the narrow parameter is
 * what makes *"a field reaches the sign-in screen only when a line picks it"*
 * a fact about the signature rather than about this body.
 *
 * It also means the two callers hand over a `PublicAccount` — which has already
 * dropped the hash and the salt — so the projection is narrowing a narrow thing
 * rather than reaching back into the record.
 */
export function toGalleryEntry(
  account: Pick<Account, 'handle' | 'displayName'>,
  avatar: string | null,
): GalleryEntry {
  return { handle: account.handle, displayName: account.displayName, avatar };
}

/** **Filter: enabled and not hidden. Nothing else** — [12 §6]. */
export function isListedInGallery(
  account: Pick<Account, 'enabled' | 'hiddenFromGallery'>,
): boolean {
  return account.enabled && account.hiddenFromGallery !== true;
}

/**
 * The account store.
 *
 * Read whole and written whole: a household has single-digit accounts, so the
 * simplest correct thing is also the right one, and it keeps the file a plain
 * document somebody can read.
 */
export class Accounts {
  readonly #layout: Layout;
  /**
   * Cached against the file's `(mtime, size)`, revalidated by a stat on every
   * read — not held forever. Two writers are legitimate here: a running server
   * and a `--reset-password` process fixing an account beside it. A cache with
   * no expiry would keep authenticating against the password the reset just
   * replaced, silently, until a restart — and would also mean a hand edit to
   * accounts.json is never seen at all. A stat per read is what the object
   * index pays per *watch event* for the same freshness, and requests already
   * pay more than that in queries.
   */
  #cache: { facts: FileFacts | null; file: AccountsFile } | null = null;

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  async #read(): Promise<AccountsFile> {
    const facts = await statFile(this.#layout.accountsFile);
    if (this.#cache && sameFacts(this.#cache.facts, facts)) {
      return this.#cache.file;
    }

    const bytes = await readFileBytes(this.#layout.accountsFile);
    if (bytes === null) {
      this.#cache = { facts: null, file: { schema: ACCOUNTS_SCHEMA, accounts: [] } };
      return this.#cache.file;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // A truncated or hand-mangled file is the same refusal as a mis-shaped
      // one — but a raw SyntaxError names neither the file nor the decision.
      throw new AccountError(
        'invalid',
        `${this.#layout.accountsFile} is not valid JSON. Refusing to start rather than guess.`,
      );
    }
    const validate = createValidator().compile(AccountsFile);
    if (!validate(parsed)) {
      // Refusing to start is the right failure here. Every other store in this
      // project degrades rather than blocks, and this is the exception: a
      // malformed accounts file means the server cannot tell who anyone is, and
      // continuing would mean continuing as nobody.
      throw new AccountError(
        'invalid',
        `${this.#layout.accountsFile} is not a valid accounts file. Refusing to start rather than guess.`,
      );
    }

    this.#cache = { facts, file: parsed };
    return this.#cache.file;
  }

  async #write(file: AccountsFile): Promise<void> {
    const token = await writeJsonAtomic(this.#layout.accountsFile, file);
    this.#cache = { facts: { mtimeMs: token.mtimeMs, size: token.size }, file };
  }

  async list(): Promise<PublicAccount[]> {
    return (await this.#read()).accounts.map(toPublic);
  }

  async count(): Promise<number> {
    return (await this.#read()).accounts.length;
  }

  /**
   * True until the first admin exists.
   *
   * **First-run setup gates everything** — until an admin account exists, every
   * route except setup returns the setup flow
   * ([09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md)). Combined with
   * the loopback default this closes the claim window on bare-metal installs.
   */
  async needsSetup(): Promise<boolean> {
    return (await this.count()) === 0;
  }

  async find(handle: string): Promise<PublicAccount | null> {
    const account = (await this.#read()).accounts.find((entry) => entry.handle === handle);
    return account ? toPublic(account) : null;
  }

  /**
   * Verifies a password and returns the account, or null.
   *
   * Null covers "no such handle", "wrong password" and "disabled" alike. The
   * caller cannot tell which, and neither can whoever is typing — that costs
   * nothing here and avoids a handle oracle.
   */
  async authenticate(handle: string, password: string): Promise<PublicAccount | null> {
    const account = (await this.#read()).accounts.find((entry) => entry.handle === handle);
    if (!account?.enabled) return null;

    const ok = await verifyPassword(password, { salt: account.salt, hash: account.passwordHash });
    return ok ? toPublic(account) : null;
  }

  async create(input: {
    handle: string;
    displayName?: string;
    password: string;
    role: Account['role'];
    locale?: string | null;
    capabilities?: Partial<Capabilities>;
  }): Promise<PublicAccount> {
    // The handle becomes a directory name, so it is checked here rather than
    // trusted from wherever it arrived ([09 §4.3]: the path is the owner).
    assertValidHandle(input.handle);

    const file = await this.#read();
    if (file.accounts.some((entry) => entry.handle === input.handle)) {
      throw new AccountError(
        'exists',
        `An account with the handle ${input.handle} already exists.`,
      );
    }

    const { salt, hash } = await hashPassword(input.password);
    const account: Account = {
      handle: input.handle,
      displayName: input.displayName ?? input.handle,
      passwordHash: hash,
      salt,
      role: input.role,
      enabled: true,
      locale: input.locale ?? null,
      capabilities: { ...DEFAULT_CAPABILITIES, ...input.capabilities },
      createdAt: Date.now(),
    };

    await this.#write({ ...file, accounts: [...file.accounts, account] });
    // The library directory is created eagerly so the folder appears the moment
    // an account does, rather than on the first write. `ls data/users/ned/` is
    // part of the P1 demo.
    await ensureDirectory(this.#layout.libraryRoot({ kind: 'user', handle: input.handle }));

    return toPublic(account);
  }

  /**
   * Creates the first admin.
   *
   * Separate from {@link create} because it is the one account creation that
   * happens with nobody logged in, and conflating them is how an
   * unauthenticated route ends up able to make an admin at any time.
   */
  async createFirstAdmin(input: {
    handle: string;
    displayName?: string;
    password: string;
    locale?: string | null;
  }): Promise<PublicAccount> {
    if (!(await this.needsSetup())) {
      throw new AccountError('exists', 'Setup has already been completed.');
    }
    return this.create({ ...input, role: 'admin' });
  }

  /**
   * What an account may change about **itself** — [10 §15.1].
   *
   * A separate method from {@link update} rather than one method with a flag,
   * and the difference is the type: this signature *cannot express* a role,
   * an enabled flag or a capability, so the self-service route cannot pass one
   * through by forgetting to strip it. A shared updater guarded by a boolean
   * would put that guarantee in a branch instead of in a signature, and a
   * branch is something a later caller can get wrong.
   *
   * [P2A §2.3] makes the same argument about removal, and it is the same
   * argument the library makes about there being no `:handle` parameter to
   * forget: the safest guard is one there is no way to omit.
   */
  async updateSelf(
    handle: string,
    patch: {
      displayName?: string;
      locale?: string | null;
      /**
       * ***A widening, and a deliberate one*** — [12 §4], [P10.4]. This method
       * rebuilds its patch field by field *precisely so* that adding a field is
       * a decision rather than a consequence, and hiding your own face from the
       * sign-in screen is a privacy preference about your own face: the account
       * holder's, the way the display name is.
       */
      hiddenFromGallery?: boolean;
    },
  ): Promise<PublicAccount> {
    // **Picked, not forwarded.** The narrow signature is a compile-time
    // guarantee and TypeScript's types are erased, so forwarding `patch` whole
    // meant a caller reaching this with an extra `role` — an untyped body, a
    // JavaScript consumer, a future route that widened its schema — had it
    // silently applied. Rebuilding the object from the two fields this verb
    // owns makes "cannot express a role" true at runtime as well, and mirrors
    // what `toPublic()` does in the other direction.
    return this.#patch(handle, {
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.locale === undefined ? {} : { locale: patch.locale }),
      ...(patch.hiddenFromGallery === undefined
        ? {}
        : { hiddenFromGallery: patch.hiddenFromGallery }),
    });
  }

  /**
   * What an admin may change about anyone — [10 §15.2].
   *
   * Everything {@link updateSelf} covers, plus the three fields that are
   * somebody else's business: the role, the enabled flag, and the capability
   * record `Capabilities` has carried since P1 with nothing ever granting it.
   *
   * Capabilities merge rather than replace, so a form sending one switch does
   * not silently clear the other two — the client sends what it changed, and a
   * newer build's capability survives an older client's patch.
   */
  async update(
    handle: string,
    patch: {
      displayName?: string;
      locale?: string | null;
      role?: Account['role'];
      enabled?: boolean;
      capabilities?: Partial<Capabilities>;
      /** [12 §4]: *"both the person and the admin can set it."* */
      hiddenFromGallery?: boolean;
    },
  ): Promise<PublicAccount> {
    return this.#patch(handle, patch);
  }

  async #patch(
    handle: string,
    patch: {
      displayName?: string;
      locale?: string | null;
      role?: Account['role'];
      enabled?: boolean;
      capabilities?: Partial<Capabilities>;
      hiddenFromGallery?: boolean;
    },
  ): Promise<PublicAccount> {
    const file = await this.#read();
    const account = file.accounts.find((entry) => entry.handle === handle);
    if (!account) {
      throw new AccountError('not-found', `No account with the handle ${handle}.`);
    }

    const updated: Account = {
      ...account,
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.locale === undefined ? {} : { locale: patch.locale }),
      ...(patch.role === undefined ? {} : { role: patch.role }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.capabilities === undefined
        ? {}
        : { capabilities: { ...account.capabilities, ...patch.capabilities } }),
      /**
       * **`false` removes the field rather than storing it**, which keeps
       * [12 §4]'s polarity true on disk: absence means listed, so *"only
       * objectors carry the field"* and `accounts.json` stays a document where
       * a field's presence marks a choice somebody made.
       */
      ...(patch.hiddenFromGallery === undefined
        ? {}
        : patch.hiddenFromGallery
          ? { hiddenFromGallery: true }
          : {}),
    };
    if (patch.hiddenFromGallery === false) delete updated.hiddenFromGallery;

    assertAdminSurvives(file, account, updated);
    await this.#write({
      ...file,
      accounts: file.accounts.map((entry) => (entry.handle === handle ? updated : entry)),
    });
    return toPublic(updated);
  }

  /**
   * Removes an account and moves its directory to `data/removed/` — [P2A §2.3].
   *
   * **The destructive verb, and it is destructive on purpose.** Disabling is
   * `update(handle, { enabled: false })` and needs no method of its own; a
   * `keepData` flag that turned this into a not-delete would be exactly the
   * shape that makes a dangerous control feel routine.
   *
   * **The directory moves before the record goes**, and the order is the whole
   * of the failure design. Record-first would mean a failed move leaves the
   * handle free with the old data still at `users/<handle>/` — so recreating
   * the account would silently inherit somebody else's library, which is the
   * worst outcome available and an invisible one. This way a failed write
   * leaves an account whose directory has moved: broken, obvious, and
   * recoverable by hand from a folder StoryEngine has promised not to touch.
   */
  async remove(handle: string): Promise<void> {
    const file = await this.#read();
    const account = file.accounts.find((entry) => entry.handle === handle);
    if (!account) {
      throw new AccountError('not-found', `No account with the handle ${handle}.`);
    }
    assertAdminSurvives(file, account, null);

    // Guarded because an account whose directory is already gone should still
    // be removable — refusing there would trap an admin inside a broken state
    // rather than letting them leave it. (`fileExists` is a stat, which does
    // not care that this one is a directory.)
    if (await fileExists(this.#layout.userRoot(handle))) {
      await moveTree(
        this.#layout.userRoot(handle),
        this.#layout.removedDestination(handle, uuidv7()),
      );
    }

    await this.#write({
      ...file,
      accounts: file.accounts.filter((entry) => entry.handle !== handle),
    });
  }

  /**
   * Replaces an account's password, and re-enables the account.
   *
   * **The break-glass path.** Its only caller is the `--reset-password` flag
   * on the server binary, which means the authority behind it is host access —
   * and anyone who can read `data/` owns the install already
   * ([09 §4.1](../../../../docs/design/09-server-multiuser-deployment.md)), so this adds no
   * authority that did not exist. At 1.0 the *norm* is an admin resetting an
   * account through the UI (P10); this remains the rung beneath it, for when
   * no usable admin account exists.
   *
   * Re-enabling is deliberate rather than incidental: a disabled account is
   * the same lockout wearing a different hat, nothing else can re-enable one
   * until P10, and resetting a password someone still cannot use would be a
   * half-repair.
   */
  async resetPassword(handle: string, password: string): Promise<PublicAccount> {
    return this.#setPassword(handle, password, { reEnable: true });
  }

  /**
   * Sets a password, leaving `enabled` alone.
   *
   * The self-service verb, and the difference from {@link resetPassword} is the
   * one thing this must not inherit: **re-enabling**. That is right for the
   * break-glass path, where a disabled account is the same lockout wearing a
   * different hat and nothing else can clear it — and wrong here, where an
   * admin has disabled somebody and a password change would quietly undo it.
   *
   * **Verifying the current password is not done here**, and the omission is
   * deliberate rather than an oversight: `authenticate` is *the* password check
   * in this codebase, and a second one written beside it is how two checks drift
   * into disagreeing about disabled accounts or about timing. The route
   * ([P2A §3], P2A.2) calls `authenticate` and then this, which is also what
   * makes the admin reset — no current password to know — the same method with
   * one fewer step rather than a separate code path.
   */
  async changePassword(handle: string, password: string): Promise<PublicAccount> {
    return this.#setPassword(handle, password, { reEnable: false });
  }

  async #setPassword(
    handle: string,
    password: string,
    options: { reEnable: boolean },
  ): Promise<PublicAccount> {
    const file = await this.#read();
    const account = file.accounts.find((entry) => entry.handle === handle);
    if (!account) {
      throw new AccountError('not-found', `No account with the handle ${handle}.`);
    }

    const { salt, hash } = await hashPassword(password);
    const updated: Account = {
      ...account,
      passwordHash: hash,
      salt,
      ...(options.reEnable ? { enabled: true } : {}),
    };
    await this.#write({
      ...file,
      accounts: file.accounts.map((entry) => (entry.handle === handle ? updated : entry)),
    });
    return toPublic(updated);
  }
}

/** An admin who can actually sign in. A disabled one locks the install out too. */
function usableAdmin(account: Account): boolean {
  return account.role === 'admin' && account.enabled;
}

/**
 * Refuses any change that would leave the install with no usable admin.
 *
 * **One predicate for three gestures** — demote, disable, remove — because they
 * are one failure wearing three faces, and three separate checks is how the
 * third one gets written differently or not at all. It is also the first
 * thrower `AccountError`'s `last-admin` code has ever had: the code was
 * declared at P1 against a day nobody could yet reach.
 *
 * "Usable" rather than "present" is the load-bearing word. An install whose
 * only admin is disabled is locked out exactly as thoroughly as one with no
 * admin at all, and it is a state an admin can otherwise walk into in one
 * click while the account list still shows an administrator.
 *
 * `after` is `null` for a removal. Passing the account being removed and
 * letting this work out that it is gone would mean encoding "removed" as some
 * field combination, and there isn't one.
 */
function assertAdminSurvives(file: AccountsFile, before: Account, after: Account | null): void {
  if (!usableAdmin(before)) return;
  if (after !== null && usableAdmin(after)) return;

  const others = file.accounts.filter(
    (entry) => entry.handle !== before.handle && usableAdmin(entry),
  );
  if (others.length > 0) return;

  throw new AccountError(
    'last-admin',
    after === null
      ? `${before.handle} is the only administrator who can sign in. Make somebody else an administrator first.`
      : `${before.handle} is the only administrator who can sign in, and this would leave none. Make somebody else an administrator first.`,
  );
}

function sameFacts(cached: FileFacts | null, current: FileFacts | null): boolean {
  if (cached === null || current === null) return cached === current;
  return cached.mtimeMs === current.mtimeMs && cached.size === current.size;
}
