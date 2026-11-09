import test from "node:test";
import assert from "node:assert/strict";

import { isFreeSignupDomain, parseFreeDomains } from "./signup-domain.js";

const FREE = ["espace.com.eg"];

test("exact free domain is free", () => {
  assert.equal(isFreeSignupDomain("a@espace.com.eg", FREE), true);
});

test("casing and surrounding whitespace are ignored", () => {
  assert.equal(isFreeSignupDomain(" Ahmed@ESPACE.com.eg ", FREE), true);
});

test("subdomains and lookalikes are not free", () => {
  assert.equal(isFreeSignupDomain("a@sub.espace.com.eg", FREE), false);
  assert.equal(isFreeSignupDomain("a@evil-espace.com.eg", FREE), false);
  assert.equal(isFreeSignupDomain("a@espace.com.eg.evil.com", FREE), false);
});

test("other domains and empty input are not free", () => {
  assert.equal(isFreeSignupDomain("a@gmail.com", FREE), false);
  assert.equal(isFreeSignupDomain("", FREE), false);
});

test("parseFreeDomains defaults to espace.com.eg", () => {
  assert.deepEqual(parseFreeDomains(undefined), ["espace.com.eg"]);
  assert.deepEqual(parseFreeDomains(""), ["espace.com.eg"]);
});

test("parseFreeDomains trims, lower-cases and drops empties", () => {
  assert.deepEqual(parseFreeDomains(" Espace.com.eg, espace.com ,"), ["espace.com.eg", "espace.com"]);
});
