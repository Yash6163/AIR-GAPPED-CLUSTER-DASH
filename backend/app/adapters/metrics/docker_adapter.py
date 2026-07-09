try:
    import docker
except ImportError:
    docker = None

import psutil
import time
import logging
from typing import Dict, Any, List
from app.domain.interfaces import MetricSource

logger = logging.getLogger("clusterdash.docker_adapter")

class DockerSwarmAdapter(MetricSource):
    def __init__(self):
        if docker is None:
            self.client = None
            self.docker_available = False
            logger.info("Docker SDK is not installed. Container metrics are disabled.")
            return
            
        try:
            self.client = docker.from_env()
            self.client.ping()
            self.docker_available = True
            logger.info("Docker API client initialized successfully.")
        except Exception as e:
            logger.info(f"Failed to connect to Docker socket: {e}. Container monitoring disabled.")
            self.client = None
            self.docker_available = False

    def get_node_metrics(self) -> Dict[str, Any]:
        """Gets CPU, RAM, Disk, and Network stats of the host machine."""
        # CPU
        cpu_usage = psutil.cpu_percent(interval=None)
        
        # RAM
        mem = psutil.virtual_memory()
        
        # Disk
        disk = psutil.disk_usage('/')
        
        # Network IO
        net_io = psutil.net_io_counters()
        
        return {
            "cpu_usage": cpu_usage,
            "memory_used": mem.used,
            "memory_free": mem.available,
            "disk_used": disk.used,
            "disk_free": disk.free,
            "net_send": net_io.bytes_sent,
            "net_recv": net_io.bytes_recv,
            "uptime": time.time() - psutil.boot_time()
        }

    def get_container_metrics(self) -> List[Dict[str, Any]]:
        """Gets the list of containers running on the host and their stats."""
        if not self.docker_available or not self.client:
            return []
        
        containers = []
        try:
            for container in self.client.containers.list(all=True):
                # Basic metadata
                info = container.attrs
                config = info.get("Config", {})
                state = info.get("State", {})
                
                status = state.get("Status", "unknown")
                restart_count = state.get("RestartCount", 0)
                started_at = state.get("StartedAt", "")
                
                # Fetch ports
                ports_dict = info.get("NetworkSettings", {}).get("Ports", {}) or {}
                ports_list = []
                for container_port, host_ports in ports_dict.items():
                    if host_ports:
                        for hp in host_ports:
                            ports_list.append(f"{hp.get('HostIp', '0.0.0.0')}:{hp.get('HostPort')}->{container_port}")
                    else:
                        ports_list.append(container_port)
                ports_str = ", ".join(ports_list)
                
                # Default CPU/RAM if container is stopped
                cpu_percent = 0.0
                mem_usage = 0
                
                if status == "running":
                    try:
                        # stream=False returns a snapshot
                        stats = container.stats(stream=False)
                        
                        # Parse Memory
                        mem_stats = stats.get("memory_stats", {})
                        mem_usage = mem_stats.get("usage", 0)
                        
                        # Parse CPU Percentage
                        cpu_stats = stats.get("cpu_stats", {})
                        precpu_stats = stats.get("precpu_stats", {})
                        
                        cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
                        system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
                        
                        online_cpus = cpu_stats.get("online_cpus", 1)
                        if system_delta > 0 and cpu_delta > 0:
                            cpu_percent = (cpu_delta / system_delta) * online_cpus * 100.0
                    except Exception as stats_err:
                        logger.warning(f"Could not read stats for container {container.name}: {stats_err}")
                
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
            logger.error(f"Error listing Docker containers: {e}")
            
        return containers

    def get_swarm_topology(self) -> List[Dict[str, Any]]:
        """Queries Docker Swarm topology if Swarm is initialized on this machine."""
        if not self.docker_available or not self.client:
            return []
        
        try:
            info = self.client.info()
            swarm_info = info.get("Swarm", {})
            if not swarm_info.get("LocalNodeState") or swarm_info["LocalNodeState"] == "inactive":
                return []
            
            nodes = self.client.nodes.list()
            topology = []
            for node in nodes:
                node_attrs = node.attrs
                spec = node_attrs.get("Spec", {})
                status = node_attrs.get("Status", {})
                description = node_attrs.get("Description", {})
                engine = description.get("Engine", {})
                
                topology.append({
                    "id": node_attrs.get("ID"),
                    "hostname": description.get("Hostname"),
                    "role": spec.get("Role", "worker"),
                    "status": status.get("State", "unknown"),
                    "ip_address": status.get("Addr", "0.0.0.0"),
                    "os": description.get("Platform", {}).get("OS"),
                    "kernel": description.get("Platform", {}).get("KernelVersion"),
                    "arch": description.get("Platform", {}).get("Architecture"),
                    "docker_version": engine.get("EngineVersion"),
                    "cpu_cores": description.get("Resources", {}).get("NanoCPUs", 1000000000) // 1000000000,
                    "total_memory": description.get("Resources", {}).get("MemoryBytes", 0)
                })
            return topology
        except Exception as e:
            logger.warning(f"Failed to fetch Swarm topology: {e} (Node is likely not running in Swarm mode or lacks manager permissions)")
            return []
