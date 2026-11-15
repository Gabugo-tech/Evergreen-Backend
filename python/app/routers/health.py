from datetime import datetime
from fastapi import APIRouter
from ..core.config import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
async def health():
    # Minimal response — no version or service name disclosure
    return {
        "status":    "healthy",
        "timestamp": datetime.utcnow().isoformat(),
    }
