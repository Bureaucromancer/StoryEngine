import { LIBRARY_DIRECTORIES } from '@storyengine/shared';
/**
 * The client's side of docs/api.md — plain `fetch`, one wrapper.
 *
 * The server speaks folder names in URLs (`actors`, `lorebooks`, …) and schema
 * ids inside objects; both come from the shared registry, so the client never
 * maintains its own list of kinds. Adding a kind should not touch this file.
 *
 * CSRF is double-submit ([04 §4.1](docs/design/04-server-multiuser-deployment.md)):
 * the `se_csrf` cookie is script-readable precisely so this file can echo it in
 * the `x-csrf-token` header on anything state-changing.
 */
export type LibraryKind = (typeof LIBRARY_DIRECTORIES)[keyof typeof LIBRARY_DIRECTORIES];
export declare const LIBRARY_KINDS: readonly LibraryKind[];
export declare function isLibraryKind(value: unknown): value is LibraryKind;
/** The folder a schema id's objects live in, or null for a kind this build does not know. */
export declare function kindOfSchema(schemaId: string): LibraryKind | null;
/** The public account shape from `GET /api/auth/state` — never hashes or salts. */
export interface Account {
    handle: string;
    displayName: string;
    role: string;
    enabled: boolean;
    locale: string | null;
    capabilities: {
        privateConnections: boolean;
        fileAccess: string;
        enableExtensions: boolean;
    };
    createdAt: number;
}
export interface AuthState {
    setupRequired: boolean;
    account: Account | null;
}
/** The object envelope every library read returns (docs/api.md). */
export interface LibraryObject {
    id: string;
    schema: string;
    name: string;
    slug: string;
    source: 'user' | 'system';
    contentHash: string;
    shadowed: boolean;
    object: Record<string, unknown>;
}
export declare class ApiError extends Error {
    readonly status: number;
    /** The `error` field from the response body — `invalid-credentials`, `stale`, … */
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare const CSRF_COOKIE = "se_csrf";
export declare const CSRF_HEADER = "x-csrf-token";
/**
 * Reads one cookie out of a `document.cookie`-shaped string.
 *
 * A hand-rolled parse rather than a dependency: the format here is the
 * *browser's* serialisation (name=value pairs joined by "; "), which is far
 * simpler than a Set-Cookie header.
 */
export declare function cookieValue(cookies: string, name: string): string | null;
export interface Credentials {
    handle: string;
    password: string;
}
export interface SetupInput extends Credentials {
    displayName?: string;
}
export declare const api: {
    authState: () => Promise<AuthState>;
    setup: (input: SetupInput) => Promise<{
        account: Account;
    }>;
    login: (input: Credentials) => Promise<{
        account: Account;
    }>;
    logout: () => Promise<undefined>;
    listLibrary: (kind?: LibraryKind) => Promise<{
        objects: LibraryObject[];
    }>;
    readObject: (kind: LibraryKind, id: string) => Promise<LibraryObject>;
};
//# sourceMappingURL=api.d.ts.map