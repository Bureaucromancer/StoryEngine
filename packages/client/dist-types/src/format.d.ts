/**
 * Date formatting — `Intl` only, from the first component
 * ([07 §12.6](docs/design/07-tech-stack.md)). No hand-rolled "2 minutes ago".
 *
 * `locale` is the account's, when there is one; `undefined` falls back to the
 * browser's. Passing it explicitly rather than reading a global keeps these
 * pure, which is also what makes them testable under Node.
 */
/** A portable object's `provenance` timestamps, when it has any. */
export interface Timestamps {
    createdAt: string | null;
    updatedAt: string | null;
}
export declare function timestampsOf(object: Record<string, unknown>): Timestamps;
/**
 * An RFC 3339 timestamp as a readable date and time.
 *
 * An unparsable input comes back unchanged: the value is still information, and
 * a blank or a crash would hide it.
 */
export declare function formatTimestamp(iso: string, locale?: string): string;
/** Epoch milliseconds (the account's `createdAt`) as a readable date. */
export declare function formatEpochMs(epochMs: number, locale?: string): string;
//# sourceMappingURL=format.d.ts.map