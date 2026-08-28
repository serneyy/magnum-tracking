@echo off
setlocal
set "TELENCE_DIR=%~dp0"
cd /d "%TELENCE_DIR%"
title Telence Launcher

echo.
echo ==========================================
echo   TELENCE - Shopify Development Launcher
echo ==========================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Node.js is not installed.
  echo Install Node.js 22 LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo [2/4] Checking Shopify CLI...
where shopify >nul 2>&1
if errorlevel 1 (
  echo Shopify CLI not found. Installing it now...
  call npm install -g @shopify/cli@latest
  if errorlevel 1 goto :failed
)

echo [3/4] Checking project packages...
if not exist "node_modules" (
  echo Installing Telence packages. This can take a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
) else (
  echo Packages already installed.
)

echo.
echo [4/4] Opening the Telence development server...
echo.
echo IMPORTANT:
echo   A second window called "TELENCE DEV SERVER - KEEP OPEN" will open.
echo   DO NOT close that window while using Telence inside Shopify.
echo   If that window is closed, Shopify will show trycloudflare.com refused to connect.
echo.
echo In the new window Shopify may ask you to:
echo   1. Sign in to Shopify
echo   2. Choose your organization
echo   3. Create or select Telence Development
echo   4. Choose your development store
echo.

start "TELENCE DEV SERVER - KEEP OPEN" cmd /k "cd /d ""%TELENCE_DIR%"" && shopify app dev --reset"
if errorlevel 1 goto :failed

echo Telence dev server was opened in a separate window.
echo Wait until that window says the dev preview is ready.
echo Then refresh Telence in Shopify Admin.
echo.
echo You can close THIS launcher window. Keep the DEV SERVER window open.
echo.
pause
exit /b 0

:failed
echo.
echo ==========================================
echo Telence could not start.
echo Do NOT run npm audit fix --force.
echo Take a screenshot of this window and send it to ChatGPT.
echo ==========================================
echo.
pause
exit /b 1
