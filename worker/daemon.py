import os
import sys
import time
import socket
import platform
import requests
import json
import logging
import datetime
import psutil
import docker
from typing import Dict, Any, List

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] daemon: %(message)s"
)
logger = logging.getLogger("clusterdash.worker")

# Configurations from environment
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
REGISTRATION_TOKEN = os.getenv("REGISTRATION_TOKEN", "clusterdash-worker-secret-token")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "5"))
NODE_ROLE = os.getenv("NODE_ROLE", "worker")
CONFIG_PATH = os.getenv("CONFIG_PATH", "./.worker_config.json")

class WorkerDaemon:
    def __init__(self):
        self.node_id = None
        self.jwt_token = None
        self.docker_client = None
        self.docker_available = False
        self._init_docker()
        
        # IO speed metrics calculation state
        self.last_disk_io = None
        self.last_net_io = None
        self.last_io_time = None
        
    def _init_docker(self):
        try:
            self.docker_client = docker.from_env()
            self.docker_client.ping()
            self.docker_available = True
            logger.info("Connected to local Docker daemon.")
        except Exception as e:
            logger.warning(f"Could not connect to Docker socket: {e}. Container monitoring disabled.")
            self.docker_client = None
            self.docker_available = False

    def load_config(self) -> bool:
        """Loads node ID and token cache if they exist."""
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r") as f:
                    config = json.load(f)
                    self.node_id = config.get("node_id")
                    self.jwt_token = config.get("token")
                    logger.info(f"Loaded credentials for node ID: {self.node_id} from cache.")
                    return True
            except Exception as e:
                logger.error(f"Failed to load configuration cache: {e}")
        return False

    def save_config(self):
        """Saves current credentials to local file."""
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump({"node_id": self.node_id, "token": self.jwt_token}, f)
            logger.info("Saved credentials cache.")
        except Exception as e:
            logger.error(f"Failed to write configuration cache: {e}")

    def clear_config(self):
        """Clears invalid configuration cache."""
        if os.path.exists(CONFIG_PATH):
            try:
                os.remove(CONFIG_PATH)
            except Exception as e:
                logger.error(f"Failed to clear configuration cache: {e}")
        self.node_id = None
        self.jwt_token = None

    def get_local_ip(self) -> str:
        """Helper to discover the node's network IP Address."""
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('8.8.8.8', 1))
            ip = s.getsockname()[0]
        except Exception:
            ip = '127.0.0.1'
        finally:
            s.close()
        return ip

    def get_my_container_id(self) -> str:
        """Discovers the container short ID if running inside Docker."""
        try:
            if os.path.exists("/proc/self/cgroup"):
                with open("/proc/self/cgroup", "r") as f:
                    for line in f:
                        if "docker" in line:
                            parts = line.strip().split('/')
                            if len(parts) > 2:
                                return parts[-1][:12]
        except Exception:
            pass
        if self.docker_available and self.docker_client:
            try:
                my_hostname = socket.gethostname()
                for c in self.docker_client.containers.list():
                    if c.name == my_hostname or c.short_id == my_hostname or c.attrs.get("Config", {}).get("Hostname") == my_hostname:
                        return c.short_id
            except Exception:
                pass
        return "N/A"

    def get_docker_version(self) -> str:
        if self.docker_available and self.docker_client:
            try:
                return self.docker_client.version().get("Version", "unknown")
            except Exception:
                pass
        return "unknown"

    def register(self) -> bool:
        """Attempts to register the worker node with the backend Manager API."""
        url = f"{BACKEND_URL}/api/v1/register"
        hostname = socket.gethostname()
        ip_addr = self.get_local_ip()
        
        # CPU & Mem specs
        cpu_cores = psutil.cpu_count(logical=True) or 1
        total_memory = psutil.virtual_memory().total
        
        # Collect static system specifications
        try:
            import uuid as pyuuid
            mac = ':'.join(['{:02x}'.format((pyuuid.getnode() >> ele) & 0xff) for ele in range(0, 8*6, 8)][::-1])
        except Exception:
            mac = "unknown"
            
        try:
            boot_time = datetime.datetime.fromtimestamp(psutil.boot_time()).isoformat()
        except Exception:
            boot_time = "unknown"

        system_info = {
            "machine_name": platform.node(),
            "processor": platform.processor() or "unknown",
            "python_version": platform.python_version(),
            "mac_address": mac,
            "boot_time": boot_time
        }
        
        os_val = os.getenv("OVERRIDE_OS", platform.system().lower())
        
        payload = {
            "token": REGISTRATION_TOKEN,
            "hostname": hostname,
            "role": NODE_ROLE,
            "ip_address": ip_addr,
            "os": os_val,
            "kernel": platform.release(),
            "arch": platform.machine(),
            "docker_version": self.get_docker_version(),
            "cpu_cores": cpu_cores,
            "total_memory": total_memory,
            "container_id": self.get_my_container_id(),
            "system_info": system_info
        }

        logger.info(f"Sending registration request to manager at {url}...")
        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                self.node_id = data.get("node_id")
                self.jwt_token = data.get("token")
                logger.info(f"Successfully registered node. ID: {self.node_id}")
                self.save_config()
                return True
            else:
                logger.error(f"Registration rejected (Status {response.status_code}): {response.text}")
                return False
        except Exception as e:
            logger.error(f"Failed to connect to manager at {url} for registration: {e}")
            return False

    def collect_node_metrics(self) -> Dict[str, Any]:
        """Gathers local operating system metrics including detailed dynamic info."""
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        net_io = psutil.net_io_counters()
        uptime = time.time() - psutil.boot_time()
        
        # Calculate speeds & deltas
        now_time = time.time()
        disk_io = psutil.disk_io_counters()
        
        disk_read_speed = 0.0
        disk_write_speed = 0.0
        net_speed_sent = 0.0
        net_speed_recv = 0.0
        
        if self.last_io_time is not None and now_time > self.last_io_time:
            dt = now_time - self.last_io_time
            if disk_io and self.last_disk_io:
                disk_read_speed = max(0.0, (disk_io.read_bytes - self.last_disk_io.read_bytes) / dt)
                disk_write_speed = max(0.0, (disk_io.write_bytes - self.last_write_bytes) if hasattr(self, "last_write_bytes") else (disk_io.write_bytes - self.last_disk_io.write_bytes) / dt)
                # Fix write speed formula to be safe:
                disk_write_speed = max(0.0, (disk_io.write_bytes - self.last_disk_io.write_bytes) / dt)
            if net_io and self.last_net_io:
                net_speed_sent = max(0.0, (net_io.bytes_sent - self.last_net_io.bytes_sent) / dt)
                net_speed_recv = max(0.0, (net_io.bytes_recv - self.last_net_io.bytes_recv) / dt)
                
        self.last_disk_io = disk_io
        self.last_net_io = net_io
        self.last_io_time = now_time
        
        # Per-core CPU %
        per_core_cpu = []
        try:
            per_core_cpu = psutil.cpu_percent(interval=None, percpu=True)
        except Exception:
            pass
            
        # CPU Frequencies
        cpu_freq = {"current": 0.0, "min": 0.0, "max": 0.0}
        try:
            freq = psutil.cpu_freq()
            if freq:
                cpu_freq = {
                    "current": getattr(freq, "current", 0.0) or 0.0,
                    "min": getattr(freq, "min", 0.0) or 0.0,
                    "max": getattr(freq, "max", 0.0) or 0.0
                }
        except Exception:
            pass
            
        # CPU Temp
        cpu_temp = None
        try:
            temps = psutil.sensors_temperatures()
            if temps:
                for name, entries in temps.items():
                    if entries:
                        cpu_temp = entries[0].current
                        break
        except Exception:
            pass
            
        # Load Average
        load_avg = [0.0, 0.0, 0.0]
        try:
            if hasattr(os, "getloadavg"):
                load_avg = list(os.getloadavg())
            elif hasattr(psutil, "getloadavg"):
                load_avg = list(psutil.getloadavg())
        except Exception:
            pass
            
        # Swap memory
        swap_total = 0.0
        swap_used = 0.0
        swap_free = 0.0
        swap_percent = 0.0
        try:
            swap = psutil.swap_memory()
            swap_total = swap.total
            swap_used = swap.used
            swap_free = swap.free
            swap_percent = swap.percent
        except Exception:
            pass

        # Partitions
        partitions = []
        try:
            for p in psutil.disk_partitions(all=False):
                try:
                    usage = psutil.disk_usage(p.mountpoint)
                    partitions.append({
                        "device": p.device,
                        "mountpoint": p.mountpoint,
                        "fstype": p.fstype,
                        "opts": p.opts,
                        "total": usage.total,
                        "used": usage.used,
                        "free": usage.free,
                        "percent": usage.percent
                    })
                except Exception:
                    pass
        except Exception:
            pass

        # Network Interfaces
        interfaces = []
        try:
            addrs = psutil.net_if_addrs()
            stats = psutil.net_if_stats()
            for name, addresses in addrs.items():
                addr_list = []
                for a in addresses:
                    addr_list.append(a.address)
                is_up = True
                speed = 0
                if name in stats:
                    is_up = stats[name].isup
                    speed = stats[name].speed
                interfaces.append({
                    "name": name,
                    "addresses": addr_list,
                    "is_up": is_up,
                    "speed": speed
                })
        except Exception:
            pass

        # Thread Monitoring: psutil.process_iter()
        total_proc = 0
        total_threads = 0
        running_threads = 0
        sleeping_threads = 0
        zombies = 0
        processes_list = []
        
        for proc in psutil.process_iter(['pid', 'name', 'num_threads', 'cpu_percent', 'memory_percent', 'status', 'ppid']):
            try:
                total_proc += 1
                num_t = proc.info['num_threads'] or 0
                total_threads += num_t
                status = proc.info['status']
                
                if status == psutil.STATUS_RUNNING:
                    running_threads += num_t
                elif status == psutil.STATUS_SLEEPING:
                    sleeping_threads += num_t
                elif status == psutil.STATUS_ZOMBIE:
                    zombies += 1
                
                try:
                    t_ids = [t.id for t in proc.threads()]
                except Exception:
                    t_ids = []
                
                status_str = str(status)
                
                processes_list.append({
                    "pid": proc.info['pid'],
                    "name": proc.info['name'] or "unknown",
                    "threads_count": num_t,
                    "cpu_usage": round(proc.info['cpu_percent'] or 0.0, 2),
                    "memory_usage": round(proc.info['memory_percent'] or 0.0, 2),
                    "status": status_str,
                    "parent_pid": proc.info['ppid'],
                    "thread_ids": ",".join(map(str, t_ids))
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
                
        # Limit processes payload to top 50 sorted by cpu usage
        processes_list.sort(key=lambda x: x["cpu_usage"], reverse=True)
        top_processes = processes_list[:50]

        detailed = {
            "per_core_cpu": per_core_cpu,
            "cpu_freq": cpu_freq,
            "cpu_temp": cpu_temp,
            "load_avg": load_avg,
            "swap_total": swap_total,
            "swap_used": swap_used,
            "swap_free": swap_free,
            "swap_percent": swap_percent,
            "disk_partitions": partitions,
            "disk_read_speed": round(disk_read_speed, 2),
            "disk_write_speed": round(disk_write_speed, 2),
            "net_packets_sent": net_io.packets_sent if net_io else 0,
            "net_packets_recv": net_io.packets_recv if net_io else 0,
            "net_speed_sent": round(net_speed_sent, 2),
            "net_speed_recv": round(net_speed_recv, 2),
            "interfaces": interfaces
        }
        
        return {
            "cpu_usage": cpu,
            "memory_used": mem.used,
            "memory_free": mem.available,
            "disk_used": disk.used,
            "disk_free": disk.free,
            "net_send": net_io.bytes_sent,
            "net_recv": net_io.bytes_recv,
            "uptime": uptime,
            "total_processes": total_proc,
            "total_threads": total_threads,
            "running_threads": running_threads,
            "sleeping_threads": sleeping_threads,
            "zombies": zombies,
            "processes": top_processes,
            "detailed_metrics": detailed
        }

    def collect_container_metrics(self) -> List[Dict[str, Any]]:
        """Gathers stats for local running docker containers."""
        if not self.docker_available or not self.docker_client:
            return []
            
        containers = []
        try:
            for container in self.docker_client.containers.list(all=True):
                attrs = container.attrs
                config = attrs.get("Config", {}) or {}
                state = attrs.get("State", {}) or {}
                
                status = state.get("Status", "unknown")
                restart_count = state.get("RestartCount", 0)
                started_at = state.get("StartedAt", "")
                
                ports_dict = attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
                ports_list = []
                for container_port, host_ports in ports_dict.items():
                    if host_ports:
                        for hp in host_ports:
                            ports_list.append(f"{hp.get('HostIp', '0.0.0.0')}:{hp.get('HostPort')}->{container_port}")
                    else:
                        ports_list.append(container_port)
                ports_str = ", ".join(ports_list)
                
                cpu_percent = 0.0
                mem_usage = 0
                
                if status == "running":
                    try:
                        stats = container.stats(stream=False)
                        # Memory
                        mem_stats = stats.get("memory_stats", {})
                        mem_usage = mem_stats.get("usage", 0)
                        
                        # CPU
                        cpu_stats = stats.get("cpu_stats", {})
                        precpu_stats = stats.get("precpu_stats", {})
                        
                        cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
                        system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
                        
                        online_cpus = cpu_stats.get("online_cpus", 1)
                        if system_delta > 0 and cpu_delta > 0:
                            cpu_percent = (cpu_delta / system_delta) * online_cpus * 100.0
                    except Exception:
                        pass
                
                containers.append({
                    "container_id": container.short_id,
                    "name": container.name,
                    "image": config.get("Image", "unknown"),
                    "status": status,
                    "ports": ports_str,
                    "cpu_usage": round(cpu_percent, 2),
                    "memory_usage": mem_usage,
                    "restart_count": restart_count,
                    "started_at": started_at
                })
        except Exception as e:
            logger.error(f"Error querying docker container stats: {e}")
            
        return containers

    def send_metrics(self) -> bool:
        """Sends CPU/RAM/Disk stats and local containers info to the backend."""
        if not self.docker_available:
            self._init_docker()
            
        url = f"{BACKEND_URL}/api/v1/metrics"
        headers = {"Authorization": f"Bearer {self.jwt_token}"}
        
        try:
            node_metrics = self.collect_node_metrics()
            container_metrics = self.collect_container_metrics()
            
            payload = {
                **node_metrics,
                "containers": container_metrics
            }
            
            start_time = time.time()
            response = requests.post(url, json=payload, headers=headers, timeout=5)
            latency_ms = (time.time() - start_time) * 1000.0
            
            if response.status_code == 200:
                logger.info(f"Reported metrics successfully. Latency: {latency_ms:.1f}ms, Containers: {len(container_metrics)}")
                self.send_heartbeat(latency_ms)
                return True
            elif response.status_code == 401:
                logger.error("Token expired or unauthorized. Triggering re-registration.")
                self.clear_config()
                return False
            else:
                logger.error(f"Failed to post metrics (Status {response.status_code}): {response.text}")
                return False
        except Exception as e:
            logger.error(f"Failed to report metrics: {e}")
            return False

    def send_heartbeat(self, latency_ms: float):
        """Sends a lightweight heartbeat request."""
        url = f"{BACKEND_URL}/api/v1/heartbeat"
        headers = {"Authorization": f"Bearer {self.jwt_token}"}
        params = {"latency_ms": round(latency_ms, 2)}
        try:
            requests.post(url, headers=headers, params=params, timeout=3)
        except Exception as e:
            logger.debug(f"Failed to send fast heartbeat: {e}")

    def run(self):
        """Main daemon operational loop."""
        logger.info("Initializing ClusterDash Worker Daemon...")
        
        # Load or Register
        if not self.load_config():
            while not self.register():
                logger.warning("Registration failed. Retrying in 5 seconds...")
                time.sleep(5)
                
        # Main Loop
        logger.info("Starting reports transmission loop.")
        while True:
            if not self.jwt_token:
                logger.warning("No authentication token. Attempting re-registration...")
                if self.register():
                    continue
                time.sleep(5)
                continue
                
            self.send_metrics()
            time.sleep(HEARTBEAT_INTERVAL)

if __name__ == "__main__":
    daemon = WorkerDaemon()
    try:
        daemon.run()
    except KeyboardInterrupt:
        logger.info("Stopping daemon.")
        sys.exit(0)
