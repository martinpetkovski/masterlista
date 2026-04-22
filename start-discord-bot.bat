@echo off
setlocal

set "ROOT=%~dp0"
set "BOT_WINDOW_TITLE=Masterlista Discord Bot"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$processes = Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.Name -match '^(cmd|node)(\.exe)?$' -and (" ^
  "    ($_.CommandLine -like '*start --prefix discord-bot*') -or" ^
  "    ($_.CommandLine -like '*discord-bot\src\index.js*') -or" ^
  "    ($_.CommandLine -like '*node src\index.js*')" ^
  "  )" ^
  "};" ^
  "foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }"

if errorlevel 1 (
  echo Failed to stop the existing Discord bot process.
  exit /b 1
)

taskkill /FI "WINDOWTITLE eq %BOT_WINDOW_TITLE%" /T /F >nul 2>&1

start "%BOT_WINDOW_TITLE%" cmd /k "cd /d ""%ROOT%"" && node discord-bot\src\index.js"

echo Discord bot started in a new window titled "%BOT_WINDOW_TITLE%".