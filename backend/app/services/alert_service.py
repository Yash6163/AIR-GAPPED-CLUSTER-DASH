import datetime
import logging
from sqlalchemy.orm import Session
from app.adapters.database import models
from app.core.config import settings
from app.services.ws_manager import ws_manager

logger = logging.getLogger("clusterdash.alert_service")

class AlertService:
    @staticmethod
    async def trigger_alert(db: Session, node_id: str, hostname: str, alert_type: str, severity: str, message: str):
        """Creates an alert record, commits to DB, and broadcasts it."""
        try:
            # Check if there is already an unresolved alert of the same type for this node
            existing = db.query(models.Alert).filter(
                models.Alert.node_id == node_id,
                models.Alert.type == alert_type,
                models.Alert.resolved == False
            ).first()
            
            if existing:
                return  # Alert already active, don't duplicate
            
            new_alert = models.Alert(
                node_id=node_id,
                type=alert_type,
                severity=severity,
                message=message,
                timestamp=datetime.datetime.utcnow(),
                resolved=False
            )
            db.add(new_alert)
            db.commit()
            db.refresh(new_alert)
            
            # Broadcast to web socket clients
            alert_payload = {
                "event": "alert_triggered",
                "data": {
                    "id": new_alert.id,
                    "node_id": node_id,
                    "node_hostname": hostname,
                    "type": alert_type,
                    "severity": severity,
                    "message": message,
                    "timestamp": new_alert.timestamp.isoformat(),
                    "resolved": False
                }
            }
            await ws_manager.broadcast(alert_payload)
            logger.warning(f"ALERT [{severity.upper()}] on node {hostname}: {message}")
        except Exception as e:
            logger.error(f"Failed to trigger alert: {e}")
            db.rollback()

    @staticmethod
    async def resolve_alert(db: Session, node_id: str, alert_type: str):
        """Resolves active alerts of a specific type on a node."""
        try:
            active_alerts = db.query(models.Alert).filter(
                models.Alert.node_id == node_id,
                models.Alert.type == alert_type,
                models.Alert.resolved == False
            ).all()
            
            for alert in active_alerts:
                alert.resolved = True
                db.commit()
                
                # Broadcast resolution
                resolve_payload = {
                    "event": "alert_resolved",
                    "data": {
                        "id": alert.id,
                        "node_id": node_id,
                        "type": alert_type,
                        "resolved": True
                    }
                }
                await ws_manager.broadcast(resolve_payload)
                logger.info(f"Resolved alert id {alert.id} ({alert_type}) on node {node_id}")
        except Exception as e:
            logger.error(f"Failed to resolve alert: {e}")
            db.rollback()

    @classmethod
    async def check_node_metrics_thresholds(cls, db: Session, node_id: str, hostname: str, cpu_usage: float, mem_used: float, mem_free: float, disk_used: float, disk_free: float):
        """Validates reported metrics against warning/critical thresholds."""
        # CPU Checks
        if cpu_usage >= settings.ALERT_CPU_THRESHOLD_PCT:
            msg = f"CPU utilization is high at {cpu_usage}% (threshold: {settings.ALERT_CPU_THRESHOLD_PCT}%)"
            await cls.trigger_alert(db, node_id, hostname, "cpu", "critical", msg)
        else:
            await cls.resolve_alert(db, node_id, "cpu")

        # RAM Checks
        total_mem = mem_used + mem_free
        if total_mem > 0:
            mem_pct = (mem_used / total_mem) * 100.0
            if mem_pct >= settings.ALERT_MEM_THRESHOLD_PCT:
                msg = f"Memory usage is critical at {mem_pct:.1f}% (threshold: {settings.ALERT_MEM_THRESHOLD_PCT}%)"
                await cls.trigger_alert(db, node_id, hostname, "memory", "critical", msg)
            else:
                await cls.resolve_alert(db, node_id, "memory")

        # Disk Checks
        total_disk = disk_used + disk_free
        if total_disk > 0:
            disk_pct = (disk_used / total_disk) * 100.0
            if disk_pct >= settings.ALERT_DISK_THRESHOLD_PCT:
                msg = f"Disk utilization is critical at {disk_pct:.1f}% (threshold: {settings.ALERT_DISK_THRESHOLD_PCT}%)"
                await cls.trigger_alert(db, node_id, hostname, "disk", "critical", msg)
            else:
                await cls.resolve_alert(db, node_id, "disk")

    @classmethod
    async def check_container_crashes(cls, db: Session, node_id: str, hostname: str, containers: list):
        """Monitors containers for unexpected exits or restart spikes."""
        has_crashes = False
        for c in containers:
            # Check for crash/exited states
            if c.status in ["exited", "dead"]:
                msg = f"Container {c.name} ({c.image}) is stopped or crashed with status '{c.status}'"
                await cls.trigger_alert(db, node_id, hostname, "container_crash", "critical", msg)
                has_crashes = True
            else:
                # Check for high restart count
                if c.restart_count > 5:
                    msg = f"Container {c.name} ({c.image}) is in a crash loop (restart count: {c.restart_count})"
                    await cls.trigger_alert(db, node_id, hostname, "container_crash", "warning", msg)
                    has_crashes = True

        if not has_crashes:
            await cls.resolve_alert(db, node_id, "container_crash")

    @classmethod
    async def check_offline_nodes(cls, db: Session):
        """Scans nodes for missing heartbeats and triggers offline alerts."""
        now = datetime.datetime.utcnow()
        timeout = datetime.timedelta(seconds=settings.NODE_OFFLINE_TIMEOUT_SECONDS)
        cutoff = now - timeout
        
        # Get nodes that are online but haven't updated in the timeout window
        stale_nodes = db.query(models.Node).filter(
            models.Node.status == "online",
            models.Node.last_heartbeat < cutoff
        ).all()
        
        for node in stale_nodes:
            node.status = "offline"
            db.commit()
            
            # Trigger offline alert
            msg = f"Node {node.hostname} (IP: {node.ip_address}) missed its heartbeat and is offline"
            await cls.trigger_alert(db, node.id, node.hostname, "offline", "critical", msg)
            
            # Broadcast node state update to clients
            status_payload = {
                "event": "node_status_change",
                "data": {
                    "node_id": node.id,
                    "hostname": node.hostname,
                    "status": "offline",
                    "timestamp": now.isoformat()
                }
            }
            await ws_manager.broadcast(status_payload)
            
            # Log cluster event
            event = models.ClusterEvent(
                event_type="node_offline",
                message=f"Node {node.hostname} transitioned to OFFLINE due to heartbeat timeout."
            )
            db.add(event)
            db.commit()
            logger.warning(f"Node {node.hostname} detected as offline.")
