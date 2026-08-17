# Option B — command-line launchers (no desktop app)

If you don't want the desktop app, these double-click scripts run the exact same
Docker Compose stack. You still need **Docker Desktop** installed and running.

## Start / stop

Double-click the launcher for your OS (in the repo root):

| OS       | Start                              | Stop                              |
|----------|------------------------------------|-----------------------------------|
| macOS    | `Start Guacamole (Mac).command`    | `Stop Guacamole (Mac).command`    |
| Windows  | `Start Guacamole (Windows).bat`    | `Stop Guacamole (Windows).bat`    |
| Linux    | `./start-linux.sh`                 | `./stop-linux.sh`                 |

The first start downloads images and initializes the database (a minute or two);
later starts take seconds. Your browser opens automatically to
**http://localhost:8080/guacamole**.

Default login is `guacadmin` / `guacadmin` — **change it immediately** after your
first login (Settings → Preferences).

## macOS / Windows first-run warning

- **macOS:** right-click `Start Guacamole (Mac).command` → **Open** → **Open**.
- **Windows:** SmartScreen → **More info** → **Run anyway**.

## Extra actions

```bash
# macOS / Linux, run from the repo folder
scripts/guac.sh status | logs | update | restart | uninstall
```

```powershell
# Windows PowerShell, from the repo folder
powershell -ExecutionPolicy Bypass -File scripts\guac.ps1 status   # or logs / update / uninstall
```

## Change the port

Edit `.env` (created on first run) and set `WEB_PORT=` to another port, then stop
and start again.

## How it works

Same stack as the desktop app — see the main [README](../README.md#how-it-works).
The scripts create `.env` (with a random DB password) and generate the database
schema into `init/` on first run, then run `docker compose up -d`.
