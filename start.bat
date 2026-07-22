@echo off
setlocal

set "SYMTYPE_PROJECT_DIR=%~dp0"
cd /d "%SYMTYPE_PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo SymType startup failed: Node.js was not found.
  echo Install Node.js 22 LTS ^(22.12 or newer^) or 24 LTS, then try again.
  set "SYMTYPE_EXIT_CODE=1"
  goto :failed
)

node "%SYMTYPE_PROJECT_DIR%scripts\start-local.mjs" %*
set "SYMTYPE_EXIT_CODE=%ERRORLEVEL%"
if "%SYMTYPE_EXIT_CODE%"=="0" exit /b 0

:failed
echo.
echo SymType did not start. Read the message above and the launcher log for details.
if /I not "%CI%"=="true" pause
exit /b %SYMTYPE_EXIT_CODE%
