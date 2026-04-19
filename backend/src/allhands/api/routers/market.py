"""Market REST endpoints — spec § 6.2.

The poller is a process-scoped singleton kept on ``app.state`` so CRUD
routers share one MarketService/MarketPoller pair across requests. This
avoids the need to extend ``api/app.py`` lifespan (Wave 2 strict-add).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — FastAPI runtime dependency resolution
)

from allhands.api.deps import get_session
from allhands.core.market import (
    Bar,
    Holding,
    Interval,
    MarketAnomalyEvent,
    NewsItem,
    PollerThresholds,
    Quote,
    ScreenCriteria,
    Symbol,
    WatchedSymbol,
)
from allhands.execution.market import build_default_router
from allhands.execution.market.poller import MarketPoller
from allhands.persistence.market_repos import (
    SqlHoldingRepo,
    SqlNewsRepo,
    SqlSnapshotRepo,
    SqlWatchedSymbolRepo,
)
from allhands.services.market_service import HoldingNotFoundError, MarketService

if TYPE_CHECKING:
    from allhands.execution.market.router import MarketDataRouter
    from allhands.execution.triggers.runtime import TriggerRuntime


router = APIRouter(prefix="/market", tags=["market"])


# ---------------------------------------------------------------------
# Shared poller/router wiring — owned by app.state so REST requests see
# the same poller instance across calls.
# ---------------------------------------------------------------------


def _get_market_state(request: Request) -> dict[str, Any]:
    state = getattr(request.app.state, "market_state", None)
    if state is None:
        state = {"router": build_default_router(), "poller": None, "thresholds": PollerThresholds()}
        request.app.state.market_state = state
    return state


def _get_trigger_runtime(request: Request) -> TriggerRuntime | None:
    return getattr(request.app.state, "trigger_runtime", None)


async def _market_service_for(
    session: AsyncSession,
    request: Request,
) -> MarketService:
    state = _get_market_state(request)
    router_: MarketDataRouter = state["router"]
    svc = MarketService(
        router=router_,
        watched_repo=SqlWatchedSymbolRepo(session),
        holding_repo=SqlHoldingRepo(session),
        snapshot_repo=SqlSnapshotRepo(session),
        news_repo=SqlNewsRepo(session),
        thresholds=state["thresholds"],
    )
    poller: MarketPoller | None = state.get("poller")
    if poller is not None:
        svc.attach_poller(poller)
    return svc


async def _dep_market_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MarketService:
    return await _market_service_for(session, request)


# ---------------------------------------------------------------------
# Pydantic wire shapes (decouple API from core Decimal field types for JSON)
# ---------------------------------------------------------------------


class QuoteBody(BaseModel):
    symbol: str
    last: float
    change: float
    change_pct: float
    open: float | None = None
    high: float | None = None
    low: float | None = None
    prev_close: float | None = None
    volume: int | None = None
    turnover: float | None = None
    ts: str
    source: str

    @classmethod
    def from_domain(cls, q: Quote) -> QuoteBody:
        return cls(
            symbol=q.symbol,
            last=float(q.last),
            change=float(q.change),
            change_pct=float(q.change_pct),
            open=float(q.open) if q.open is not None else None,
            high=float(q.high) if q.high is not None else None,
            low=float(q.low) if q.low is not None else None,
            prev_close=float(q.prev_close) if q.prev_close is not None else None,
            volume=q.volume,
            turnover=float(q.turnover) if q.turnover is not None else None,
            ts=q.ts.isoformat(),
            source=q.source,
        )


class BarBody(BaseModel):
    symbol: str
    interval: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    ts: str

    @classmethod
    def from_domain(cls, b: Bar) -> BarBody:
        return cls(
            symbol=b.symbol,
            interval=b.interval,
            open=float(b.open),
            high=float(b.high),
            low=float(b.low),
            close=float(b.close),
            volume=b.volume,
            ts=b.ts.isoformat(),
        )


class NewsBody(BaseModel):
    id: str
    symbol: str | None
    title: str
    summary: str
    url: str
    published_at: str
    source: str
    kind: str

    @classmethod
    def from_domain(cls, n: NewsItem) -> NewsBody:
        return cls(
            id=n.id,
            symbol=n.symbol,
            title=n.title,
            summary=n.summary,
            url=n.url,
            published_at=n.published_at.isoformat(),
            source=n.source,
            kind=n.kind,
        )


class SymbolBody(BaseModel):
    code: str
    exchange: str
    name: str

    @classmethod
    def from_domain(cls, s: Symbol) -> SymbolBody:
        return cls(code=s.code, exchange=s.exchange.value, name=s.name)


class WatchedBody(BaseModel):
    id: str
    symbol: str
    name: str
    tag: str | None
    added_at: str

    @classmethod
    def from_domain(cls, w: WatchedSymbol) -> WatchedBody:
        return cls(
            id=w.id,
            symbol=w.symbol,
            name=w.name,
            tag=w.tag,
            added_at=w.added_at.isoformat(),
        )


class HoldingBody(BaseModel):
    id: str
    symbol: str
    name: str
    quantity: int
    avg_cost: float
    opened_at: str | None
    notes: str | None

    @classmethod
    def from_domain(cls, h: Holding) -> HoldingBody:
        return cls(
            id=h.id,
            symbol=h.symbol,
            name=h.name,
            quantity=h.quantity,
            avg_cost=float(h.avg_cost),
            opened_at=h.opened_at.isoformat() if h.opened_at else None,
            notes=h.notes,
        )


class AddWatchRequest(BaseModel):
    symbol: str
    name: str
    tag: str | None = None


class AddHoldingRequest(BaseModel):
    symbol: str
    name: str
    quantity: int = Field(ge=0)
    avg_cost: float
    opened_at: str | None = None
    notes: str | None = None


class UpdateHoldingRequest(BaseModel):
    quantity: int | None = Field(default=None, ge=0)
    avg_cost: float | None = None
    notes: str | None = None


class QuoteBatchRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=50)


class ScreenRequest(BaseModel):
    pe_lt: float | None = None
    pe_gt: float | None = None
    pb_lt: float | None = None
    turnover_mean_lt: float | None = None
    revenue_yoy_gt: float | None = None
    tags: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=500)


class ThresholdsBody(BaseModel):
    sudden_spike_pct: float = 2.0
    sudden_drop_pct: float = -2.0
    crash_pct: float = -8.0
    limit_up_pct: float = 10.0
    volume_spike_sigma: float = 3.0
    window_seconds: int = 60

    def to_domain(self) -> PollerThresholds:
        return PollerThresholds(
            sudden_spike_pct=Decimal(str(self.sudden_spike_pct)),
            sudden_drop_pct=Decimal(str(self.sudden_drop_pct)),
            crash_pct=Decimal(str(self.crash_pct)),
            limit_up_pct=Decimal(str(self.limit_up_pct)),
            volume_spike_sigma=Decimal(str(self.volume_spike_sigma)),
            window_seconds=self.window_seconds,
        )


class PollerStatusBody(BaseModel):
    running: bool
    last_tick_at: str | None
    thresholds: ThresholdsBody


class AnomalyEventBody(BaseModel):
    symbol: str
    symbol_name: str
    kind: str
    from_price: float
    to_price: float
    change_pct: float
    window_s: int
    severity: str
    detected_at: str

    @classmethod
    def from_domain(cls, e: MarketAnomalyEvent) -> AnomalyEventBody:
        return cls(
            symbol=e.symbol,
            symbol_name=e.symbol_name,
            kind=e.kind,
            from_price=float(e.from_price),
            to_price=float(e.to_price),
            change_pct=float(e.change_pct),
            window_s=e.window_s,
            severity=e.severity,
            detected_at=e.detected_at.isoformat(),
        )


# ---------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------


@router.get("/quote/{symbol}", response_model=QuoteBody)
async def get_quote(
    symbol: str,
    svc: MarketService = Depends(_dep_market_service),
) -> QuoteBody:
    try:
        quote = await svc.get_quote(symbol)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return QuoteBody.from_domain(quote)


@router.post("/quotes", response_model=dict[str, QuoteBody])
async def get_quote_batch(
    body: QuoteBatchRequest,
    svc: MarketService = Depends(_dep_market_service),
) -> dict[str, QuoteBody]:
    quotes = await svc.get_quote_batch(body.symbols)
    return {sym: QuoteBody.from_domain(q) for sym, q in quotes.items()}


@router.get("/bars/{symbol}", response_model=list[BarBody])
async def get_bars(
    symbol: str,
    interval: Interval = Query("1d"),
    start: str | None = None,
    end: str | None = None,
    svc: MarketService = Depends(_dep_market_service),
) -> list[BarBody]:
    start_dt = datetime.fromisoformat(start) if start else None
    end_dt = datetime.fromisoformat(end) if end else None
    bars = await svc.get_bars(symbol, interval, start=start_dt, end=end_dt)
    return [BarBody.from_domain(b) for b in bars]


@router.get("/news", response_model=list[NewsBody])
async def get_news(
    symbol: str | None = None,
    since: str | None = None,
    limit: int = 50,
    svc: MarketService = Depends(_dep_market_service),
) -> list[NewsBody]:
    since_dt = datetime.fromisoformat(since) if since else None
    items = await svc.get_news(symbol, since=since_dt, limit=limit)
    return [NewsBody.from_domain(n) for n in items]


@router.get("/announcements", response_model=list[NewsBody])
async def get_announcements(
    symbol: str,
    since: str | None = None,
    limit: int = 50,
    svc: MarketService = Depends(_dep_market_service),
) -> list[NewsBody]:
    since_dt = datetime.fromisoformat(since) if since else None
    items = await svc.get_announcements(symbol, since=since_dt, limit=limit)
    return [
        NewsBody(
            id=a.id,
            symbol=a.symbol,
            title=a.title,
            summary=a.summary or "",
            url=a.url,
            published_at=a.published_at.isoformat(),
            source=a.kind,
            kind="announcement",
        )
        for a in items
    ]


@router.get("/search", response_model=list[SymbolBody])
async def search(
    q: str,
    limit: int = 10,
    svc: MarketService = Depends(_dep_market_service),
) -> list[SymbolBody]:
    items = await svc.search(q, limit=limit)
    return [SymbolBody.from_domain(s) for s in items]


@router.post("/screen", response_model=list[SymbolBody])
async def screen(
    body: ScreenRequest,
    svc: MarketService = Depends(_dep_market_service),
) -> list[SymbolBody]:
    criteria = ScreenCriteria(
        pe_lt=Decimal(str(body.pe_lt)) if body.pe_lt is not None else None,
        pe_gt=Decimal(str(body.pe_gt)) if body.pe_gt is not None else None,
        pb_lt=Decimal(str(body.pb_lt)) if body.pb_lt is not None else None,
        turnover_mean_lt=(
            Decimal(str(body.turnover_mean_lt)) if body.turnover_mean_lt is not None else None
        ),
        revenue_yoy_gt=(
            Decimal(str(body.revenue_yoy_gt)) if body.revenue_yoy_gt is not None else None
        ),
        tags=body.tags,
        limit=body.limit,
    )
    items = await svc.screen(criteria)
    return [SymbolBody.from_domain(s) for s in items]


# ---------------------------------------------------------------------
# Watched
# ---------------------------------------------------------------------


@router.get("/watched", response_model=list[WatchedBody])
async def list_watched(
    svc: MarketService = Depends(_dep_market_service),
) -> list[WatchedBody]:
    items = await svc.list_watched()
    return [WatchedBody.from_domain(w) for w in items]


@router.post("/watched", response_model=WatchedBody, status_code=201)
async def add_watched(
    body: AddWatchRequest,
    svc: MarketService = Depends(_dep_market_service),
) -> WatchedBody:
    w = await svc.add_watch(body.symbol, name=body.name, tag=body.tag)
    return WatchedBody.from_domain(w)


@router.delete("/watched/{symbol}", status_code=204)
async def delete_watched(
    symbol: str,
    svc: MarketService = Depends(_dep_market_service),
) -> None:
    await svc.remove_watch(symbol)


# ---------------------------------------------------------------------
# Holdings
# ---------------------------------------------------------------------


@router.get("/holdings", response_model=list[HoldingBody])
async def list_holdings(
    svc: MarketService = Depends(_dep_market_service),
) -> list[HoldingBody]:
    items = await svc.list_holdings()
    return [HoldingBody.from_domain(h) for h in items]


@router.post("/holdings", response_model=HoldingBody, status_code=201)
async def add_holding(
    body: AddHoldingRequest,
    svc: MarketService = Depends(_dep_market_service),
) -> HoldingBody:
    opened: datetime | None = None
    if body.opened_at:
        opened = datetime.fromisoformat(body.opened_at)
    h = await svc.add_holding(
        symbol=body.symbol,
        name=body.name,
        quantity=body.quantity,
        avg_cost=Decimal(str(body.avg_cost)),
        opened_at=opened,
        notes=body.notes,
    )
    return HoldingBody.from_domain(h)


@router.patch("/holdings/{symbol}", response_model=HoldingBody)
async def update_holding(
    symbol: str,
    body: UpdateHoldingRequest,
    svc: MarketService = Depends(_dep_market_service),
) -> HoldingBody:
    try:
        h = await svc.update_holding(
            symbol,
            quantity=body.quantity,
            avg_cost=Decimal(str(body.avg_cost)) if body.avg_cost is not None else None,
            notes=body.notes,
        )
    except HoldingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return HoldingBody.from_domain(h)


@router.delete("/holdings/{symbol}", status_code=204)
async def delete_holding(
    symbol: str,
    svc: MarketService = Depends(_dep_market_service),
) -> None:
    await svc.remove_holding(symbol)


@router.post("/holdings/import-csv", response_model=list[HoldingBody])
async def import_holdings_csv(
    file: UploadFile,
    svc: MarketService = Depends(_dep_market_service),
) -> list[HoldingBody]:
    content = await file.read()
    items = await svc.import_holdings_csv(content)
    return [HoldingBody.from_domain(h) for h in items]


# ---------------------------------------------------------------------
# Poller
# ---------------------------------------------------------------------


@router.get("/poller/status", response_model=PollerStatusBody)
async def poller_status(
    request: Request,
    svc: MarketService = Depends(_dep_market_service),
) -> PollerStatusBody:
    status = await svc.poller_status()
    del request
    raw = status["thresholds"]
    return PollerStatusBody(
        running=status["running"],
        last_tick_at=status["last_tick_at"],
        thresholds=ThresholdsBody(
            sudden_spike_pct=float(raw["sudden_spike_pct"]),
            sudden_drop_pct=float(raw["sudden_drop_pct"]),
            crash_pct=float(raw["crash_pct"]),
            limit_up_pct=float(raw["limit_up_pct"]),
            volume_spike_sigma=float(raw["volume_spike_sigma"]),
            window_seconds=int(raw["window_seconds"]),
        ),
    )


@router.post("/poller/start", status_code=202)
async def poller_start(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    state = _get_market_state(request)
    if state.get("poller") is None:
        runtime = _get_trigger_runtime(request)
        publisher: Any
        if runtime is not None:

            async def _publish(ev: MarketAnomalyEvent) -> None:
                await runtime.bus.publish(
                    kind="market.anomaly",
                    payload=ev.model_dump(mode="json"),
                )

            publisher = _publish
        else:

            async def _noop(ev: MarketAnomalyEvent) -> None:
                del ev

            publisher = _noop

        svc = await _market_service_for(session, request)

        async def _sources() -> list[str]:
            return await svc.poll_symbols()

        state["poller"] = MarketPoller(
            router=state["router"],
            symbols_source=_sources,
            publisher=publisher,
            thresholds=state["thresholds"],
            symbol_name_map=await svc.symbol_name_map(),
        )
    poller: MarketPoller = state["poller"]
    await poller.start()
    return {"status": "started"}


@router.post("/poller/stop", status_code=202)
async def poller_stop(request: Request) -> dict[str, str]:
    state = _get_market_state(request)
    poller: MarketPoller | None = state.get("poller")
    if poller is not None:
        await poller.stop()
    return {"status": "stopped"}


@router.post("/poller/thresholds", response_model=ThresholdsBody)
async def set_thresholds(
    body: ThresholdsBody,
    request: Request,
) -> ThresholdsBody:
    state = _get_market_state(request)
    state["thresholds"] = body.to_domain()
    poller: MarketPoller | None = state.get("poller")
    if poller is not None:
        poller.set_thresholds(state["thresholds"])
    return body


@router.post("/poller/tick-once", response_model=list[AnomalyEventBody])
async def poller_tick_once(
    svc: MarketService = Depends(_dep_market_service),
) -> list[AnomalyEventBody]:
    try:
        events = await svc.poller_tick_once()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [AnomalyEventBody.from_domain(e) for e in events]


__all__ = ["router"]
