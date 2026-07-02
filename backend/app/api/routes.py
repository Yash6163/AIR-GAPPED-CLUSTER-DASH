from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.security import get_current_worker_payload, verify_registration_token
from app.domain import models as domain_schemas
from app.adapters.database import models
from app.services.node_service import NodeService
from app.services.alert_service import AlertService

router = APIRouter()

# --- WORKER INGESTION ENDPOINTS ---

@router.post("/register", response_model=domain_schemas.NodeRegisterResponse)
async def register_node(request: domain_schemas.NodeRegisterRequest, db: Session = Depends(get_db)):
    """Registration endpoint for new worker nodes. Expects the pre-shared registration token."""
    if not verify_registration_token(request.token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid worker registration token"
        )
    return await NodeService.register_node(db, request)


@router.post("/heartbeat", status_code=status.HTTP_200_OK)
async def node_heartbeat(
    latency_ms: float = Query(0.0),
    db: Session = Depends(get_db),
    worker_payload: Dict[str, Any] = Depends(get_current_worker_payload)
):
    """Heartbeat validation endpoint for workers. Signed JWT required."""
    node_id = worker_payload.get("sub")
    await NodeService.receive_heartbeat(db, node_id, latency_ms)
    return {"status": "ok"}


@router.post("/metrics", status_code=status.HTTP_200_OK)
async def node_metrics(
    payload: domain_schemas.NodeMetricPayload,
    db: Session = Depends(get_db),
    worker_payload: Dict[str, Any] = Depends(get_current_worker_payload)
):
    """Metrics upload endpoint for workers. Signed JWT required."""
    node_id = worker_payload.get("sub")
    await NodeService.ingest_metrics(db, node_id, payload)
    return {"status": "ok"}


# --- DASHBOARD CONSUMER ENDPOINTS ---

@router.get("/cluster", response_model=domain_schemas.ClusterOverviewResponse)
def get_cluster_overview(db: Session = Depends(get_db)):
    """Computes aggregate cluster stats across all nodes."""
    nodes = db.query(models.Node).all()
    
    total_nodes = len(nodes)
    online_nodes = sum(1 for n in nodes if n.status == "online")
    offline_nodes = total_nodes - online_nodes
    manager_nodes = sum(1 for n in nodes if n.role == "manager")
    worker_nodes = sum(1 for n in nodes if n.role == "worker")
    
    total_cpu = sum(n.cpu_cores for n in nodes)
    total_mem = sum(n.total_memory for n in nodes)
    
    # Calculate status based on ratio of online nodes and open alerts
    active_critical_alerts = db.query(models.Alert).filter(
        models.Alert.resolved == False,
        models.Alert.severity == "critical"
    ).count()
    
    if online_nodes == 0:
        cluster_status = "degraded"
    elif offline_nodes > 0 or active_critical_alerts > 0:
        cluster_status = "warning"
    else:
        cluster_status = "healthy"
        
    return domain_schemas.ClusterOverviewResponse(
        total_nodes=total_nodes,
        online_nodes=online_nodes,
        offline_nodes=offline_nodes,
        manager_nodes=manager_nodes,
        worker_nodes=worker_nodes,
        total_cpu_cores=total_cpu,
        total_memory=total_mem,
        status=cluster_status
    )


@router.get("/nodes", response_model=List[domain_schemas.NodeResponse])
def get_nodes(db: Session = Depends(get_db)):
    """Lists all registered nodes in the database."""
    return db.query(models.Node).all()


@router.get("/nodes/{node_id}", response_model=domain_schemas.NodeResponse)
def get_node_by_id(node_id: str, db: Session = Depends(get_db)):
    """Retrieves metadata of a specific node."""
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.get("/containers")
def get_containers(db: Session = Depends(get_db)):
    """Gathers the latest container states from all online nodes by querying container history logs."""
    # Find active nodes
    active_nodes = db.query(models.Node).filter(models.Node.status == "online").all()
    active_node_ids = [n.id for n in active_nodes]
    
    if not active_node_ids:
        return []
        
    # We fetch the latest recorded status for each container.
    # Grouping logic using a subquery
    results = []
    for node in active_nodes:
        # Get distinct container IDs reported in the last 20 seconds for this node
        cutoff = datetime.utcnow() - timedelta(seconds=20)
        latest_records = db.query(models.ContainerHistory).filter(
            models.ContainerHistory.node_id == node.id,
            models.ContainerHistory.timestamp >= cutoff
        ).order_by(models.ContainerHistory.timestamp.desc()).all()
        
        # Deduplicate to show only the newest status per container
        seen = set()
        for record in latest_records:
            if record.container_id not in seen:
                seen.add(record.container_id)
                results.append({
                    "container_id": record.container_id,
                    "name": record.name,
                    "image": record.image,
                    "status": record.status,
                    "cpu_usage": record.cpu_usage,
                    "memory_usage": record.memory_usage,
                    "restart_count": record.restart_count,
                    "node_id": node.id,
                    "node_hostname": node.hostname,
                    "timestamp": record.timestamp.isoformat()
                })
    return results


