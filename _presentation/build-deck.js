/**
 * eSpace Dev Hub — stakeholder deck.
 *
 * Visual language follows the app's HexaCore aesthetic 1:1:
 *   - warm paper background (#f1eee6)
 *   - electric indigo accent (#3826ff)
 *   - one italic-serif "accent word" per headline
 *   - hairline 1px borders, 4px radii (we use plain RECTANGLE — accent
 *     overlays don't cover rounded corners; pptxgenjs caveat)
 *   - mono micro-labels (UPPERCASE, tracked) over every section
 *   - section counter bottom-right (matches the dashboard's snap-counter)
 *
 * Layout: 16:9 widescreen, 13.3" × 7.5" — gives us editorial breathing room
 * for the big-headline title slides while keeping Powerpoint-default ratios.
 */

const path = require("path");
const pptxgen = require(path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "pptxgenjs",
));

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333" × 7.5"
pres.author = "eSpace Dev Hub";
pres.company = "eSpace";
pres.title = "eSpace Dev Hub — Stakeholder Overview";

/* ────────────────────────────── tokens ────────────────────────────── */

const C = {
  bg: "F1EEE6", // warm paper
  fg: "0B0B14", // primary text
  card: "FFFFFF",
  cardAlt: "FAF8F2",
  muted: "7D7D83", // ~55% black on warm paper
  dim: "9E9EA4",
  border: "DCDACF",
  borderStrong: "C9C7BC",
  accent: "3826FF", // electric indigo
  accentDim: "DDD9FF", // 10% accent on warm paper
  accentOn: "FFFFFF",
  accent2: "00C48A", // mint
  bad: "B91C1C",
  good: "047857",
};

const F = {
  display: "Inter Tight", // falls back to Calibri/Helvetica
  sans: "Inter Tight",
  mono: "JetBrains Mono", // falls back to Consolas
  serif: "Georgia", // italic accent words
};

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

/* ────────────────────────────── primitives ────────────────────────────── */

/** Set the warm-paper background on every slide. */
function paperBg(slide) {
  slide.background = { color: C.bg };
}

/** Brand mark top-left — eSpace/DevHub */
function brand(slide) {
  slide.addText(
    [
      { text: "eSpace", options: { color: C.fg, bold: true } },
      { text: "/", options: { color: C.accent, bold: true } },
      { text: "DevHub", options: { color: C.fg, bold: true } },
    ],
    {
      x: 0.5,
      y: 0.35,
      w: 3,
      h: 0.4,
      fontSize: 13,
      fontFace: F.display,
      charSpacing: -0.6,
      margin: 0,
    },
  );
  slide.addText("v0.4 PREVIEW", {
    x: 0.5,
    y: 0.74,
    w: 3,
    h: 0.25,
    fontSize: 8,
    fontFace: F.mono,
    color: C.dim,
    charSpacing: 4,
    margin: 0,
  });
}

/** "01 / 12" counter bottom-right — matches the dashboard's section snap counter. */
function counter(slide, current, total) {
  slide.addText(
    [
      { text: String(current).padStart(2, "0"), options: { color: C.accent, bold: true } },
      { text: ` / ${String(total).padStart(2, "0")}`, options: { color: C.muted } },
    ],
    {
      x: SLIDE_W - 1.2,
      y: SLIDE_H - 0.55,
      w: 0.9,
      h: 0.3,
      fontSize: 9,
      fontFace: F.mono,
      align: "right",
      charSpacing: 4,
      margin: 0,
    },
  );
}

/** Mono uppercase label (the small overline used everywhere in the app). */
function monoLabel(slide, text, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? 0.5,
    y: opts.y ?? 0.5,
    w: opts.w ?? 6,
    h: opts.h ?? 0.3,
    fontSize: opts.fontSize ?? 9,
    fontFace: F.mono,
    color: opts.color ?? C.muted,
    charSpacing: 4,
    bold: !!opts.bold,
    align: opts.align ?? "left",
    margin: 0,
  });
}

/** Hairline 1pt card. (RECTANGLE — never ROUNDED, so overlays align.) */
function card(slide, x, y, w, h, opts = {}) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: opts.fill ?? C.card },
    line: { color: opts.border ?? C.border, width: 0.75 },
  });
  if (opts.accentLeft) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.04,
      h,
      fill: { color: C.accent },
      line: { type: "none" },
    });
  }
}

/** Faint dither texture in a corner — visual signature. */
function ditherCluster(slide, cx, cy, cells = 14, color = C.accent, dotR = 0.045) {
  const step = 0.16;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const dx = c * step - (cells * step) / 2;
      const dy = r * step - (cells * step) / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const opacity = Math.max(0, 0.55 - dist * 0.7);
      if (opacity < 0.08) continue;
      slide.addShape(pres.shapes.OVAL, {
        x: cx + dx,
        y: cy + dy,
        w: dotR,
        h: dotR,
        fill: { color, transparency: Math.round((1 - opacity) * 100) },
        line: { type: "none" },
      });
    }
  }
}

/** Italic-serif accent word — the app's "case" headline trick. */
function italicAccent(text) {
  return { text, options: { italic: true, fontFace: F.serif, color: C.accent } };
}

