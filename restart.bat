@echo off
title YellowStorm Services
echo ========================================
echo   Restarting YellowStorm Services
echo ========================================

call %~dp0stop.bat
timeout /t 3 /nobreak >nul
call %~dp0start.bat
