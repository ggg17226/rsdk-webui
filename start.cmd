@echo off
rem rsdk-webui 一键启动（Windows）：转发到 PowerShell 脚本
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