/** Hairline divider rule. */
function divider(slide, x, y, w, color = C.border) {
  slide.addShape(pres.shapes.LINE, {
    x,
    y,
    w,
    h: 0,
    line: { color, width: 0.5 },
  });
}

/** Pill (small uppercase tag). */
function pill(slide, x, y, text, tone = "muted") {
  const tones = {
    muted: { bg: C.cardAlt, color: C.muted, border: C.border },
    accent: { bg: C.accentDim, color: C.accent, border: C.accentDim },
    ok: { bg: "E0F5EE", color: C.good, border: "E0F5EE" },
    inverse: { bg: C.accent, color: "FFFFFF", border: C.accent },
  };
  const t = tones[tone] || tones.muted;
  const w = Math.max(0.6, text.length * 0.075 + 0.25);
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h: 0.27,
    fill: { color: t.bg },
    line: { color: t.border, width: 0.5 },
  });
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.27,
    fontSize: 8,
    fontFace: F.mono,
    color: t.color,
    bold: true,
    align: "center",
    valign: "middle",
    charSpacing: 3,
    margin: 0,
  });
  return w;
}

/* ────────────────────────────── slides ────────────────────────────── */

const TOTAL = 12;

// ─────────────── Slide 01 — Title ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  // Decorative dither blob, top-right
  ditherCluster(s, SLIDE_W - 1.8, 1.5, 18, C.accent);

  monoLabel(s, "WK 17 · APR 20 — APR 26 · STAKEHOLDER OVERVIEW", {
    x: 0.5,
    y: 1.6,
    w: 8,
    fontSize: 10,
    color: C.muted,
  });

  s.addText(
    [
      { text: "Measure. ", options: { color: C.muted } },
      { text: "Merge. ", options: { color: C.muted } },
      { text: "Make the ", options: { color: C.fg } },
      italicAccent("case"),
      { text: ".", options: { color: C.fg } },
    ],
    {
      x: 0.5,
      y: 2.1,
      w: 11,
      h: 2.7,
      fontSize: 110,
      fontFace: F.display,
      bold: true,
      charSpacing: -3,
      valign: "top",
      margin: 0,
    },
  );

  s.addText(
    "A quiet performance dashboard for loud review seasons. Pulls Jira, GitLab, and GitHub into one receipts-ready view — and lets an AI build the rest.",
    {
      x: 0.5,
      y: 5.1,
      w: 8.5,
      h: 1.0,
      fontSize: 16,
      fontFace: F.sans,
      color: C.muted,
      lineSpacing: 24,
      margin: 0,
    },
  );

  // Footer line
  divider(s, 0.5, SLIDE_H - 0.9, SLIDE_W - 1);
  monoLabel(s, "ESPACE.DEV / INTERNAL", {
    x: 0.5,
    y: SLIDE_H - 0.7,
    w: 5,
    fontSize: 8,
    color: C.muted,
  });
  monoLabel(s, "APR 2026 · BUILT FOR THE PERFORMANCE CYCLE", {
    x: SLIDE_W - 6,
    y: SLIDE_H - 0.7,
    w: 5.5,
    fontSize: 8,
    color: C.muted,
    align: "right",
  });
  counter(s, 1, TOTAL);
}

