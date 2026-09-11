from typing import Optional
from fastapi import APIRouter, Depends, Query
from ..core.security import get_current_user
from ..services.analytics_service import AnalyticsService
from ..schemas.analytics import (
    SpendingByCategory, MonthlyTrend, PortfolioMetrics,
    AssetAllocation, PortfolioHistory, NetWorthSummary,
)
from ..schemas.common import APIResponse

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _svc(user=Depends(get_current_user)) -> AnalyticsService:
    return AnalyticsService(user["id"])


@router.get("/spending/categories", response_model=APIResponse[list[SpendingByCategory]])
async def spending_by_category(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date:   Optional[str] = Query(None, alias="to"),
    currency:  str = Query("USD"),
    svc: AnalyticsService = Depends(_svc),
):
    """Spending breakdown by category."""
    data = svc.spending_by_category(from_date, to_date, currency)
    return APIResponse(data=data, message=f"{len(data)} categories")


@router.get("/spending/trends", response_model=APIResponse[list[MonthlyTrend]])
async def monthly_trends(
    months: int = Query(6, ge=1, le=24),
    svc: AnalyticsService = Depends(_svc),
):
    """Month-over-month income vs. spending trends."""
    data = svc.monthly_trends(months)
    return APIResponse(data=data)


@router.get("/portfolio/metrics", response_model=APIResponse[PortfolioMetrics])
async def portfolio_metrics(svc: AnalyticsService = Depends(_svc)):
    """Total return, day change, Sharpe ratio, volatility."""
    return APIResponse(data=svc.portfolio_metrics())


@router.get("/portfolio/allocation", response_model=APIResponse[list[AssetAllocation]])
async def asset_allocation(svc: AnalyticsService = Depends(_svc)):
    """Portfolio breakdown by asset type."""
    return APIResponse(data=svc.asset_allocation())


@router.get("/portfolio/history", response_model=APIResponse[PortfolioHistory])
async def portfolio_history(
    period: str = Query("1Y", pattern="^(1M|3M|6M|1Y)$"),
    svc: AnalyticsService = Depends(_svc),
):
    """Time-series portfolio value for charting."""
    return APIResponse(data=svc.portfolio_history(period))


@router.get("/net-worth", response_model=APIResponse[NetWorthSummary])
async def net_worth(svc: AnalyticsService = Depends(_svc)):
    """Combined bank + investment net worth summary."""
    return APIResponse(data=svc.net_worth())
