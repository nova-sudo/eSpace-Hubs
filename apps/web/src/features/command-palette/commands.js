/**
 * Command registry for the palette.
 *
 * `buildCommands(ctx)` returns a flat array of command descriptors:
 *   {
 *     id:        string                       // stable for React keys
 *     category:  string                       // shown as a section header
 *     label:     string                       // primary text
 *     sub?:      string                       // muted secondary text
 *     keywords?: string[]                     // boost search recall
 *     shortcut?: string[]                     // optional kbd hints
 *     run:       () => void                   // fired on enter / click
 *   }
 *
 * Adding a new command is a one-line entry — most categories are arrays
 * derived from existing data (sections, providers).
 */

const ROUTES = [
  { label: "Performance", path: "/", keywords: ["dashboard", "home", "main", "metrics"] },
  { label: "Goals", path: "/goals", keywords: ["objectives", "tracking", "ai", "tree"] },
  {
    label: "Evidence",
    path: "/evidence",
    keywords: ["export", "review", "packet", "markdown", "pdf"],
  },
  { label: "Settings", path: "/settings", keywords: ["integrations", "tokens"] },
  // Utility / drill-down routes — searchable but not header-pinned.
  { label: "Reviews log", path: "/reviews", keywords: ["pr", "ttfr", "comments"] },
  {
    label: "Snapshots",
    path: "/snapshots",
    keywords: ["history", "weekly", "trend"],
  },
];

/**
 * Each section node carries `data-section-id`; we read those directly so
 * the palette stays in sync with whatever sections are mounted (no risk
 * of drift if a section is added without updating the palette).
 *
 * Numbers reflect the section's position WITHIN ITS OWN TAB:
 *   Performance tab — 01..04 (overview, review-timing, glance, trends)
 *   Goals tab       — 01..02 (goals, goal-tracking)
 */
const SECTION_LABELS = {
  // Performance tab
  "sec-overview": { number: "01", label: "Overview" },
  "sec-review-timing": { number: "02", label: "Review timing" },
  "sec-glance": { number: "03", label: "At a glance" },
  "sec-trend": { number: "04", label: "Trends" },
  // Goals tab
  "sec-goals": { number: "01", label: "Performance goals" },
  "sec-goal-tracking": { number: "02", label: "Goal tracking (AI)" },
};

function listSections() {
  if (typeof document === "undefined") return [];
  const nodes = Array.from(document.querySelectorAll("[data-section-id]"));
  return nodes
    .map((node) => {
      const id = node.dataset.sectionId;
      const meta = SECTION_LABELS[id] || { number: "", label: id };
      return { id, node, ...meta };
    })
    // DOM order — querySelectorAll already returns it.
    .filter(Boolean);
}

function scrollToSectionId(id) {
  if (typeof document === "undefined") return;
  const node = document.querySelector(`[data-section-id="${id}"]`);
  if (node?.scrollIntoView) {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function buildCommands(ctx) {
  const {
    pathname,
    router,
    provider,
    setProvider,
    snapshotNow,
    link,
  } = ctx;
  const cmds = [];

  // ── Navigation ─────────────────────────────────────────────────────
  // Each route is hub-relative — the `link()` helper supplied by the
  // palette host prepends the active hub's id (e.g. "/dev/goals").
  // The pathname comparison uses the resolved hub-prefixed path so
  // we skip the route the user is already on.
  ROUTES.forEach((r) => {
    const target = link ? link(r.path) : r.path;
    if (target === pathname) return; // skip current route
    cmds.push({
      id: `nav:${r.path}`,
      category: "Go to",
      label: r.label,
      sub: target,
      keywords: r.keywords,
      run: () => router.push(target),
    });
  });

  // ── Tab sections (only when on Performance or Goals — they own the
  //    scroll-shell and have data-section-id elements in the DOM).
  //    pathname is now hub-prefixed (e.g. /dev or /dev/goals); compare
  //    against the resolved link() targets.
  const dashboardPath = link ? link("") : "/";
  const goalsPath = link ? link("/goals") : "/goals";
  if (pathname === dashboardPath || pathname?.startsWith(goalsPath)) {
    const sections = listSections();
    sections.forEach((s, i) => {
      cmds.push({
        id: `section:${s.id}`,
        category: "Jump to section",
        label: `${s.number} · ${s.label}`,
        sub: `press ${i + 1}`,
        keywords: [s.id, s.label.toLowerCase()],
        shortcut: [String(i + 1)],
        run: () => scrollToSectionId(s.id),
      });
    });
  }

  // ── One-shot actions ───────────────────────────────────────────────
  cmds.push({
    id: "action:snapshot-now",
    category: "Actions",
    label: "Snapshot now",
    sub: "freeze this week's metrics",
    keywords: ["capture", "save", "weekly"],
    run: () => snapshotNow(""),
  });

  cmds.push({
    id: "action:open-evidence-print",
    category: "Actions",
    label: "Open evidence in print mode",
    sub: "browser print → save as PDF",
    keywords: ["pdf", "print", "export"],
    run: () => router.push(link ? link("/evidence?print=1") : "/evidence?print=1"),
  });

  // ── AI provider switcher ───────────────────────────────────────────
  // AI_PROVIDERS lives in use-ai-provider; we import the module from
  // command-palette.jsx (this file is server-safe / pure logic) and pass
  // the helpers in via ctx, but the list is small enough to mirror here
  // to keep this module dependency-free.
  const PROVIDERS = [
    { id: "mistral", label: "Mistral" },
    { id: "glm", label: "GLM (Z.ai)" },
    { id: "openrouter", label: "OpenRouter" },
  ];
  PROVIDERS.forEach((p) => {
    if (p.id === provider) return; // skip the active one
    cmds.push({
      id: `provider:${p.id}`,
      category: "AI provider",
      label: `Switch to ${p.label}`,
      sub: provider ? `currently ${provider}` : undefined,
      keywords: ["ai", "switch", p.id],
      run: () => setProvider(p.id),
    });
  });

  // ── Shortcuts cheatsheet (informational) ───────────────────────────
  const cheatsheet = [
    { keys: ["⌘", "K"], desc: "Open this palette" },
    { keys: ["?"], desc: "Open this palette to shortcuts" },
    { keys: ["1", "…", "4"], desc: "Jump to section N (Performance / Goals)" },
    { keys: ["j"], desc: "Next section (on / or /goals)" },
    { keys: ["k"], desc: "Previous section (on / or /goals)" },
    { keys: ["g", "p"], desc: "Go to Performance" },
    { keys: ["g", "g"], desc: "Go to Goals" },
    { keys: ["g", "e"], desc: "Go to Evidence" },
    { keys: ["g", "t"], desc: "Go to Settings" },
    { keys: ["g", "r"], desc: "Go to Reviews log" },
    { keys: ["g", "s"], desc: "Go to Snapshots" },
    { keys: ["esc"], desc: "Close palette / overlay" },
  ];
  cheatsheet.forEach((s, i) => {
    cmds.push({
      id: `shortcut:${i}`,
      category: "Shortcuts",
      label: s.desc,
      shortcut: s.keys,
      keywords: ["help", "shortcuts", "keyboard"],
      // Selecting a shortcut just closes the palette (palette closes after
      // any run); the shortcut label is informational. No-op `run`.
      run: () => {},
    });
  });

  return cmds;
}
