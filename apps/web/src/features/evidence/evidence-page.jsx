"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, Card, PageContainer, PageHeader, SegmentedControl } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import { useSession } from "@/features/auth";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { readInputsTruncated } from "@/features/goal-inputs";
import { ConfigPanel } from "./config-panel";
import { DocumentPreview } from "./document-preview";
import { EvidenceDialog } from "./evidence-dialog";
import { ReviewPrepChecklist } from "./review-prep-checklist";
import { StarredEvidenceCard } from "./starred-evidence-card";
import { useStarredEvidence } from "./use-evidence";
import { useGoalReadings } from "./goal-readings";
import { buildGoalEvidenceGroups } from "./goal-evidence";
import { GoalEvidenceBoard } from "./goal-evidence-board";
import { EvidenceSummary } from "./evidence-summary";
import { downloadMarkdown, renderMarkdown } from "./markdown-export";
import { yearToDateLabel } from "@/lib/date";
import { apiGet, apiPost } from "@/lib/api-client";
import { generateEvidencePdf } from "./pdf/generate-pdf";

const NARRATIVE_DRAFT_KEY = "espace-devhub:evidence-narrative";
/** Readings the export prints when a live-only widget hasn't published on
 *  this device — a packet containing them isn't the record you want frozen. */
const PLACEHOLDER_READING = "No reading on this device";

const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "compile", label: "Document" },
];

/** "2026-09-29" in the viewer's LOCAL calendar — the same day the
 *  document footer prints (toISOString is UTC, a day off in the evening). */
function localIsoDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "jane-doe-review-2026-09-28" — one filename stem for every export. */
function exportStem(name) {
  const slug = (name || "performance")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "performance"}-review-${localIsoDay()}`;
}

export function EvidencePage() {
  const { me } = useIntegrations();
  // The document names the ACCOUNT (Settings → Account), not a provider
  // login — with no code host connected the packet used to read "# — —".
  const { user } = useSession();
  const docName = user?.displayName?.trim() || me?.name || null;
  const docTeam = user?.department?.trim() || me?.team || null;
  const searchParams = useSearchParams();
  // "board" = the goal evidence board (primary); "compile" = the document builder.
  const [view, setView] = useState("board");
  const link = useHubLink();

  // Deep-link (`?view=compile` / legacy `?print=1`) opens the builder directly.
  useEffect(() => {
    if (searchParams?.get("print") === "1" || searchParams?.get("view") === "compile") {
      setView("compile");
    }
  }, [searchParams]);

  // The reviewee's career level ("Senior engineer"). Empty by default — an
  // unset level is omitted from the document title, not printed as a
  // placeholder.
  const [level, setLevel] = useState("");
  // #238: the narrative used to be bare useState — one navigation away
  // and a half-written review summary was gone. Draft lives in
  // localStorage (wiped on sign-out; the submitted packet is the record).
  // Load on mount (not in the initializer) so server and client render
  // the same empty textarea first — no hydration mismatch.
  const [narrative, setNarrative] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    try {
      setNarrative(window.localStorage.getItem(NARRATIVE_DRAFT_KEY) || "");
    } catch {
      /* storage unavailable — start empty */
    }
    setDraftLoaded(true);
  }, []);
  useEffect(() => {
    if (!draftLoaded) return; // never clobber the stored draft with the initial ""
    try {
      if (narrative) window.localStorage.setItem(NARRATIVE_DRAFT_KEY, narrative);
      else window.localStorage.removeItem(NARRATIVE_DRAFT_KEY);
    } catch {
      /* storage unavailable — draft just isn't persisted */
    }
  }, [narrative, draftLoaded]);
  // Goal-oriented review: only the summary narrative + the per-goal readings.
  // (The old integration sections — metrics, PRs, tickets, reviews — are gone;
  // GitHub/Jira aren't tracked anymore.)
  const [include, setInclude] = useState({ narrative: true, goals: true });

  // Goal-oriented data: per-goal readings + the check-in entries the user
  // logged against each goal. Windowed to year-to-date (the L2s are annual
  // goals). useAllGoalInputs subscribes the inputs store so the memo re-reads
  // readInputs() on hydration/change.
  const { ready, goalsError, retryGoals, unclassifiedGoals } = useGoalWidgetItems();
  // Goals with no tracker — listed on the board and in the packet (never
  // scored) so a 13-goal year doesn't read as a clean 3-goal one.
  const untracked = useMemo(
    () =>
      (unclassifiedGoals || [])
        .filter((g) => g && g.kind !== "L1")
        .map((g) => ({ id: g.id, title: g.title, l1Title: g.parentL1Title || "" })),
    [unclassifiedGoals],
  );
  const goalReadings = useGoalReadings();
  // Hand-picked proof artifacts (starred PRs/tickets) — rendered in the
  // sidebar card and as the document's "Starred proof" section.
  const starred = useStarredEvidence();
  // Enrichment (verdict, evidence, timing) lives in useGoalReadings now, so the
  // rows already carry everything — this just shelves them by L1.
  const evidence = useMemo(
    () => buildGoalEvidenceGroups(goalReadings, untracked),
    [goalReadings, untracked],
  );

  const rangeLabel = yearToDateLabel();
  // Real hydration signal (goals + specs loaded), NOT emptiness — otherwise a
  // user with zero classified goals sees a permanent spinner and never the
  // "set up your goals" empty state.
  const loading = !ready;

  // F1 — submission status. The "Review packet" sidebar shows when this
  // document was last submitted; submitting freezes it server-side as a
  // review packet the manager grades against. Fetched once on mount (not
  // gated on `view`) so the sidebar can show it from the board view too.
  const [submitting, setSubmitting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [lastPacket, setLastPacket] = useState(null); // {id, submittedAt, hasManager} | null
  const [packetView, setPacketView] = useState({ status: "idle", packet: null, error: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Who the packet goes to — known BEFORE the first submit (it used to be
  // read off the last packet, so a first-timer was told "your manager, if
  // one is assigned to you"). undefined = still loading, null = none.
  const [manager, setManager] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    void apiGet("/review-packets/mine").then((r) => {
      if (cancelled || !r.ok) return;
      setLastPacket(r.data?.packets?.[0] ?? null);
    });
    void apiGet("/my-reports/manager").then((r) => {
      if (cancelled) return;
      setManager(r.ok ? (r.data?.manager ?? null) : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const managerName = manager?.displayName || lastPacket?.managerName || null;

  function buildDocProps() {
    return {
      name: docName,
      team: docTeam,
      level,
      rangeLabel,
      narrative,
      goalReadings,
      untracked,
      starred,
      include,
    };
  }

  // What the confirm dialog needs to say before the user freezes anything.
  const pendingMarkdown = useMemo(
    () => (confirmOpen ? renderMarkdown(buildDocProps()) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmOpen, level, narrative, goalReadings, untracked, starred, include, docName, docTeam],
  );
  const placeholderCount = useMemo(
    () => (pendingMarkdown.match(new RegExp(PLACEHOLDER_READING, "g")) || []).length,
    [pendingMarkdown],
  );

  // A PR-derived reading whose feed hasn't answered yet ("Still loading").
  // Freezing or exporting it would put that placeholder in the document.
  const readingsPending = goalReadings.some((r) => r.reading?.pending);
  function blockWhilePending() {
    if (!readingsPending) return false;
    toast("Some readings are still loading from your code host", {
      description: "Give it a moment — the document would print \u201cStill loading\u201d for them.",
    });
    return true;
  }

  async function handleSubmitForReview() {
    if (submitting) return;
    if (blockWhilePending()) return;
    setSubmitting(true);
    const markdown = renderMarkdown(buildDocProps());
    // Clamp to the server's field caps so one long reading string can't
    // fail validation for the whole submit.
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    const goals = goalReadings
      .filter((r) => r.level === "L2")
      .map((r) => ({
        goalId: r.goal.id,
        title: clip(r.goal.title, 1000) || "",
        l1Title: clip(r.parentL1?.title, 1000) || "",
        tier: clip(r.verdict?.tier, 50),
        reading: clip(r.reading?.value, 500),
        statusLabel: clip(r.reading?.statusLabel, 100),
      }))
      // Untracked goals ride along with no verdict, so the manager's copy
      // shows the whole year too.
      .concat(
        untracked.map((g) => ({
          goalId: g.id,
          title: clip(g.title, 1000) || "",
          l1Title: clip(g.l1Title, 1000) || "",
          tier: null,
          reading: null,
          statusLabel: "No tracker yet",
        })),
      )
      .slice(0, 500);
    const r = await apiPost("/review-packets", {
      level,
      rangeLabel,
      // The narrative only travels when the Summary section is on — what
      // the manager gets is exactly what the preview shows.
      narrative: include.narrative ? narrative : "",
      markdown,
      goals,
      starredCount: starred.length,
    });
    setSubmitting(false);
    if (!r.ok) {
      toast.error(
        `Couldn't submit: ${r.error?.message || "the server didn't respond"}`,
      );
      return;
    }
    setConfirmOpen(false);
    const packet = r.data?.packet ?? null;
    setLastPacket(packet);
    // The submit response is meta-only; seed the viewer with what we just
    // sent so "View last submitted packet" is instant for this version.
    setPacketView({
      status: "ready",
      packet: packet ? { ...packet, markdown } : null,
      error: null,
    });
    if (packet?.hasManager) {
      toast.success("Submitted for review.", {
        description:
          "Your manager received the frozen document — it's the record you'll both be looking at.",
      });
    } else {
      toast.success("Review packet saved.", {
        description:
          "No manager on file yet — the frozen version is stored and appears to a manager once one is assigned.",
      });
    }
  }

  function handleDownloadMarkdown() {
    if (blockWhilePending()) return;
    downloadMarkdown(`${exportStem(docName)}.md`, renderMarkdown(buildDocProps()));
    toast.success("Markdown downloaded");
  }

  async function handleExportPdf() {
    if (generatingPdf) return;
    if (blockWhilePending()) return;
    setGeneratingPdf(true);
    const t = toast.loading("Generating PDF…");
    try {
      await generateEvidencePdf(buildDocProps(), `${exportStem(docName)}.pdf`);
      toast.success("PDF downloaded", { id: t });
    } catch (err) {
      toast.error("PDF export failed", {
        id: t,
        description: `${err?.message || err}. Try Download .md instead — it's the same document.`,
        action: { label: "Download .md", onClick: handleDownloadMarkdown },
      });
    } finally {
      setGeneratingPdf(false);
    }
  }

  // The frozen markdown lives on the server (GET /review-packets/mine/:id),
  // so the viewer works from any device, not just the one that submitted.
  async function openPacketViewer() {
    setViewerOpen(true);
    if (!lastPacket?.id) return;
    if (packetView.status === "ready" && packetView.packet?.id === lastPacket.id) return;
    setPacketView({ status: "loading", packet: null, error: null });
    const r = await apiGet(`/review-packets/mine/${lastPacket.id}`);
    if (r.ok) {
      setPacketView({ status: "ready", packet: r.data?.packet ?? null, error: null });
    } else {
      setPacketView({
        status: "error",
        packet: null,
        error: r.error?.message || "Couldn't load the packet.",
      });
    }
  }

  function SubmitCard() {
    return (
      <Card tone="sky" className="flex flex-col gap-3">
        <div className="text-[14px] font-bold">Submit for review</div>
        <p className="text-[13px] leading-[1.5] opacity-85">
          Freezes the document as it stands into a review packet{" "}
          {managerName ? `${managerName} reads` : "your manager reads"}. Resubmitting creates a
          newer version.
        </p>
        {manager === null && !lastPacket?.hasManager ? (
          <p className="text-[12.5px] leading-[1.5] opacity-85">
            You don&apos;t have a manager assigned yet — ask your admin. The packet is kept
            until one is.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting || loading}
          >
            {submitting ? "Submitting…" : "Submit packet"}
          </Button>
          {lastPacket?.submittedAt ? (
            <Button
              size="sm"
              variant="soft"
              onClick={() => void openPacketViewer()}
            >
              View last submitted packet
            </Button>
          ) : null}
        </div>
        {lastPacket?.submittedAt ? (
          <div className="text-[12px] opacity-75">
            Last submitted{" "}
            {new Date(lastPacket.submittedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            {lastPacket.hasManager
              ? ` · ${lastPacket.managerName || managerName || "your manager"} can see it`
              : " · no manager assigned yet"}
          </div>
        ) : null}
      </Card>
    );
  }

  const managerLine = managerName
    ? `It goes to ${managerName}.`
    : manager === null
      ? "You don't have a manager assigned yet — ask your admin. The packet is stored and appears to a manager once one is."
      : "It goes to your manager.";
  // Goals that won't carry a verdict in the packet (no tracker at all).
  const totalGoalCount = goalReadings.filter((r) => r.level === "L2").length + untracked.length;

  const dialogs = (
    <>
      <EvidenceDialog
        open={confirmOpen}
        title="Submit this packet?"
        onClose={() => (submitting ? null : setConfirmOpen(false))}
      >
        <p className="mt-2 text-[13px] leading-[1.6] text-muted-fg">
          This freezes the document exactly as the preview shows it. {managerLine}{" "}
          Resubmitting later creates a newer version — nothing is overwritten.
        </p>
        {untracked.length > 0 ? (
          <div className="mt-3 rounded-[var(--radius-lg)] bg-lemon px-3.5 py-3 text-[13px] leading-[1.5] text-lemon-ink">
            {untracked.length} of your {totalGoalCount} goals aren&apos;t in this packet&apos;s
            verdicts because they have no tracker — they&apos;re listed under &ldquo;Not yet
            tracked&rdquo;. Submit anyway?
          </div>
        ) : null}
        {placeholderCount > 0 ? (
          <div className="mt-3 rounded-[var(--radius-lg)] bg-lemon px-3.5 py-3 text-[13px] leading-[1.5] text-lemon-ink">
            {placeholderCount} goal{placeholderCount === 1 ? "" : "s"} read{" "}
            &ldquo;{PLACEHOLDER_READING}&rdquo;. Open the Goals page once on this device so
            those widgets publish a number, then submit — or submit anyway and the packet
            carries the placeholder.
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="soft" onClick={() => setConfirmOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmitForReview()} disabled={submitting}>
            {submitting
              ? "Submitting…"
              : placeholderCount > 0 || untracked.length > 0
                ? "Submit anyway"
                : "Submit packet"}
          </Button>
        </div>
      </EvidenceDialog>

      <EvidenceDialog
        open={viewerOpen}
        title="Last submitted packet"
        onClose={() => setViewerOpen(false)}
        wide
      >
        <p className="mt-1 text-[12.5px] text-muted-fg">
          {lastPacket?.submittedAt
            ? `Frozen ${new Date(lastPacket.submittedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}`
            : ""}
          {lastPacket?.hasManager
            ? ` · visible to ${lastPacket.managerName || "your manager"}`
            : " · no manager assigned yet"}
        </p>
        {packetView.status === "ready" && packetView.packet ? (
          <>
            <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-[var(--radius-lg)] bg-card-alt p-4 font-sans text-[13px] leading-[1.55] text-fg">
              {packetView.packet.markdown}
            </pre>
            <div className="mt-4 flex justify-end gap-2.5">
              <Button
                variant="soft"
                onClick={() =>
                  downloadMarkdown(
                    `${exportStem(docName)}-submitted.md`,
                    packetView.packet.markdown,
                  )
                }
              >
                Download .md
              </Button>
              <Button onClick={() => setViewerOpen(false)}>Close</Button>
            </div>
          </>
        ) : packetView.status === "error" ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-[13px] leading-[1.6] text-muted-fg">
              Couldn&apos;t load the packet — {packetView.error}
            </p>
            <div className="flex justify-end gap-2.5">
              <Button variant="soft" onClick={() => void openPacketViewer()}>
                Retry
              </Button>
              <Button onClick={() => setViewerOpen(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-[1.6] text-muted-fg">
            {lastPacket?.id ? "Loading the frozen document…" : "Nothing submitted yet."}
          </p>
        )}
      </EvidenceDialog>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        crumb={`Evidence · ${rangeLabel}`}
        title="Make the case."
        subtitle="Compile your goals — what each was set up to achieve, where it landed, and the evidence you logged — into one document your manager can review."
        right={
          <div className="flex flex-wrap items-center gap-2 no-print">
            <SegmentedControl ariaLabel="Evidence view" options={VIEW_OPTIONS} value={view} onChange={setView} />
            <Button variant="soft" onClick={handleDownloadMarkdown}>
              Download .md
            </Button>
            {/* Soft: "Submit packet" is the page's one ink button. */}
            <Button variant="soft" onClick={() => void handleExportPdf()} disabled={generatingPdf}>
              {generatingPdf ? "Generating…" : "Export PDF"}
            </Button>
          </div>
        }
      />

      {readInputsTruncated() ? (
        <div className="mb-5 no-print">
          <Badge
            tone="lemon"
            title="Your check-in history hit the server's row cap — the oldest entries aren't loaded, so totals and compliance counts read as at-least, not exact."
          >
            History capped
          </Badge>
        </div>
      ) : null}

      {view === "board" ? (
        goalsError && !ready ? (
          <Card className="flex flex-col items-start gap-3">
            <div className="text-[15px] font-bold text-peach-text">Couldn&apos;t load your goals</div>
            <p className="text-[13px] leading-[1.5] text-muted-fg">
              {goalsError.message || "The server didn't respond. Check your connection and try again."}
            </p>
            <Button onClick={() => void retryGoals()}>Retry</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <GoalEvidenceBoard
              groups={evidence.groups}
              untracked={untracked}
              loading={loading}
              goalsHref={link("/goals")}
              goalHref={(goalId) => link(`/goals?goal=${encodeURIComponent(goalId)}`)}
            />
            <div className="flex flex-col gap-4 no-print">
              <Card>
                <ReviewPrepChecklist />
              </Card>
              <EvidenceSummary
                rangeLabel={rangeLabel}
                summary={evidence.summary}
                onCompile={() => setView("compile")}
                loading={loading}
                lastPacket={lastPacket}
              />
              <SubmitCard />
              <StarredEvidenceCard />
            </div>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 no-print">
            <ConfigPanel
              level={level}
              setLevel={setLevel}
              include={include}
              setInclude={setInclude}
              rangeLabel={rangeLabel}
            />
            <SubmitCard />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <DocumentPreview
              name={docName}
              team={docTeam}
              untracked={untracked}
              filename={`${exportStem(docName)}.md / .pdf`}
              level={level}
              narrative={narrative}
              setNarrative={setNarrative}
              include={include}
              goalReadings={goalReadings}
              starred={starred}
              rangeLabel={rangeLabel}
            />
          </div>
        </div>
      )}
      {dialogs}
    </PageContainer>
  );
}