// ─────────────── Slide 02 — The Problem ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "01 · THE PROBLEM", {
    x: 0.5,
    y: 1.4,
    w: 8,
    fontSize: 10,
    color: C.muted,
  });
  s.addText(
    [
      { text: "Performance season is ", options: {} },
      italicAccent("scavenger hunting"),
      { text: ".", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 50,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1.5,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Three pain cards
  const painY = 3.7;
  const painH = 2.7;
  const painW = (SLIDE_W - 1.0 - 0.4) / 3; // 0.5 each margin + 0.2 gaps
  const pains = [
    {
      label: "01",
      title: "Evidence is everywhere",
      body:
        "PRs in GitHub. MRs in GitLab. Tickets in Jira. Reviews on Slack. By April nobody can remember what they shipped in February.",
    },
    {
      label: "02",
      title: "Goals don't fit one shape",
      body:
        "Some L2s are countable (merged PRs, review rounds). Others are judgement calls (mentoring, leadership, quality). Spreadsheets force everything into the same column.",
    },
    {
      label: "03",
      title: "The story has to be re-told",
      body:
        "1:1, mid-cycle, end-of-cycle, promo packet — same story, four formats, all of it manual.",
    },
  ];
  pains.forEach((p, i) => {
    const x = 0.5 + i * (painW + 0.2);
    card(s, x, painY, painW, painH);
    s.addText(p.label, {
      x: x + 0.25,
      y: painY + 0.25,
      w: 1,
      h: 0.4,
      fontSize: 18,
      italic: true,
      fontFace: F.serif,
      color: C.accent,
      margin: 0,
    });
    s.addText(p.title, {
      x: x + 0.25,
      y: painY + 0.7,
      w: painW - 0.5,
      h: 0.6,
      fontSize: 18,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -0.4,
      margin: 0,
    });
    s.addText(p.body, {
      x: x + 0.25,
      y: painY + 1.3,
      w: painW - 0.5,
      h: painH - 1.4,
      fontSize: 12,
      fontFace: F.sans,
      color: C.muted,
      lineSpacing: 17,
      margin: 0,
    });
  });

  counter(s, 2, TOTAL);
}

// ─────────────── Slide 03 — The Solution ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "02 · THE SOLUTION", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "One dashboard. Three connectors. ", options: {} },
      italicAccent("AI"),
      { text: " for the rest.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12.5,
      h: 1.4,
      fontSize: 44,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1.2,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Three pillars + one accent pillar
  const py = 3.7;
  const ph = 2.9;
  const pw = (SLIDE_W - 1.0 - 0.45) / 4;
  const pillars = [
    {
      tag: "JR",
      title: "Jira",
      body: "Tickets, statuses, due dates, assignee — straight from the work tracker.",
      tone: "default",
    },
    {
      tag: "GL",
      title: "GitLab",
      body: "MRs, reviews, code-review rounds, turnaround. Self-hosted-friendly via PAT.",
      tone: "default",
    },
    {
      tag: "GH",
      title: "GitHub",
      body: "PRs, merges, comments, push events. OAuth — pulls year-to-date for grading.",
      tone: "default",
    },
    {
      tag: "AI",
      title: "Goal Analyst",
      body: "Mistral classifies each L1 / L2, picks (or invents) the widget that tracks it.",
      tone: "accent",
    },
  ];
  pillars.forEach((p, i) => {
    const x = 0.5 + i * (pw + 0.15);
    const isAccent = p.tone === "accent";
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y: py,
      w: pw,
      h: ph,
      fill: { color: isAccent ? C.accent : C.card },
      line: {
        color: isAccent ? C.accent : C.border,
        width: 0.75,
      },
    });
    // Glyph circle
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.3,
      y: py + 0.3,
      w: 0.55,
      h: 0.55,
      fill: { color: isAccent ? "FFFFFF" : C.accentDim },
      line: { type: "none" },
    });
    s.addText(p.tag, {
      x: x + 0.3,
      y: py + 0.3,
      w: 0.55,
      h: 0.55,
      fontSize: 11,
      fontFace: F.mono,
      color: isAccent ? C.accent : C.accent,
      bold: true,
      align: "center",
      valign: "middle",
      charSpacing: 1,
      margin: 0,
    });
    s.addText(p.title, {
      x: x + 0.3,
      y: py + 1.0,
      w: pw - 0.6,
      h: 0.55,
      fontSize: 22,
      fontFace: F.display,
      bold: true,
      color: isAccent ? "FFFFFF" : C.fg,
      charSpacing: -0.5,
      margin: 0,
    });
    s.addText(p.body, {
      x: x + 0.3,
      y: py + 1.65,
      w: pw - 0.6,
      h: ph - 1.85,
      fontSize: 11.5,
      fontFace: F.sans,
      color: isAccent ? "D6D2FF" : C.muted,
      lineSpacing: 16,
      margin: 0,
    });
  });

  counter(s, 3, TOTAL);
}

// ─────────────── Slide 04 — Dashboard Architecture (5 sections) ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "03 · DASHBOARD AT A GLANCE", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Five ", options: {} },
      italicAccent("scroll-snap"),
      { text: " sections. One viewport each.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Five horizontal bands
  const sections = [
    { num: "01", name: "Overview", body: "Hero · 14d signal · integrations · merged · review rounds · Jira linkage" },
    { num: "02", name: "On your plate", body: "Attention nudges · Jira kanban · open PRs / linked commits" },
    { num: "03", name: "Goals & evidence", body: "L1 / L2 tree · weekly snapshots · accent EVIDENCE export tile · recent commits" },
    { num: "04", name: "Trends", body: "Activity area chart · turnaround histogram · reviews-given list" },
    {
      num: "05",
      name: "Goal tracking",
      body: "AI-classified widgets — auto, manual, hybrid, AI-graded. Inverse theme (white-on-indigo).",
      accent: true,
    },
  ];

  const startY = 3.7;
  const rowH = 0.62;
  sections.forEach((sec, i) => {
    const y = startY + i * (rowH + 0.06);
    const isAccent = sec.accent;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5,
      y,
      w: SLIDE_W - 1,
      h: rowH,
      fill: { color: isAccent ? C.accent : C.card },
      line: { color: isAccent ? C.accent : C.border, width: 0.75 },
    });
    // section number — italic serif
    s.addText(sec.num, {
      x: 0.7,
      y,
      w: 0.7,
      h: rowH,
      fontSize: 17,
      italic: true,
      fontFace: F.serif,
      color: isAccent ? "FFFFFF" : C.accent,
      bold: true,
      valign: "middle",
      margin: 0,
    });
    s.addText(sec.name, {
      x: 1.4,
      y,
      w: 3,
      h: rowH,
      fontSize: 16,
      fontFace: F.display,
      bold: true,
      color: isAccent ? "FFFFFF" : C.fg,
      charSpacing: -0.3,
      valign: "middle",
      margin: 0,
    });
    s.addText(sec.body, {
      x: 4.4,
      y,
      w: SLIDE_W - 5,
      h: rowH,
      fontSize: 11,
      fontFace: F.mono,
      color: isAccent ? "D6D2FF" : C.muted,
      valign: "middle",
      charSpacing: 1,
      margin: 0,
    });
  });

  counter(s, 4, TOTAL);
}

