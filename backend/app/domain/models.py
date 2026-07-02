from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

# --- Worker Handshakes ---

class NodeRegisterRequest(BaseModel):
    token: str
    hostname: str
    role: str  # "manager" or "worker"
    ip_address: str
    os: str
    kernel: str
    arch: str
    docker_version: str
    cpu_cores: int
    total_memory: float  # In bytes
    
    # Extended V2 registration fields
    container_id: Optional[str] = None
    system_info: Optional[Dict[str, Any]] = None

class NodeRegisterResponse(BaseModel):
    node_id: str
    token: str  # JWT token for future requests

# --- Metrics Payload ---

class ContainerMetric(BaseModel):
    container_id: str
    name: str
    image: str
    status: str
    ports: str = ""
    cpu_usage: float  # Percentage (e.g. 1.5%)
    memory_usage: float  # In bytes
    restart_count: int = 0
    started_at: str = ""

class NodeMetricPayload(BaseModel):
    cpu_usage: float  # Percentage (e.g. 45.2)
    memory_used: float  # In bytes
    memory_free: float  # In bytes
    disk_used: float  # In bytes
    disk_free: float  # In bytes
    net_send: float  # Bytes per second
    net_recv: float  # Bytes per second
    uptime: float  # Seconds
    containers: List[ContainerMetric]
    
    # Extended V2 metrics fields
    total_processes: int = 0
    total_threads: int = 0
    running_threads: int = 0
    sleeping_threads: int = 0
    zombies: int = 0
    processes: Optional[List[Dict[str, Any]]] = None
    detailed_metrics: Optional[Dict[str, Any]] = None

# --- API Responses ---

class NodeResponse(BaseModel):
    id: str
    hostname: str
    ip_address: str
    role: str
    status: str  # "online" | "offline"
    os: str
    kernel: str
    arch: str
    docker_version: str
    cpu_cores: int
    total_memory: float
    uptime: Optional[datetime] = None
    last_heartbeat: Optional[datetime] = None
    latency: float = 0.0  # Latency in ms based on heartbeat duration
    
    # Extended V2 response fields
    container_id: Optional[str] = None
    system_info: Optional[Dict[str, Any]] = None
    detailed_metrics: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class MetricHistoryItem(BaseModel):
    timestamp: datetime
    cpu_usage: float
    memory_used: float
    memory_free: float
    disk_used: float
    disk_free: float
    net_send: float
    net_recv: float
    
    # Extended V2 fields
    total_processes: int = 0
    total_threads: int = 0

    class Config:
        from_attributes = True

class ContainerHistoryItem(BaseModel):
    timestamp: datetime
    container_id: str
    name: str
    status: str
    cpu_usage: float
    memory_usage: float
    restart_count: int

    class Config:
        from_attributes = True

class AlertResponse(BaseModel):
    id: int
    node_id: str
    node_hostname: Optional[str] = None
    type: str  # "cpu" | "memory" | "disk" | "offline" | "docker_down" | "container_crash"
    severity: str  # "warning" | "critical"
    message: str
    timestamp: datetime
    resolved: bool

    class Config:
        from_attributes = True

class ClusterOverviewResponse(BaseModel):
    total_nodes: int
    online_nodes: int
    offline_nodes: int
    manager_nodes: int
    worker_nodes: int
    total_cpu_cores: int
    total_memory: float  # Aggregate memory in bytes
    status: str  # "healthy" | "warning" | "degraded"

