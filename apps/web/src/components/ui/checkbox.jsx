export function Checkbox({ checked, onChange, id }) {
  return (
    <span
      id={id}
      role="checkbox"
      aria-checked={checked}
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
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
