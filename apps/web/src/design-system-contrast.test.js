import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design system v2 ("Zinc") — CONTRAST guard.
 *
 * The companion to design-system-guard.test.js: that one polices which
 * idioms are allowed, this one polices whether you can SEE them. It reads the
 * real token values out of globals.css and computes WCAG 2.1 contrast ratios,
 * so a future "let's lighten the greys a touch" fails here instead of in
 * someone's eyes.
 *
 * What prompted it: `Checkbox` drew its unchecked state as `bg-card-alt` with
 * no border. On a white card that is #f7f7f8 on #ffffff — a ratio of 1.07:1,
 * where WCAG 1.4.11 asks 3:1 for the boundary of a control. The empty box was
 * not faint, it was invisible, on every card in the app, and worse on a poor
 * screen. It now carries a `muted-fg` ring, and the BOUNDARY assertions below
 * are what keep it carrying one.
 *
 * Thresholds, from WCAG 2.1 AA:
 *   4.5:1  body text under 18.66px (SC 1.4.3)
 *   3:1    UI component boundaries and graphical objects (SC 1.4.11)
 */

const thisFile = fileURLToPath(import.meta.url);
const CSS = readFileSync(path.join(path.dirname(thisFile), "app", "globals.css"), "utf8");

const BODY_TEXT = 4.5;
const NON_TEXT = 3;

/** Pull one `--token: value;` out of a block of CSS text. */
function tokensFrom(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[name] = value.trim();
  }
  return out;
}

/**
 * The `:root` block is light; `[data-theme="dark"]` is dark. Dark inherits
 * every token it doesn't restate (the tints, deliberately, are identical in
 * both themes), so it's layered over light rather than read on its own.
 */
function readThemes(css) {
  const light = tokensFrom(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
  const darkStart = css.indexOf('[data-theme="dark"]');
  const dark = tokensFrom(css.slice(darkStart, css.indexOf("}", darkStart)));
  assert.ok(Object.keys(light).length > 10, "light tokens should parse out of globals.css");
  assert.ok(Object.keys(dark).length > 5, "dark tokens should parse out of globals.css");
  return { light, dark: { ...light, ...dark } };
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.trim();
  assert.match(h, /^#[0-9a-f]{6}$/i, `expected a 6-digit hex, got "${hex}"`);
  const r = channel(parseInt(h.slice(1, 3), 16));
  const g = channel(parseInt(h.slice(3, 5), 16));
  const b = channel(parseInt(h.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const THEMES = readThemes(CSS);

function check(themeName, fg, bg, min, what) {
  const t = THEMES[themeName];
  const got = ratio(t[fg], t[bg]);
  assert.ok(
    got >= min,
    `${themeName}: ${what} — --${fg} (${t[fg]}) on --${bg} (${t[bg]}) is ${got.toFixed(2)}:1, needs ${min}:1`,
  );
}

const SURFACES = ["bg", "card", "card-alt"];

for (const theme of ["light", "dark"]) {
  test(`${theme}: primary and secondary text clear the body-text bar on every surface`, () => {
    for (const surface of SURFACES) {
      check(theme, "fg", surface, BODY_TEXT, "primary text");
      check(theme, "muted-fg", surface, BODY_TEXT, "secondary text / labels");
    }
  });

  test(`${theme}: a control boundary drawn in muted-fg is visible on every surface`, () => {
    // The Checkbox ring, and anything else that outlines a control rather
    // than filling it. This is the assertion that would have caught the
    // invisible checkbox.
    for (const surface of SURFACES) {
      check(theme, "muted-fg", surface, NON_TEXT, "control boundary");
    }
  });

  test(`${theme}: an ink fill reads against every surface`, () => {
    for (const surface of SURFACES) {
      check(theme, "ink", surface, NON_TEXT, "ink fill (checked box, filled strip cell)");
    }
    check(theme, "ink-on", "ink", BODY_TEXT, "text on ink");
  });

  test(`${theme}: every tint carries its own ink`, () => {
    for (const tint of ["mint", "sky", "lav", "peach", "lemon"]) {
      check(theme, `${tint}-ink`, tint, BODY_TEXT, `${tint} badge text`);
    }
  });

  test(`${theme}: a card is distinguishable from the canvas behind it`, () => {
    // Not a WCAG threshold — cards are separated by shadow in light and by
    // fill in dark — but it pins the relationship so a token edit can't
    // collapse card and canvas into the same colour.
    assert.notEqual(THEMES[theme].card, THEMES[theme].bg);
    assert.notEqual(THEMES[theme]["card-alt"], THEMES[theme].card);
  });
}

/**
 * KNOWN DEBT, recorded rather than asserted away.
 *
 * `--dim-fg` is the system's tertiary tone and it does NOT reach the
 * body-text bar: 2.56:1 in light, 2.96:1 in dark. That is fine for a
 * placeholder, which is what the design doc scopes it to, and wrong for
 * anything a reader has to read. The goal-widgets field body was moved off
 * it for exactly that reason.
 *
 * This ratchets the current values so the token cannot quietly get lighter
 * still. Raising dim-fg to clear 4.5:1 app-wide is a design decision, not a
 * test fix — when it happens, tighten this to BODY_TEXT and delete the note.
 */
test("dim-fg is placeholder-only and may not get any lighter", () => {
  const floors = { light: 2.5, dark: 2.9 };
  for (const theme of ["light", "dark"]) {
    const got = ratio(THEMES[theme]["dim-fg"], THEMES[theme].card);
    assert.ok(
      got >= floors[theme],
      `${theme}: --dim-fg on --card is ${got.toFixed(2)}:1, below the recorded floor of ${floors[theme]}:1`,
    );
    assert.ok(
      got < BODY_TEXT,
      `${theme}: --dim-fg now clears ${BODY_TEXT}:1 — tighten this test to BODY_TEXT and drop the exception`,
    );
  }
});
