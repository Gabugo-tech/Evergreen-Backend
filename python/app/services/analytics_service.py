"""
Core analytics engine — spending analysis, portfolio metrics, trends.
All number-heavy work lives here so the Node gateway stays lean.
"""

from typing import Optional
import math
from datetime import datetime, timedelta
from collections import defaultdict

from ..core.supabase import get_supabase
from ..schemas.analytics import (
    SpendingByCategory, MonthlyTrend, PortfolioMetrics,
    AssetAllocation, PortfolioHistory, PortfolioSnapshot, NetWorthSummary,
)


class AnalyticsService:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self._sb = get_supabase()

    # ─── Spending ─────────────────────────────────────────────────────────────

    def spending_by_category(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        currency: str = "USD",
    ) -> list[SpendingByCategory]:
        query = (
            self._sb.table("transactions")
            .select("category, amount, currency")
            .eq("user_id", self.user_id)
            .eq("status", "completed")
            .lt("amount", 0)   # debits only
        )
        if from_date:
            query = query.gte("created_at", from_date)
        if to_date:
            query = query.lte("created_at", to_date + "T23:59:59")

        result = query.execute()
        rows = result.data or []

        totals: dict[str, float] = defaultdict(float)
        counts: dict[str, int]   = defaultdict(int)

        for row in rows:
            totals[row["category"]] += abs(row["amount"])
            counts[row["category"]] += 1

        grand_total = sum(totals.values()) or 1.0

        return [
            SpendingByCategory(
                category=cat,
                total=round(total, 2),
                count=counts[cat],
                percentage=round((total / grand_total) * 100, 2),
                currency=currency,
            )
            for cat, total in sorted(totals.items(), key=lambda x: -x[1])
        ]

    def monthly_trends(self, months: int = 6) -> list[MonthlyTrend]:
        since = (datetime.utcnow() - timedelta(days=months * 31)).isoformat()

        result = (
            self._sb.table("transactions")
            .select("amount, type, created_at")
            .eq("user_id", self.user_id)
            .eq("status", "completed")
            .gte("created_at", since)
            .execute()
        )
        rows = result.data or []

        monthly: dict[str, dict] = defaultdict(lambda: {"income": 0.0, "expenses": 0.0})

        for row in rows:
            month_key = row["created_at"][:7]   # "YYYY-MM"
            if row["amount"] > 0:
                monthly[month_key]["income"] += row["amount"]
            else:
                monthly[month_key]["expenses"] += abs(row["amount"])

        return [
            MonthlyTrend(
                month=month,
                income=round(data["income"], 2),
                expenses=round(data["expenses"], 2),
                net=round(data["income"] - data["expenses"], 2),
            )
            for month, data in sorted(monthly.items())
        ]

    # ─── Portfolio ────────────────────────────────────────────────────────────

    def portfolio_metrics(self) -> PortfolioMetrics:
        result = (
            self._sb.table("investments")
            .select("quantity, avg_buy_price, current_price")
            .eq("user_id", self.user_id)
            .execute()
        )
        holdings = result.data or []

        total_value    = sum(h["quantity"] * h["current_price"] for h in holdings)
        total_invested = sum(h["quantity"] * h["avg_buy_price"]  for h in holdings)
        gain_loss      = total_value - total_invested
        gain_loss_pct  = (gain_loss / total_invested * 100) if total_invested else 0.0

        # Mock daily change (in production: compare to yesterday's close)
        day_change     = total_value * 0.0143
        day_change_pct = 1.43

        # Sharpe approximation using holdings variance (simplified)
        if len(holdings) > 1:
            returns = [
                (h["current_price"] - h["avg_buy_price"]) / h["avg_buy_price"]
                for h in holdings
            ]
            mean_r   = sum(returns) / len(returns)
            variance = sum((r - mean_r) ** 2 for r in returns) / len(returns)
            vol      = math.sqrt(variance)
            sharpe   = (mean_r / vol) if vol > 0 else None
        else:
            vol, sharpe = None, None

        return PortfolioMetrics(
            total_value=round(total_value, 2),
            total_invested=round(total_invested, 2),
            total_gain_loss=round(gain_loss, 2),
            total_gain_loss_pct=round(gain_loss_pct, 2),
            day_change=round(day_change, 2),
            day_change_pct=round(day_change_pct, 2),
            sharpe_ratio=round(sharpe, 4) if sharpe is not None else None,
            volatility=round(vol, 4) if vol is not None else None,
        )

    def asset_allocation(self) -> list[AssetAllocation]:
        result = (
            self._sb.table("investments")
            .select("asset_type, quantity, current_price")
            .eq("user_id", self.user_id)
            .execute()
        )
        holdings = result.data or []

        by_type: dict[str, dict] = defaultdict(lambda: {"value": 0.0, "count": 0})
        for h in holdings:
            key = h["asset_type"]
            by_type[key]["value"] += h["quantity"] * h["current_price"]
            by_type[key]["count"] += 1

        total = sum(v["value"] for v in by_type.values()) or 1.0

        return [
            AssetAllocation(
                asset_type=atype,
                value=round(data["value"], 2),
                percentage=round(data["value"] / total * 100, 2),
                count=data["count"],
            )
            for atype, data in sorted(by_type.items(), key=lambda x: -x[1]["value"])
        ]

    def portfolio_history(self, period: str = "1Y") -> PortfolioHistory:
        """
        Returns time-series snapshots.
        In production these would come from a daily_portfolio_snapshots table.
        Here we generate plausible mock data for the given period.
        """
        now = datetime.utcnow()
        period_map = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365}
        days = period_map.get(period, 365)

        metrics = self.portfolio_metrics()
        base_value = metrics.total_value * 0.65   # approximate starting value

        snapshots = []
        interval  = max(days // 20, 1)   # ~20 data points
        for i in range(0, days + 1, interval):
            d     = now - timedelta(days=days - i)
            noise = 1 + (i / days) * 0.35 + (hash(str(d.date())) % 100 - 50) / 1000
            snapshots.append(PortfolioSnapshot(
                date=d.strftime("%b %d" if days <= 90 else "%b '%y"),
                value=round(base_value * noise, 2),
            ))

        start_val = snapshots[0].value if snapshots else 0.0
        end_val   = snapshots[-1].value if snapshots else 0.0

        return PortfolioHistory(
            snapshots=snapshots,
            period=period,
            start_value=start_val,
            end_value=end_val,
            change=round(end_val - start_val, 2),
            change_pct=round((end_val - start_val) / start_val * 100, 2) if start_val else 0.0,
        )

    # ─── Net worth ────────────────────────────────────────────────────────────

    def net_worth(self) -> NetWorthSummary:
        accounts_res = (
            self._sb.table("bank_accounts")
            .select("balance")
            .eq("user_id", self.user_id)
            .execute()
        )
        bank_balance = sum(
            float(a["balance"]) for a in (accounts_res.data or [])
        )

        pm = self.portfolio_metrics()

        return NetWorthSummary(
            total_assets=round(bank_balance + pm.total_value, 2),
            total_liabilities=0.0,   # extend when loan module is added
            net_worth=round(bank_balance + pm.total_value, 2),
            bank_balance=round(bank_balance, 2),
            investment_value=pm.total_value,
        )
