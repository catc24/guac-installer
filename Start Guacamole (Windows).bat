@echo off
REM Double-click this file to START Guacamole on Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\guac.ps1" start
