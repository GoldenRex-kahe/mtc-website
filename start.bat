@echo off
title MTC website server
cd /d "%~dp0"
echo MTC website server. Keep this window open. Close it to stop the site.
:loop
node server.js
echo [%date% %time%] Server stopped. Restarting in 5 seconds... >> data\server.log
echo Server stopped. Restarting in 5 seconds (close this window to stop for good)...
timeout /t 5 /nobreak >nul
goto loop
