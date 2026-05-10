const PROPS = [
  [
    "Live, not lagging",
    "Everything proxies through to Jira/GitLab/GitHub on page load. No cron. No stale cache.",
  ],
  [
    "Private by default",
    "Tokens stay in your browser. We don't have a database. There is no manager dashboard.",
  ],
  [
    "Your story, your data",
    "You star the PRs that mattered. You write the narrative. The tool just organizes.",
  ],
  [
    "Works with self-hosted",
    "Self-hosted GitLab, Atlassian Cloud Jira, and GitHub.com all work out of the box.",
  ],
];

export function ValueProps() {
  return (
    <div className="mb-8 grid grid-cols-2 gap-4.5">
      {PROPS.map(([t, b]) => (
        <div key={t}>
          <div className="mb-1 flex items-center gap-2">
            <span className="block h-1.5 w-1.5 rounded-full bg-accent" />
            <span
              className="uppercase tracking-[0.5px] font-bold"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {t}
            </span>
          </div>
          <div className="pl-3.5 text-[12.5px] leading-[1.5] text-muted-fg">{b}</div>
        </div>
      ))}
    </div>
  );
}
