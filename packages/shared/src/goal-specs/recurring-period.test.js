import test from "node:test";
import assert from "node:assert/strict";
import { recurringPeriodKey, previousRecurringPeriodKey } from "./recurring-period.js";
import { weekLabelUtc } from "./weeks.js";

const at = (s) => Date.parse(s + "T12:00:00Z");

test("weekly keys follow the Sunday work week and match the snapshot week number", () => {
  // Sun 20 Sep – Sat 26 Sep 2026 is W39 everywhere else in the app.
  for (const day of ["2026-09-20", "2026-09-23", "2026-09-26"]) {
    assert.equal(recurringPeriodKey(at(day), "weekly"), "2026-W39");
    assert.equal(weekLabelUtc(at(day)), "W39");
  }
  assert.equal(recurringPeriodKey(at("2026-09-27"), "weekly"), "2026-W40");
});

test("the week that straddles New Year is one period, keyed by its Sunday", () => {
  const dec = recurringPeriodKey(at("2026-12-29"), "weekly");
  assert.equal(recurringPeriodKey(at("2027-01-01"), "weekly"), dec);
  assert.equal(recurringPeriodKey(at("2027-01-02"), "weekly"), dec);
  assert.notEqual(recurringPeriodKey(at("2027-01-03"), "weekly"), dec);
});

test("stepping back a week walks the same keys forwards produces", () => {
  let key = recurringPeriodKey(at("2027-01-20"), "weekly");
  const seen = [key];
  for (let i = 0; i < 6; i++) {
    key = previousRecurringPeriodKey(key, "weekly");
    seen.push(key);
  }
  const expected = [0, 7, 14, 21, 28, 35, 42].map((d) =>
    recurringPeriodKey(at("2027-01-20") - d * 86_400_000, "weekly"),
  );
  assert.deepEqual(seen, expected);
});

test("biweekly buckets pair weeks and step back across a year", () => {
  // W39 and W40 share a bucket (floor(38/2) = floor(39/2) = 19); W41 starts the next.
  assert.equal(recurringPeriodKey(at("2026-09-20"), "biweekly"), "2026-B19");
  assert.equal(recurringPeriodKey(at("2026-09-27"), "biweekly"), "2026-B19");
  assert.equal(recurringPeriodKey(at("2026-10-04"), "biweekly"), "2026-B20");
  let key = recurringPeriodKey(at("2027-01-10"), "biweekly");
  for (let i = 0; i < 4; i++) {
    const prev = previousRecurringPeriodKey(key, "biweekly");
    assert.ok(prev && prev !== key, `stepped from ${key}`);
    key = prev;
  }
  assert.match(key, /^2026-B\d{2}$/);
});

test("daily, monthly and quarterly keys and steps", () => {
  assert.equal(recurringPeriodKey(at("2026-03-01"), "daily"), "2026-03-01");
  assert.equal(previousRecurringPeriodKey("2026-03-01", "daily"), "2026-02-28");
  assert.equal(previousRecurringPeriodKey("2026-01", "monthly"), "2025-12");
  assert.equal(previousRecurringPeriodKey("2026-Q1", "quarterly"), "2025-Q4");
  assert.equal(recurringPeriodKey(at("2026-05-10"), "quarterly"), "2026-Q2");
});

test("non-resetting cadences and junk keys", () => {
  assert.equal(recurringPeriodKey(at("2026-05-10"), "milestone"), "all");
  assert.equal(recurringPeriodKey(NaN, "weekly"), "all");
  assert.equal(previousRecurringPeriodKey("all", "weekly"), null);
  assert.equal(previousRecurringPeriodKey("nonsense", "weekly"), null);
});
