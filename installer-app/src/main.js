"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const { spawn } = require("child_process");

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------
// A unique project name so our compose commands (including the destructive
// `down -v` on uninstall) only ever affect this app's own containers/volumes,
// never an unrelated "guacamole" Compose project the user may already run.
const PROJECT = "guacamole-installer";
const STACK_DIR = path.join(app.getPath("userData"), "stack");

// Where the bundled compose template lives (packaged vs. dev).
function templateDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "stack-template")
    : path.join(__dirname, "..", "resources");
}

// ---------------------------------------------------------------------------
// PATH augmentation — GUI apps launched from Finder/Explorer often have a
// minimal PATH that omits where Docker lives. Add the usual locations.
// ---------------------------------------------------------------------------
function augmentPath() {
  const sep = process.platform === "win32" ? ";" : ":";
  const extra =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Docker\\Docker\\resources\\bin",
          "C:\\ProgramData\\DockerDesktop\\version-bin",
        ]
      : [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/usr/bin",
          "/bin",
          path.join(os.homedir(), ".docker", "bin"),
        ];
  const cur = (process.env.PATH || "").split(sep).filter(Boolean);
  process.env.PATH = [...new Set([...cur, ...extra])].join(sep);
}

// ---------------------------------------------------------------------------
// Child-process helpers
// ---------------------------------------------------------------------------
// Run a command to completion, capturing output. Never rejects on non-zero
// exit — returns { code, out, err } so callers can decide.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: process.env, shell: false });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e) });
    }
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (opts.onData) opts.onData(d.toString());
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (opts.onData) opts.onData(d.toString());
    });
    child.on("error", (e) => resolve({ code: -1, out, err: err + String(e) }));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

// ---------------------------------------------------------------------------
// Docker / Compose discovery
// ---------------------------------------------------------------------------
let composeStyle = null; // "plugin" (docker compose) | "legacy" (docker-compose)

async function detectCompose() {
  if (composeStyle) return composeStyle;
  const plugin = await run("docker", ["compose", "version"]);
  if (plugin.code === 0) {
    composeStyle = "plugin";
    return composeStyle;
  }
  const legacy = await run("docker-compose", ["version"]);
  if (legacy.code === 0) {
    composeStyle = "legacy";
    return composeStyle;
  }
  return null;
}

// Build a compose invocation: returns { cmd, args } with the project name and
// any extra args appended, run inside STACK_DIR.
function composeCmd(extraArgs) {
  const base = ["-p", PROJECT, ...extraArgs];
  if (composeStyle === "legacy") return { cmd: "docker-compose", args: base };
  return { cmd: "docker", args: ["compose", ...base] };
}

async function dockerInstalled() {
  const r = await run("docker", ["--version"]);
  return r.code === 0;
}

async function dockerRunning() {
  const r = await run("docker", ["info"]);
  return r.code === 0;
}

async function guacRunning() {
  const r = await run("docker", [
    "ps",
    "--filter",
    "name=guac-web",
    "--filter",
    "status=running",
    "--format",
    "{{.Names}}",
  ]);
  return r.code === 0 && r.out.includes("guac-web");
}

