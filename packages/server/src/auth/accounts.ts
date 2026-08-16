// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';
import { createValidator } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, readFileBytes } from '../storage/files.js';
import { assertValidHandle, type Layout } from '../storage/layout.js';
import { hashPassword, verifyPassword } from './secrets.js';

/**
 * Accounts — docs/design/04-server-multiuser-deployment.md §4.2.
 *
 * **Authoritative state, so a file and never an index row**
 * ([19 §1.3](docs/design/19-p1-implementation.md)). Deleting `index.sqlite` has
 * to stay a non-event ([18 §5](docs/design/18-internal-contracts.md)), and it
 * cannot be if losing it logs everyone out — or worse, loses the only admin.
 *
 * It sits at `data/accounts.json`, **outside every user directory**, so the file
 * browser can never serve a password hash whatever `fileAccess` a user is
 * granted ([05 §4.2.1](docs/design/05-ui-surfaces.md)). That section is worth
 * reading: an earlier draft rooted file access at the user's own directory and
 * thereby handed anyone with write access a one-line path to `role: "admin"`.
 *
 * Written through `atomic.ts` like everything else, so the no-direct-`fs` rule
 * needs no exemption for auth.
 */

/**
 * Flat, enumerated, and deliberately not a role system
 * ([04 §4.2.1](docs/design/04-server-multiuser-deployment.md)).
 *
 * **Nothing enforces these at P1** — none of the gated features exist yet. The
 * record is written now because it is a persisted shape, and a persisted shape
 * added later is a migration over user data
 * ([15 §2.1](docs/design/15-work-plan.md)). Enforcement is additive and waits
 * for P10. Splitting on exactly that line is the point.
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
    /** In-UI file browser over their own directory ([05 §4.2]). */
    fileAccess: Type.Union([Type.Literal('none'), Type.Literal('read'), Type.Literal('write')], {
      default: 'none',
    }),
    /** May enable installed extensions. Installing stays admin-only ([17 §7]). */
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
     * ([07 §12.5](docs/design/07-tech-stack.md)) — cheap now, a migration later.
     */
    locale: Type.Union([Type.String(), Type.Null()]),
    capabilities: Capabilities,
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
    createdAt: account.createdAt,
  };
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
  #cache: AccountsFile | null = null;

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  async #read(): Promise<AccountsFile> {
    if (this.#cache) return this.#cache;

    const bytes = await readFileBytes(this.#layout.accountsFile);
    if (bytes === null) {
      this.#cache = { schema: ACCOUNTS_SCHEMA, accounts: [] };
      return this.#cache;
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

    this.#cache = parsed;
    return this.#cache;
  }

  async #write(file: AccountsFile): Promise<void> {
    await writeJsonAtomic(this.#layout.accountsFile, file);
    this.#cache = file;
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
   * ([04 §5.1](docs/design/04-server-multiuser-deployment.md)). Combined with
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
    // trusted from wherever it arrived ([04 §4.3]: the path is the owner).
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

  /** Forgets the cached file, so a hand edit is picked up. */
  invalidate(): void {
    this.#cache = null;
  }
}
