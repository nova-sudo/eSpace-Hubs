/**
 * Evidence PDF document (@react-pdf/renderer).
 *
 * A first-class, headless PDF — no browser print dialog, reproducible output.
 * Binds to the SAME props as renderMarkdown / DocumentPreview so the three
 * renderings stay in lockstep (shared formatExpected). Goal-oriented sections
 * mirror the markdown: masthead, 01 Summary, 02 Performance goals, footer.
 *
 * This is a LIGHT "paper" document regardless of the app's on-screen theme —
 * white ground, dark ink, cobalt accent — which is what fixes the old
 * dark-cards-on-white print bug. react-pdf has no CSS variables or Tailwind,
 * so literal light values here are the sanctioned exception to the token rule
 * (the PDF is rendered off-DOM). Built-in Helvetica for reliability — no
 * web-font fetch to fail.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { formatExpected } from "../format-expected";

const INK = "#0b0b0e";
const MUTED = "#5c5c63";
const DIM = "#8a8a90";
const ACCENT = "#1d4ed8";
const LINE = "#e2e0d8";
const PANEL = "#f7f5ef";

// Achievement-tier short labels (react-pdf can't import the theme-aware UI).
const TIER_SHORT = {
  not_achieved: "Not met",
  achieved: "Achieved",
  over_achieved: "Over-achieved",
  role_model: "Role model",
};

/** Short calendar date for an evidence timestamp — the "when". */
function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const s = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: INK,
    paddingTop: 48,
    paddingBottom: 54,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
  },
  mastheadName: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.4 },
  mastheadSub: { fontSize: 10, color: MUTED, marginTop: 4 },
  rule: { borderBottomWidth: 1, borderBottomColor: LINE, marginTop: 14, marginBottom: 18 },
  sectionHead: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 8,
  },
  para: { fontSize: 10.5, color: INK, lineHeight: 1.55 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap" },
  metric: { width: "33.33%", paddingRight: 12, marginBottom: 12 },
  metricLabel: {
    fontSize: 7.5,
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: "Helvetica-Bold",
  },
  metricValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 2 },
  metricSub: { fontSize: 7.5, color: DIM, marginTop: 1 },
  item: { flexDirection: "row", marginBottom: 5 },
  itemRef: { fontFamily: "Helvetica-Bold", color: ACCENT, width: 78, fontSize: 9 },
  itemBody: { flex: 1, fontSize: 9.5 },
  itemDate: { color: DIM, fontSize: 8, width: 52, textAlign: "right" },
  itemImpact: { color: MUTED, fontSize: 8.5, marginLeft: 78, marginBottom: 4 },
  l1Head: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 2 },
  l1Reading: { fontSize: 9, color: MUTED, marginBottom: 6 },
  // Rich per-goal block (what / how / when).
  goalTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 9 },
  goalMeta: { fontSize: 9, color: MUTED, marginTop: 1.5, lineHeight: 1.4 },
  goalMetaLabel: { fontFamily: "Helvetica-Bold", color: DIM },
  goalAssess: { fontSize: 9, color: INK, marginTop: 2.5, lineHeight: 1.45 },
  evList: { marginTop: 4, marginBottom: 2 },
  evRow: { flexDirection: "row", marginTop: 2.5, paddingLeft: 8 },
  evDate: { fontSize: 7.5, color: DIM, width: 44, fontFamily: "Helvetica-Bold" },
  evBody: { flex: 1, fontSize: 8.5, color: MUTED, lineHeight: 1.4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4 },
  tHead: { backgroundColor: PANEL },
  tCellGoal: { width: "40%", paddingRight: 6, fontSize: 8.5 },
  tCellExp: { width: "26%", paddingRight: 6, fontSize: 8.5, color: MUTED },
  tCellAch: { width: "20%", paddingRight: 6, fontSize: 8.5 },
  tCellStat: { width: "14%", fontSize: 8, color: MUTED },
  tHeadCell: { fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.4, textTransform: "uppercase", fontSize: 7 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 8,
    fontSize: 7.5,
    color: DIM,
  },
});

