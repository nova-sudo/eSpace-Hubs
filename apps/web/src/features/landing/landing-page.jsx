"use client";

/**
 * Public marketing landing page (unauthenticated), mounted at `/` for
 * logged-out visitors. Dark-only "Nothing UI": pure black, Doto dot-matrix
 * display type, Space Mono labels, Hanken Grotesk body, one cobalt accent, and
 * the live dot-matrix Glyph analyst as the signature visual. Every CTA routes
 * to /login. Ported from the design handoff; tokens are scoped to `.lp` so the
 * dark-only palette never leaks into the themed app.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GlyphAgent } from "@/components/ui";

const AC = "#4d7cff";
const GOOD = "#3fcf8e";
const AMB = "#ffb24d";
const RED = "#ff5a5a";
const FG = "#f6f6f6";
const DIM = "rgba(246,246,246,0.30)";
const DOTD = "rgba(255,255,255,0.18)";

const NAV = [
  { label: "How", href: "how" },
  { label: "Features", href: "features" },
  { label: "Product", href: "product" },
  { label: "Analyst", href: "analyst" },
];

const MARQUEE = ["Pull requests", "Reviews", "Tickets", "Goals", "Evidence", "Snapshots"].map(
  (word, i) => ({ word, color: i % 2 === 0 ? FG : DIM }),
);

const HERO_PROOF = [
  { value: "90d", label: "of receipts", color: FG },
  { value: "13", label: "goals tracked", color: AC },
  { value: "1-click", label: "review export", color: GOOD },
];

const INTEGRATIONS = ["GitLab", "GitHub", "Jira", "Zoho"];

const STEPS = [
  { num: "01", tag: "Set once", title: "Connect your goals", body: "Import your L1/L2 goal tree from Zoho or build it in minutes. Weightings, rubrics and targets the analyst reads." },
  { num: "02", tag: "Automatic", title: "Evidence classifies itself", body: "Connect GitLab, GitHub and Jira. Every merged PR, review and closed ticket is pulled in and matched to a goal." },
  { num: "03", tag: "One click", title: "Compile the review", body: "Get a review-ready document with metrics, narrative and receipts per goal, drafted and editable, ready to export." },
];

const HEALTH_STRIP = [GOOD, GOOD, AMB, GOOD, GOOD, RED, GOOD];

const SMALL_FEATURES = [
  { title: "Auto + manual", body: "Code metrics pull live. Softer goals log in a tap.", d0: AC, d1: DOTD },
  { title: "Evidence bundles", body: "Export 30/90/180-day cases as Markdown or PDF.", d0: FG, d1: DOTD },
];

const strip = (arr) => arr.map((x) => (x ? AC : DOTD));
const DEMO_CARDS = [
  { kind: "Counter", title: "Mentoring hours", dot: AMB, strip: strip([1, 1, 0, 0]), foot: "stale · 9d" },
  { kind: "Rubric", title: "Defect rate ≤ 10%", dot: RED, strip: strip([1, 1, 1, 0]), foot: "behind" },
  { kind: "Auto", title: "Review turnaround", dot: GOOD, strip: strip([1, 1, 1, 1]), foot: "on pace" },
  { kind: "Counter", title: "OSS contributions", dot: GOOD, strip: strip([1, 0, 1, 1]), foot: "on pace" },
];

const ANALYST_POINTS = [
  "Classifies all 13 goals in seconds",
  "Flags what's slipping before review season",
  "Drafts the narrative and cites the receipts",
];

const FAQS = [
  { q: "Where does the data come from?", a: "From the tools you already use: GitLab, GitHub and Jira via personal access tokens, plus your Zoho goal tree. Nothing is entered twice." },
  { q: "Is my data private?", a: "Yes. Tokens are stored only in your browser and used to read your own activity. Metrics stay local unless you choose to export a bundle." },
  { q: "What if a goal isn't code-measurable?", a: "Softer goals like mentoring or design reviews log manually in a tap. The analyst tracks them alongside the automatic ones so nothing goes dark." },
  { q: "Can I edit what the analyst writes?", a: "Always. The drafted narrative and every included section are fully editable before you export or share." },
  { q: "Do I need my manager to set it up?", a: "No. Sign in, connect your sources, and your evidence starts collecting immediately. It is built for the individual developer first." },
];

const FOOT_LINKS = ["Privacy", "Security", "Docs", "Contact"];

// Nine-dot logo mark (alternating solid / dim, cobalt centre).
function Logo3({ size = 26, pad = 5, gap = 2.5, center = AC }) {
  const D = "var(--dot)";
  const F = "var(--dotd)";
  const pat = [D, F, D, F, center, F, D, F, D];
  return (
    <span
      className="logo3"
      style={{ width: size, height: size, padding: pad, gap }}
      aria-hidden="true"
    >
      {pat.map((bg, i) => (
        <i key={i} style={{ background: bg }} />
      ))}
    </span>
  );
}

export function LandingPage() {
  const rootRef = useRef(null);
  const [heroEmotion, setHeroEmotion] = useState("story");

  // Scroll-reveal: reproduce the handoff's `.rv → .in` fade/rise with a
  // sibling-staggered IntersectionObserver instead of a per-frame scroll poll.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("is-animated");
    const els = [...root.querySelectorAll(".rv")];
    if (reduce) {
      els.forEach((el) => el.classList.add("in"));
      return undefined;
    }
    els.forEach((el) => {
      const sibs = [...el.parentElement.children].filter((c) => c.classList.contains("rv"));
      el.style.transitionDelay = `${Math.max(0, sibs.indexOf(el)) * 70}ms`;
    });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Hero glyph reacts to scroll depth (cheap: emotion changes only ~6× over the
  // hero region; no per-frame state). Comet smear is intentionally omitted.
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;
    const FACES = ["story", "think", "scan", "working", "aha", "happy", "proud"];
    let raf = 0;
    let last = "story";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const prog = Math.min(1, Math.max(0, (window.scrollY || 0) / (window.innerHeight || 1)));
      const want = FACES[Math.min(FACES.length - 1, Math.floor(prog * FACES.length))];
      if (want !== last) {
        last = want;
        setHeroEmotion(want);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className="lp" ref={rootRef}>
        {/* NAV */}
        <header
          style={{
            position: "sticky", top: 0, zIndex: 30, display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 16, padding: "16px 44px",
            borderBottom: "1px solid var(--line)", background: "rgba(5,5,5,0.82)", backdropFilter: "blur(18px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Logo3 />
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}>
              eSpace<span style={{ color: "var(--ac)" }}>/</span>
              <span className="dt" style={{ fontSize: 15, fontWeight: 700 }}>DevHub</span>
            </div>
          </div>
          <nav className="lp-nav" style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {NAV.map((l) => (
              <a key={l.href} href={`#${l.href}`} className="eb" style={{ letterSpacing: "1px", color: "var(--mut)" }}>
                {l.label}
              </a>
            ))}
          </nav>
          <Link href="/login" className="btn-solid" style={{ padding: "10px 17px", fontSize: 11 }}>Log in →</Link>
        </header>

        {/* HERO */}
        <section style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--line)" }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "radial-gradient(var(--dotd) 1px,transparent 1px)", backgroundSize: "30px 30px",
            opacity: 0.28,
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 60% 30%,#000,transparent)",
            maskImage: "radial-gradient(ellipse 80% 70% at 60% 30%,#000,transparent)", pointerEvents: "none",
          }} />
          <div className="wrap" style={{ position: "relative", zIndex: 1, paddingTop: 60, paddingBottom: 0, textAlign: "center" }}>
            <div className="rv" style={{ display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid var(--line)", borderRadius: 999, padding: "6px 13px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ac)" }} />
              <span className="eb" style={{ letterSpacing: "1.5px" }}>Performance evidence for developers</span>
            </div>

            <div className="rv hero-instrument" style={{ display: "flex", justifyContent: "center", margin: "26px 0 6px", pointerEvents: "none" }}>
              <GlyphAgent emotion={heroEmotion} size={320} res={64} accent="#557CFF" showCaption={false} />
            </div>

            <h1 className="rv dt" style={{ fontSize: "clamp(54px,9vw,124px)", lineHeight: 0.84, margin: 0 }}>
              Your review,<br />already written<span style={{ color: "var(--ac)" }}>.</span>
            </h1>
            <p className="rv" style={{ fontSize: 17, lineHeight: 1.6, color: "var(--mut)", maxWidth: 440, margin: "24px auto 0" }}>
              DevHub reads your PRs, reviews and tickets, maps them to your goals, and drafts the case for you.
            </p>
            <div className="rv" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 32, paddingBottom: 48 }}>
              <Link href="/login" className="btn-solid">Log in to start →</Link>
              <a href="#how" className="btn-ghost">See how it works</a>
            </div>
          </div>

          <div style={{ position: "relative", zIndex: 1, borderTop: "1px solid var(--line)" }}>
            <div className="wrap hero-bottom" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, paddingTop: 22, paddingBottom: 22, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap" }}>
                {HERO_PROOF.map((p) => (
                  <div key={p.label} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                    <span className="dt" style={{ fontSize: 26, color: p.color }}>{p.value}</span>
                    <span className="eb" style={{ fontSize: 8.5, letterSpacing: "1px" }}>{p.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="eb" style={{ fontSize: 9, letterSpacing: "1.4px" }}>Reads from</span>
                <span style={{ width: 26, height: 1, background: "var(--line)" }} />
                {INTEGRATIONS.map((i) => (
                  <span key={i} className="mn" style={{ fontSize: 11, color: "var(--mut)", letterSpacing: "0.5px" }}>{i}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* KINETIC MARQUEE */}
        <section style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", overflow: "hidden", background: "var(--panel)", padding: "22px 0" }}>
          <div className="marq">
            {[0, 1].map((dup) => (
              <div key={dup} style={{ display: "flex", alignItems: "center" }} aria-hidden={dup === 1 ? "true" : undefined}>
                {MARQUEE.map((m, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                    <span className="mk" style={{ color: m.color, padding: "0 30px" }}>{m.word}</span>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ac)", flex: "none" }} />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* PROBLEM */}
        <section style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="wrap" style={{ paddingTop: 64, paddingBottom: 64 }}>
            <p className="rv" style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: "clamp(24px,3.2vw,38px)", lineHeight: 1.28, letterSpacing: "-0.5px", margin: 0, maxWidth: 960 }}>
              Every cycle, you rebuild six months of work from memory and a messy commit log.{" "}
              <span style={{ color: "var(--mut)" }}>DevHub keeps the receipts as you go, so the story is already there.</span>
            </p>
          </div>
        </section>

        {/* 01 · HOW IT WORKS */}
        <section id="how" style={{ paddingTop: 88, paddingBottom: 40 }}>
          <div className="wrap">
            <div className="rv" style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
              <span className="idx">01</span>
              <h2 className="dt" style={{ fontSize: "clamp(30px,4vw,44px)", margin: 0 }}>Connect. Classify. Compile<span style={{ color: "var(--ac)" }}>.</span></h2>
            </div>
            {STEPS.map((s) => (
              <div key={s.num} className="rv step-row" style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 32, alignItems: "center", borderTop: "1px solid var(--line)", padding: "30px 4px" }}>
                <span className="dt" style={{ fontSize: 52, color: "var(--card2)", WebkitTextStroke: "1px var(--ls)" }}>{s.num}</span>
                <div style={{ maxWidth: 560 }}>
                  <h3 style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "-0.3px", margin: 0 }}>{s.title}</h3>
                  <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--mut)", margin: "9px 0 0" }}>{s.body}</p>
                </div>
                <span className="eb" style={{ fontSize: 9, letterSpacing: "1.4px", color: "var(--ac)", whiteSpace: "nowrap" }}>{s.tag}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 02 · FEATURES */}
        <section id="features" style={{ paddingTop: 64, paddingBottom: 40 }}>
          <div className="wrap">
            <h2 className="rv dt" style={{ fontSize: "clamp(30px,4vw,44px)", margin: "0 0 30px", display: "flex", alignItems: "baseline", gap: 14 }}>
              <span className="idx">02</span>Built for the review, not the busywork<span style={{ color: "var(--ac)" }}>.</span>
            </h2>
            <div className="rv bento" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
              <div className="bento-cell span-all" style={{ gridColumn: "span 2", gridRow: "span 2", border: "1px solid var(--line)", borderRadius: 16, background: "#070709", position: "relative", overflow: "hidden", padding: 22, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 280 }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px,transparent 1px)", backgroundSize: "14px 14px", opacity: 0.05 }} />
                <div style={{ position: "relative" }}>
                  <h3 style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 19, margin: 0 }}>Weekly snapshots</h3>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--mut)", margin: "9px 0 0", maxWidth: 260 }}>Your dashboard freezes every Monday. You watch the trend: you versus you.</p>
                </div>
                <div style={{ position: "relative", alignSelf: "center" }}>
                  <GlyphAgent emotion="proud" size={150} accent="#4d7cff" showCaption={false} />
                </div>
              </div>
              <div className="bento-cell" style={{ gridColumn: "span 2", border: "1px solid var(--ac)", borderRadius: 16, background: "linear-gradient(150deg,var(--acd),transparent 70%)", padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 133 }}>
                <span className="eb" style={{ fontSize: 8.5, letterSpacing: "1.2px", color: "var(--ac)" }}>Goal health</span>
                <div>
                  <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                    {HEALTH_STRIP.map((d, i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: d }} />)}
                  </div>
                  <h3 style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>On-pace, stale or behind, at a glance</h3>
                </div>
              </div>
              {SMALL_FEATURES.map((f) => (
                <div key={f.title} className="bento-cell" style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)", padding: 18, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 133 }}>
                  <span className="logo3" style={{ width: 30, height: 30, padding: 6, gap: 2.5 }}>
                    {[f.d0, f.d1, f.d0, f.d1, f.d0, f.d1, f.d0, f.d1, f.d0].map((c, i) => <i key={i} style={{ background: c }} />)}
                  </span>
                  <div>
                    <h3 style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 15, margin: 0 }}>{f.title}</h3>
                    <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--mut)", margin: "7px 0 0" }}>{f.body}</p>
                  </div>
                </div>
              ))}
              <div className="bento-cell span-all" style={{ gridColumn: "span 2", border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)", padding: 20, display: "flex", alignItems: "center", gap: 18, minHeight: 120 }}>
                <span className="dt" style={{ fontSize: 44, color: "var(--ac)", flex: "none" }}>100%</span>
                <div>
                  <h3 style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>Your keys, your data</h3>
                  <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--mut)", margin: "7px 0 0" }}>Tokens live in your browser. Metrics never leave the tab unless you export them.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 03 · PRODUCT */}
        <section id="product" style={{ paddingTop: 64, paddingBottom: 40 }}>
          <div className="wrap">
            <h2 className="rv dt" style={{ fontSize: "clamp(30px,4vw,44px)", margin: "0 0 30px", display: "flex", alignItems: "baseline", gap: 14 }}>
              <span className="idx">03</span>Where you stand, at a glance<span style={{ color: "var(--ac)" }}>.</span>
            </h2>
            <div className="rv" style={{ border: "1px solid var(--ls)", borderRadius: 16, overflow: "hidden", background: "var(--card)", boxShadow: "0 34px 90px rgba(0,0,0,0.6)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--ls)" }} />)}
                <span className="mn" style={{ fontSize: 10, color: "var(--dim)", marginLeft: 14 }}>app.espace.dev/intelligence</span>
              </div>
              <div style={{ padding: "26px 26px 30px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
                  <div className="dt" style={{ fontSize: 28 }}>Where you stand<span style={{ color: "var(--ac)" }}>.</span></div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span className="dt" style={{ fontSize: 42, color: "var(--good)" }}>08</span>
                    <span className="dt" style={{ fontSize: 19, color: "var(--dim)" }}>/12</span>
                  </div>
                </div>
                <div className="demo-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                  {DEMO_CARDS.map((c) => (
                    <div key={c.title} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span className="eb" style={{ fontSize: 8, letterSpacing: "0.8px", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 6px" }}>{c.kind}</span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot }} />
                      </div>
                      <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 600, fontSize: 12.5, lineHeight: 1.3, minHeight: 32 }}>{c.title}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
                        {c.strip.map((d, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: d }} />)}
                      </div>
                      <div className="mn" style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--dim)", marginTop: 10 }}>{c.foot}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ANALYST SPOTLIGHT */}
        <section id="analyst" style={{ paddingTop: 72, paddingBottom: 40 }}>
          <div className="wrap">
            <div className="rv spot" style={{ border: "1px solid var(--line)", borderRadius: 22, background: "linear-gradient(150deg,var(--acd),transparent 55%)", overflow: "hidden", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 44, alignItems: "center", padding: "44px 48px" }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{ width: 230, height: 230, borderRadius: 20, border: "1px solid var(--line)", background: "#070709", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px,transparent 1px)", backgroundSize: "13px 13px", opacity: 0.05 }} />
                  <GlyphAgent emotion="think" size={160} accent="#557CFF" showCaption={false} />
                </div>
              </div>
              <div>
                <h2 className="dt" style={{ fontSize: "clamp(28px,3.6vw,40px)", margin: 0 }}>It reads the room<br />so you don&rsquo;t have to<span style={{ color: "var(--ac)" }}>.</span></h2>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--mut)", maxWidth: 440, margin: "16px 0 0" }}>
                  Glyph classifies every goal, pulls the metrics that back it, and drafts the narrative, flagging what&rsquo;s slipping before your manager does.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 22 }}>
                  {ANALYST_POINTS.map((p) => (
                    <div key={p} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, border: "1px solid var(--ac)", background: "var(--acd)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ac)", fontSize: 11, flex: "none" }}>✓</span>
                      <span style={{ fontSize: 13.5 }}>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 04 · FAQ */}
        <section id="faq" style={{ paddingTop: 72, paddingBottom: 40 }}>
          <div className="wrap" style={{ maxWidth: 900 }}>
            <h2 className="rv dt" style={{ fontSize: "clamp(28px,3.6vw,40px)", margin: "0 0 26px", display: "flex", alignItems: "baseline", gap: 14 }}>
              <span className="idx">04</span>Good to know<span style={{ color: "var(--ac)" }}>.</span>
            </h2>
            {FAQS.map((f) => (
              <div key={f.q} className="rv faq-item" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16 }}>
                <div>
                  <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16 }}>{f.q}</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--mut)", margin: "9px 0 0", maxWidth: 700 }}>{f.a}</p>
                </div>
                <span className="dt" style={{ fontSize: 17, color: "var(--ac)" }}>+</span>
              </div>
            ))}
          </div>
        </section>

        {/* FINAL CTA */}
        <section id="cta" style={{ paddingTop: 76, paddingBottom: 92 }}>
          <div className="wrap">
            <div className="rv" style={{ border: "1px solid var(--ac)", borderRadius: 22, background: "linear-gradient(180deg,var(--acd),transparent)", padding: "60px 40px", textAlign: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(77,124,255,0.4) 1px,transparent 1px)", backgroundSize: "12px 12px", opacity: 0.15, WebkitMaskImage: "radial-gradient(ellipse 60% 100% at 50% 0%,#000,transparent)", maskImage: "radial-gradient(ellipse 60% 100% at 50% 0%,#000,transparent)", pointerEvents: "none" }} />
              <div style={{ position: "relative" }}>
                <h2 className="dt" style={{ fontSize: "clamp(34px,5vw,54px)", margin: 0, lineHeight: 0.9 }}>Stop writing reviews<br />from memory<span style={{ color: "var(--ac)" }}>.</span></h2>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--mut)", maxWidth: 420, margin: "18px auto 0" }}>Log in and your evidence is already waiting. It has been collecting since your last commit.</p>
                <div style={{ marginTop: 28 }}><Link href="/login" className="btn-solid">Log in →</Link></div>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ borderTop: "1px solid var(--line)" }}>
          <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 26, paddingBottom: 26, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo3 size={22} pad={4} gap={2} />
              <span className="mn" style={{ fontSize: 11, color: "var(--mut)" }}>eSpace<span style={{ color: "var(--ac)" }}>/</span>DevHub · © 2026</span>
            </div>
            <div style={{ display: "flex", gap: 22 }}>
              {FOOT_LINKS.map((l) => (
                <span key={l} className="eb" style={{ letterSpacing: "1px", color: "var(--dim)" }}>{l}</span>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

/* Scoped landing CSS — all utilities live under `.lp` so the dark-only palette
   and helpers never collide with the themed app. Keyframes are prefixed. */
const CSS = `
.lp{--bg:#050505;--panel:#0b0b0d;--card:#0f0f12;--card2:#161619;--line:rgba(255,255,255,0.09);--ls:rgba(255,255,255,0.18);--fg:#f6f6f6;--mut:rgba(246,246,246,0.54);--dim:rgba(246,246,246,0.28);--ac:#4d7cff;--acd:rgba(77,124,255,0.13);--aco:#fff;--dot:#fff;--dotd:rgba(255,255,255,0.15);--good:#3fcf8e;--amb:#ffb24d;--red:#ff5a5a;background:var(--bg);color:var(--fg);font-family:'Hanken Grotesk',system-ui,sans-serif;min-height:100vh;overflow-x:hidden}
.lp *{box-sizing:border-box}
.lp .eb{font-family:'Space Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--mut)}
.lp .dt{font-family:'Doto',monospace;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:var(--fg)}
.lp .mn{font-family:'Space Mono',monospace}
.lp .wrap{max-width:1240px;margin:0 auto;padding:0 44px}
.lp .btn-solid{font-family:'Space Mono',monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--aco);background:var(--ac);border:1px solid var(--ac);border-radius:9px;padding:15px 24px;cursor:pointer;white-space:nowrap;display:inline-block;text-decoration:none;transition:filter .2s,transform .2s}
.lp .btn-solid:hover{filter:brightness(1.09);transform:translateY(-2px);color:var(--aco)}
.lp .btn-solid:active{transform:translateY(0) scale(.98)}
.lp .btn-ghost{font-family:'Space Mono',monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--fg);background:transparent;border:1px solid var(--ls);border-radius:9px;padding:15px 24px;cursor:pointer;white-space:nowrap;display:inline-block;text-decoration:none;transition:border-color .2s,color .2s,transform .2s}
.lp .btn-ghost:hover{border-color:var(--ac);color:var(--ac);transform:translateY(-2px)}
.lp .logo3{border-radius:6px;border:1px solid var(--ls);display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);background:var(--card);flex:none}
.lp .logo3 i{border-radius:50%}
.lp a{color:var(--ac);text-decoration:none}
.lp a:hover{color:#93abff}
.lp .rv{transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}
.lp.is-animated .rv{opacity:0;transform:translateY(22px)}
.lp.is-animated .rv.in{opacity:1;transform:none}
.lp .bento-cell{transition:transform .3s cubic-bezier(.16,1,.3,1),border-color .3s}
.lp .bento-cell:hover{transform:translateY(-4px);border-color:var(--ls)}
.lp .idx{font-family:'Doto',monospace;font-weight:900;font-size:13px;letter-spacing:2px;color:var(--ac)}
.lp .mk{font-family:'Doto',monospace;font-weight:900;font-size:clamp(58px,9vw,132px);line-height:0.82;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
.lp .marq{display:flex;gap:0;width:max-content;animation:lpmarq 58s linear infinite}
@keyframes lpmarq{to{transform:translateX(-50%)}}
@keyframes lpheroFloat{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-16px) rotate(1.2deg)}}
.lp .hero-instrument{animation:lpheroFloat 12s ease-in-out infinite}
.lp .faq-item{border-top:1px solid var(--line);padding:20px 4px}
.lp .faq-item:last-child{border-bottom:1px solid var(--line)}
@media (prefers-reduced-motion:reduce){.lp.is-animated .rv{opacity:1;transform:none;transition:none}.lp .marq{animation:none}.lp .hero-instrument{animation:none}}
@media (max-width:900px){.lp .bento{grid-template-columns:1fr 1fr !important}.lp .span-all{grid-column:1 / -1 !important}.lp .step-row{grid-template-columns:1fr !important;gap:8px !important}.lp .spot{grid-template-columns:1fr !important}.lp .demo-grid{grid-template-columns:1fr 1fr !important}.lp .hero-bottom{flex-direction:column;align-items:flex-start !important}}
@media (max-width:560px){.lp .wrap{padding:0 22px}.lp .lp-nav{display:none}.lp .bento{grid-template-columns:1fr !important}.lp .demo-grid{grid-template-columns:1fr !important}}
`;

export default LandingPage;
