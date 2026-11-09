import test from "node:test";
import assert from "node:assert/strict";

import { renderEmail, type EmailContent } from "./email-layout.js";

const base: EmailContent = {
  tone: "sky",
  title: "Hello",
  footer: { reason: "Because." },
  preheader: "Preview text",
};

test("escapes caller strings in html, keeps them raw in text", () => {
  const title = 'Ship <img src=x onerror=alert(1)> "now"';
  const { html, text } = renderEmail({ ...base, title });
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&quot;now&quot;"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(text.includes(title));
});

test("uses the tone's surface and ink in the header", () => {
  const { html } = renderEmail({ ...base, tone: "peach" });
  assert.ok(html.includes("#ffe4d6"));
  assert.ok(html.includes("#9a3412"));
});

test("renders logo + eSpace Hubs wordmark", () => {
  const { html } = renderEmail(base);
  assert.ok(html.includes("/brand/png/mark-128.png"));
  assert.ok(html.includes("Hubs"));
  assert.ok(!html.includes("Dev Hub"));
});

test("cta renders a button and a text line", () => {
  const { html, text } = renderEmail({
    ...base,
    cta: { label: "Open the goal", url: "https://x/n/1" },
  });
  assert.ok(html.includes('href="https://x/n/1"'));
  assert.ok(text.includes("Open the goal: https://x/n/1"));
});

test("no cta → no button", () => {
  const { html } = renderEmail(base);
  assert.ok(!html.includes("border-radius:999px"));
});

test("list renders headings and badges", () => {
  const { html, text } = renderEmail({
    ...base,
    list: [
      { heading: "Overdue", rows: [{ label: "W45 check-in", badge: "Thu 6 Nov", tone: "peach" }] },
      { heading: "Due this week", rows: [{ label: "Review log", badge: "Tue", tone: "lemon" }] },
    ],
  });
  for (const s of ["Overdue", "Due this week", "W45 check-in", "Review log", "Thu 6 Nov"]) {
    assert.ok(html.includes(s), `html has ${s}`);
    assert.ok(text.includes(s), `text has ${s}`);
  }
});

test("footer shows manage and mute links only when given", () => {
  const none = renderEmail(base).html;
  assert.ok(!none.includes("Manage emails"));
  assert.ok(!none.includes("Mute this kind"));
  const both = renderEmail({
    ...base,
    footer: { reason: "r", manageUrl: "https://x/m", muteUrl: "https://x/u" },
  }).html;
  assert.ok(both.includes("Manage emails"));
  assert.ok(both.includes("Mute this kind"));
  const manageOnly = renderEmail({
    ...base,
    footer: { reason: "r", manageUrl: "https://x/m", muteUrl: null },
  }).html;
  assert.ok(manageOnly.includes("Manage emails"));
  assert.ok(!manageOnly.includes("Mute this kind"));
});

test("preheader is hidden text at the top of body", () => {
  const { html } = renderEmail(base);
  const body = html.indexOf("<body");
  const pre = html.indexOf("Preview text");
  assert.ok(pre > body);
  assert.ok(html.slice(body, pre).includes("<body"));
  assert.ok(html.slice(pre - 200, pre).includes("display:none"));
});
