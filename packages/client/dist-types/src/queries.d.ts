import { QueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { type Account, type AuthState, type Credentials, type LibraryKind, type LibraryObject, type SetupInput } from './api.js';
export declare const queryClient: QueryClient;
export declare function useAuthState(): UseQueryResult<AuthState>;
export declare function useLibrary(kind?: LibraryKind): UseQueryResult<{
    objects: LibraryObject[];
}>;
export declare function useLibraryObject(kind: LibraryKind, id: string): UseQueryResult<LibraryObject>;
export declare function useSetup(): UseMutationResult<{
    account: Account;
}, Error, SetupInput>;
export declare function useLogin(): UseMutationResult<{
    account: Account;
}, Error, Credentials>;
export declare function useLogout(): UseMutationResult<undefined, Error, void>;
//# sourceMappingURL=queries.d.ts.map