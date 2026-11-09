import Link from "next/link";
import { LogoMark } from "@/components/shell/logo-mark";
import { DOCS, WIDGET_GALLERY_HREF, docHref } from "./docs-registry.js";
import { loadDoc } from "./load-doc.js";

/**
 * The public user manual (/docs, /docs/<slug>). A server component: the
 * Markdown is rendered at build time and served as static HTML, so it
 * works signed out (people read "Getting started" before they sign up).
 */
export function DocsPage({ slug = "" }) {
  const doc = loadDoc(slug);
  if (!doc) return null;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5">
        <Link href="/docs" className="flex items-center gap-2.5 font-extrabold tracking-tight no-underline">
          <LogoMark size={28} />
          <span>eSpace Hubs</span>
          <span className="font-semibold text-muted-fg">Docs</span>
        </Link>
        <Link
          href="/"
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-ink-on no-underline"
        >
          Open the app
        </Link>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Manual" className="md:sticky md:top-6 md:self-start">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            {DOCS.map((d) => {
              const active = d.slug === doc.slug;
              return (
                <li key={d.file} className="shrink-0">
                  <Link
                    href={docHref(d.slug)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "block whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold no-underline " +
                      (active ? "bg-ink text-ink-on" : "bg-card text-fg md:bg-transparent hover:bg-card")
                    }
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0">
              <a
                href={WIDGET_GALLERY_HREF}
                className="block whitespace-nowrap rounded-full bg-card px-3.5 py-1.5 text-[13px] font-semibold text-fg no-underline md:bg-transparent hover:bg-card"
              >
                Widget gallery ↗
              </a>
            </li>
          </ul>
          {doc.headings.length > 1 ? (
            <ul className="mt-4 hidden flex-col gap-0.5 md:flex">
              {doc.headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="block px-3.5 py-1 text-[12.5px] text-muted-fg no-underline hover:text-fg"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>

        <main className="min-w-0 rounded-[20px] bg-card px-5 py-6 md:px-10 md:py-9">
          <article className="docs-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </main>
      </div>
    </div>
  );
}
