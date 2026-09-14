import { Label } from "./label";
import { Delta } from "./delta";

const SIZE_PX = { md: 44, lg: 56 };

/**
 * Section stat — label + big numeral + optional unit + delta + sub-line.
 */
export function Stat({ label, value, unit, delta, deltaInvert, sub, size = "md" }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className="font-extrabold tracking-[-0.04em] leading-none tabular-nums"
          style={{ fontSize: SIZE_PX[size] || SIZE_PX.md }}
        >
          {value}
        </span>
        {unit ? <span className="text-[15px] text-muted-fg">{unit}</span> : null}
        {delta !== undefined ? <Delta value={delta} invert={deltaInvert} /> : null}
      </div>
      {sub ? <div className="mt-1.5 text-[13px] text-muted-fg">{sub}</div> : null}
    </div>
  );
}
