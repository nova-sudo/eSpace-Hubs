import { MonoLabel } from "@/components/ui";
import { DashboardPreview } from "./dashboard-preview";
import { ValueProps } from "./value-props";
import { Wizard } from "./wizard";

export function OnboardingPage() {
  return (
    <main className="relative z-[2] mx-auto max-w-[1200px] px-10 pb-14 pt-16">
      <div className="grid grid-cols-[minmax(0,1fr)_440px] items-start gap-12">
        <div>
          <MonoLabel>Welcome · 0 of 3 connected</MonoLabel>
          <h1
            className="mb-4 mt-2.5 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(48px, 6vw, 82px)",
              lineHeight: 0.95,
              letterSpacing: "-2.2px",
              textWrap: "balance",
            }}
          >
            Receipts for <em className="accent">review</em> season. Calm for the rest of
            it.
          </h1>
          <p className="mb-7 max-w-[560px] text-[16px] leading-[1.55] text-muted-fg">
            Connect Jira, GitLab, and GitHub once. Watch your metrics quietly for 90
            days. When performance review lands, export the whole case in one click.
          </p>

          <ValueProps />
          <DashboardPreview />
        </div>

        <Wizard />
      </div>
    </main>
  );
}
