@echo off
REM Double-click this file to STOP Guacamole on Windows. Your data is kept.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\guac.ps1" stop
