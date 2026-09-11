from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from ..core.security import get_current_user
from ..core.supabase import get_supabase
from ..schemas.common import APIResponse, PaginatedResponse, PaginationMeta

router = APIRouter(prefix="/investments", tags=["investments"])


class HoldingCreate(BaseModel):
    symbol:     str
    name:       str
    asset_type: str   # stock | etf | crypto | bond | mutual_fund
    quantity:   float
    avg_buy_price: float
    current_price: float
    currency:   str = "USD"


class HoldingUpdate(BaseModel):
    quantity:      Optional[float] = None
    avg_buy_price: Optional[float] = None
    current_price: Optional[float] = None


@router.get("/", response_model=APIResponse[list[dict]])
async def list_holdings(user=Depends(get_current_user)):
    sb = get_supabase()
    res = sb.table("investments").select("*").eq("user_id", user["id"]).execute()
    return APIResponse(data=res.data or [])


@router.post("/", response_model=APIResponse[dict], status_code=201)
async def add_holding(body: HoldingCreate, user=Depends(get_current_user)):
    sb  = get_supabase()
    row = body.model_dump()
    row["user_id"] = user["id"]
    row["market_value"] = round(body.quantity * body.current_price, 2)
    row["gain_loss"]    = round((body.current_price - body.avg_buy_price) * body.quantity, 2)
    row["gain_loss_pct"]= round(
        (body.current_price - body.avg_buy_price) / body.avg_buy_price * 100, 2
    ) if body.avg_buy_price else 0.0

    res = sb.table("investments").insert(row).select().execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create holding")
    return APIResponse(data=res.data[0], message="Holding added", )


@router.get("/{holding_id}", response_model=APIResponse[dict])
async def get_holding(holding_id: str, user=Depends(get_current_user)):
    sb  = get_supabase()
    res = (
        sb.table("investments")
        .select("*")
        .eq("id", holding_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Holding not found")
    return APIResponse(data=res.data[0])


@router.patch("/{holding_id}", response_model=APIResponse[dict])
async def update_holding(
    holding_id: str, body: HoldingUpdate, user=Depends(get_current_user)
):
    sb      = get_supabase()
    updates = body.model_dump(exclude_none=True)
    res     = (
        sb.table("investments")
        .update(updates)
        .eq("id", holding_id)
        .eq("user_id", user["id"])
        .select()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Holding not found")
    return APIResponse(data=res.data[0], message="Holding updated")


@router.delete("/{holding_id}", response_model=APIResponse[None])
async def delete_holding(holding_id: str, user=Depends(get_current_user)):
    sb = get_supabase()
    sb.table("investments").delete().eq("id", holding_id).eq("user_id", user["id"]).execute()
    return APIResponse(data=None, message="Holding removed")
