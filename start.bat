@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  npm.cmd install
  if errorlevel 1 (
    echo Install failed. Check Node.js is installed: https://nodejs.org
    pause
    exit /b 1
  )
)

echo Starting TikTok Intelligence Hub...
npm.cmd run dev
pause
