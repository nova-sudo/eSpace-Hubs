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

const TINTS = ["mint", "sky", "lav", "peach", "lemon"];

for (const theme of ["light", "dark"]) {
  test(`${theme}: every tint TEXT token reads on every plain surface`, () => {
    // B1 of the a11y review: tint inks were used as text on plain cards and
    // fell to 1.5–2.45:1 in dark. `--<tint>-text` is the plain-surface tone
    // (text, icons, status dots).
    for (const tint of TINTS) {
      for (const surface of SURFACES) {
        check(theme, `${tint}-text`, surface, BODY_TEXT, `${tint} text on a plain surface`);
      }
    }
  });

  test(`${theme}: a form field boundary is visible (WCAG 1.4.11)`, () => {
    // M5: inputs are the exception to borderless. The 1px --field-line ring
    // has to separate the field from whatever it sits on AND from its own
    // --card-alt fill.
    for (const surface of SURFACES) {
      check(theme, "field-line", surface, NON_TEXT, "field boundary");
    }
  });

  test(`${theme}: dim-fg clears the non-text bar but stays below body text`, () => {
    // --dim-fg is for placeholders, disabled text and decorative separators.
    // 3:1 so those are still perceivable; NOT 4.5:1, so the guard test keeps
    // it off readable copy (design-system-guard.test.js).
    for (const surface of SURFACES) {
      check(theme, "dim-fg", surface, NON_TEXT, "placeholder / disabled / separator");
      const got = ratio(THEMES[theme]["dim-fg"], THEMES[theme][surface]);
      assert.ok(
        got < BODY_TEXT,
        `${theme}: --dim-fg now clears ${BODY_TEXT}:1 on --${surface} — fold it into muted-fg and drop the exception`,
      );
    }
  });

  test(`${theme}: progress tracks — filled reads against empty, empty reads against the card`, () => {
    // Minor 9: tracks were card-alt on card (1.07:1). The filled part (ink)
    // must clear 3:1 against the empty --track; the empty track must be
    // perceptibly different from the card it sits on.
    check(theme, "ink", "track", NON_TEXT, "filled progress vs empty track");
    check(theme, "peach-text", "track", NON_TEXT, "owed cell vs empty track");
    for (const surface of ["card", "card-alt"]) {
      check(theme, "track", surface, 1.3, "empty track on a card");
    }
  });
}

test("light: each tint TEXT token is the tint INK (one colour per state in light)", () => {
  for (const tint of TINTS) {
    assert.equal(THEMES.light[`${tint}-text`], THEMES.light[`${tint}-ink`], `--${tint}-text should equal --${tint}-ink in light`);
  }
});

test("the prefers-color-scheme dark block matches [data-theme=dark]", () => {
  // Two copies of the dark tokens exist (explicit toggle + OS preference);
  // a token added to one and forgotten in the other only breaks for half
  // the users. Pin them together.
  const start = CSS.indexOf(":root:not([data-theme=\"light\"])");
  assert.ok(start > 0, "OS-preference dark block should exist");
  const media = tokensFrom(CSS.slice(start, CSS.indexOf("}", start)));
  const darkStart = CSS.indexOf('[data-theme="dark"]');
  const explicit = tokensFrom(CSS.slice(darkStart, CSS.indexOf("}", darkStart)));
  assert.deepEqual(media, explicit);
});
