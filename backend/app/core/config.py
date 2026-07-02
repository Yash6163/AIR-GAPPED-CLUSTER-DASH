import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    PROJECT_NAME: str = "ClusterDash API"
    API_V1_STR: str = "/api/v1"
    
    # Security
    SECRET_KEY: str = Field(default="super-secret-clusterdash-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # Long lived for workers (30 days)
    
    # Registration token for new workers
    WORKER_REGISTRATION_TOKEN: str = Field(default="clusterdash-worker-secret-token")
    
    # Databases
    POSTGRES_SERVER: str = Field(default="localhost")
    POSTGRES_USER: str = Field(default="postgres")
    POSTGRES_PASSWORD: str = Field(default="postgres")
    POSTGRES_DB: str = Field(default="clusterdash")
    POSTGRES_PORT: str = Field(default="5432")
    
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
    
    REDIS_HOST: str = Field(default="localhost")
    REDIS_PORT: int = Field(default=6379)
    REDIS_DB: int = Field(default=0)
    REDIS_PASSWORD: str = Field(default="")
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]
    
    # Alert Thresholds
    ALERT_CPU_THRESHOLD_PCT: float = 85.0
    ALERT_MEM_THRESHOLD_PCT: float = 90.0
    ALERT_DISK_THRESHOLD_PCT: float = 90.0
    
    # Heartbeat Settings
    NODE_OFFLINE_TIMEOUT_SECONDS: int = 15  # Marks node offline if no heartbeat in 15 seconds
    HEARTBEAT_INTERVAL_SECONDS: int = 5
    
    # Environment
    ENV: str = Field(default="development")
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