// ─────────────── Slide 05 — AI Analyst (the differentiator) ───────────────
// Full-bleed accent slide for visual variety.
{
  const s = pres.addSlide();
  s.background = { color: C.accent };
  // Brand inverse
  s.addText(
    [
      { text: "eSpace", options: { color: "FFFFFF", bold: true } },
      { text: "/", options: { color: "B8B0FF", bold: true } },
      { text: "DevHub", options: { color: "FFFFFF", bold: true } },
    ],
    {
      x: 0.5,
      y: 0.35,
      w: 3,
      h: 0.4,
      fontSize: 13,
      fontFace: F.display,
      charSpacing: -0.6,
      margin: 0,
    },
  );

  // Decorative dither (white on indigo)
  ditherCluster(s, SLIDE_W - 2.2, 2.0, 22, "FFFFFF");

  monoLabel(s, "04 · THE DIFFERENTIATOR", {
    x: 0.5,
    y: 1.4,
    w: 8,
    fontSize: 10,
    color: "9A91E8",
  });
  s.addText(
    [
      { text: "An ", options: { color: "FFFFFF" } },
      { text: "Analyst", options: { color: "FFFFFF", italic: true, fontFace: F.serif } },
      { text: " that builds the widgets.", options: { color: "FFFFFF" } },
    ],
    {
      x: 0.5,
      y: 1.85,
      w: 12,
      h: 1.4,
      fontSize: 48,
      fontFace: F.display,
      bold: true,
      charSpacing: -1.2,
      margin: 0,
    },
  );

  // Process flow — 4 steps
  const stepY = 4.0;
  const stepH = 2.0;
  const stepW = (SLIDE_W - 1.0 - 0.45) / 4;
  const steps = [
    {
      n: "01",
      title: "Read goals",
      body: "User pastes L1 / L2 tree once. Editor captures title, description, rubric, priority, dates, weight, category.",
    },
    {
      n: "02",
      title: "Classify",
      body: "Mistral streams a verdict per goal: auto, manual, hybrid, or delegated. Reasoning shown live.",
    },
    {
      n: "03",
      title: "Build the widget",
      body: "Spec maps to one of 12 widgets. Auto pulls from integrations; manual prompts the user; AI-graded scores PRs.",
    },
    {
      n: "04",
      title: "Track",
      body: "Section 5 + analyst page render the widget grid. Re-analyze any goal in one click.",
    },
  ];
  steps.forEach((st, i) => {
    const x = 0.5 + i * (stepW + 0.15);
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y: stepY,
      w: stepW,
      h: stepH,
      // Slightly-lighter indigo tile (white-on-indigo blend at ~12%).
      // Pptxgenjs's `transparency` property would also work, but a solid
      // tint renders more consistently across PowerPoint versions.
      fill: { color: "5042FF" },
      line: { color: "9A91E8", width: 0.5 },
    });
    s.addText(st.n, {
      x: x + 0.25,
      y: stepY + 0.2,
      w: 1.2,
      h: 0.45,
      fontSize: 18,
      italic: true,
      fontFace: F.serif,
      color: "FFFFFF",
      bold: true,
      margin: 0,
    });
    s.addText(st.title, {
      x: x + 0.25,
      y: stepY + 0.65,
      w: stepW - 0.5,
      h: 0.5,
      fontSize: 16,
      fontFace: F.display,
      bold: true,
      color: "FFFFFF",
      charSpacing: -0.3,
      margin: 0,
    });
    s.addText(st.body, {
      x: x + 0.25,
      y: stepY + 1.15,
      w: stepW - 0.5,
      h: stepH - 1.3,
      fontSize: 10.5,
      fontFace: F.sans,
      color: "D6D2FF",
      lineSpacing: 14,
      margin: 0,
    });
  });

  // Inverse counter
  s.addText(
    [
      { text: "05", options: { color: "FFFFFF", bold: true } },
      { text: " / 12", options: { color: "9A91E8" } },
    ],
    {
      x: SLIDE_W - 1.2,
      y: SLIDE_H - 0.55,
      w: 0.9,
      h: 0.3,
      fontSize: 9,
      fontFace: F.mono,
      align: "right",
      charSpacing: 4,
      margin: 0,
    },
  );
}

