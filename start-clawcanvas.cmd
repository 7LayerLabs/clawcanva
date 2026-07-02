@echo off
cd /d %~dp0
title ClawCanvas
echo.
echo   ClawCanvas starting on http://localhost:18790
echo   Voice works in Edge/Chrome (NOT Firefox or Brave).
echo   Opening in Edge...
echo.
rem Open Edge a couple seconds after the server boots, so the page loads cleanly.
rem Edge app mode = chromeless window + the Web Speech API voice needs.
start "" cmd /c "timeout /t 2 /nobreak >nul & start msedge --app=http://localhost:18790"
node server.js
