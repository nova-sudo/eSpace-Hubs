import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin Turbopack's workspace root to the monorepo root so it ignores
  // any stray lockfile higher up the tree (e.g. a global one in the
  // user's home directory).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
