/**
 * The user manual's table of contents. Each entry is one Markdown file in
 * ./content, served at /docs/<slug> (the README is /docs itself).
 */
export const DOCS = [
  { slug: "", file: "README.md", title: "Overview" },
  { slug: "getting-started", file: "getting-started.md", title: "Getting started" },
  { slug: "developer-guide", file: "developer-guide.md", title: "Developer guide" },
  { slug: "manager-guide", file: "manager-guide.md", title: "Manager guide" },
  { slug: "admin-guide", file: "admin-guide.md", title: "Admin guide" },
  { slug: "faq", file: "faq.md", title: "FAQ and troubleshooting" },
  { slug: "glossary", file: "glossary.md", title: "Glossary" },
];

/** The widget gallery is a standalone page in /public. */
export const WIDGET_GALLERY_HREF = "/guides/widget-gallery.html";

export function docBySlug(slug = "") {
  return DOCS.find((d) => d.slug === slug) ?? null;
}

export function docHref(slug) {
  return slug ? `/docs/${slug}` : "/docs";
}

/**
 * Rewrites a link written for the repo (`faq.md#x`, `README.md`,
 * `widget-gallery.html`) to its URL on the site. Anything else is
 * returned unchanged.
 */
export function rewriteDocLink(href) {
  if (!href || /^[a-z]+:|^\/|^#/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const suffix = hash ? `#${hash}` : "";
  if (path === "widget-gallery.html") return `${WIDGET_GALLERY_HREF}${suffix}`;
  const doc = DOCS.find((d) => d.file === path);
  return doc ? `${docHref(doc.slug)}${suffix}` : href;
}

/** GitHub-style heading anchor, so `#4-analyze-my-goals` links keep working. */
export function headingSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}
