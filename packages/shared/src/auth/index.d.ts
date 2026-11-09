/** Type barrel for @espace-devhub/shared/auth. */
export declare const DEFAULT_FREE_DOMAINS: readonly string[];
export declare function parseFreeDomains(raw: string | undefined | null): string[];
export declare function isFreeSignupDomain(email: string, domains: readonly string[]): boolean;
