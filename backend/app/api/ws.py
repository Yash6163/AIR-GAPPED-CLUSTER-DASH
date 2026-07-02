import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.ws_manager import ws_manager

logger = logging.getLogger("clusterdash.ws_api")
router = APIRouter()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for dashboard clients to receive real-time streams."""
    await ws_manager.connect(websocket)
    try:
        # Keep connection open, wait for client messages if any
        while True:
            # We don't expect many incoming messages, but we read to detect socket closure
            data = await websocket.receive_text()
            # Simple heartbeat response if client pinged
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"Error handling WebSocket client: {e}")
        ws_manager.disconnect(websocket)
