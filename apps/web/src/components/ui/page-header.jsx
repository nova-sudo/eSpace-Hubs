import { MonoLabel } from "./mono-label";

/**
 * Editorial page header used by secondary screens (evidence, snapshots, settings).
 * `italicWord` gets swapped with a serif-italic accent em.
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
            fontFamily: "var(--font-display)",
            fontSize: "clamp(40px, 5vw, 68px)",
            lineHeight: 0.98,
            letterSpacing: "-1.8px",
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
