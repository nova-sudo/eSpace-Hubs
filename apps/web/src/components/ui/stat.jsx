import { MonoLabel } from "./mono-label";
import { Delta } from "./delta";

/**
 * Section stat — label + 44px numeral + optional unit + delta + sub-line.
 */
export function Stat({ label, value, unit, delta, deltaInvert, sub }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className="font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 44,
            letterSpacing: "-1.4px",
          }}
        >
          {value}
        </span>
        {unit ? <span className="text-[15px] text-muted-fg">{unit}</span> : null}
        {delta !== undefined ? <Delta value={delta} invert={deltaInvert} /> : null}
      </div>
      {sub ? (
        <div
          className="mt-1.5 text-[10.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
