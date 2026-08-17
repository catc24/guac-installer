#!/usr/bin/env node
// Copies the canonical Docker Compose stack files from the repo root into
// ./resources so they get bundled into the packaged app. Run automatically by
// the "dist" / "pack" npm scripts.
const fs = require("fs");
const path = require("path");

const appDir = path.join(__dirname, "..");
const repoRoot = path.join(appDir, "..");
const resDir = path.join(appDir, "resources");

fs.mkdirSync(resDir, { recursive: true });

const files = ["docker-compose.yml", ".env.example"];
for (const f of files) {
  const src = path.join(repoRoot, f);
  const dst = path.join(resDir, f);
  if (!fs.existsSync(src)) {
    // Not fatal: resources/ already contains a committed copy that ships with
    // the app. Only warn, and fail only if there is no usable copy at all.
    if (fs.existsSync(dst)) {
      console.warn(`sync-resources: ${f} not at repo root; using existing resources/${f}`);
      continue;
    }
    console.error(`sync-resources: no source for ${f} (repo root or resources/)`);
    process.exit(1);
  }
  fs.copyFileSync(src, dst);
  console.log(`sync-resources: ${f} -> resources/`);
}
