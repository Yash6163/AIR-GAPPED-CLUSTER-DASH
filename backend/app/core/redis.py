try:
    import redis
except ImportError:
    redis = None

import logging
import time
from app.core.config import settings

logger = logging.getLogger("clusterdash.redis")

class RedisClient:
    def __init__(self):
        self.client = None
        self._memory_limits = {}  # In-memory rate limiter fallback
        
    def connect(self):
        if redis is None:
            logger.info("Redis package is not installed. Caching/rate limiting will run in-memory.")
            self.client = None
            return
            
        try:
            self.client = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                db=settings.REDIS_DB,
                password=settings.REDIS_PASSWORD or None,
                decode_responses=True,
                socket_timeout=5
            )
            # Test connection
            self.client.ping()
            logger.info("Connected successfully to Redis.")
        except Exception as e:
            logger.warning(f"Could not connect to Redis: {e}. Falling back to in-memory caching.")
            self.client = None

    def get_client(self):
        if redis is None:
            return None
        if not self.client:
            self.connect()
        return self.client

    def is_rate_limited(self, key: str, limit: int, period_seconds: int) -> bool:
        """Simple rate limiter using Redis, falling back to in-memory dict."""
        r = self.get_client()
        if not r:
            # Clean up expired in-memory items
            now = time.time()
            self._memory_limits = {k: v for k, v in self._memory_limits.items() if v["expires"] > now}
            
            if key in self._memory_limits:
                record = self._memory_limits[key]
                if record["count"] >= limit:
                    return True
                record["count"] += 1
            else:
                self._memory_limits[key] = {
                    "count": 1,
                    "expires": now + period_seconds
                }
            return False
        
        try:
            current = r.get(key)
            if current and int(current) >= limit:
                return True
            
            pipe = r.pipeline()
            pipe.incr(key)
            if not current:
                pipe.expire(key, period_seconds)
            pipe.execute()
            return False
        except Exception as e:
            logger.error(f"Rate limiting check failed: {e}")
            return False

redis_client = RedisClient()
