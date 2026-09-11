from pydantic import BaseModel
from typing import Optional


class SpendingByCategory(BaseModel):
    category: str
    total: float
    count: int
    percentage: float
    currency: str = "USD"


class MonthlyTrend(BaseModel):
    month: str
    income: float
    expenses: float
    net: float
    currency: str = "USD"


class PortfolioMetrics(BaseModel):
    total_value: float
    total_invested: float
    total_gain_loss: float
    total_gain_loss_pct: float
    day_change: float
    day_change_pct: float
    sharpe_ratio: Optional[float] = None
    volatility: Optional[float] = None
    currency: str = "USD"


class AssetAllocation(BaseModel):
    asset_type: str
    value: float
    percentage: float
    count: int


class PortfolioSnapshot(BaseModel):
    date: str
    value: float


class PortfolioHistory(BaseModel):
    snapshots: list[PortfolioSnapshot]
    period: str
    start_value: float
    end_value: float
    change: float
    change_pct: float


class NetWorthSummary(BaseModel):
    total_assets: float
    total_liabilities: float
    net_worth: float
    bank_balance: float
    investment_value: float
    currency: str = "USD"
