@echo off
REM Kayla Pipeline Bot — Supervised Process Wrapper
REM Deployed: 2026-08-01
REM Commit: 7ef479c
REM Service: kayla-pipeline-bot

setlocal

set BOT_DIR=%~dp0bot
set WORK_DIR=%~dp0
set LOG_DIR=%~dp0logs
set DATA_DIR=%~dp0data

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Load secrets
if exist "%~dp0..\secrets\.env" (
  for /f "tokens=1,2 delims==" %%a in ('type "%~dp0..\secrets\.env" ^| findstr /v "^#" ^| findstr "="') do (
    set %%a=%%b
  )
)

REM Required: TELEGRAM_BOT_TOKEN must be set in environment or here
if "%TELEGRAM_BOT_TOKEN%"=="" (
  echo ERROR: TELEGRAM_BOT_TOKEN is not set
  exit /b 1
)

echo [%date% %time%] Starting Kayla Pipeline Bot...
echo Working directory: %WORK_DIR%
echo Log directory: %LOG_DIR%

:loop
node "%BOT_DIR%\kayla-telegram-bot.js" >> "%LOG_DIR%\bot-stdout.log" 2>&1
set EXIT_CODE=%ERRORLEVEL%
echo [%date% %time%] Bot exited with code %EXIT_CODE%. Restarting in 5 seconds...
timeout /t 5 /nobreak > nul
goto loop
