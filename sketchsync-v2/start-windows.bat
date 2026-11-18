@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installing... & call npm install)
echo Starting SketchSync on http://localhost:8080
start "" http://localhost:8080
node server.js
pause