// ---------------------------------------------------------------------------
// .env handling
// ---------------------------------------------------------------------------
function readEnvValue(key, fallback) {
  try {
    const txt = fs.readFileSync(path.join(STACK_DIR, ".env"), "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.startsWith(key + "="));
    if (lines.length) {
      const v = lines[lines.length - 1].split("=").slice(1).join("=").trim();
      if (v) return v;
    }
  } catch {}
  return fallback;
}

function webPort() {
  return readEnvValue("WEB_PORT", "8080");
}
function guacVersion() {
  return readEnvValue("GUAC_VERSION", "1.6.0");
}
function guacUrl() {
  return `http://localhost:${webPort()}/guacamole/`;
}

// Copy the template stack into the writable data dir and generate .env.
function ensureStackFiles(log) {
  fs.mkdirSync(STACK_DIR, { recursive: true });
  const tmpl = templateDir();

  for (const f of ["docker-compose.yml", ".env.example"]) {
    const dst = path.join(STACK_DIR, f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(tmpl, f), dst);
  }

  const envPath = path.join(STACK_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    log("First run: creating configuration with a random database password\n");
    let env = fs.readFileSync(path.join(STACK_DIR, ".env.example"), "utf8");
    const pw = crypto.randomBytes(16).toString("hex");
    env = env.replace(/^POSTGRES_PASSWORD=.*$/m, "POSTGRES_PASSWORD=" + pw);
    fs.writeFileSync(envPath, env);
  }
}

// Generate the PostgreSQL schema (one-time). Postgres applies it on first init.
async function ensureSchema(log) {
  const initDir = path.join(STACK_DIR, "init");
  const initSql = path.join(initDir, "initdb.sql");
  fs.mkdirSync(initDir, { recursive: true });
  if (fs.existsSync(initSql) && fs.statSync(initSql).size > 0) return true;

  log("Generating database schema (one-time; downloads the Guacamole image)…\n");
  const r = await run(
    "docker",
    [
      "run",
      "--rm",
      `guacamole/guacamole:${guacVersion()}`,
      "/opt/guacamole/bin/initdb.sh",
      "--postgresql",
    ],
    { onData: (d) => log(d) }
  );
  if (r.code !== 0 || !r.out) {
    log("ERROR: could not generate the database schema.\n");
    return false;
  }
  fs.writeFileSync(initSql, r.out);
  log("Schema generated.\n");
  return true;
}

// Poll the Guacamole HTTP endpoint until it answers.
function waitUntilReady(log) {
  const url = guacUrl();
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      tries++;
      const req = http.get(url, (res) => {
        res.resume();
        if ([200, 301, 302].includes(res.statusCode)) {
          log("Guacamole is up.\n");
          return resolve(true);
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(3000, () => req.destroy());
      function retry() {
        if (tries >= 90) {
          log("Guacamole did not respond in time; it may still be starting.\n");
          return resolve(false);
        }
        setTimeout(tick, 2000);
      }
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// High-level actions (invoked over IPC)
// ---------------------------------------------------------------------------
async function preflight(log) {
  if (!(await dockerInstalled())) {
    log("Docker is not installed.\n");
    return { ok: false, reason: "docker-missing" };
  }
  if (!(await dockerRunning())) {
    log("Docker is installed but not running. Please start Docker Desktop.\n");
    return { ok: false, reason: "docker-stopped" };
  }
  if (!(await detectCompose())) {
    log("Docker Compose was not found. Please update Docker Desktop.\n");
    return { ok: false, reason: "compose-missing" };
  }
  return { ok: true };
}

async function actionInstallStart(log) {
  const pf = await preflight(log);
  if (!pf.ok) return pf;

  ensureStackFiles(log);
  if (!(await ensureSchema(log))) return { ok: false, reason: "schema-failed" };

  log("Starting Guacamole (first run can take a minute)…\n");
  const { cmd, args } = composeCmd(["up", "-d"]);
  const up = await run(cmd, args, { cwd: STACK_DIR, onData: log });
  if (up.code !== 0) return { ok: false, reason: "compose-up-failed" };

  await waitUntilReady(log);
  return { ok: true, url: guacUrl() };
}

async function actionStop(log) {
  const pf = await preflight(log);
  if (!pf.ok) return pf;
  log("Stopping Guacamole (your data is kept)…\n");
  const { cmd, args } = composeCmd(["down"]);
  const r = await run(cmd, args, { cwd: STACK_DIR, onData: log });
  return { ok: r.code === 0 };
}

async function actionUpdate(log) {
  const pf = await preflight(log);
  if (!pf.ok) return pf;
  log("Pulling the latest images…\n");
  let { cmd, args } = composeCmd(["pull"]);
  await run(cmd, args, { cwd: STACK_DIR, onData: log });
  ({ cmd, args } = composeCmd(["up", "-d"]));
  const r = await run(cmd, args, { cwd: STACK_DIR, onData: log });
  await waitUntilReady(log);
  return { ok: r.code === 0, url: guacUrl() };
}

async function actionUninstall(log) {
  const pf = await preflight(log);
  if (!pf.ok) return pf;
  log("Removing containers and all saved data…\n");
  const { cmd, args } = composeCmd(["down", "-v"]);
  const r = await run(cmd, args, { cwd: STACK_DIR, onData: log });
  try {
    fs.rmSync(path.join(STACK_DIR, "init"), { recursive: true, force: true });
  } catch {}
  return { ok: r.code === 0 };
}

async function getStatus() {
  const installed = await dockerInstalled();
  const running = installed ? await dockerRunning() : false;
  const guac = running ? await guacRunning() : false;
  return {
    dockerInstalled: installed,
    dockerRunning: running,
    guacRunning: guac,
    url: guacUrl(),
    port: webPort(),
  };
}

// ---------------------------------------------------------------------------
// Streaming logs viewer
// ---------------------------------------------------------------------------
let logChild = null;
function startLogs(win) {
  stopLogs();
  if (!composeStyle) return;
  const { cmd, args } = composeCmd(["logs", "-f", "--tail=200"]);
  logChild = spawn(cmd, args, { cwd: STACK_DIR, env: process.env });
  const send = (d) => win.webContents.send("log", d.toString());
  logChild.stdout.on("data", send);
  logChild.stderr.on("data", send);
}
function stopLogs() {
  if (logChild) {
    try {
      logChild.kill();
    } catch {}
    logChild = null;
  }
}

// ---------------------------------------------------------------------------
// Window & IPC wiring
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 520,
    minHeight: 620,
    title: "Guacamole Installer",
    backgroundColor: "#111417",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function wireIpc() {
  const log = (d) => mainWindow && mainWindow.webContents.send("log", d);

  ipcMain.handle("status", () => getStatus());
  ipcMain.handle("install-start", () => actionInstallStart(log));
  ipcMain.handle("stop", () => actionStop(log));
  ipcMain.handle("update", () => actionUpdate(log));
  ipcMain.handle("uninstall", () => actionUninstall(log));
  ipcMain.handle("open-guac", () => shell.openExternal(guacUrl()));
  ipcMain.handle("open-docker-download", () =>
    shell.openExternal("https://www.docker.com/products/docker-desktop/")
  );
  ipcMain.handle("logs-start", () => startLogs(mainWindow));
  ipcMain.handle("logs-stop", () => stopLogs());
}

app.whenReady().then(() => {
  augmentPath();
  wireIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopLogs();
  if (process.platform !== "darwin") app.quit();
});