// No wrap={false} on Section/groups — a long list (PRs, tickets, a big L1
// table) can exceed a full page, and a non-wrapping node taller than a page is
// CLIPPED by react-pdf (silent data loss). Sections flow across pages; only the
// atomic units (one item, one table row) stay unbreakable via wrap={false}.
function Section({ n, title, children }) {
  return (
    <View>
      <Text style={s.sectionHead}>
        {n} · {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Group goalReadings L1 → its L2s, mirroring renderMarkdown's grouping. Keeps
 * L1s with NO classified L2 children (rows: []) so the PDF shows them too —
 * the markdown + on-screen preview both render those L1s, and dropping them
 * here would silently diverge the three renderings.
 */
function goalGroups(goalReadings) {
  const groups = [];
  let active = null;
  for (const r of goalReadings) {
    if (r.level === "L1") {
      active = { l1: r.goal, reading: r.reading, weightage: r.goal?.weightage, rows: [] };
      groups.push(active);
    } else if (r.level === "L2") {
      if (!active || active.l1?.id !== r.parentL1?.id) {
        active = { l1: r.parentL1, reading: null, weightage: r.parentL1?.weightage, rows: [] };
        groups.push(active);
      }
      active.rows.push(r);
    }
  }
  return groups;
}

/**
 * One L2 goal, rendered rich: what it was set out to achieve → where it landed
 * (+ tier), the grader's assessment (the "how/why"), and the dated proof the
 * user logged (the "when"). The header is atomic (`wrap={false}`) but the
 * evidence list flows across pages so a long log is never clipped.
 */
function GoalBlock({ r }) {
  const v = r.verdict;
  const graded = v && !v.awaiting && !v.pendingSetup;
  const tier = graded && v.tier ? TIER_SHORT[v.tier] : null;
  const reasoning = graded && v.reasoning ? v.reasoning : null;
  const evidence = Array.isArray(r.evidence) ? r.evidence : [];

  return (
    <View>
      <View wrap={false}>
        <Text style={s.goalTitle}>{r.goal?.title || "(untitled)"}</Text>
        <Text style={s.goalMeta}>
          <Text style={s.goalMetaLabel}>Target: </Text>
          {formatExpected(r.spec) || "—"}
          <Text style={s.goalMetaLabel}>    Achieved: </Text>
          {r.reading?.value || "—"}
          {r.reading?.statusLabel ? ` · ${r.reading.statusLabel}` : ""}
          {tier ? ` · ${tier}` : ""}
        </Text>
        {reasoning ? (
          <Text style={s.goalAssess}>
            <Text style={s.goalMetaLabel}>Assessment: </Text>
            {reasoning}
            {v.confidence === "low" ? " (low confidence)" : ""}
          </Text>
        ) : null}
      </View>
      {evidence.length ? (
        <View style={s.evList}>
          {evidence.map((ev, i) => (
            <View key={i} style={s.evRow} wrap={false}>
              <Text style={s.evDate}>{fmtDate(ev.ts)}</Text>
              <Text style={s.evBody}>{ev.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function EvidencePdfDocument({
  name,
  team,
  level,
  rangeLabel,
  narrative,
  goalReadings = [],
  include = { narrative: true, goals: true },
}) {
  const groups = include.goals ? goalGroups(goalReadings) : [];
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <Document title={`${name || "Performance review"} — ${level || ""}`.trim()}>
      <Page size="A4" style={s.page}>
        <Text style={s.mastheadName}>
          {name || "—"} — {level || "Performance review"}
        </Text>
        <Text style={s.mastheadSub}>
          {[team, rangeLabel].filter(Boolean).join(" · ")}
        </Text>
        <View style={s.rule} />

        {include.narrative && narrative?.trim() ? (
          <Section n="01" title="Summary">
            <Text style={s.para}>{narrative.trim()}</Text>
          </Section>
        ) : null}

        {groups.length ? (
          <View>
            <Text style={s.sectionHead}>02 · Performance goals</Text>
            {groups.map((g, gi) => (
              <View key={gi}>
                <View wrap={false}>
                  <Text style={s.l1Head}>
                    {g.l1?.title || "(untitled)"}
                    {g.weightage > 0 ? `  (${g.weightage}% weight)` : ""}
                  </Text>
                  {g.reading ? (
                    <Text style={s.l1Reading}>
                      {g.reading.value} — {g.reading.statusLabel}
                    </Text>
                  ) : null}
                </View>
                {g.rows.length === 0 ? (
                  <Text style={s.l1Reading}>No L2s classified yet for this L1.</Text>
                ) : (
                  g.rows.map((r, ri) => <GoalBlock key={ri} r={r} />)
                )}
              </View>
            ))}
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          Generated by eSpace/DevHub · {today} · Source: your logged goal evidence
        </Text>
      </Page>
    </Document>
  );
}
