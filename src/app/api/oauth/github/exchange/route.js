export const dynamic = "force-dynamic";

export async function POST(req) {
  const { code } = await req.json();
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    return Response.json(
      { error: "GitHub OAuth env vars not configured (NEXT_PUBLIC_GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET)" },
      { status: 500 },
    );
  }
  if (!code) {
    return Response.json({ error: "Missing code" }, { status: 400 });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${appUrl}/oauth/github`,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
