from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .core.config import get_settings
from .core.logging import configure_logging, logger
from .routers import analytics, investments, health

# ─── Init ─────────────────────────────────────────────────────────────────────
settings = get_settings()
configure_logging()

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Evergreen Analytics API starting",
        env=settings.ENVIRONMENT,
    )
    yield
    logger.info("Evergreen Analytics API shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Evergreen Analytics API — internal microservice.",
    # Disable interactive docs and schema exposure in production
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

# ─── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── Middleware ───────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-Secret"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ─── Internal secret gate ─────────────────────────────────────────────────────
# All /api/* routes must come via the Node gateway which sends X-Internal-Secret.
# This prevents direct calls to the analytics service from the internet.
@app.middleware("http")
async def require_internal_secret(request: Request, call_next):
    # Health check is exempt
    if request.url.path in ("/health", "/"):
        return await call_next(request)

    # Only enforce when INTERNAL_API_SECRET is configured (not empty)
    secret = settings.INTERNAL_API_SECRET
    if secret:
        incoming = request.headers.get("x-internal-secret", "")
        if incoming != secret:
            logger.warning(
                "blocked_direct_access",
                path=request.url.path,
                ip=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=403,
                content={"success": False, "message": "Forbidden"},
            )

    return await call_next(request)


# ─── Request logging ──────────────────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    logger.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
    )
    return response


# ─── Global exception handler ────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("unhandled_exception", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "An internal error occurred" if not settings.DEBUG else str(exc),
        },
    )


# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(analytics.router, prefix="/api")
app.include_router(investments.router, prefix="/api")
