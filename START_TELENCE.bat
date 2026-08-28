@echo off
setlocal
cd /d "%~dp0"
title Telence Shopify Development

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
echo [4/4] Starting Telence in Shopify...
echo.
echo Shopify may open your browser and ask you to:
echo   1. Sign in to Shopify
echo   2. Choose your organization
echo   3. Create or select the Telence Development app
echo   4. Choose your development store
echo.
echo After that, keep this window OPEN while testing Telence.
echo.

call shopify app dev --reset
if errorlevel 1 (
  echo.
  echo Shopify could not start the app automatically.
  echo Trying the app-link flow once...
  echo.
  call shopify app config link
  if errorlevel 1 goto :failed
  echo.
  call shopify app dev --reset
  if errorlevel 1 goto :failed
)

goto :end

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

:end
echo.
echo Telence development session ended.
pause