// ─────────────── Slide 06 — Widget Catalog ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "05 · WIDGET CATALOG", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Twelve widgets. ", options: {} },
      italicAccent("One"),
      { text: " contract.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  monoLabel(s, "AUTO · DERIVED FROM INTEGRATIONS", {
    x: 0.5,
    y: 3.5,
    w: 7,
    fontSize: 9,
    color: C.muted,
  });
  monoLabel(s, "MANUAL · USER-LOGGED", {
    x: 0.5,
    y: 5.55,
    w: 7,
    fontSize: 9,
    color: C.muted,
  });

  const widgets = [
    // auto row
    { name: "Merged count", desc: "PRs merged in window + 8w trend", row: 0 },
    { name: "Review rounds", desc: "Avg comments per merged MR", row: 0 },
    { name: "Turnaround", desc: "Open → merge histogram + median", row: 0 },
    { name: "Jira linkage", desc: "% MRs referencing a ticket", row: 0 },
    { name: "Ticket cycle", desc: "Cycle time across statuses", row: 0 },
    { name: "Code rubric ★", desc: "AI grades each PR vs your rubric", row: 0, accent: true },
    // manual row
    { name: "Counter", desc: "+1 / -1 with weekly tally", row: 1 },
    { name: "1–5 scale", desc: "Self-rate with sparkline", row: 1 },
    { name: "Milestone", desc: "Checklist + progress %", row: 1 },
    { name: "Date log", desc: "Dated events with notes", row: 1 },
    { name: "Journal", desc: "Free-text per-day entries", row: 1 },
    { name: "Before/after", desc: "Baseline vs. current delta", row: 1 },
  ];
  const colsPerRow = 6;
  const cellW = (SLIDE_W - 1.0 - 0.5) / colsPerRow;
  const cellH = 1.55;
  const rowYs = [3.85, 5.9];
  widgets.forEach((w, i) => {
    const c = i % colsPerRow;
    const r = Math.floor(i / colsPerRow);
    const x = 0.5 + c * (cellW + 0.1);
    const y = rowYs[r];
    card(s, x, y, cellW, cellH, {
      fill: w.accent ? C.accent : C.card,
      border: w.accent ? C.accent : C.border,
    });
    s.addText(w.name, {
      x: x + 0.18,
      y: y + 0.2,
      w: cellW - 0.36,
      h: 0.5,
      fontSize: 13,
      fontFace: F.display,
      bold: true,
      color: w.accent ? "FFFFFF" : C.fg,
      charSpacing: -0.3,
      margin: 0,
    });
    s.addText(w.desc, {
      x: x + 0.18,
      y: y + 0.65,
      w: cellW - 0.36,
      h: cellH - 0.8,
      fontSize: 10,
      fontFace: F.sans,
      color: w.accent ? "D6D2FF" : C.muted,
      lineSpacing: 14,
      margin: 0,
    });
  });

  counter(s, 6, TOTAL);
}

// ─────────────── Slide 07 — Code Rubric Grading (the killer feature) ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "06 · CODE-RUBRIC GRADING", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "You define ", options: {} },
      italicAccent("quality"),
      { text: ". The AI grades the receipts.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 38,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Two-column: rubric input on left, verdict list on right
  const leftX = 0.5;
  const leftW = 5.6;
  const rightX = 6.5;
  const rightW = SLIDE_W - 7;
  const colY = 3.6;
  const colH = 3.4;

  // LEFT — rubric input mock
  card(s, leftX, colY, leftW, colH, { accentLeft: true });
  monoLabel(s, "RUBRIC · YOUR CRITERIA", {
    x: leftX + 0.3,
    y: colY + 0.25,
    w: leftW - 0.6,
    fontSize: 9,
    color: C.muted,
  });
  s.addText("Define before tracking", {
    x: leftX + 0.3,
    y: colY + 0.55,
    w: leftW - 0.6,
    h: 0.5,
    fontSize: 18,
    fontFace: F.display,
    bold: true,
    color: C.fg,
    charSpacing: -0.4,
    margin: 0,
  });
  const criteria = [
    "No styling issues raised by reviewers",
    "All reviewer concerns addressed",
    "CI checks green at merge",
    "PR body explains the why",
  ];
  criteria.forEach((cri, i) => {
    const y = colY + 1.25 + i * 0.42;
    s.addShape(pres.shapes.RECTANGLE, {
      x: leftX + 0.3,
      y,
      w: leftW - 0.6,
      h: 0.34,
      fill: { color: C.cardAlt },
      line: { color: C.border, width: 0.5 },
    });
    s.addText(`${i + 1}.  ${cri}`, {
      x: leftX + 0.4,
      y,
      w: leftW - 0.7,
      h: 0.34,
      fontSize: 11,
      fontFace: F.mono,
      color: C.fg,
      valign: "middle",
      charSpacing: 0,
      margin: 0,
    });
  });

  // RIGHT — verdicts
  card(s, rightX, colY, rightW, colH);
  monoLabel(s, "RUBRIC · YTD · 14 OF 18 PASSING", {
    x: rightX + 0.3,
    y: colY + 0.25,
    w: rightW - 0.6,
    fontSize: 9,
    color: C.muted,
  });
  s.addText("78%", {
    x: rightX + 0.3,
    y: colY + 0.55,
    w: 1.5,
    h: 0.7,
    fontSize: 38,
    fontFace: F.display,
    bold: true,
    color: C.fg,
    charSpacing: -1.4,
    margin: 0,
  });
  s.addText("PASS RATE", {
    x: rightX + 1.85,
    y: colY + 0.95,
    w: 2,
    h: 0.3,
    fontSize: 9,
    fontFace: F.mono,
    color: C.muted,
    charSpacing: 4,
    valign: "bottom",
    margin: 0,
  });

  // Pass-rate bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: rightX + 0.3,
    y: colY + 1.4,
    w: rightW - 0.6,
    h: 0.1,
    fill: { color: C.border },
    line: { type: "none" },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: rightX + 0.3,
    y: colY + 1.4,
    w: (rightW - 0.6) * 0.78,
    h: 0.1,
    fill: { color: C.accent },
    line: { type: "none" },
  });

  // Per-PR rows
  const verdicts = [
    { num: "#13", title: "Audit logging for privileged actions", pass: true },
    { num: "#11", title: "Rate limiting on public API routes", pass: false, why: "[perf] reviewer concern unaddressed" },
    { num: "#6", title: "Off-by-one on reports pagination", pass: true },
    { num: "#5", title: "Settlement worker → RetryPolicy", pass: true },
  ];
  verdicts.forEach((v, i) => {
    const y = colY + 1.7 + i * 0.4;
    s.addText(v.num, {
      x: rightX + 0.3,
      y,
      w: 0.6,
      h: 0.3,
      fontSize: 10,
      fontFace: F.mono,
      bold: true,
      color: C.accent,
      valign: "middle",
      margin: 0,
    });
    s.addText(v.title, {
      x: rightX + 0.95,
      y,
      w: rightW - 2.2,
      h: 0.3,
      fontSize: 11,
      fontFace: F.sans,
      color: C.fg,
      valign: "middle",
      margin: 0,
    });
    s.addText(v.pass ? "✓ PASS" : "✗ FAIL", {
      x: rightX + rightW - 1.1,
      y,
      w: 0.8,
      h: 0.3,
      fontSize: 10,
      fontFace: F.mono,
      bold: true,
      color: v.pass ? C.accent2 : C.bad,
      align: "right",
      valign: "middle",
      charSpacing: 3,
      margin: 0,
    });
  });

  counter(s, 7, TOTAL);
}

