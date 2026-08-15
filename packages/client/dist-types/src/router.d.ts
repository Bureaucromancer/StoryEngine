import { type LibraryKind } from './api.js';
/**
 * Two routes: the list and the detail view. The kind filter is a search param
 * on the list, so a filtered library is an address like any other.
 *
 * Code-based rather than file-based routing — at two routes the generator would
 * be more machinery than route.
 */
export interface LibrarySearch {
    kind?: LibraryKind;
}
export declare const router: import("@tanstack/router-core").RouterCore<import("@tanstack/router-core").Route<import("@tanstack/react-router").Register, any, "/", "/", string, "__root__", undefined, {}, {}, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, readonly [import("@tanstack/react-router").Route<unknown, import("@tanstack/react-router").RootRoute<import("@tanstack/react-router").Register, undefined, {}, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/", "/", string, "/", (search: Record<string, unknown>) => LibrarySearch, import("@tanstack/router-core").ResolveParams<"/">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, import("@tanstack/react-router").Route<unknown, import("@tanstack/react-router").RootRoute<import("@tanstack/react-router").Register, undefined, {}, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>, "/library/$kind/$id", "/library/$kind/$id", string, "/library/$kind/$id", undefined, import("@tanstack/router-core").ResolveParams<"/library/$kind/$id">, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, import("@tanstack/router-core").AnyContext, {}, undefined, unknown, unknown, unknown, unknown, undefined>], unknown, unknown, unknown, undefined>, "never", false, import("@tanstack/history").RouterHistory, Record<string, any>>;
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
//# sourceMappingURL=router.d.ts.map