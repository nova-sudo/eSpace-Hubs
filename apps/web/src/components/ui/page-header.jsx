"use client";

import { Label } from "./label";

/**
 * Page header: crumb → Display title → optional subtitle on the left;
 * `right` (actions) bottom-aligned on the right. `italicWord` is accepted
 * for back-compat and ignored — the redesign has no accent-word treatment.
 *
 * The entrance is a CSS animation (`.ui-reveal` in globals.css), staggered
 * via `--reveal-delay`. CSS keeps running when JS is throttled and always
 * ends at the element's normal styles, so the title can't be left hidden.
 */
export function PageHeader({ crumb, title, italicWord: _italicWord, subtitle, right }) {
  const delay = (i) => ({ "--reveal-delay": `${i * 90}ms` });
  return (
    <div className="mb-7 grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
      <div>
        {crumb ? (
          <div className="ui-reveal" style={delay(0)}>
            <Label>{crumb}</Label>
          </div>
        ) : null}
        <h1
          className="ui-reveal mt-3.5 text-[40px] font-extrabold tracking-[-0.03em] leading-[1.05] text-fg"
          style={{ textWrap: "balance", ...delay(1) }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className="ui-reveal mt-3 max-w-[560px] text-[14.5px] leading-[1.55] text-muted-fg"
            style={delay(2)}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? (
        <div className="ui-reveal min-w-0 sm:self-end" style={delay(3)}>
          {right}
        </div>
      ) : null}
    </div>
  );
}
