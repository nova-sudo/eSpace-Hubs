"use client";

/**
 * Shared pieces used by the three CI/CD AUTO widgets
 * (DEPLOY_FREQUENCY / LEAD_TIME / BUILD_PASS_RATE).
 *
 * Kept in one module so widget files stay focused on their unique
 * rendering and the scope-required messaging stays consistent.
 */

/**
 * Inline banner when the spec needs a Jenkins job or GitHub Actions
 * repo to be picked before the widget can render anything. Shown in
 * place of the headline + bar so the user is never staring at a
 * silent "0" while the widget is actually missing its required
 * filter.
 */
export function NeedsScopeBanner({ provider, variant }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const what = provider === "jenkins" ? "a Jenkins job" : "a GitHub repo";
  const hint =
    provider === "jenkins"
      ? "Pick a job in the Review pane."
      : "Pick a repo in the Review pane.";
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color:
            variant === "light"
              ? "rgba(255,255,255,0.85)"
              : "var(--fg)",
          lineHeight: 1.4,
        }}
      >
        This widget needs {what} to track.
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: muted,
          lineHeight: 1.4,
        }}
      >
        {hint}
      </div>
    </div>
  );
}
