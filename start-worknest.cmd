@echo off
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo Please run npm.cmd ci and npm.cmd run build first.
  pause
  exit /b 1
)
echo Open http://localhost:3000 in your browser.
call npm.cmd start
pause
