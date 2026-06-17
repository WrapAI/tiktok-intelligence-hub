@echo off
setlocal EnableExtensions
title TikTok Intelligence Hub
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Install failed. Check Node.js is installed: https://nodejs.org
    pause
    exit /b 1
  )
)

call :ensure_electron
if errorlevel 1 exit /b 1

call :resolve_whisper_dir
if defined WHISPER_DIR (
  call :start_whisper
) else (
  echo.
  echo WARNING: Could not find whisper-server\server.py
  echo Expected sibling folder: ..\tiktok-hook-analyzer\whisper-server
  echo Hub will try to auto-start whisper when it opens.
  echo.
)

echo Starting TikTok Intelligence Hub...
call npm.cmd run dev
if errorlevel 1 (
  echo.
  echo Hub failed to start. See errors above.
  pause
  exit /b 1
)
pause
exit /b 0

:ensure_electron
if exist "%~dp0node_modules\electron\path.txt" exit /b 0
if not exist "%~dp0node_modules\electron\install.js" (
  echo Electron package missing - running npm install...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)
echo.
echo Electron binary missing - downloading (may take a minute)...
node "%~dp0node_modules\electron\install.js"
if errorlevel 1 (
  echo.
  echo ERROR: Electron download failed. Check your internet connection and try:
  echo   node node_modules\electron\install.js
  echo.
  pause
  exit /b 1
)
if exist "%~dp0node_modules\electron\path.txt" exit /b 0
echo.
echo ERROR: Electron install finished but binary is still missing.
pause
exit /b 1

:resolve_whisper_dir
set "WHISPER_DIR="
if exist "%~dp0..\tiktok-hook-analyzer\whisper-server\server.py" (
  set "WHISPER_DIR=%~dp0..\tiktok-hook-analyzer\whisper-server"
  goto :eof
)
if exist "%~dp0..\..\tiktok-hook-analyzer\whisper-server\server.py" (
  set "WHISPER_DIR=%~dp0..\..\tiktok-hook-analyzer\whisper-server"
  goto :eof
)
if defined WHISPER_SERVER_DIR if exist "%WHISPER_SERVER_DIR%\server.py" (
  set "WHISPER_DIR=%WHISPER_SERVER_DIR%"
)
goto :eof

:start_whisper
curl -s -o nul http://127.0.0.1:5050/health 2>nul
if not errorlevel 1 (
  echo Whisper server already running on port 5050.
  goto :eof
)
echo Starting Whisper Server in a new window...
start "Whisper Server" cmd /k call "%WHISPER_DIR%\start.bat"
ping 127.0.0.1 -n 4 >nul
goto :eof
