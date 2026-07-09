# ClusterDash - Physical Nodes Setup Guide 🖥️🔗
*(Hinglish and English Versions Included)*

This guide will walk you through setting up a physical, distributed cluster of computers on your local network (LAN or Wi-Fi) using **ClusterDash**.

---

## 📋 Prerequisites / Requirements
1. **Local Network Connection**: All systems (Manager and Worker nodes) **must be connected to the exact same Wi-Fi network or Local Router** so they can ping each other.
2. **Offline Ready**: No active internet connection is required.
3. **Manager Machine (Computer A)**: Python 3.x and Node.js must be installed.
4. **Worker Machines (Computer B, C, etc.)**: Python 3.x must be installed.

---

## 🌐 ENGLISH SETUP GUIDE

### Phase 1: Set up the Manager (Computer A)
This computer hosts the Postgres Database, Redis Cache, API Backend, and React Frontend.

1. Open your terminal on **Computer A**.
2. Navigate to the `/Users/yashkumar/Desktop/final` folder.
3. Start the stack by running:
   ```bash
   ./start-manager.sh
   ```
4. The script will automatically discover your local IP (e.g., `192.168.1.50`) and print it on the console along with join commands.
5. Keep this terminal running. You can access the dashboard at:
   - **Frontend UI & API**: `http://<MANAGER_IP>:8000` (Swagger docs at `/docs`)

---

### Phase 2: Add Worker Nodes (Computer B, Computer C, etc.)
Now, register your other physical systems (macOS, Windows, or Linux) to send metrics to the Manager dashboard.

1. **Copy the `worker` folder** from `/Users/yashkumar/Desktop/final/worker` onto the other computer (via USB drive, local file sharing, or SSH).
2. Open a terminal or Command Prompt on that machine inside the copied `worker` directory.

#### 🍎 For macOS & Linux Workers:
1. Run the join script:
   ```bash
   ./run-worker.sh
   ```
2. The script will ask you for:
   - **Manager IP Address**: Enter the local network IP of Computer A (printed by `start-manager.sh`).
   - **Node Role**: Choose either `worker` or `manager` (press Enter to accept default `worker`).
3. The script will auto-configure a Python virtual environment, install requirements, and start streaming hardware telemetry.

#### 🪟 For Windows Workers:
1. Double-click or run from CMD:
   ```cmd
   run-worker.bat
   ```
2. Provide the Manager's local network IP and role when prompted.
3. The batch script will build the python environment and connect automatically.

---

### Phase 3: Visualizing Metrics
1. Open the dashboard at `http://<MANAGER_IP>:8000` from any computer or browser on the network.
2. You will see all physical systems register and heartbeat live!
3. Click on any node card to view its:
   - **System Specs**: Processor, Python versions, MAC Addresses, boot times, etc.
   - **CPU & Memory Details**: Uptime, logical cores, load average, temperature, per-core utilization bars, and swap memory.
   - **Disk & Network**: Disk speed, partition tables, network interface speeds, and bandwidth speeds.
   - **Threads & Processes**: Table of running threads, sleeping threads, processes list, sorting by memory/CPU, and process searching.
   - **Historical Charts**: Real-time graph trends for CPU, RAM, Disk, Net speeds, and thread counts.
   - **Database Explorer**: Go to the `/database` page to view the SQLite tables (`nodes`, `metric_history`, `process_metrics`, `alerts`) directly in a premium datagrid view.

---

---

## 🇮🇳 HINGLISH SETUP GUIDE (हिंदी/अंग्रेजी गाइड)

### Phase 1: Manager Computer (Computer A) Setup Karein
Yeh computer database, caching servers, API, aur frontend dashboard chalaega.

1. **Computer A** par terminal open karein.
2. `/Users/yashkumar/Desktop/final` folder me navigate karein.
3. Command run karein:
   ```bash
   ./start-manager.sh
   ```
4. Yeh script aapka Local IP address (jaise `192.168.1.X`) auto-discover karega aur screen par worker join commands print kar dega.
5. Is terminal ko band mat karna. Dashboard open karne ke liye kisi bhi browser me type karein:
   - `http://<MANAGER_IP>:8000`

---

### Phase 2: Dusre Physical Computers ko Connect Karein (Computer B, C, etc.)
Ab hum dusre computers ko is network dashboard se jodenge taaki unki hardware info dashboard par real-time dikhe.

1. **`worker` folder** ko USB, local network share, ya email se dusre physical computer par copy karein.
2. Us computer me copy kiye gaye `worker` folder ke andar terminal (macOS/Linux) ya Command Prompt (Windows) open karein.

#### 🍎 macOS aur Linux ke liye:
1. Script run karein:
   ```bash
   ./run-worker.sh
   ```
2. Yeh aapse do cheezein puchega:
   - **Manager IP Address**: Yahan Computer A ka IP dalein (jo `start-manager.sh` ne print kiya tha).
   - **Node Role**: `worker` dalein (ya seedhe Enter dabayein).
3. Script automatic Python environment banayegi, dynamic dependencies install karegi, aur data stream shuru kar degi.

#### 🪟 Windows ke liye:
1. File par double-click karein:
   ```cmd
   run-worker.bat
   ```
2. Apne Manager computer ka local network IP address aur role type karein.
3. Windows batch script venv setup karega aur daemon run karega.

---

### Phase 3: Visual Dashboard aur Database Explorer Dekhein
1. Ab kisi bhi device se browser me `http://<MANAGER_IP>:8000` open karein.
2. Dashboard par aapke physical nodes live pulse karte huye dikhenge!
3. Kisi bhi node par click karke aap unke **CPU Cores details, Memory/Swap graphs, Disk partitions, active processes, and historical trends charts** live track kar sakte hain.
4. **Database Explorer**: Aap **SQLite Database Viewer** (URL: `http://<MANAGER_IP>:8000/database`) par jakar database tables ka raw data search, filter, ya CSV format me export kar sakte hain.
