import datetime
import uuid
import logging
import asyncio
from sqlalchemy.orm import Session
from app.adapters.database import models
from app.domain import models as domain_schemas
from app.core.security import create_worker_token
from app.services.alert_service import AlertService
from app.services.ws_manager import ws_manager

logger = logging.getLogger("clusterdash.node_service")

async def save_process_metrics_task(node_id: str, processes: list, timestamp: datetime.datetime):
    """Background task to asynchronously save process details and prune old ones."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        # Clear existing processes for this node to keep it live
        db.query(models.ProcessMetric).filter(models.ProcessMetric.node_id == node_id).delete()
        
        # Save new list
        db_procs = []
        for p in processes:
            db_procs.append(models.ProcessMetric(
                node_id=node_id,
                pid=p["pid"],
                name=p["name"],
                threads_count=p["threads_count"],
                cpu_usage=p["cpu_usage"],
                memory_usage=p["memory_usage"],
                status=p["status"],
                thread_ids=p.get("thread_ids"),
                parent_pid=p.get("parent_pid"),
                timestamp=timestamp
            ))
        db.add_all(db_procs)
        
        # Prune records older than 5 minutes
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(minutes=5)
        db.query(models.ProcessMetric).filter(models.ProcessMetric.timestamp < cutoff).delete()
        
        db.commit()
    except Exception as e:
        logger.error(f"Error in save_process_metrics_task for node {node_id}: {e}")
        db.rollback()
    finally:
        db.close()

class NodeService:
    @staticmethod
    async def register_node(db: Session, request: domain_schemas.NodeRegisterRequest) -> domain_schemas.NodeRegisterResponse:
        """Registers or re-registers a node, returning a unique ID and a signed JWT auth token."""
        # Find node by hostname
        node = db.query(models.Node).filter(models.Node.hostname == request.hostname).first()
        
        if not node:
            # Generate new node ID
            node_id = f"node-{str(uuid.uuid4())[:8]}"
            node = models.Node(
                id=node_id,
                hostname=request.hostname,
                ip_address=request.ip_address,
                role=request.role,
                status="online",
                os=request.os,
                kernel=request.kernel,
                arch=request.arch,
                docker_version=request.docker_version,
                cpu_cores=request.cpu_cores,
                total_memory=request.total_memory,
                last_heartbeat=datetime.datetime.utcnow(),
                container_id=request.container_id,
                system_info=request.system_info
            )
            db.add(node)
            logger.info(f"Registered new node: {request.hostname} ({node_id})")
        else:
            # Update existing node
            node_id = node.id
            node.ip_address = request.ip_address
            node.role = request.role
            node.status = "online"
            node.os = request.os
            node.kernel = request.kernel
            node.arch = request.arch
            node.docker_version = request.docker_version
            node.cpu_cores = request.cpu_cores
            node.total_memory = request.total_memory
            node.last_heartbeat = datetime.datetime.utcnow()
            node.container_id = request.container_id
            node.system_info = request.system_info
            logger.info(f"Updated registration for existing node: {request.hostname} ({node_id})")
            
        # Log cluster event
        event = models.ClusterEvent(
            event_type="node_registered",
            message=f"Node {request.hostname} registered as {request.role} (IP: {request.ip_address})"
        )
        db.add(event)
        
        db.commit()
        db.refresh(node)
 
        # Generate JWT worker token
        jwt_token = create_worker_token(node_id=node.id, hostname=node.hostname, role=node.role)
        
        # Resolve any offline alerts
        await AlertService.resolve_alert(db, node.id, "offline")
 
        return domain_schemas.NodeRegisterResponse(
            node_id=node.id,
            token=jwt_token
        )
 
    @staticmethod
    async def ingest_metrics(db: Session, node_id: str, payload: domain_schemas.NodeMetricPayload):
        """Ingests a standard metrics payload from a worker node, saves to DB, checks alerts, and broadcasts."""
        node = db.query(models.Node).filter(models.Node.id == node_id).first()
        if not node:
            logger.error(f"Cannot ingest metrics: Node {node_id} not registered.")
            return
 
        now = datetime.datetime.utcnow()
        
        # 1. Update node heartbeat/status and detailed_metrics
        was_offline = node.status == "offline"
        node.status = "online"
        node.last_heartbeat = now
        node.uptime = now - datetime.timedelta(seconds=payload.uptime)
        node.detailed_metrics = payload.detailed_metrics
        
        # 2. Save Metric History
        metric_history = models.MetricHistory(
            node_id=node_id,
            cpu_usage=payload.cpu_usage,
            memory_used=payload.memory_used,
            memory_free=payload.memory_free,
            disk_used=payload.disk_used,
            disk_free=payload.disk_free,
            net_send=payload.net_send,
            net_recv=payload.net_recv,
            timestamp=now,
            total_processes=payload.total_processes,
            total_threads=payload.total_threads
        )
        db.add(metric_history)
        
        # 3. Save Container History
        for c in payload.containers:
            container_hist = models.ContainerHistory(
                node_id=node_id,
                container_id=c.container_id,
                name=c.name,
                image=c.image,
                status=c.status,
                cpu_usage=c.cpu_usage,
                memory_usage=c.memory_usage,
                restart_count=c.restart_count,
                timestamp=now
            )
            db.add(container_hist)
            
        db.commit()
        
        # Spawn thread collection in the background
        if payload.processes:
            asyncio.create_task(save_process_metrics_task(node_id, payload.processes, now))
        
        # 4. Resolve offline status if it just came back
        if was_offline:
            await AlertService.resolve_alert(db, node_id, "offline")
            event = models.ClusterEvent(
                event_type="node_online",
                message=f"Node {node.hostname} came back ONLINE."
            )
            db.add(event)
            db.commit()
            
            # Broadcast node state change
            await ws_manager.broadcast({
                "event": "node_status_change",
                "data": {
                    "node_id": node.id,
                    "hostname": node.hostname,
                    "status": "online",
                    "timestamp": now.isoformat()
                }
            })
 
        # 5. Alert Checks
        await AlertService.check_node_metrics_thresholds(
            db, 
            node_id, 
            node.hostname, 
            payload.cpu_usage, 
            payload.memory_used, 
            payload.memory_free, 
            payload.disk_used, 
            payload.disk_free
        )
        await AlertService.check_container_crashes(db, node_id, node.hostname, payload.containers)
 
        # 6. Broadcast metrics over websocket
        broadcast_payload = {
            "event": "metrics_update",
            "data": {
                "node_id": node_id,
                "hostname": node.hostname,
                "cpu_usage": payload.cpu_usage,
                "memory_used": payload.memory_used,
                "memory_free": payload.memory_free,
                "disk_used": payload.disk_used,
                "disk_free": payload.disk_free,
                "net_send": payload.net_send,
                "net_recv": payload.net_recv,
                "uptime": node.uptime.isoformat() if node.uptime else None,
                "last_heartbeat": now.isoformat(),
                "containers": [c.model_dump() for c in payload.containers],
                # Extended V2 fields
                "total_processes": payload.total_processes,
                "total_threads": payload.total_threads,
                "running_threads": payload.running_threads,
                "sleeping_threads": payload.sleeping_threads,
                "zombies": payload.zombies,
                "detailed_metrics": payload.detailed_metrics
            }
        }
        await ws_manager.broadcast(broadcast_payload)


    @staticmethod
    async def receive_heartbeat(db: Session, node_id: str, latency_ms: float):
        """Processes a fast heartbeat validation signal and updates state."""
        node = db.query(models.Node).filter(models.Node.id == node_id).first()
        if not node:
            logger.error(f"Cannot process heartbeat: Node {node_id} not registered.")
            return

        now = datetime.datetime.utcnow()
        was_offline = node.status == "offline"
        
        node.status = "online"
        node.last_heartbeat = now
        node.latency = latency_ms
        db.commit()
        
        if was_offline:
            await AlertService.resolve_alert(db, node_id, "offline")
            event = models.ClusterEvent(
                event_type="node_online",
                message=f"Node {node.hostname} came back ONLINE."
            )
            db.add(event)
            db.commit()
            
            # Broadcast node state change
            await ws_manager.broadcast({
                "event": "node_status_change",
                "data": {
                    "node_id": node.id,
                    "hostname": node.hostname,
                    "status": "online",
                    "timestamp": now.isoformat()
                }
            })

        # Broadcast heartbeat ping
        await ws_manager.broadcast({
            "event": "heartbeat",
            "data": {
                "node_id": node_id,
                "hostname": node.hostname,
                "latency": latency_ms,
                "timestamp": now.isoformat()
            }
        })
