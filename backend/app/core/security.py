import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

security_scheme = HTTPBearer()

def create_worker_token(node_id: str, hostname: str, role: str) -> str:
    """Generates a long-lived JWT token for registered worker nodes."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": node_id,
        "hostname": hostname,
        "role": role,
        "exp": expire
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def verify_worker_token(token: str) -> Optional[Dict[str, Any]]:
    """Verifies JWT token integrity and returns payload if valid."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None

def get_current_worker_payload(credentials: HTTPAuthorizationCredentials = Security(security_scheme)) -> Dict[str, Any]:
    """FastAPI dependency to secure worker endpoints."""
    token = credentials.credentials
    payload = verify_worker_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired worker token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload

def verify_registration_token(token: str) -> bool:
    """Verifies pre-shared worker registration token."""
    return token == settings.WORKER_REGISTRATION_TOKEN
