export const dynamic = "force-dynamic";

export async function POST(req) {
  const { code, codeVerifier } = await req.json();
  const gitlabUrl = process.env.NEXT_PUBLIC_GITLAB_URL;
  const clientId = process.env.NEXT_PUBLIC_GITLAB_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!gitlabUrl || !clientId || !appUrl) {
    return Response.json(
      { error: "GitLab OAuth env vars not configured" },
      { status: 500 },
    );
  }
  if (!code || !codeVerifier) {
    return Response.json({ error: "Missing code or codeVerifier" }, { status: 400 });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: `${appUrl}/oauth/gitlab`,
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${gitlabUrl.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
