import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DOCS, headingSlug, rewriteDocLink } from "./docs-registry.js";

test("repo-style links map to site URLs", () => {
  assert.equal(rewriteDocLink("faq.md"), "/docs/faq");
  assert.equal(rewriteDocLink("README.md"), "/docs");
  assert.equal(rewriteDocLink("manager-guide.md#shared-goals"), "/docs/manager-guide#shared-goals");
  assert.equal(rewriteDocLink("widget-gallery.html"), "/guides/widget-gallery.html");
  assert.equal(rewriteDocLink("#3-adding"), "#3-adding");
  assert.equal(rewriteDocLink("https://x.test/a.md"), "https://x.test/a.md");
});

test("heading slugs match GitHub anchors", () => {
  assert.equal(headingSlug("4. Analyze my goals (the AI analyst)"), "4-analyze-my-goals-the-ai-analyst");
  assert.equal(headingSlug("5. Build your own tracker, and manager approval"), "5-build-your-own-tracker-and-manager-approval");
});

test("every content file is registered and every .md link resolves", () => {
  const dir = new URL("./content/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(files, DOCS.map((d) => d.file).sort());
  for (const f of files) {
    for (const [, href] of readFileSync(new URL(f, dir), "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(href) || href.startsWith("#")) continue;
      assert.ok(rewriteDocLink(href).startsWith("/"), `${f}: unresolved link ${href}`);
    }
  }
});