// ─────────────── Slide 08 — Goal Context + Delegation ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "07 · WHEN TRACKING NEEDS A HUMAN", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Two ", options: {} },
      italicAccent("escape hatches"),
      { text: " for messy goals.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Two cards
  const cy = 3.6;
  const ch = 3.4;
  const cw = (SLIDE_W - 1.0 - 0.4) / 2;

  // Card A: Context
  const ax = 0.5;
  card(s, ax, cy, cw, ch, { accentLeft: true });
  s.addText("Define before tracking", {
    x: ax + 0.3,
    y: cy + 0.25,
    w: cw - 0.6,
    h: 0.5,
    fontSize: 22,
    fontFace: F.display,
    bold: true,
    color: C.fg,
    charSpacing: -0.5,
    margin: 0,
  });
  s.addText(
    [
      { text: "When a goal references team-specific concepts ('agreed quality standards', 'success criteria'), the AI emits a ", options: { color: C.muted } },
      { text: "context.questions", options: { color: C.fg, fontFace: F.mono } },
      { text: " block. The user fills it in once; the widget activates only after.", options: { color: C.muted } },
    ],
    {
      x: ax + 0.3,
      y: cy + 0.95,
      w: cw - 0.6,
      h: 1.3,
      fontSize: 12,
      fontFace: F.sans,
      lineSpacing: 17,
      margin: 0,
    },
  );
  // Mock prompt strip
  s.addShape(pres.shapes.RECTANGLE, {
    x: ax + 0.3,
    y: cy + 2.4,
    w: cw - 0.6,
    h: 0.7,
    fill: { color: C.cardAlt },
    line: { color: C.border, width: 0.5 },
  });
  monoLabel(s, "Q · QUALITY-STANDARDS", {
    x: ax + 0.45,
    y: cy + 2.5,
    w: cw - 0.9,
    fontSize: 8,
    color: C.muted,
  });
  s.addText("List your team's agreed quality standards", {
    x: ax + 0.45,
    y: cy + 2.75,
    w: cw - 0.9,
    h: 0.3,
    fontSize: 11,
    fontFace: F.sans,
    color: C.fg,
    margin: 0,
  });

  // Card B: Delegation
  const bx = ax + cw + 0.4;
  card(s, bx, cy, cw, ch);
  s.addText("Delegated to a senior", {
    x: bx + 0.3,
    y: cy + 0.25,
    w: cw - 0.6,
    h: 0.5,
    fontSize: 22,
    fontFace: F.display,
    bold: true,
    color: C.fg,
    charSpacing: -0.5,
    margin: 0,
  });
  s.addText(
    [
      { text: "When the goal is judged by a manager (succession readiness, quarterly review), the AI emits ", options: { color: C.muted } },
      { text: "delegated: { judge: 'manager' }", options: { color: C.fg, fontFace: F.mono } },
      { text: ". User sees a calm 'judged by …' card — no demand to self-track.", options: { color: C.muted } },
    ],
    {
      x: bx + 0.3,
      y: cy + 0.95,
      w: cw - 0.6,
      h: 1.3,
      fontSize: 12,
      fontFace: F.sans,
      lineSpacing: 17,
      margin: 0,
    },
  );
  // Inverse mock chip
  s.addShape(pres.shapes.RECTANGLE, {
    x: bx + 0.3,
    y: cy + 2.4,
    w: cw - 0.6,
    h: 0.7,
    fill: { color: C.accent },
    line: { type: "none" },
  });
  monoLabel(s, "DELEGATED", {
    x: bx + 0.45,
    y: cy + 2.5,
    w: cw - 0.9,
    fontSize: 8,
    color: "B8B0FF",
  });
  s.addText("Your manager evaluates this goal — no self-tracking required.", {
    x: bx + 0.45,
    y: cy + 2.75,
    w: cw - 0.9,
    h: 0.3,
    fontSize: 11,
    fontFace: F.sans,
    color: "FFFFFF",
    margin: 0,
  });

  counter(s, 8, TOTAL);
}

