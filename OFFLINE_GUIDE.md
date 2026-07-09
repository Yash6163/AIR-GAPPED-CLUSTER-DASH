# ClusterDash - Offline Deployment Guide 🔌🚫
*(Hinglish and English Versions Included - No-Docker Edition)*

This guide explains how to deploy **ClusterDash** (both the Manager stack and Worker agents) on physical machines that have **no active internet connection** and **no Docker installed**.

---

## 🌐 ENGLISH VERSION

### Concept
Since the target Offline Manager machine has no internet, we cannot run `pip install` on it directly. 
Instead:
1. **On your Online PC (with internet)**: We download all Python library wheels (`.whl` files) for both backend and worker.
2. **On the Offline PC**: We install the Python dependencies locally from the downloaded wheels. The database uses SQLite (which is built-in to Python), and rate-limiting falls back to an in-memory implementation. Node.js is run natively.

---

### Step 1: Package Assets (On your Online PC)
1. Open terminal on your current computer (where you have this code and internet).
2. Run the packager script:
   ```bash
   ./package-offline.sh
   ```
3. This script will:
   - Download the required Python packages for both backend and worker into `offline-assets/wheels/` directory.
   - Save core Python utilities (pip, setuptools, wheel).

---

### Step 2: Transfer Files to Offline Machine
1. Copy the entire project folder (including the newly created `offline-assets` folder) to a USB drive or external storage.
2. Paste/transfer the folder to your **Offline Manager** system.

---

### Step 3: Run the Manager (On your Offline PC)
1. Open a terminal inside the project directory on your offline machine.
2. Run the offline manager script:
   ```bash
   ./start-offline-manager.sh
   ```
3. This script will:
   - Create a local python virtual environment `backend/venv`.
   - Install backend dependencies offline from the `offline-assets/wheels` directory.
   - Discover your local network IP (LAN/Wi-Fi).
   - Start the SQLite backend FastAPI server (port 8000) and Next.js frontend (port 3000) natively in the background.
4. Note the printed manager IP (e.g. `192.168.1.50`).

---

### Step 4: Run Workers Offline (Other physical machines)
If a worker machine (Computer B, C, etc.) is also offline:
1. Copy the `worker` folder **AND** the `offline-assets/wheels` folder to that machine.
2. Place the `wheels` folder inside the `worker` folder so it looks like:
   ```
   worker/
   ├── daemon.py
   ├── requirements.txt
   ├── run-worker.sh
   ├── run-worker.bat
   └── wheels/       <-- Paste the wheels folder here
   ```
3. Run the setup script:
   - **For macOS/Linux**: `./run-worker.sh`
   - **For Windows**: `run-worker.bat`
4. The script will see the local `wheels` directory, skip internet installation, and install everything offline!

---
---

## 🇮🇳 HINGLISH VERSION (हिंदी/अंग्रेजी मिक्स गाइड)

### Concept
Offline Manager system me internet nahi hone ki wajah se, hum wahan direct pip install nahi kar sakte.
Isliye:
1. **Online PC par (jahan internet hai)**: Hum Python dependencies download karke `.whl` files me save karenge.
2. **Offline PC par**: Hum in wheels folder ki help se Python packages offline install karenge. SQLite database use hoga jo Python me pehle se installed hota hai, and Node.js server local chalaenge.

---

### Step 1: Assets Package Karein (Online Machine Par)
1. Apne internet wale computer par terminal open karein.
2. Yeh packaging script run karein:
   ```bash
   ./package-offline.sh
   ```
3. Yeh script:
   - Backend aur worker requirements ke python packages `offline-assets/wheels/` folder me download karega.

---

### Step 2: Files Ko Transfer Karein
1. Apne USB drive me poora project folder copy karein.
2. Usse offline Manager machine par paste kar dein.

---

### Step 3: Manager Ko Start Karein (Offline Machine Par)
1. Offline system me terminal open karke project folder me jayein.
2. Yeh command run karein:
   ```bash
   ./start-offline-manager.sh
   ```
3. Yeh script:
   - `backend` folder ke andar local virtual environment setup karega.
   - `offline-assets/wheels` ka use karke saare backend packages offline install karega.
   - Aapke local LAN/Wi-Fi router se Local IP automatic dhoondhega.
   - FastAPI server (port 8000) aur Next.js frontend (port 3000) ko local run kar dega.
4. Terminal par dikhaye gaye Local IP address ko note karein.

---

### Step 4: Workers Ko Connect Karein (Offline Mode Me)
Agar baaki physical computers (Workers) bhi internet se connect nahi hain:
1. `worker` folder ke andar `offline-assets` me se `wheels` folder ko copy karke paste karein. Structure aesa hona chahiye:
   ```
   worker/
   ├── daemon.py
   ├── requirements.txt
   ├── run-worker.sh
   └── wheels/       <-- Wheels folder ko yahan copy karein
   ```
2. Setup script chalaein:
   - **macOS/Linux Workers**: `./run-worker.sh`
   - **Windows Workers**: `run-worker.bat`
3. Script automatic detect karegi ki `wheels` folder maujood hai aur bina internet ke local libraries install kar degi!
