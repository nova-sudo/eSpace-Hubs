import test from "node:test";
import assert from "node:assert/strict";

import { githubMergedPrsUrl, gitlabMergedMrsUrl, jiraIssuesUrl } from "./provider-links.js";

const dec = (u) => decodeURIComponent(u);

test("github link scopes to author, the year and the labels, in one repo", () => {
  const u = githubMergedPrsUrl({ repo: "nova-sudo/espace-hubs", author: "nova-sudo", labels: ["bug", "hotfix"], year: 2026 });
  assert.equal(dec(u), 'https://github.com/nova-sudo/espace-hubs/pulls?q=is:pr is:merged author:nova-sudo merged:>=2026-01-01 label:"bug","hotfix"');
});

test("github link without a repo is a global search, and @me stands in for an unknown author", () => {
  const u = githubMergedPrsUrl({ labels: ["bug"], year: 2026 });
  assert.match(u, /^https:\/\/github\.com\/search\?type=pullrequests&q=/);
  assert.match(dec(u), /author:@me merged:>=2026-01-01 label:"bug"$/);
});

test("gitlab link needs a host; author and labels become list filters", () => {
  assert.equal(gitlabMergedMrsUrl({ repo: "g/p", labels: ["bug"] }), null);
  const u = gitlabMergedMrsUrl({ baseUrl: "https://git.example.com/", repo: "g/p", author: "me", labels: ["bug"] });
  assert.equal(u, "https://git.example.com/g/p/-/merge_requests?state=merged&author_username=me&label_name%5B%5D=bug");
  assert.match(gitlabMergedMrsUrl({ baseUrl: "https://git.example.com", author: "me" }), /\/dashboard\/merge_requests\?state=merged&author_username=me$/);
});

test("jira link filters the referenced keys to the watched types and caps at 50", () => {
  const keys = Array.from({ length: 60 }, (_, i) => `PAY-${i + 1}`);
  const u = jiraIssuesUrl({ baseUrl: "https://jira.example.com/", keys: [...keys, "not a key"], types: ["bug"] });
  const jql = dec(u.split("jql=")[1]);
  assert.match(jql, /^key in \(PAY-1,PAY-2,.*PAY-50\) AND issuetype in \("bug"\)$/);
  assert.ok(!jql.includes("PAY-51"));
  assert.equal(jiraIssuesUrl({ baseUrl: "https://jira.example.com", keys: [] }), null);
});
