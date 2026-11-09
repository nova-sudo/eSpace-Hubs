import { readFileSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { docBySlug, headingSlug, rewriteDocLink } from "./docs-registry.js";

/**
 * Server-only: reads one manual page and renders it to HTML. The pages
 * are statically generated at build time, so this runs during
 * `next build`, never per request.
 */
const CONTENT_DIR = path.join(process.cwd(), "src", "features", "docs", "content");

function renderer() {
  const seen = new Map();
  const headings = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        const base = headingSlug(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth === 2) headings.push({ id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = rewriteDocLink(href);
        const t = title ? ` title="${title}"` : "";
        return `<a href="${url}"${t}>${inner}</a>`;
      },
    },
  });
  return { marked, headings };
}

export function loadDoc(slug = "") {
  const doc = docBySlug(slug);
  if (!doc) return null;
  const source = readFileSync(path.join(CONTENT_DIR, doc.file), "utf8");
  const { marked, headings } = renderer();
  const html = marked.parse(source);
  return { ...doc, html, headings };
}
