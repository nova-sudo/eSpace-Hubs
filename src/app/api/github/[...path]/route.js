export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  return proxy(req, params, "GET");
}

export async function POST(req, { params }) {
  return proxy(req, params, "POST");
}

async function proxy(req, params, method) {
  const { path } = await params;
  const token = req.headers.get("x-devhub-token");
  if (!token) {
    return Response.json({ error: "Missing GitHub access token" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = `https://api.github.com/${path.join("/")}${url.search}`;

  const upstream = await fetch(target, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "espace-devhub",
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : await req.text(),
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
  });
}
