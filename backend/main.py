import asyncio
import logging
import socket
import datetime
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.logging import setup_logging
from app.core.database import engine, Base, SessionLocal
from app.core.redis import redis_client
from app.api.routes import router as api_router
from app.api.ws import router as ws_router

# Adapters & Services used in background loop
from app.adapters.metrics.docker_adapter import DockerSwarmAdapter
from app.services.node_service import NodeService
from app.services.alert_service import AlertService
from app.adapters.database import models
from app.domain import models as domain_schemas

# Initialize logging
setup_logging()
logger = logging.getLogger("clusterdash.main")

# Background monitoring task reference
background_monitor_task = None

async def monitor_cluster_loop():
    """Background thread runner that sweeps offline status for registered virtual nodes."""
    logger.info("Starting background cluster monitor loop...")
    while True:
        try:
            db = SessionLocal()
            try:
                # Sweep all registered virtual nodes for offline heartbeat timeouts
                await AlertService.check_offline_nodes(db)
            except Exception as loop_db_err:
                logger.error(f"Error in monitoring loop sub-execution: {loop_db_err}")
            finally:
                db.close()
        except Exception as loop_err:
            logger.error(f"Fatal error in background loop: {loop_err}")
            
        await asyncio.sleep(settings.HEARTBEAT_INTERVAL_SECONDS)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles FastAPI startup and shutdown lifecycles."""
    # 1. Initialize Postgres Database Tables
    logger.info("Initializing Postgres tables...")
    Base.metadata.create_all(bind=engine)
    
    # 2. Connect to Redis
    logger.info("Initializing Redis client...")
    redis_client.connect()
    
    # 3. Spawn background monitoring loop
    global background_monitor_task
    background_monitor_task = asyncio.create_task(monitor_cluster_loop())
    
    yield
    
    # 4. Cleanup background task
    if background_monitor_task:
        background_monitor_task.cancel()
        try:
            await background_monitor_task
        except asyncio.CancelledError:
            logger.info("Background monitor loop cancelled successfully.")

# Create FastAPI instance
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)

# CORS configuration
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Include Routers
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(ws_router)

# Define static files directory path
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../frontend/out")

# Dynamic SPA fallback exception handler for 404 errors
@app.exception_handler(404)
async def spa_fallback(request, exc):
    # If it's an API request, return normal 404 JSON
    if request.url.path.startswith("/api") or request.url.path.startswith("/ws"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    
    # Otherwise fallback to index.html for React router handles
    fallback_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(fallback_path):
        return FileResponse(fallback_path)
    return JSONResponse(status_code=404, content={"detail": "Dashboard assets not found. Please run package-offline.sh first."})

# Mount static files at / to serve the built Next.js UI dashboard
if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    logger.warning(f"Static directory '{STATIC_DIR}' does not exist. Serving API backend only.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
