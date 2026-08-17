"use strict";

const $ = (id) => document.getElementById(id);

const el = {
  dotDocker: $("dot-docker"),
  valDocker: $("val-docker"),
  dotGuac: $("dot-guac"),
  valGuac: $("val-guac"),
  banner: $("docker-banner"),
  bannerText: $("docker-banner-text"),
  getDocker: $("btn-get-docker"),
  primary: $("btn-primary"),
  stop: $("btn-stop"),
  logs: $("btn-logs"),
  update: $("btn-update"),
  uninstall: $("btn-uninstall"),
  recheck: $("btn-recheck"),
  creds: $("creds"),
  credsUrl: $("creds-url"),
  log: $("log"),
  clearLog: $("btn-clear-log"),
};

let busy = false;
let logsOn = false;
let lastUrl = "http://localhost:8080/guacamole/";

function logLine(text) {
  el.log.textContent += text;
  el.log.scrollTop = el.log.scrollHeight;
}

function setDot(dot, state) {
  dot.classList.remove("ok", "bad", "wait");
  if (state) dot.classList.add(state);
}

function setBusy(on, label) {
  busy = on;
  const controls = [el.primary, el.stop, el.update, el.uninstall, el.recheck];
  controls.forEach((c) => (c.disabled = on));
  if (on && label) {
    el.primary.innerHTML = `<span class="spin">↻</span> ${label}`;
  }
}

async function refresh() {
  const s = await window.api.status();
  lastUrl = s.url;

  // Docker row
  if (!s.dockerInstalled) {
    setDot(el.dotDocker, "bad");
    el.valDocker.textContent = "Not installed";
  } else if (!s.dockerRunning) {
    setDot(el.dotDocker, "wait");
    el.valDocker.textContent = "Installed, not running";
  } else {
    setDot(el.dotDocker, "ok");
    el.valDocker.textContent = "Running";
  }

  // Guacamole row
  if (s.guacRunning) {
    setDot(el.dotGuac, "ok");
    el.valGuac.textContent = "Running";
  } else {
    setDot(el.dotGuac, null);
    el.valGuac.textContent = s.dockerRunning ? "Not started" : "—";
  }

  // Docker banner
  if (!s.dockerInstalled || !s.dockerRunning) {
    el.banner.classList.remove("hidden");
    el.bannerText.textContent = !s.dockerInstalled
      ? "Docker Desktop is required and was not found on this computer."
      : "Docker Desktop is installed but not running. Start it, then click Re-check.";
  } else {
    el.banner.classList.add("hidden");
  }

  // Buttons
  const canAct = s.dockerInstalled && s.dockerRunning;
  el.primary.disabled = !canAct || busy;
  el.update.disabled = !canAct || busy;
  el.stop.disabled = !s.guacRunning || busy;
  el.uninstall.disabled = !canAct || busy;

  if (s.guacRunning) {
    el.primary.textContent = "Open Guacamole";
    el.primary.dataset.mode = "open";
    el.creds.classList.remove("hidden");
    el.credsUrl.textContent = s.url;
  } else {
    el.primary.textContent = canAct ? "Install & Start" : "Waiting for Docker…";
    el.primary.dataset.mode = "install";
  }
}

async function guard(fn, label) {
  if (busy) return;
  setBusy(true, label);
  try {
    await fn();
  } catch (e) {
    logLine("\nERROR: " + (e && e.message ? e.message : String(e)) + "\n");
  } finally {
    setBusy(false);
    await refresh();
  }
}

// ---- button handlers ------------------------------------------------------
el.primary.addEventListener("click", () => {
  if (el.primary.dataset.mode === "open") {
    window.api.openGuac();
    return;
  }
  guard(async () => {
    const r = await window.api.installStart();
    if (r && r.ok) logLine("\nDone. Guacamole is ready.\n");
  }, "Installing…");
});

el.stop.addEventListener("click", () =>
  guard(async () => {
    await window.api.stop();
  }, "Stopping…")
);

el.update.addEventListener("click", () =>
  guard(async () => {
    await window.api.update();
  }, "Updating…")
);

el.uninstall.addEventListener("click", () => {
  const ok = window.confirm(
    "This removes the Guacamole containers AND ALL saved connections and users.\n\nThis cannot be undone. Continue?"
  );
  if (!ok) return;
  guard(async () => {
    await window.api.uninstall();
  }, "Removing…");
});

el.recheck.addEventListener("click", () => refresh());

el.getDocker.addEventListener("click", () => window.api.openDockerDownload());

el.logs.addEventListener("click", async () => {
  logsOn = !logsOn;
  if (logsOn) {
    el.logs.textContent = "Stop logs";
    await window.api.logsStart();
  } else {
    el.logs.textContent = "View logs";
    await window.api.logsStop();
  }
});

el.credsUrl.addEventListener("click", (e) => {
  e.preventDefault();
  window.api.openGuac();
});

el.clearLog.addEventListener("click", () => (el.log.textContent = ""));

// ---- streaming log events --------------------------------------------------
window.api.onLog((data) => logLine(data));

// ---- boot ------------------------------------------------------------------
refresh();
setInterval(() => {
  if (!busy) refresh();
}, 5000);