// ─────────────── Slide 09 — Evidence Export ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "08 · EVIDENCE EXPORT", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Bundle ", options: {} },
      italicAccent("receipts"),
      { text: " for 1:1s and promo packets.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // Big indigo export tile + 4 facts
  const ex = 0.5;
  const ey = 3.6;
  const eh = 3.4;
  const ew = 5.5;

  s.addShape(pres.shapes.RECTANGLE, {
    x: ex,
    y: ey,
    w: ew,
    h: eh,
    fill: { color: C.accent },
    line: { color: C.accent, width: 0.5 },
  });
  ditherCluster(s, ex + ew - 0.7, ey + eh - 0.7, 12, "FFFFFF");
  monoLabel(s, "EVIDENCE · 90D BUNDLE", {
    x: ex + 0.35,
    y: ey + 0.3,
    w: ew - 0.7,
    fontSize: 9,
    color: "B8B0FF",
  });
  s.addText("Bundle last 90d as markdown + PDF.", {
    x: ex + 0.35,
    y: ey + 0.65,
    w: ew - 0.7,
    h: 1.4,
    fontSize: 28,
    fontFace: F.display,
    bold: true,
    color: "FFFFFF",
    charSpacing: -0.7,
    margin: 0,
  });
  monoLabel(s, "TICKETS · MRS · REVIEWS · SLA · ON-CALL", {
    x: ex + 0.35,
    y: ey + 2.05,
    w: ew - 0.7,
    fontSize: 9,
    color: "9A91E8",
  });

  // White export buttons
  ["EXPORT .MD ↓", "EXPORT .PDF ↓"].forEach((btn, i) => {
    const bx = ex + 0.35 + i * 1.6;
    s.addShape(pres.shapes.RECTANGLE, {
      x: bx,
      y: ey + 2.55,
      w: 1.45,
      h: 0.45,
      fill: { color: "FFFFFF" },
      line: { type: "none" },
    });
    s.addText(btn, {
      x: bx,
      y: ey + 2.55,
      w: 1.45,
      h: 0.45,
      fontSize: 10,
      fontFace: F.mono,
      bold: true,
      color: C.accent,
      align: "center",
      valign: "middle",
      charSpacing: 3,
      margin: 0,
    });
  });

  // Right side facts
  const fx = ex + ew + 0.4;
  const fw = SLIDE_W - 0.5 - fx;
  const facts = [
    { big: "30s", small: "Click .md → file downloads. No backend roundtrip." },
    { big: "auto", small: "Pulls 90d merged PRs, reviews, Jira tickets, headline metrics." },
    { big: "print", small: ".pdf opens the print-styled evidence page; browser prints to PDF." },
    { big: "starred", small: "Items the user starred in the Evidence picker land first." },
  ];
  facts.forEach((f, i) => {
    const y = ey + i * 0.85;
    s.addText(f.big, {
      x: fx,
      y,
      w: 1.2,
      h: 0.7,
      fontSize: 32,
      fontFace: F.display,
      bold: true,
      color: C.accent,
      charSpacing: -1.2,
      margin: 0,
    });
    s.addText(f.small, {
      x: fx + 1.4,
      y: y + 0.1,
      w: fw - 1.4,
      h: 0.6,
      fontSize: 12,
      fontFace: F.sans,
      color: C.fg,
      lineSpacing: 16,
      margin: 0,
    });
  });

  counter(s, 9, TOTAL);
}

// ─────────────── Slide 10 — Architecture ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "09 · ARCHITECTURE", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Layered, ", options: {} },
      italicAccent("SOLID"),
      { text: ", scale-ready.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  // 5 horizontal layers
  const layers = [
    {
      name: "Domain",
      tag: "PURE",
      body: "Schemas + enums + validators. Zero React, zero fetch. Goal-specs / goal-inputs / goal-context shapes live here.",
    },
    {
      name: "Infrastructure",
      tag: "I/O",
      body: "localStorage stores, change events, Mistral classifier adapter, integration API clients. Swappable behind ports.",
    },
    {
      name: "Application",
      tag: "ORCHESTRATION",
      body: "API routes (/api/classify-goals, /api/grade-pr), use-case hooks, NDJSON streams, concurrency caps.",
    },
    {
      name: "UI",
      tag: "PRESENTATION",
      body: "Widget registry (Map<kind, Component>), state-shell decision tree, error boundaries per widget. Adding a 13th widget = 1 line.",
    },
    {
      name: "Page",
      tag: "COMPOSITION",
      body: "Scroll shell, analyst page, dashboard sections. AppShell hosts both views; one swipe transition wires them together.",
    },
  ];
  const ly = 3.6;
  const lh = 0.62;
  layers.forEach((l, i) => {
    const y = ly + i * (lh + 0.06);
    card(s, 0.5, y, SLIDE_W - 1, lh);
    s.addText(l.name, {
      x: 0.7,
      y,
      w: 1.6,
      h: lh,
      fontSize: 14,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      valign: "middle",
      margin: 0,
    });
    pill(s, 2.3, y + (lh - 0.27) / 2, l.tag, "muted");
    s.addText(l.body, {
      x: 4.0,
      y,
      w: SLIDE_W - 4.5,
      h: lh,
      fontSize: 11,
      fontFace: F.sans,
      color: C.muted,
      valign: "middle",
      lineSpacing: 14,
      margin: 0,
    });
  });

  counter(s, 10, TOTAL);
}

