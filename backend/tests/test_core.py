import pytest
from app.core.security import create_worker_token, verify_worker_token, verify_registration_token
from app.core.config import settings

def test_registration_token_verification():
    # True for valid default token
    assert verify_registration_token(settings.WORKER_REGISTRATION_TOKEN) is True
    # False for invalid token
    assert verify_registration_token("wrong-token-value") is False

def test_jwt_token_flow():
    node_id = "node-test-123"
    hostname = "worker-node-1"
    role = "worker"
    
    # 1. Create token
    token = create_worker_token(node_id, hostname, role)
    assert token is not None
    assert isinstance(token, str)
    
    # 2. Verify token
    payload = verify_worker_token(token)
    assert payload is not None
    assert payload["sub"] == node_id
    assert payload["hostname"] == hostname
    assert payload["role"] == role

def test_jwt_invalid_token():
    # Verify mock garbage token returns None rather than raising exceptions
    payload = verify_worker_token("invalid.jwt.token.here")
    assert payload is None
