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
    console.error(`sync-resources: missing ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dst);
  console.log(`sync-resources: ${f} -> resources/`);
}
