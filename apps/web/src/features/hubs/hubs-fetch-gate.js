/**
 * Whether HubsFetcher may call /hubs/me for this session user. An
 * unverified self-signup (`pending_email`) is limited server-side to
 * me / logout / resend-verification, so the fetch would 403 on every
 * session refresh while they sit on "check your inbox".
 */
export function canFetchHubs(user) {
  return !!user && user.status !== "pending_email";
}
