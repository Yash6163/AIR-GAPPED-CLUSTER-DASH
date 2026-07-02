#!/bin/bash

# --- Distributed Swarm Monitor Worker Launcher (macOS/Linux) ---

clear
echo -e "\033[1;36m========================================================\033[0m"
echo -e "\033[1;32m      ClusterDash - JOIN PHYSICAL NODE (macOS/Linux)     \033[0m"
echo -e "\033[1;36m========================================================\033[0m"
echo ""

# Check for Python 3
if ! command -v python3 &>/dev/null; then
    echo -e "\033[1;31m[✘] Error: python3 is not installed on this system.\033[0m"
    exit 1
fi

# Prepare virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment 'venv'..."
    python3 -m venv venv
fi

echo "Activating virtual environment..."
source venv/bin/activate

echo "Ensuring required packages are installed..."
pip install --upgrade pip
pip install -r requirements.txt

# Prompt for Manager IP Address
echo ""
echo -ne "\033[1;33mEnter Manager IP Address [default: localhost]: \033[0m"
read INPUT_IP

if [ -z "$INPUT_IP" ]; then
    INPUT_IP="localhost"
fi

export BACKEND_URL="http://$INPUT_IP:8000"

# Prompt for Role
echo -ne "\033[1;33mEnter Node Role (manager/worker) [default: worker]: \033[0m"
read INPUT_ROLE

if [ -z "$INPUT_ROLE" ]; then
    INPUT_ROLE="worker"
fi

export NODE_ROLE=$INPUT_ROLE
export REGISTRATION_TOKEN="clusterdash-worker-secret-token"
export HEARTBEAT_INTERVAL="5"

echo ""
echo -e "\033[1;32m[✔] Connecting to Manager at: \033[1;37m$BACKEND_URL\033[0m"
echo -e "\033[1;32m[✔] Node Role: \033[1;37m$NODE_ROLE\033[0m"
echo "Starting physical worker telemetry daemon..."
echo ""

python daemon.py
