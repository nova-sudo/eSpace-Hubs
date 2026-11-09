/**
 * Absolute origin of the web app, for links that leave the app (emails,
 * GitHub issue bodies). Set APP_URL (or NEXT_PUBLIC_APP_URL) in production;
 * defaults to localhost:3000 for dev. No trailing slash.
 */
export function appOrigin(): string {
  const raw =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}