@router.get("/alerts", response_model=List[domain_schemas.AlertResponse])
def get_alerts(
    unresolved_only: bool = Query(True), 
    limit: int = Query(50), 
    db: Session = Depends(get_db)
):
    """Retrieves node alerts, sorted by newest first."""
    query = db.query(models.Alert)
    if unresolved_only:
        query = query.filter(models.Alert.resolved == False)
    
    alerts = query.order_by(models.Alert.timestamp.desc()).limit(limit).all()
    
    # Enrich with hostnames
    enriched_alerts = []
    for a in alerts:
        node = db.query(models.Node).filter(models.Node.id == a.node_id).first()
        enriched_alerts.append(
            domain_schemas.AlertResponse(
                id=a.id,
                node_id=a.node_id,
                node_hostname=node.hostname if node else "unknown",
                type=a.type,
                severity=a.severity,
                message=a.message,
                timestamp=a.timestamp,
                resolved=a.resolved
            )
        )
    return enriched_alerts


@router.get("/history")
def get_node_history(
    node_id: str,
    limit: int = Query(30),
    db: Session = Depends(get_db)
):
    """Retrieves metric records for drawing timeseries charts."""
    history = db.query(models.MetricHistory).filter(
        models.MetricHistory.node_id == node_id
    ).order_by(models.MetricHistory.timestamp.desc()).limit(limit).all()
    
    # Reverse to return chronological order (oldest to newest) for Recharts
    history.reverse()
    
    return [
        domain_schemas.MetricHistoryItem.model_validate(item)
        for item in history
    ]


# --- V2 PROTOTYPE NEW APIS ---

@router.get("/os/{os_name}")
def get_os_cluster_stats(os_name: str, db: Session = Depends(get_db)):
    """Computes aggregate stats for nodes of a specific OS ('windows' or 'mac')."""
    # Normalize OS names
    db_os = "darwin" if os_name.lower() in ["mac", "macos", "darwin"] else "windows"
    
    nodes = db.query(models.Node).filter(models.Node.os == db_os).all()
    
    total_nodes = len(nodes)
    if total_nodes == 0:
        return {
            "total_nodes": 0,
            "online_nodes": 0,
            "offline_nodes": 0,
            "cpu_avg": 0.0,
            "ram_avg": 0.0,
            "storage_usage": 0.0,
            "last_heartbeat": None
        }
        
    online_nodes = sum(1 for n in nodes if n.status == "online")
    offline_nodes = total_nodes - online_nodes
    
    cpu_sum = 0.0
    ram_pct_sum = 0.0
    disk_pct_sum = 0.0
    num_online = 0
    
    for n in nodes:
        if n.status == "online":
            num_online += 1
            # Retrieve latest MetricHistory
            latest_history = db.query(models.MetricHistory).filter(
                models.MetricHistory.node_id == n.id
            ).order_by(models.MetricHistory.timestamp.desc()).first()
            
            if latest_history:
                cpu_sum += latest_history.cpu_usage
                total_mem = latest_history.memory_used + latest_history.memory_free
                ram_pct_sum += (latest_history.memory_used / total_mem * 100.0) if total_mem > 0 else 0.0
                total_disk = latest_history.disk_used + latest_history.disk_free
                disk_pct_sum += (latest_history.disk_used / total_disk * 100.0) if total_disk > 0 else 0.0
            
    cpu_avg = round(cpu_sum / max(1, num_online), 1)
    ram_avg = round(ram_pct_sum / max(1, num_online), 1)
    disk_avg = round(disk_pct_sum / max(1, num_online), 1)
    
    heartbeats = [n.last_heartbeat for n in nodes if n.last_heartbeat]
    last_hb = max(heartbeats).isoformat() if heartbeats else None
    
    return {
        "total_nodes": total_nodes,
        "online_nodes": online_nodes,
        "offline_nodes": offline_nodes,
        "cpu_avg": cpu_avg,
        "ram_avg": ram_avg,
        "storage_usage": disk_avg,
        "last_heartbeat": last_hb
    }


@router.get("/node/{node_id}")
def get_detailed_node(node_id: str, db: Session = Depends(get_db)):
    """Retrieves full detailed info of a node, including system info and detailed metrics."""
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return {
        "id": node.id,
        "hostname": node.hostname,
        "ip_address": node.ip_address,
        "role": node.role,
        "status": node.status,
        "os": node.os,
        "kernel": node.kernel,
        "arch": node.arch,
        "docker_version": node.docker_version,
        "cpu_cores": node.cpu_cores,
        "total_memory": node.total_memory,
        "uptime": node.uptime.isoformat() if node.uptime else None,
        "last_heartbeat": node.last_heartbeat.isoformat() if node.last_heartbeat else None,
        "latency": node.latency,
        "container_id": node.container_id,
        "system_info": node.system_info,
        "detailed_metrics": node.detailed_metrics
    }


