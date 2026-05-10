export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  return proxy(req, params, "GET");
}

export async function POST(req, { params }) {
  return proxy(req, params, "POST");
}

async function proxy(req, params, method) {
  const { path } = await params;
  const gitlabUrl = process.env.NEXT_PUBLIC_GITLAB_URL;
  if (!gitlabUrl) {
    return Response.json(
      { error: "NEXT_PUBLIC_GITLAB_URL not configured" },
      { status: 500 },
    );
  }

  const token = req.headers.get("x-devhub-token");
  if (!token) {
    return Response.json({ error: "Missing GitLab access token" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = `${gitlabUrl.replace(/\/$/, "")}/api/v4/${path.join("/")}${url.search}`;

  const upstream = await fetch(target, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
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
