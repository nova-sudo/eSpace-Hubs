/**
 * Accessible checkbox span. `label` is REQUIRED in spirit: a bare
 * role="checkbox" announces as "checkbox, not checked" N times in a
 * list with no way to tell which item is which — and because this is a
 * span (not an <input>), a wrapping <label> does NOT name it. Every
 * call site passes the row's own text.
 */
export function Checkbox({ checked, onChange, id, label }) {
  return (
    <span
      id={id}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange?.();
        }
      }}
      className="inline-grid h-4 w-4 cursor-pointer place-items-center rounded-[2px] border"
      style={{
        borderColor: checked ? "var(--accent)" : "var(--border)",
        background: checked ? "var(--accent)" : "var(--card)",
      }}
    >
      {checked ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M2 5.5l2 2 4-5"
            stroke="var(--accent-on)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
