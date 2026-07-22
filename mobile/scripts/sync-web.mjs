// Copies the static frontend files (which live at the repo root, served
// directly by FastAPI — see backend/app/main.py) into mobile/www/, which is
// the webDir Capacitor packages into the native Android WebView. mobile/www
// is generated and gitignored; run this before `cap sync`/`cap copy`.
import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(mobileDir);
const wwwDir = join(mobileDir, "www");

const FILES = ["index.html", "app.js", "api.js", "manifest.json", "sw.js"];
const DIRS = ["icons"];

rmSync(wwwDir, { recursive: true, force: true });
mkdirSync(wwwDir, { recursive: true });

for (const file of FILES) {
  const src = join(repoRoot, file);
  if (!existsSync(src)) {
    throw new Error(`Expected frontend file not found: ${src}`);
  }
  cpSync(src, join(wwwDir, file));
}

for (const dir of DIRS) {
  const src = join(repoRoot, dir);
  if (!existsSync(src)) {
    throw new Error(`Expected frontend directory not found: ${src}`);
  }
  cpSync(src, join(wwwDir, dir), { recursive: true });
}

console.log(`Synced frontend into ${wwwDir}`);
