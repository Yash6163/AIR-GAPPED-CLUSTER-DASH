#!/bin/bash

# --- Distributed Swarm Monitor Offline Manager Launcher (No-Docker) ---
# Run this on the OFFLINE Linux/macOS manager machine.

clear
echo -e "\033[1;35m========================================================\033[0m"
echo -e "\033[1;36m   ClusterDash - OFFLINE MANAGER LAUNCHER (No-Docker)   \033[0m"
echo -e "\033[1;35m========================================================\033[0m"
echo ""

# Check if offline-assets exist
if [ ! -d "offline-assets" ]; then
    echo -e "\033[1;31m[✘] Error: 'offline-assets' directory not found.\033[0m"
    echo "Please package the assets on an online PC first using ./package-offline.sh"
    echo "and transfer the 'offline-assets' folder here."
    exit 1
fi

# Discover local IP Address (Robust offline local network lookup)
MANAGER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$MANAGER_IP" ]; then
    MANAGER_IP=$(ip route get 1 2>/dev/null | awk '{print $7}')
fi
if [ -z "$MANAGER_IP" ] || [ "$MANAGER_IP" = "127.0.0.1" ]; then
    MANAGER_IP=$(python3 -c "
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('10.255.255.255', 1))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print('127.0.0.1')
" 2>/dev/null)
fi

echo -e "\033[1;32m[✔] Manager Local Network IP Address: \033[1;37m$MANAGER_IP\033[0m"
echo ""
echo -e "\033[1;34m[✦] Access URLs from any device on this network:\033[0m"
echo -e "    - \033[1;37mFrontend Dashboard:\033[0m http://$MANAGER_IP:8000"
echo -e "    - \033[1;37mBackend Swagger API:\033[0m http://$MANAGER_IP:8000/docs"
echo ""
echo -e "\033[1;34m[✦] Join Commands for Other Computers (Physical Nodes):\033[0m"
echo -e "    \033[1;33mFor macOS/Linux Nodes:\033[0m"
echo -e "    export BACKEND_URL=http://$MANAGER_IP:8000 && export REGISTRATION_TOKEN=clusterdash-worker-secret-token && python3 daemon.py"
echo ""
echo -e "    \033[1;33mFor Windows Nodes (in PowerShell):\033[0m"
echo -e "    \$env:BACKEND_URL='http://$MANAGER_IP:8000'; \$env:REGISTRATION_TOKEN='clusterdash-worker-secret-token'; python daemon.py"
echo -e "\033[1;35m========================================================\033[0m"
echo ""

# Setup Python environment for Backend Offline
echo "[*] Setting up Backend Python virtual environment..."
cd backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

echo "[*] Installing backend dependencies offline from wheels directory..."
if [ -d "../offline-assets/wheels" ]; then
    pip install --no-index --find-links=../offline-assets/wheels -r requirements.txt
else
    echo -e "\033[1;31m[✘] Warning: 'offline-assets/wheels' directory not found. Trying online install...\033[0m"
    pip install -r requirements.txt
fi
echo "[✔] Backend environment ready."
echo ""

# Start Unified Backend Server (port 8000)
echo "[*] Starting Unified FastAPI Server (port 8000)..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
