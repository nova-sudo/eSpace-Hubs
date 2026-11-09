/**
 * Email domains that sign up without an org signup code. Mirrors the
 * API's SIGNUP_FREE_DOMAINS (the API decides; this only hides the
 * code field so espace people never see it).
 */

import { isFreeSignupDomain, parseFreeDomains } from "@espace-devhub/shared/auth";

export const FREE_DOMAINS = parseFreeDomains(process.env.NEXT_PUBLIC_SIGNUP_FREE_DOMAINS);

export function needsSignupCode(email) {
  return !!String(email ?? "").includes("@") && !isFreeSignupDomain(email, FREE_DOMAINS);
}
