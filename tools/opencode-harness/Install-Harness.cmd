@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "setupExit=%ERRORLEVEL%"
echo.
if "%setupExit%"=="0" echo Setup finished. Open a new terminal, check opencode --version reports v2.1.2, then verify onboarding.
if "%setupExit%"=="2" echo Harness installed; some integrations need the steps shown above.
if "%setupExit%"=="1" echo Setup failed. Read the error above before retrying.
pause
exit /b %setupExit%