// ─────────────── Slide 11 — Status / Roadmap ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  monoLabel(s, "10 · WHAT'S LIVE TODAY", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });
  s.addText(
    [
      { text: "Shipped, ", options: {} },
      italicAccent("trying"),
      { text: ", and on the runway.", options: {} },
    ],
    {
      x: 0.5,
      y: 1.8,
      w: 12,
      h: 1.4,
      fontSize: 40,
      fontFace: F.display,
      bold: true,
      color: C.fg,
      charSpacing: -1,
      margin: 0,
    },
  );
  divider(s, 0.5, 3.3, SLIDE_W - 1);

  const cols = [
    {
      label: "SHIPPED",
      tone: "ok",
      items: [
        "5-section scroll-snap dashboard",
        "Jira + GitLab + GitHub integrations",
        "12-widget registry (10 polished, 2 stubbed)",
        "AI Analyst with NDJSON streaming",
        "Code-rubric grading w/ per-PR cache",
        "Goal context + delegation",
        "Evidence export (.md + print-PDF)",
      ],
    },
    {
      label: "ITERATING",
      tone: "accent",
      items: [
        "Schema v2 — rich L1/L2 fields",
        "Classifier prompt tuning per cadence",
        "GitHub rate-limit recovery UX",
        "Grading verdict cache invalidation",
      ],
    },
    {
      label: "NEXT",
      tone: "muted",
      items: [
        "Ticket-cycle widget (Jira changelog)",
        "Streaming reasoning UI per widget",
        "Multi-user accounts (today: localStorage)",
        "Slack digest of weekly snapshots",
        "Custom widgets via plug-in registry",
      ],
    },
  ];
  const cy = 3.55;
  const ch = 3.5;
  const cw = (SLIDE_W - 1.0 - 0.4) / 3;
  cols.forEach((col, i) => {
    const x = 0.5 + i * (cw + 0.2);
    card(s, x, cy, cw, ch);
    pill(s, x + 0.25, cy + 0.25, col.label, col.tone);
    col.items.forEach((it, j) => {
      const y = cy + 0.75 + j * 0.36;
      // small bullet dot
      s.addShape(pres.shapes.OVAL, {
        x: x + 0.3,
        y: y + 0.13,
        w: 0.07,
        h: 0.07,
        fill: { color: col.tone === "ok" ? C.accent2 : col.tone === "accent" ? C.accent : C.dim },
        line: { type: "none" },
      });
      s.addText(it, {
        x: x + 0.5,
        y,
        w: cw - 0.7,
        h: 0.36,
        fontSize: 11,
        fontFace: F.sans,
        color: C.fg,
        valign: "middle",
        margin: 0,
      });
    });
  });

  counter(s, 11, TOTAL);
}

// ─────────────── Slide 12 — Closing ───────────────
{
  const s = pres.addSlide();
  paperBg(s);
  brand(s);

  // Big dither blob bottom-right
  ditherCluster(s, SLIDE_W - 2.0, SLIDE_H - 2.0, 22, C.accent);

  monoLabel(s, "FIN · APR 2026", { x: 0.5, y: 1.4, w: 8, fontSize: 10 });

  s.addText(
    [
      { text: "A quiet dashboard for ", options: { color: C.fg } },
      { text: "loud", options: { italic: true, fontFace: F.serif, color: C.accent } },
      { text: " review seasons.", options: { color: C.fg } },
    ],
    {
      x: 0.5,
      y: 2.0,
      w: 11.5,
      h: 2.4,
      fontSize: 64,
      fontFace: F.display,
      bold: true,
      charSpacing: -2,
      margin: 0,
    },
  );

  s.addText(
    "Receipts ready. Goals classified. Widgets written by your AI.\nReview time writes itself.",
    {
      x: 0.5,
      y: 4.6,
      w: 8.5,
      h: 1.0,
      fontSize: 16,
      fontFace: F.sans,
      color: C.muted,
      lineSpacing: 24,
      margin: 0,
    },
  );

  divider(s, 0.5, SLIDE_H - 0.9, SLIDE_W - 1);
  monoLabel(s, "ESPACE.DEV / DEVHUB", {
    x: 0.5,
    y: SLIDE_H - 0.7,
    w: 5,
    fontSize: 8,
    color: C.muted,
  });
  monoLabel(s, "QUESTIONS WELCOME", {
    x: SLIDE_W - 4,
    y: SLIDE_H - 0.7,
    w: 3.5,
    fontSize: 8,
    color: C.muted,
    align: "right",
  });
  counter(s, 12, TOTAL);
}

/* ────────────────────────────── write ────────────────────────────── */

const outFile = path.join(__dirname, "eSpace-DevHub-Stakeholder-Deck.pptx");
pres.writeFile({ fileName: outFile }).then((f) => {
  console.log("Wrote:", f);
});
