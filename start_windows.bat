@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
echo ANNON AI OFFICE local demo at http://127.0.0.1:4173
echo When you are finished, press Ctrl+C to stop.
node --experimental-sqlite src\server.mjs
pause
