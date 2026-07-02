@echo off
cd /d %~dp0
rem Edge app mode: chromeless window + Web Speech API (default browser is Firefox, which has no speech)
start msedge --app=http://localhost:18790
node server.js
