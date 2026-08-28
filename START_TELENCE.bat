@echo off
setlocal
cd /d "%~dp0"
title TELENCE DEV SERVER - KEEP OPEN

echo.
echo ==========================================
echo   TELENCE - Shopify Development
echo ==========================================
echo.
echo Keep THIS window open while using Telence.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 22 LTS and run this file again.
  pause
  exit /b 1
)

where shopify >nul 2>&1
if errorlevel 1 (
  echo Installing Shopify CLI...
  call npm install -g @shopify/cli@latest
  if errorlevel 1 goto :failed
)

if not exist "node_modules" (
  echo Installing Telence packages...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)

echo.
echo STEP 1 - Link this code to the Shopify app
echo --------------------------------------------------
echo When Shopify asks which app to use, select:
echo   Telence Development
echo.
call shopify app config link
if errorlevel 1 goto :failed

echo.
echo STEP 2 - Start Telence
echo --------------------------------------------------
echo When Shopify asks for a store, select your test store.
echo Keep this window OPEN after Dev preview ready appears.
echo.
call shopify app dev --reset
if errorlevel 1 goto :failed

goto :end

:failed
echo.
echo ==========================================
echo TELENCE DID NOT START
echo ==========================================
echo.
echo Take a screenshot of THIS window and send it to ChatGPT.
echo Do not run npm audit fix --force.
echo.
pause
exit /b 1

:end
echo.
echo Telence dev session ended.
pause
