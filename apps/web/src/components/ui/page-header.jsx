import { MonoLabel } from "./mono-label";

/**
 * Editorial page header used by secondary screens (evidence, snapshots, settings).
 * The title renders in the dot-matrix display face (Doto); `italicWord` becomes
 * the accent dot-word via `em.accent` (Doto + cobalt, see globals.css).
 */
export function PageHeader({ crumb, title, italicWord, subtitle, right }) {
  const parts =
    italicWord && title?.includes(italicWord) ? title.split(italicWord) : null;
  return (
    <div className="mb-7 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6">
      <div>
        {crumb ? <MonoLabel>{crumb}</MonoLabel> : null}
        <h1
          className="mt-2 font-semibold"
          style={{
            fontFamily: "var(--font-dot)",
            fontSize: "clamp(36px, 4.6vw, 60px)",
            lineHeight: 1.0,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            textWrap: "balance",
          }}
        >
          {parts ? (
            <>
              {parts[0]}
              <em className="accent">{italicWord}</em>
              {parts[1]}
            </>
          ) : (
            title
          )}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-[640px] text-[14.5px] leading-[1.55] text-muted-fg">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
