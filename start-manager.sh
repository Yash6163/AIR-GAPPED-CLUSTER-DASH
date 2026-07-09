#!/bin/bash

# --- Distributed Swarm Monitor Manager Launcher (No-Docker) ---

# Clear screen for custom banner
clear

echo -e "\033[1;35m========================================================\033[0m"
echo -e "\033[1;36m       ClusterDash - DISTRIBUTED MONITOR MANAGER        \033[0m"
echo -e "\033[1;35m========================================================\033[0m"
echo ""

# Auto-discover local IP Address using Python routing table lookup
MANAGER_IP=$(python3 -c "
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print('127.0.0.1')
" 2>/dev/null)

if [ "$MANAGER_IP" = "127.0.0.1" ] || [ -z "$MANAGER_IP" ]; then
    # Fallback to macOS specific check
    MANAGER_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
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

# Build Frontend statically if missing
if [ ! -d "frontend/out" ]; then
    echo "[*] Compiling static React frontend first (generating frontend/out)..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        echo "Installing frontend Node dependencies..."
        npm install
    fi
    npm run build
    cd ..
fi

# Setup Python environment for Backend
echo "[*] Setting up Backend Python virtual environment..."
cd backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
echo "[*] Installing backend dependencies..."
pip install -r requirements.txt
echo "[✔] Backend environment ready."
echo ""

# Start Backend Server synchronously (which also hosts static frontend)
echo "[*] Starting Unified FastAPI Server (port 8000)..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000

