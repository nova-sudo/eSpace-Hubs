"use client";

/**
 * QA Hub config tab — exposed in /qa/settings only (the parent
 * SettingsPage filters it out for other hubs). Lets the user pick:
 *
 *   - Jira project key   (which project the defect widgets query)
 *   - Jenkins job name   (which job FlakeRateTile reads, and the
 *                         default for BuildPassRateTile)
 *
 * Persistence + reactivity is delegated to useQaHubConfig. This tab
 * just owns the form draft and the dirty/save mechanics.
 *
 * Why a per-hub config tab vs. baking it into IntegrationsTab:
 *
 *   IntegrationsTab is shared across all hubs and scoped to
 *   provider-level concerns (which OAuth tokens you've connected).
 *   QA Hub config is hub-shaped — Dev Hub doesn't need a Jira
 *   project key because its widgets are user-scoped. Keeping the
 *   two separate means we can add more per-hub tabs later (e.g. a
 *   Manager Hub tab with team-roster picks) without IntegrationsTab
 *   sprouting hub-conditional sections.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Label,
  Section,
} from "@/components/ui";
import { DEFAULT_QA_CONFIG, useQaHubConfig } from "@/features/hubs";

export function QaConfigTab() {
  const { config, setConfig, resetConfig } = useQaHubConfig();
  const [draft, setDraft] = useState(config);

  // If the underlying config changes externally (other tab, or our
  // own resetConfig call) re-seed the draft so the form doesn't show
  // stale typed values. We only re-seed when the *external* config
  // actually changed (vs. just our own save echoing back), tracked
  // via lastSeenRef.
  const lastSeenRef = useRef(config);
  useEffect(() => {
    if (
      config.jiraProjectKey !== lastSeenRef.current.jiraProjectKey ||
      config.jenkinsJobName !== lastSeenRef.current.jenkinsJobName
    ) {
      setDraft(config);
      lastSeenRef.current = config;
    }
  }, [config]);

  const dirty =
    draft.jiraProjectKey !== config.jiraProjectKey ||
    draft.jenkinsJobName !== config.jenkinsJobName;

  const save = () => {
    // Normalize on save (not on every keystroke — would jump the
    // cursor): trim + uppercase the project key, trim the job name.
    const trimmed = {
      jiraProjectKey: (draft.jiraProjectKey || "").trim().toUpperCase(),
      jenkinsJobName: (draft.jenkinsJobName || "").trim(),
    };
    if (!trimmed.jiraProjectKey || !trimmed.jenkinsJobName) return;
    setConfig(trimmed);
    setDraft(trimmed);
  };

  const handleReset = () => {
    if (
      window.confirm(
        `Reset QA Hub config to defaults?\n\n` +
          `Jira project key → ${DEFAULT_QA_CONFIG.jiraProjectKey}\n` +
          `Jenkins job name → ${DEFAULT_QA_CONFIG.jenkinsJobName}`,
      )
    ) {
      resetConfig();
      setDraft({ ...DEFAULT_QA_CONFIG });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section title="Data sources">
        <Card className="p-6">
          <p className="mb-5 text-[13px] leading-[1.55] text-muted-fg">
            Which Jira project the defect widgets query, and which Jenkins job
            powers the automation-health tiles. Changes apply immediately on
            save — refresh the dashboard tab to see them.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field
              label="Jira project key"
              hint="Project that owns your team's bug tickets. Uppercase by convention (e.g. ESPQA, QA)."
            >
              <Input
                value={draft.jiraProjectKey}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, jiraProjectKey: e.target.value }))
                }
                placeholder={DEFAULT_QA_CONFIG.jiraProjectKey}
              />
            </Field>
            <Field
              label="Jenkins job name"
              hint="Job that runs your regression suite. FlakeRateTile reads it directly; BuildPassRateTile uses it as the default selection."
            >
              <Input
                value={draft.jenkinsJobName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, jenkinsJobName: e.target.value }))
                }
                placeholder={DEFAULT_QA_CONFIG.jenkinsJobName}
              />
            </Field>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button onClick={save} disabled={!dirty}>
              Save
            </Button>
            <Button variant="ghost" onClick={handleReset}>
              Reset to defaults
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Jira project requirements">
        <Card className="p-6">
          <Label>For the defect widgets to show data</Label>
          <ul className="mt-3 grid gap-3 text-[12.5px] leading-[1.55] text-muted-fg">
            <li>
              <span className="text-fg">·</span> The widgets query{" "}
              <code className="rounded-[var(--radius-md)] bg-card-alt px-1.5 py-0.5 font-mono text-[11px] text-fg">
                project = {(draft.jiraProjectKey || "?").toUpperCase()} AND
                issuetype = Bug
              </code>{" "}
              — your project needs a <strong className="text-fg">Bug</strong>{" "}
              issuetype enabled. Many Jira Work Management projects ship with
              Task + Epic only; add Bug under{" "}
              <strong className="inline-flex items-center gap-0.5 text-fg">
                Project settings <ChevronRight size={11} /> Issue types
              </strong>
              .
            </li>
            <li>
              <span className="text-fg">·</span> Priority breakdown needs the{" "}
              <strong className="text-fg">Priority</strong> field on the Bug
              create screen. If priority chips all read{" "}
              <em className="text-fg">Unset</em>, enable it under{" "}
              <strong className="inline-flex items-center gap-0.5 text-fg">
                Project settings <ChevronRight size={11} /> Issue layout
              </strong>
              .
            </li>
            <li>
              <span className="text-fg">·</span> Config lives in your browser
              under{" "}
              <code className="rounded-[var(--radius-md)] bg-card-alt px-1.5 py-0.5 font-mono text-[11px] text-fg">
                eshub:qa:config:v1
              </code>{" "}
              — clearing site data resets to defaults.
            </li>
          </ul>
        </Card>
      </Section>
    </div>
  );
}
