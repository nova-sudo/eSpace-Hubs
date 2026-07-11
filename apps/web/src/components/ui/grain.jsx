"use client";

import { useEffect, useState } from "react";

/**
 * Static-noise overlay — tiles a low-alpha PNG generated once on the client.
 * Gives the page its "printed on paper" feel.
 */
let _cached = null;

function generate() {
  if (_cached) return _cached;
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 180;
  c.height = 180;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 180 + Math.random() * 75;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 14 + Math.random() * 14;
  }
  ctx.putImageData(img, 0, 0);
  _cached = c.toDataURL("image/png");
  return _cached;
}

/**
 * @param {number}  opacity
 * @param {"multiply"|"screen"} [blend]  Force a blend mode. When omitted the
 *        grain follows the theme: `multiply` darkens paper on the light canvas,
 *        `screen` lifts speckle on the pure-black dark canvas (a `multiply`
 *        grain is invisible on #050505). Tracks live theme toggles.
 */
export function Grain({ opacity = 0.5, blend }) {
  const [url, setUrl] = useState("");
  const [autoBlend, setAutoBlend] = useState("screen");

  useEffect(() => {
    setUrl(generate());
    const root = document.documentElement;
    const resolve = () =>
      setAutoBlend(root.getAttribute("data-theme") === "light" ? "multiply" : "screen");
    resolve();
    // Theme flips flip the attribute directly (no React re-render), so watch it.
    const obs = new MutationObserver(resolve);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1]"
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: "180px 180px",
        mixBlendMode: blend ?? autoBlend,
        opacity,
      }}
    />
  );
}
