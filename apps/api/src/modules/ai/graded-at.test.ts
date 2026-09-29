import test from "node:test";
import assert from "node:assert/strict";

import { toIsoOrNull } from "./controller.js";

test("toIsoOrNull serialises a stored Date", () => {
  assert.equal(toIsoOrNull(new Date("2026-09-01T10:00:00Z")), "2026-09-01T10:00:00.000Z");
});

test("toIsoOrNull tolerates legacy rows: missing → null, string → ISO, garbage → null", () => {
  assert.equal(toIsoOrNull(undefined), null);
  assert.equal(toIsoOrNull(null), null);
  assert.equal(toIsoOrNull("2026-09-01T10:00:00Z"), "2026-09-01T10:00:00.000Z");
  assert.equal(toIsoOrNull("not a date"), null);
});
