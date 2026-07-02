from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base
import datetime

class Node(Base):
    __tablename__ = "nodes"

    id = Column(String, primary_key=True, index=True)  # Generated node ID
    hostname = Column(String, unique=True, index=True, nullable=False)
    ip_address = Column(String, nullable=False)
    role = Column(String, default="worker")  # "manager" or "worker"
    status = Column(String, default="online")  # "online" or "offline"
    os = Column(String, nullable=True)
    kernel = Column(String, nullable=True)
    arch = Column(String, nullable=True)
    docker_version = Column(String, nullable=True)
    cpu_cores = Column(Integer, default=1)
    total_memory = Column(Float, default=0.0)  # In bytes
    uptime = Column(DateTime, nullable=True)
    last_heartbeat = Column(DateTime, default=datetime.datetime.utcnow)
    latency = Column(Float, default=0.0)  # Network heartbeat latency in ms
    
    # Extended V2 fields
    container_id = Column(String, nullable=True)
    system_info = Column(JSON, nullable=True)
    detailed_metrics = Column(JSON, nullable=True)

    # Relationships
    metrics = relationship("MetricHistory", back_populates="node", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="node", cascade="all, delete-orphan")
    processes = relationship("ProcessMetric", back_populates="node", cascade="all, delete-orphan")


class MetricHistory(Base):
    __tablename__ = "metric_history"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    cpu_usage = Column(Float, nullable=False)
    memory_used = Column(Float, nullable=False)
    memory_free = Column(Float, nullable=False)
    disk_used = Column(Float, nullable=False)
    disk_free = Column(Float, nullable=False)
    net_send = Column(Float, nullable=False)  # Bytes
    net_recv = Column(Float, nullable=False)  # Bytes
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    
    # Extended V2 fields
    total_processes = Column(Integer, default=0)
    total_threads = Column(Integer, default=0)

    node = relationship("Node", back_populates="metrics")


class ContainerHistory(Base):
    __tablename__ = "container_history"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, nullable=False, index=True)
    container_id = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    image = Column(String, nullable=False)
    status = Column(String, nullable=False)
    cpu_usage = Column(Float, nullable=False)
    memory_usage = Column(Float, nullable=False)
    restart_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String, nullable=False)  # "cpu", "memory", "disk", "offline", "docker_down", "container_crash"
    severity = Column(String, nullable=False)  # "warning", "critical"
    message = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    resolved = Column(Boolean, default=False)

    node = relationship("Node", back_populates="alerts")


class ClusterEvent(Base):
    __tablename__ = "cluster_events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, nullable=False)  # e.g., "node_registered", "node_status_change"
    message = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class ProcessMetric(Base):
    __tablename__ = "process_metrics"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    pid = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    threads_count = Column(Integer, default=1)
    cpu_usage = Column(Float, default=0.0)
    memory_usage = Column(Float, default=0.0)
    status = Column(String, nullable=False)
    thread_ids = Column(String, nullable=True)  # Comma-separated PIDs
    parent_pid = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    node = relationship("Node", back_populates="processes")

