#!/bin/bash

# --- ClusterDash Offline Packager (No-Docker Edition) ---
# Run this script on an INTERNET-CONNECTED machine to prepare all assets
# for the offline manager and worker nodes.

clear
echo -e "\033[1;35m========================================================\033[0m"
echo -e "\033[1;36m       ClusterDash - OFFLINE PACKAGER (No-Docker)       \033[0m"
echo -e "\033[1;35m========================================================\033[0m"
echo ""

WHEELS_DIR="./offline-assets/wheels"
mkdir -p "$WHEELS_DIR"

echo -e "\033[1;33m[1/4] Downloading Python dependencies (Wheels) for Backend...\033[0m"
python3 -m pip download -r backend/requirements.txt -d "$WHEELS_DIR"

echo -e "\033[1;33m[2/4] Downloading Python dependencies (Wheels) for Worker...\033[0m"
# Download for current machine's environment
python3 -m pip download -r worker/requirements.txt -d "$WHEELS_DIR"

# Download specifically for Windows x86_64 compatibility
python3 -m pip download -r worker/requirements.txt \
  --platform win_amd64 \
  --only-binary=:all: \
  -d "$WHEELS_DIR" 2>/dev/null || true

# Download specifically for Linux x86_64 compatibility (modern Python)
python3 -m pip download -r worker/requirements.txt \
  --platform manylinux2014_x86_64 \
  --only-binary=:all: \
  -d "$WHEELS_DIR" 2>/dev/null || true

# Download specifically for legacy Python 3.6 (Rocky Linux) compatibility
python3 -m pip download -r worker/requirements.txt \
  --python-version 3.6 \
  --platform manylinux2014_x86_64 \
  --only-binary=:all: \
  -d "$WHEELS_DIR" 2>/dev/null || true


echo -e "\033[1;33m[3/4] Downloading core Python packaging utilities (pip, setuptools, wheel)...\033[0m"
python3 -m pip download pip setuptools wheel -d "$WHEELS_DIR"

echo -e "\033[1;33m[4/4] Compiling static Frontend dashboard (Next.js export)... \033[0m"
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend Node.js dependencies..."
    npm install
fi
echo "Running Next.js static build export..."
npm run build
cd ..

echo -e "\033[1;32m[✔] All Python wheels downloaded and Frontend statically exported!\033[0m"
echo ""

echo -e "\033[1;32m========================================================\033[0m"
echo -e "\033[1;32m[✔] Packaging Completed Successfully!\033[0m"
echo -e "\033[1;37mNext Steps:\033[0m"
echo -e "1. Copy the entire project folder to a USB drive."
echo -e "2. Transfer it to the offline machine(s)."
echo -e "3. Start the Manager using ./start-manager.sh (or ./start-offline-manager.sh)."
echo -e "4. Run the Worker using ./worker/run-worker.sh (or run-worker.bat)."
echo -e "\033[1;35m========================================================\033[0m"
echo ""
