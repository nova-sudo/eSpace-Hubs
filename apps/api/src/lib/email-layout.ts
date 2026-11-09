/**
 * The one email layout (design: docs/superpowers/specs/2026-11-09-email-notifications-design.md).
 *
 *   grey canvas
 *     logo mark + "eSpace Hubs" wordmark
 *     white 20px card
 *       tinted header — title + subtitle; the tint carries state
 *       body — paragraphs, grouped list, note, ink pill CTA
 *     footer — why you got this · Manage emails · Mute this kind
 *
 * Email clients can't read CSS variables, strip <style> blocks and flexbox,
 * and block SVG — so this is table markup with every style inline, a PNG
 * logo, and literal colours mirrored from apps/web/src/app/globals.css in
 * EMAIL_PALETTE (the only place they live in the API). Light only.
 *
 * Callers pass plain text; everything is escaped here. The text body is
 * built from the same content so the two never drift.
 */

import { appOrigin } from "./app-url.js";

export type EmailTone = "mint" | "peach" | "lemon" | "sky";

export const EMAIL_PALETTE = Object.freeze({
  canvas: "#f4f4f5",
  card: "#ffffff",
  fg: "#18181b",
  muted: "#6d6d76",
  wordmarkMuted: "#71717a",
  line: "rgba(24,24,27,0.07)",
  ink: "#18181b",
  inkOn: "#ffffff",
  tones: {
    mint: { bg: "#dcf5e6", ink: "#14532d" },
    peach: { bg: "#ffe4d6", ink: "#9a3412" },
    lemon: { bg: "#fbf3c4", ink: "#713f12" },
    sky: { bg: "#e0eafe", ink: "#1e3a8a" },
  } satisfies Record<EmailTone, { bg: string; ink: string }>,
});

export interface EmailListRow {
  label: string;
  badge: string;
  tone: EmailTone;
}

export interface EmailContent {
  tone: EmailTone;
  title: string;
  subtitle?: string | null;
  paragraphs?: string[];
  list?: { heading: string; rows: EmailListRow[] }[];
  note?: string | null;
  cta?: { label: string; url: string } | null;
  footer: { reason: string; manageUrl?: string | null; muteUrl?: string | null };
  preheader: string;
}

/** Escape a string for an HTML text node or attribute. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const P = EMAIL_PALETTE;

function listHtml(list: NonNullable<EmailContent["list"]>): string {
  return list
    .filter((g) => g.rows.length > 0)
    .map((g, gi) => {
      const rows = g.rows
        .map((r) => {
          const t = P.tones[r.tone];
          return `<tr>
  <td style="padding:9px 0;border-top:1px solid ${P.line};font-size:14px;line-height:1.4;color:${P.fg};">${esc(r.label)}</td>
  <td align="right" style="padding:9px 0 9px 12px;border-top:1px solid ${P.line};white-space:nowrap;">
    <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${t.bg};color:${t.ink};font-size:12px;font-weight:700;">${esc(r.badge)}</span>
  </td>
</tr>`;
        })
        .join("");
      return `<div style="font-size:14px;font-weight:800;color:${P.fg};margin:${gi === 0 ? "0" : "18px"} 0 4px 0;">${esc(g.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
    })
    .join("");
}

function footerHtml(f: EmailContent["footer"]): string {
  const links: string[] = [];
  if (f.manageUrl) links.push(`<a href="${esc(f.manageUrl)}" style="color:${P.muted};text-decoration:underline;">Manage emails</a>`);
  if (f.muteUrl) links.push(`<a href="${esc(f.muteUrl)}" style="color:${P.muted};text-decoration:underline;">Mute this kind</a>`);
  return `${esc(f.reason)}${links.length ? `<br>${links.join(" &middot; ")}` : ""}`;
}

function textBody(c: EmailContent): string {
  const out: string[] = [c.title];
  if (c.subtitle) out.push(c.subtitle);
  out.push("");
  for (const p of c.paragraphs ?? []) out.push(p, "");
  for (const g of c.list ?? []) {
    if (g.rows.length === 0) continue;
    out.push(`${g.heading}:`);
    for (const r of g.rows) out.push(`  - ${r.label} — ${r.badge}`);
    out.push("");
  }
  if (c.note) out.push(c.note, "");
  if (c.cta) out.push(`${c.cta.label}: ${c.cta.url}`, "");
  out.push("—", c.footer.reason);
  if (c.footer.manageUrl) out.push(`Manage emails: ${c.footer.manageUrl}`);
  return out.join("\n");
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const tone = P.tones[c.tone];
  const logo = `${appOrigin()}/brand/png/mark-128.png`;
  const paragraphs = (c.paragraphs ?? [])
    .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${P.fg};">${esc(p)}</p>`)
    .join("");
  const list = c.list?.length ? `<div style="margin:2px 0 6px 0;">${listHtml(c.list)}</div>` : "";
  const note = c.note
    ? `<p style="margin:14px 0 0 0;font-size:13px;line-height:1.5;color:${P.muted};">${esc(c.note)}</p>`
    : "";
  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${list ? "20px" : "6px"};"><tr>
  <td bgcolor="${P.ink}" style="background:${P.ink};border-radius:999px;">
    <a href="${esc(c.cta.url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;color:${P.inkOn};font-size:14px;font-weight:700;text-decoration:none;font-family:${FONT};">${esc(c.cta.label)}</a>
  </td>
</tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(c.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${P.canvas};font-family:${FONT};color:${P.fg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.canvas}" style="background:${P.canvas};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 6px 16px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="${esc(logo)}" width="28" height="28" alt="eSpace Hubs" style="display:block;border:0;border-radius:9px;"></td>
        <td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:16px;letter-spacing:-0.3px;color:${P.fg};"><span style="font-weight:800;">eSpace</span> <span style="font-weight:600;color:${P.wordmarkMuted};">Hubs</span></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${P.card}" style="background:${P.card};border-radius:20px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td bgcolor="${tone.bg}" style="background:${tone.bg};color:${tone.ink};padding:22px 24px;border-radius:20px 20px 0 0;">
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;line-height:1.3;color:${tone.ink};">${esc(c.title)}</div>
          ${c.subtitle ? `<div style="margin-top:4px;font-size:14px;line-height:1.5;color:${tone.ink};">${esc(c.subtitle)}</div>` : ""}
        </td></tr>
        <tr><td style="padding:22px 24px 24px 24px;">
          ${paragraphs}${list}${note}${cta}
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 6px 0 6px;font-size:12px;line-height:1.6;color:${P.muted};font-family:${FONT};">
      ${footerHtml(c.footer)}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  return { html, text: textBody(c) };
}
