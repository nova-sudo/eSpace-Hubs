/**
 * Section heading — title + optional right slot. No rule line.
 * `num` is accepted for back-compat and ignored.
 */
export function Section({ num: _num, title, children, right, className }) {
  return (
    <section className={className} style={{ marginBottom: 36 }}>
      <div className="mb-3.5 flex items-baseline justify-between gap-5">
        <h2 className="m-0 text-[18px] font-bold tracking-[-0.01em] text-fg">{title}</h2>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
