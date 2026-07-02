import docker
import urllib.request
import re
import logging
from typing import Dict, Any, List
from app.domain.interfaces import MetricSource

logger = logging.getLogger("clusterdash.node_exporter_adapter")

class NodeExporterAdapter(MetricSource):
    def __init__(self, node_exporter_url: str = "http://localhost:9100/metrics"):
        self.node_exporter_url = node_exporter_url
        try:
            self.docker_client = docker.from_env()
            self.docker_available = True
        except Exception as e:
            logger.warning(f"Docker client could not be loaded: {e}. Container stats will be empty.")
            self.docker_client = None
            self.docker_available = False

    def _fetch_metrics(self) -> str:
        """Helper to fetch prometheus raw metrics from Node Exporter."""
        try:
            with urllib.request.urlopen(self.node_exporter_url, timeout=3) as response:
                return response.read().decode('utf-8')
        except Exception as e:
            logger.error(f"Error fetching from Node Exporter at {self.node_exporter_url}: {e}")
            return ""

    def _parse_metrics(self, raw_data: str) -> Dict[str, float]:
        """Parses standard prometheus metrics line-by-line using regex."""
        metrics = {}
        for line in raw_data.splitlines():
            # Skip comments
            if line.startswith("#") or not line.strip():
                continue
            
            # Simple match for metric_name{labels} value or metric_name value
            match = re.match(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)\s*({[^}]+})?\s*([0-9e.+-]+)", line)
            if match:
                name, labels, val = match.groups()
                try:
                    metrics[name] = float(val)
                except ValueError:
                    continue
        return metrics

    def get_node_metrics(self) -> Dict[str, Any]:
        """Scrapes and converts Node Exporter metrics to standard ClusterDash metrics."""
        raw_data = self._fetch_metrics()
        if not raw_data:
            # Fallback mock/empty if down
            return {
                "cpu_usage": 0.0,
                "memory_used": 0,
                "memory_free": 0,
                "disk_used": 0,
                "disk_free": 0,
                "net_send": 0,
                "net_recv": 0,
                "uptime": 0.0
            }

        parsed = self._parse_metrics(raw_data)
        
        # CPU calculation: derived from node_cpu_seconds_total
        # In a fully realized prometheus adapter, this would track delta between scrapes.
        # Here we mock cpu percentage based on idle ratio if stats are available.
        cpu_usage = 0.0
        # Placeholder calculation (illustrating Phase 2 metrics processing)
        if "node_cpu_seconds_total" in parsed:
            cpu_usage = 100.0 - parsed.get("node_cpu_seconds_total", 0.0) % 100.0
        
        # Memory
        total_mem = parsed.get("node_memory_MemTotal_bytes", 0)
        free_mem = parsed.get("node_memory_MemFree_bytes", 0) + parsed.get("node_memory_Buffers_bytes", 0) + parsed.get("node_memory_Cached_bytes", 0)
        used_mem = total_mem - free_mem
        
        # Disk
        # e.g., node_filesystem_size_bytes{mountpoint="/"}
        total_disk = parsed.get("node_filesystem_size_bytes", 0)
        free_disk = parsed.get("node_filesystem_free_bytes", 0)
        used_disk = total_disk - free_disk

        # Network IO
        net_send = parsed.get("node_network_transmit_bytes_total", 0)
        net_recv = parsed.get("node_network_receive_bytes_total", 0)
        
        uptime = parsed.get("node_time_seconds", 0) - parsed.get("node_boot_time_seconds", 0)

        return {
            "cpu_usage": round(max(0.0, min(100.0, cpu_usage)), 2),
            "memory_used": max(0, int(used_mem)),
            "memory_free": max(0, int(free_mem)),
            "disk_used": max(0, int(used_disk)),
            "disk_free": max(0, int(free_disk)),
            "net_send": net_send,
            "net_recv": net_recv,
            "uptime": max(0.0, uptime)
        }

    def get_container_metrics(self) -> List[Dict[str, Any]]:
        """For container details in Phase 2, we still query the Docker Socket API directly."""
        if not self.docker_available or not self.docker_client:
            return []
        
        containers = []
        try:
            for container in self.docker_client.containers.list():
                # We skip resource usage metrics calculation here because we extract them from cadvisor / docker api
                info = container.attrs
                config = info.get("Config", {})
                state = info.get("State", {})
                
                containers.append({
                    "container_id": container.short_id,
                    "name": container.name,
                    "image": config.get("Image", "unknown"),
                    "status": state.get("Status", "unknown"),
                    "ports": "",
                    "cpu_usage": 0.0, # Filled by Node Exporter/cAdvisor integrations in Phase 2
                    "memory_usage": 0,
                    "restart_count": state.get("RestartCount", 0),
                    "started_at": state.get("StartedAt", "")
                })
        except Exception as e:
            logger.error(f"Error querying Docker container metadata for Node Exporter Adapter: {e}")
        return containers
