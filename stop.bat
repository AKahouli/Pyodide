@echo off
title YellowStorm Services
echo ========================================
echo   Stopping YellowStorm Services
echo ========================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo   Stopped back  ^(:3000^)  PID %%a
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo   Stopped front ^(:5173^)  PID %%a
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo   Stopped adk   ^(:8000^)  PID %%a
)

echo ========================================
echo   Done.
echo ========================================
