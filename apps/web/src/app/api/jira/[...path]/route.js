export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  return proxy(req, params, "GET");
}

export async function POST(req, { params }) {
  return proxy(req, params, "POST");
}

async function proxy(req, params, method) {
  const { path } = await params;
  const jiraUrl = process.env.NEXT_PUBLIC_JIRA_URL;
  if (!jiraUrl) {
    return Response.json(
      { error: "NEXT_PUBLIC_JIRA_URL not configured" },
      { status: 500 },
    );
  }

  const email = req.headers.get("x-devhub-email");
  const apiToken = req.headers.get("x-devhub-api-token");
  if (!email || !apiToken) {
    return Response.json({ error: "Missing Jira credentials" }, { status: 401 });
  }

  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const url = new URL(req.url);
  const target = `${jiraUrl.replace(/\/$/, "")}/rest/api/3/${path.join("/")}${url.search}`;

  const upstream = await fetch(target, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
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
