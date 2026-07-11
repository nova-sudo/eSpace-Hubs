/**
 * Concise "Expected" string for a goal spec — the target/cadence a goal is
 * judged against, phrased for the evidence document's goals table.
 *
 * Single source of truth: the markdown export, the on-screen DocumentPreview,
 * and the PDF renderer all import this so the three renderings never drift
 * (they used to each carry their own copy). Pure — no React, no IO.
 */
export function formatExpected(spec) {
  if (!spec) return "—";
  if (spec.delegated?.delegated) {
    return `Judged by ${spec.delegated.judge || "manager"}`;
  }
  const target = spec.manual?.target || spec.source?.target;
  const cadence = spec.manual?.cadence;
  const unit = spec.manual?.unit;
  if (target && target.value != null) {
    const cadenceSuffix = cadence ? ` / ${cadence}` : "";
    const unitSuffix = unit ? ` ${unit}` : "";
    return `${target.op} ${target.value}${unitSuffix}${cadenceSuffix}`;
  }
  if (cadence === "milestone") return "Hit listed milestones";
  if (cadence === "continuous") return "Continuous reflection";
  if (cadence === "per-incident") return "Per-incident capture";
  if (cadence) return `Logged ${cadence}`;
  if (spec.source?.metric) {
    return `Tracked via ${spec.source.metric.replace(/_/g, " ")}`;
  }
  return "Tracked";
}
