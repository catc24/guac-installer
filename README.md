# Guacamole — one-click desktop installer

[Apache Guacamole](https://guacamole.apache.org/) is a clientless remote desktop
gateway: reach your RDP / VNC / SSH machines from a web browser, with no client
software to install. This project installs and runs it on your own computer with
**one click** — a small desktop app handles everything.

> **What you still need:** Docker Desktop (free). The app checks for it and helps
> you install it if it's missing. Everything else — database, schema, containers,
> updates — is one click. (Bundling Docker itself would make the download several
> gigabytes; using it under the hood keeps the app around 90 MB.)

---

## Download

Grab the installer for your operating system from the
[**Releases**](../../releases/latest) page:

| OS                     | File to download                         |
|------------------------|------------------------------------------|
| **Windows** (installer)| `Guacamole Installer-x.y.z.exe`          |
| **Windows** (portable) | `Guacamole Installer-x.y.z-win.zip`  — unzip and run, no install |
| **macOS** (Apple chip) | `Guacamole Installer-x.y.z-arm64.dmg`    |
| **macOS** (Intel)      | `Guacamole Installer-x.y.z.dmg`          |
| **Linux** (universal)  | `Guacamole Installer-x.y.z.AppImage`     |
| **Linux** (Debian/Ubuntu) | `guacamole-installer_x.y.z_amd64.deb` |
| **Linux** (Fedora/RHEL)   | `guacamole-installer-x.y.z.x86_64.rpm`|

> **Windows portable zip:** unzip it anywhere and double-click
> `Guacamole Installer.exe` inside — no installation needed. Good for USB sticks
> or locked-down machines.

## Use it

1. **Install Docker Desktop** if you don't have it (the app opens the download
   page for you): https://www.docker.com/products/docker-desktop/ — start it and
   wait until it says *running*.
2. **Open the Guacamole Installer app** and click **Install & Start**.
   The first run downloads the images and sets up the database (a minute or two).
3. When it's ready, click **Open Guacamole** and log in:

   ```
   Username:  guacadmin
   Password:  guacadmin
   ```
   **Change that password immediately** (Settings → Preferences).

The app also has buttons for **Stop**, **Update**, **View logs**, and
**Uninstall**. Your connections and users are saved between restarts.

### First-launch security prompts (unsigned app)

The installers aren't code-signed, so the OS shows a one-time warning:

- **macOS:** right-click the app → **Open** → **Open** (or System Settings →
  Privacy & Security → **Open Anyway**).
- **Windows:** SmartScreen → **More info** → **Run anyway**.
- **Linux (AppImage):** make it executable — `chmod +x *.AppImage` — then run it.

---

## What's in this repo

```
installer-app/            The desktop GUI app (Electron)
  src/main.js             Docker orchestration (start/stop/update/uninstall)
  src/renderer/           The app window (HTML/CSS/JS)
  resources/              Compose stack bundled into the app
  electron-builder.yml    How the installers are built
docker-compose.yml        The Guacamole stack (Postgres + guacd + web app)
.env.example              Config template (port, version)
.github/workflows/        CI that builds installers for all 3 OSes
scripts/ + *.command/.bat One-click *scripts* (Option B, below)
```

## Building the installers yourself

Installers are produced automatically by GitHub Actions
([`.github/workflows/build.yml`](.github/workflows/build.yml)) on every push, and
attached to a **GitHub Release** when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

To build locally (produces files in `installer-app/dist/`):

```bash
cd installer-app
npm install
npm run dist        # current OS
# or: npm run dist:mac  |  npm run dist:win  |  npm run dist:linux
```

> Note: each OS's installer must be built on that OS (or via the CI above). A Mac
> can build the `.dmg`; the Linux and Windows **installers** build on their own
> runners. On an **Apple Silicon** Mac you cannot build the Windows `.exe`
> locally (the Windows toolchain relies on Wine, which crashes under the x86
> emulation) — use the CI, or build the portable Windows **zip** instead:
>
> ```bash
> # portable Windows .zip, built via Docker (no Wine needed)
> docker run --rm --platform linux/amd64 -v "$PWD/..":/project \
>   electronuserland/builder:wine \
>   bash -c "cd /project/installer-app && npm ci && \
>     npx electron-builder --win zip --config.win.signAndEditExecutable=false"
> ```

---

## Option B: no-app command-line launchers

If you'd rather not use the desktop app, this repo also includes double-click
scripts that do the same thing via Docker Compose. See
[`docs/SCRIPTS.md`](docs/SCRIPTS.md).

## How it works

Three containers, defined in [`docker-compose.yml`](docker-compose.yml):

- **postgres** — stores connections, users, and history.
- **guacd** — the native proxy that speaks RDP / VNC / SSH.
- **guacamole** — the web app you log into.

On first run the app creates a private data folder, writes a config file with a
strong random database password, generates the database schema, and starts the
stack. Guacamole is served at `http://localhost:8080/guacamole`.

## Security note

This runs Guacamole on **localhost** for personal / LAN use over plain HTTP.
It is not hardened for exposure to the public internet — that would need HTTPS
and a reverse proxy in front. Ask if you want that variant.
