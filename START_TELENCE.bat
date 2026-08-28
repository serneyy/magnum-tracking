@echo off
setlocal
cd /d "%~dp0"
title TELENCE - KEEP OPEN

echo.
echo ==========================================
echo   TELENCE - Shopify Admin Preview
echo ==========================================
echo.
echo This mode does NOT use Cloudflare.
echo Keep this window open while viewing Telence in Shopify.
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
echo STEP 1 - Link Telence to your Shopify app
echo --------------------------------------------------
echo Select Telence Development when Shopify asks.
echo.
call shopify app config link
if errorlevel 1 goto :failed

echo.
echo STEP 2 - Start Telence on localhost
echo --------------------------------------------------
echo This bypasses the unstable trycloudflare tunnel.
echo Select your development store if Shopify asks.
echo.
call shopify app dev --reset --use-localhost --install-mkcert
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
