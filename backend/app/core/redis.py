import redis
import logging
from app.core.config import settings

logger = logging.getLogger("clusterdash.redis")

class RedisClient:
    def __init__(self):
        self.client = None
        
    def connect(self):
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
        except redis.ConnectionError as e:
            logger.error(f"Could not connect to Redis: {e}")
            self.client = None

    def get_client(self) -> redis.Redis:
        if not self.client:
            self.connect()
        return self.client

    def is_rate_limited(self, key: str, limit: int, period_seconds: int) -> bool:
        """Simple rate limiter using Redis keys."""
        r = self.get_client()
        if not r:
            # If Redis is unavailable, don't block the API, just allow
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
