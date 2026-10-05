@echo off
REM ============================================================
REM  AI OneClick Setup - launcher
REM  NOTE: keep this file CRLF + pure ASCII on purpose.
REM  Chinese text in .bat gets garbled by cmd's code page.
REM ============================================================
setlocal
chcp 65001 >nul 2>&1

cd /d "%~dp0"

echo.
echo ==========================================
echo   AI OneClick Setup
echo ==========================================
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo [X] PowerShell not found. This script needs it.
    echo     Try: Start menu - search "PowerShell" - Run as administrator.
    echo.
    pause
    exit /b 1
)

echo [1/2] Running setup...
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0setup.ps1"
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
    echo [OK] Setup finished.
) else (
    echo [!] Setup returned code %RC%. Check the log above.
)
echo.
echo Docs:
echo   README.md
echo   CREDITS.md
echo   git-github\   (Git and GitHub guide)
echo   codetool\     (toolchain list)
echo.

pause
exit /b %RC%