@router.get("/node/{node_id}/threads")
def get_node_processes_and_threads(node_id: str, db: Session = Depends(get_db)):
    """Retrieves real-time process and thread lists from the database."""
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
        
    processes = db.query(models.ProcessMetric).filter(
        models.ProcessMetric.node_id == node_id
    ).order_by(models.ProcessMetric.cpu_usage.desc()).all()
    
    total_processes = len(processes)
    total_threads = sum(p.threads_count for p in processes)
    
    running_threads = sum(p.threads_count for p in processes if p.status.lower() in ["running", "run"])
    sleeping_threads = sum(p.threads_count for p in processes if p.status.lower() in ["sleeping", "sleep"])
    zombies = sum(1 for p in processes if p.status.lower() in ["zombie", "zomb"])
    
    return {
        "total_processes": total_processes,
        "total_threads": total_threads,
        "running_threads": running_threads,
        "sleeping_threads": sleeping_threads,
        "zombies": zombies,
        "processes": [
            {
                "pid": p.pid,
                "name": p.name,
                "threads": p.threads_count,
                "cpu": p.cpu_usage,
                "memory": p.memory_usage,
                "status": p.status,
                "parent_pid": p.parent_pid,
                "thread_ids": p.thread_ids.split(",") if p.thread_ids else []
            }
            for p in processes
        ]
    }


@router.get("/database/tables")
def get_database_tables():
    """Returns a list of human-readable and raw database tables in the application."""
    return [
        {"name": "Nodes", "table": "nodes", "description": "Registered node hardware & specifications"},
        {"name": "Metrics", "table": "metric_history", "description": "Timeseries history of CPU, memory, and disk usage"},
        {"name": "Containers", "table": "container_history", "description": "Docker container statuses and metric streams"},
        {"name": "Alerts", "table": "alerts", "description": "System-wide and node threshold alarms"},
        {"name": "Heartbeats & Events", "table": "cluster_events", "description": "Historical registration and status change logs"},
        {"name": "Processes", "table": "process_metrics", "description": "Real-time process details and thread counts"}
    ]


@router.get("/database/explorer/{table_name}")
def get_database_table_data(
    table_name: str,
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Enables lightweight read-only database query grid for any given table."""
    model_map = {
        "nodes": models.Node,
        "metric_history": models.MetricHistory,
        "container_history": models.ContainerHistory,
        "alerts": models.Alert,
        "cluster_events": models.ClusterEvent,
        "process_metrics": models.ProcessMetric
    }
    
    if table_name not in model_map:
        raise HTTPException(status_code=404, detail="Table not found")
        
    model = model_map[table_name]
    query = db.query(model)
    
    # Apply text search across applicable string columns
    if search:
        search_filter = []
        for col in model.__table__.columns:
            if str(col.type).upper().startswith("VARCHAR") or str(col.type).upper().startswith("TEXT"):
                search_filter.append(col.ilike(f"%{search}%"))
        if search_filter:
            from sqlalchemy import or_
            query = query.filter(or_(*search_filter))
            
    # Sorting
    if sort_by and hasattr(model, sort_by):
        sort_col = getattr(model, sort_by)
        if sort_desc:
            query = query.order_by(sort_col.desc())
        else:
            query = query.order_by(sort_col.asc())
    else:
        # Default sorting
        if hasattr(model, "id"):
            query = query.order_by(model.id.desc())
        elif hasattr(model, "timestamp"):
            query = query.order_by(model.timestamp.desc())
            
    total_count = query.count()
    offset = (page - 1) * page_size
    records = query.offset(offset).limit(page_size).all()
    
    data = []
    for r in records:
        row = {}
        for col in r.__table__.columns.keys():
            val = getattr(r, col)
            if isinstance(val, datetime):
                row[col] = val.isoformat()
            else:
                row[col] = val
        data.append(row)
        
    columns = [{"field": col.name, "type": str(col.type)} for col in model.__table__.columns]
    
    return {
        "columns": columns,
        "rows": data,
        "total": total_count,
        "page": page,
        "page_size": page_size
    }


import csv
import io
from fastapi.responses import StreamingResponse

@router.get("/database/export")
def export_table_csv(table: str, db: Session = Depends(get_db)):
    """Generates a downloadable CSV streaming response for a database table."""
    model_map = {
        "nodes": models.Node,
        "metric_history": models.MetricHistory,
        "container_history": models.ContainerHistory,
        "alerts": models.Alert,
        "cluster_events": models.ClusterEvent,
        "process_metrics": models.ProcessMetric
    }
    
    if table not in model_map:
        raise HTTPException(status_code=404, detail="Table not found")
        
    model = model_map[table]
    records = db.query(model).all()
    
    columns = [col.name for col in model.__table__.columns]
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(columns)
    
    def csv_generator():
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
        
        for r in records:
            row = []
            for col in columns:
                val = getattr(r, col)
                if isinstance(val, datetime):
                    row.append(val.isoformat())
                else:
                    row.append(val)
            writer.writerow(row)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
            
    response = StreamingResponse(csv_generator(), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename={table}_export.csv"
    return response

