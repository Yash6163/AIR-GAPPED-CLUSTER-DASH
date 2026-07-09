@echo off
title ClusterDash - Join Physical Node (Windows)
cls

echo ========================================================
echo       ClusterDash - JOIN PHYSICAL NODE (Windows)
echo ========================================================
echo.

:: Check for Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not added to your PATH.
    echo Please install Python 3.x from python.org and try again.
    pause
    exit /b 1
)

:: Create venv if not exists
if not exist venv (
    echo Creating virtual environment 'venv'...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate

echo Ensuring required packages are installed...
if exist wheels (
    echo Offline wheels directory found. Installing dependencies offline...
    python -m pip install --no-index --find-links=wheels -r requirements.txt
) else (
    echo Installing dependencies online...
    python -m pip install --upgrade pip
    pip install -r requirements.txt
)

:: Prompt for Manager IP
echo.
set /p MANAGER_IP="Enter Manager IP Address [default: localhost]: "
if "%MANAGER_IP%"=="" (
    set MANAGER_IP=localhost
)

set BACKEND_URL=http://%MANAGER_IP%:8000

:: Prompt for Node Role
set /p NODE_ROLE="Enter Node Role (manager/worker) [default: worker]: "
if "%NODE_ROLE%"=="" (
    set NODE_ROLE=worker
)

set REGISTRATION_TOKEN=clusterdash-worker-secret-token
set HEARTBEAT_INTERVAL=5

echo.
echo [✔] Connecting to Manager at: %BACKEND_URL%
echo [✔] Node Role: %NODE_ROLE%
echo Starting physical Windows node telemetry daemon...
echo.

python daemon.py
pause
