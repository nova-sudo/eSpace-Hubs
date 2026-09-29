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

// `slot` is the hub page slot the route needs — a route the active hub
// doesn't expose (the manager hub has no /goals, /evidence, /reviews) is
// left out instead of bouncing the user back to the hub home.
const ROUTES = [
  {
    label: "Home",
    path: "/",
    slot: "dashboard",
    keywords: ["intelligence", "dashboard", "home", "main", "metrics", "performance", "team", "overview"],
  },
  {
    label: "Goals",
    path: "/goals",
    slot: "goals",
    // The flow map IS the Goals page now (the /goals-v2 preview route only
    // redirects here), so its old preview-only keywords ride along.
    keywords: ["objectives", "tracking", "ai", "tree", "flow", "map", "canvas"],
  },
  {
    label: "Evidence",
    path: "/evidence",
    slot: "evidence",
    keywords: ["export", "review", "packet", "markdown", "pdf"],
  },
  { label: "Settings", path: "/settings", slot: "settings", keywords: ["integrations", "tokens"] },
  // Utility / drill-down routes — searchable but not header-pinned.
  { label: "Reviews log", path: "/reviews", slot: "reviews", keywords: ["pr", "ttfr", "comments"] },
  {
    label: "Snapshots",
    path: "/snapshots",
    slot: "snapshots",
    keywords: ["history", "weekly", "trend"],
  },
  // Exposed on every hub, but hidden from the dev/qa nav bar — the palette
  // (and the home page's drill-down sub-nav) are how a dev gets back to a
  // goal that was shared with them once the notification is gone.
  {
    label: "Shared with me",
    path: "/shared-goals",
    slot: "sharedgoals",
    keywords: ["shared", "assigned", "team", "manager", "analytics"],
  },
];

/**
 * Each section node carries `data-section-id`; we read those directly so
 * the palette stays in sync with whatever sections are mounted (no risk
 * of drift if a section is added without updating the palette).
 *
 * Labels are the page's own section headings — no numbering (a retired
 * idiom, and the numbers never appeared on the page).
 */
const SECTION_LABELS = {
  // Intelligence (home)
  "sec-summary": { label: "Year so far" },
  "sec-focus": { label: "Needs you first" },
  "sec-objectives": { label: "All objectives" },
  // Legacy performance dashboard
  "sec-overview": { label: "Overview" },
  "sec-review-timing": { label: "Review timing" },
  "sec-glance": { label: "At a glance" },
  "sec-trend": { label: "Trends" },
  // Goals tab
  "sec-goals": { label: "Performance goals" },
  "sec-goal-tracking": { label: "Goal tracking" },
};

function listSections() {
  if (typeof document === "undefined") return [];
  const nodes = Array.from(document.querySelectorAll("[data-section-id]"));
  return nodes
    .map((node) => {
      const id = node.dataset.sectionId;
      const meta = SECTION_LABELS[id] || { label: id };
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
    providers,
    setProvider,
    getProvider,
    snapshotNow,
    snapshotReady = true,
    link,
    toast,
    pages,
  } = ctx;
  const say = toast || { success() {}, error() {} };
  const cmds = [];

  // ── Navigation ─────────────────────────────────────────────────────
  // Each route is hub-relative — the `link()` helper supplied by the
  // palette host prepends the active hub's id (e.g. "/dev/goals").
  // The pathname comparison uses the resolved hub-prefixed path so
  // we skip the route the user is already on.
  ROUTES.forEach((r) => {
    // `pages` is the active hub's slot map; unknown (still loading) → show all.
    if (pages && r.slot && !pages[r.slot]) return;
    const target = link ? link(r.path) : r.path;
    if (target === pathname) return; // skip current route
    cmds.push({
      id: `nav:${r.path}`,
      category: "Go to",
      label: r.label,
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
        label: s.label,
        sub: `press ${i + 1}`,
        keywords: [s.id, s.label.toLowerCase()],
        shortcut: [String(i + 1)],
        run: () => scrollToSectionId(s.id),
      });
    });
  }

  // ── One-shot actions ───────────────────────────────────────────────
  // Skipped (not just disabled) until the snapshot store has hydrated —
  // capturing before that races the first load and can overwrite a week.
  if (snapshotReady && typeof snapshotNow === "function" && (!pages || pages.snapshots)) {
    cmds.push({
      id: "action:snapshot-now",
      category: "Actions",
      label: "Snapshot now",
      sub: "freeze this week's metrics",
      keywords: ["capture", "save", "weekly"],
      run: async () => {
        // The hook is moving to a `{ ok, error }` result; a legacy
        // undefined resolve still counts as success (the store rolled back
        // + logged if it wasn't).
        let r;
        try {
          r = await snapshotNow("");
        } catch (err) {
          say.error("Couldn't save the snapshot", { description: err?.message });
          return;
        }
        if (r && r.ok === false) {
          say.error("Couldn't save the snapshot", {
            description: r.error?.message || "Try again in a moment.",
          });
        } else if (r && r.ok === true) {
          say.success("Snapshot saved");
        }
      },
    });
  }

  if (!pages || pages.evidence) cmds.push({
    id: "action:open-evidence-compile",
    category: "Actions",
    label: "Compile evidence review",
    sub: "open the builder, export .pdf or .md",
    keywords: ["pdf", "export", "compile", "review", "evidence"],
    run: () =>
      router.push(link ? link("/evidence?view=compile") : "/evidence?view=compile"),
  });

  // ── AI provider switcher ───────────────────────────────────────────
  // The list comes in via ctx (AI_PROVIDERS from the analyst feature) so a
  // provider added there shows up here without a second copy to forget.
  const PROVIDERS = Array.isArray(providers) && providers.length > 0
    ? providers
    : [
        { id: "mistral", label: "Mistral" },
        { id: "glm", label: "GLM (Z.ai)" },
        { id: "openrouter", label: "OpenRouter" },
      ];
  const labelOf = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;
  PROVIDERS.forEach((p) => {
    if (p.id === provider) return; // skip the active one
    cmds.push({
      id: `provider:${p.id}`,
      category: "AI provider",
      label: `Switch to ${p.label}`,
      sub: provider ? `currently ${labelOf(provider)}` : undefined,
      keywords: ["ai", "switch", p.id, p.label.toLowerCase()],
      run: async () => {
        // The pref store writes optimistically and rolls back on a failed
        // PATCH; `ok` reports which happened so the toast is truthful.
        const r = await setProvider(p.id);
        // The pref store rolls back silently on a failed PATCH — read the
        // live value back rather than trusting the optimistic write.
        const now = typeof getProvider === "function" ? getProvider() : p.id;
        if ((r && r.ok === false) || now !== p.id) {
          say.error(`Couldn't switch to ${p.label}`, {
            description: r.error?.message || "Your previous provider is still active.",
          });
        } else {
          say.success(`AI provider: ${p.label}`);
        }
      },
    });
  });

  // ── Shortcuts cheatsheet (informational) ───────────────────────────
  const cheatsheet = [
    { keys: ["⌘", "K"], desc: "Open this palette" },
    { keys: ["?"], desc: "Open this palette to shortcuts" },
    { keys: ["1", "…", "9"], desc: "Jump to section N (Intelligence / Goals)" },
    { keys: ["j"], desc: "Next section (on / or /goals)" },
    { keys: ["k"], desc: "Previous section (on / or /goals)" },
    { keys: ["g", "p"], desc: "Go to Intelligence (home)" },
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
