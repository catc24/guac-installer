# Shared launcher logic for Apache Guacamole (Windows).
# The double-click .bat launchers in the project folder call this script.
#
#   powershell -ExecutionPolicy Bypass -File scripts\guac.ps1 [action]
#
# action = start | stop | restart | status | logs | update | uninstall

param([string]$Action = "start")

$ErrorActionPreference = "Stop"

# --- locate the project folder (parent of this scripts\ directory) -----------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

$GuacUrlPath = "/guacamole"

function Say  ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "  ok $m"  -ForegroundColor Green }
function Warn ($m) { Write-Host "  !  $m"  -ForegroundColor Yellow }
function Fail ($m) { Write-Host "ERROR $m" -ForegroundColor Red }

function Require-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail "Docker is not installed."
        Write-Host ""
        Write-Host "Please install Docker Desktop (free), then run this launcher again:"
        Write-Host "  https://www.docker.com/products/docker-desktop/"
        Start-Process "https://www.docker.com/products/docker-desktop/"
        Read-Host "`nPress Enter to close"
        exit 1
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "Docker is installed but not running."
        Write-Host ""
        Write-Host "Please start Docker Desktop, wait until it says 'running', then run this launcher again."
        Start-Process "https://www.docker.com/products/docker-desktop/"
        Read-Host "`nPress Enter to close"
        exit 1
    }
}

$script:DC = $null
function Detect-Compose {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) { $script:DC = @("docker","compose"); return }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) { $script:DC = @("docker-compose"); return }
    Fail "Docker Compose was not found. Please update Docker Desktop."
    Read-Host "`nPress Enter to close"
    exit 1
}
function Compose { & $script:DC[0] ($script:DC[1..($script:DC.Count-1)] + $args) }

function Ensure-Env {
    if (-not (Test-Path ".env")) {
        Say "First run: creating configuration (.env) with a random database password"
        Copy-Item ".env.example" ".env"
        $bytes = New-Object 'System.Byte[]' 16
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $pw = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
        (Get-Content ".env") -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$pw" |
            Set-Content ".env" -Encoding ascii
        Ok "Configuration created"
    }
}

function Get-EnvValue($key, $default) {
    if (-not (Test-Path ".env")) { return $default }
    $line = Select-String -Path ".env" -Pattern "^$key=" | Select-Object -Last 1
    if ($line) { $v = ($line.Line -split "=",2)[1]; if ($v) { return $v } }
    return $default
}

function Ensure-Schema {
    if (-not (Test-Path "init")) { New-Item -ItemType Directory -Path "init" | Out-Null }
    if (-not (Test-Path "init\initdb.sql") -or ((Get-Item "init\initdb.sql").Length -eq 0)) {
        Say "Generating database schema (one-time, downloads the Guacamole image)"
        $ver = Get-EnvValue "GUAC_VERSION" "1.6.0"
        docker run --rm "guacamole/guacamole:$ver" /opt/guacamole/bin/initdb.sh --postgresql |
            Out-File -FilePath "init\initdb.sql" -Encoding ascii
        if ($LASTEXITCODE -ne 0 -or (Get-Item "init\initdb.sql").Length -eq 0) {
            Fail "Could not generate the database schema."
            Remove-Item "init\initdb.sql" -ErrorAction SilentlyContinue
            Read-Host "`nPress Enter to close"
            exit 1
        }
        Ok "Schema generated"
    }
}

function Wait-Ready($port) {
    $url = "http://localhost:$port$GuacUrlPath/"
    Say "Waiting for Guacamole to be ready..."
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { Ok "Guacamole is up"; return }
        } catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in 301,302) { Ok "Guacamole is up"; return }
        }
        Start-Sleep -Seconds 2
    }
    Warn "Guacamole did not respond in time, but it may still be starting."
}

function Do-Start {
    Require-Docker; Detect-Compose; Ensure-Env; Ensure-Schema
    Say "Starting Guacamole (this can take a minute the first time)"
    Compose up -d
    $port = Get-EnvValue "WEB_PORT" "8080"
    Wait-Ready $port
    $url = "http://localhost:$port$GuacUrlPath/"
    Write-Host ""
    Write-Host "--------------------------------------------------------------------"
    Write-Host "  Guacamole is running."
    Write-Host ""
    Write-Host "  Open in your browser:   $url"
    Write-Host ""
    Write-Host "  First-time login:"
    Write-Host "      Username:  guacadmin"
    Write-Host "      Password:  guacadmin"
    Write-Host ""
    Write-Host "  IMPORTANT: log in and change the guacadmin password right away"
    Write-Host "  (top-right menu -> Settings -> Preferences)."
    Write-Host "--------------------------------------------------------------------"
    Start-Process $url
}

function Do-Stop {
    Require-Docker; Detect-Compose
    Say "Stopping Guacamole (your data is kept)"
    Compose down
    Ok "Stopped. Run the Start launcher again anytime; your connections are saved."
}

function Do-Status  { Require-Docker; Detect-Compose; Say "Container status"; Compose ps }
function Do-Logs    { Require-Docker; Detect-Compose; Say "Showing logs (press Ctrl+C to stop)"; Compose logs -f --tail=100 }
function Do-Update  { Require-Docker; Detect-Compose; Say "Updating images"; Compose pull; Compose up -d; Ok "Updated." }

function Do-Uninstall {
    Require-Docker; Detect-Compose
    Warn "This removes the Guacamole containers AND ALL saved connections/users."
    $ans = Read-Host "Type DELETE to confirm"
    if ($ans -eq "DELETE") {
        Compose down -v
        Remove-Item "init\initdb.sql" -ErrorAction SilentlyContinue
        Ok "Removed. Your .env (with the DB password) was kept."
    } else { Say "Cancelled. Nothing was removed." }
}

switch ($Action) {
    "start"     { Do-Start }
    "stop"      { Do-Stop }
    "restart"   { Do-Stop; Do-Start }
    "status"    { Do-Status }
    "logs"      { Do-Logs }
    "update"    { Do-Update }
    "uninstall" { Do-Uninstall }
    default     { Fail "Unknown action: $Action"; Write-Host "Use: start | stop | restart | status | logs | update | uninstall" }
}

if ($Action -ne "logs") { Read-Host "`nPress Enter to close" }
