# 行情数据 · `allhands.market` Spec

**日期** 2026-04-19
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列 spec** [2026-04-18-triggers.md](./2026-04-18-triggers.md)(异动触发消费)· [2026-04-19-notification-channels.md](./2026-04-19-notification-channels.md)(推送出口)· [2026-04-19-stock-assistant.md](./2026-04-19-stock-assistant.md)(首个消费 skill)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · § 10 ref-src 对照

---

## 0 · TL;DR

- 平台级**行情/资讯/公告**数据抽象 · 任何 skill 都能用一个 tool 拿到 quote / news / announcement / fundamentals
- **免费优先 · 付费平滑接入**:v0 用 akshare + 新浪非官方实时 · v1 可无缝加 tushare pro / xtquant(Level-2)
- 常驻 `market-ticker-poller` 后台进程 · 对 `watched_symbols` 做**秒级**轮询 · 产生 `market.tick` 事件进 `events` 表(cockpit events 投影)· **triggers 自动消费** · 触发后走 notification channels
- 数据模型:`watched_symbols`(自选)· `holdings`(持仓)· `market_snapshots`(分钟快照缓存)· `market_news`(新闻/公告缓存)

---

## 1 · 问题陈述

stock-assistant / 任何要看行情的 skill · 不可能自己直接 `pip install akshare` · 再在 tool 里写 HTTP 请求。这样:
- 接口换源要改 N 份代码
- 免费 → 付费迁移没路径
- 缓存 / 限流 / 失败 fallback 散落各处
- **秒级异动**需要后台 poller · 不能让每个 skill 自己跑线程

→ 提一层平台能力 · 和 `ToolRegistry` / `ChannelService` 同级。

---

## 2 · 原则

### 2.1 Provider 是插件 · 不是 if/else

- `MarketDataProvider` ABC · 每个源一个实现
- 运行时按"数据类型 + 免费付费配额"路由到一个或多个 provider
- 新接一个 provider = 一个文件 + 一行注册

### 2.2 分层缓存

- `market_snapshots` 存 1min / 5min / daily bar 缓存 · 历史数据不重取
- 实时行情不缓存(秒级失效)· 每次 provider 直取
- 新闻/公告按 `symbol + date` 缓存 1 天 · 省接口额度

### 2.3 秒级异动靠"后台 poller + events 表"

- 不让 skill 自己轮询
- 一个单独进程 `market-ticker-poller`(FastAPI lifespan 启动的 asyncio task)
- 订阅 `watched_symbols ∪ holdings` 的 symbols · 2-5s 一轮
- 计算"涨跌幅 / 波动"跨阈值 → 写 `events(type='market.anomaly')` → triggers engine 现成订阅逻辑直接用

### 2.4 免费优先

- v0 **完全不接付费源** · akshare + 新浪非官方实时够用
- config 里 `provider_priority: [akshare, sina_realtime]` 可调
- v1 开 tushare pro → 新加 `TushareProvider` · 改 config 上线 · 零代码改其他

---

## 3 · 数据模型(新增)

### 3.1 `core/market.py`(Pydantic)

```python
class Exchange(str, Enum):
    SSE = "SSE"   # 上交所
    SZSE = "SZSE" # 深交所
    BSE = "BSE"   # 北交所
    HKEX = "HKEX" # v1 预留
    US = "US"     # v1 预留

class Symbol(BaseModel):
    code: str              # '600519'
    exchange: Exchange
    name: str              # '贵州茅台'

    @property
    def full_code(self) -> str:  # 'SSE:600519'
        return f"{self.exchange.value}:{self.code}"

class Quote(BaseModel):
    symbol: str            # full_code
    last: Decimal
    change: Decimal        # 涨跌额
    change_pct: Decimal    # 涨跌幅 %
    open: Decimal | None = None
    high: Decimal | None = None
    low: Decimal | None = None
    prev_close: Decimal | None = None
    volume: int | None = None
    turnover: Decimal | None = None    # 成交额
    bid: list[tuple[Decimal, int]] = []  # 买五档
    ask: list[tuple[Decimal, int]] = []  # 卖五档
    ts: datetime                       # server receive ts
    source: str                        # 'akshare' / 'sina_realtime' / ...

class Bar(BaseModel):
    symbol: str
    interval: Literal["1m", "5m", "15m", "30m", "1h", "1d"]
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    ts: datetime

class NewsItem(BaseModel):
    id: str
    symbol: str | None     # 无关个股为 None
    title: str
    summary: str
    url: str
    published_at: datetime
    source: str            # '财联社' / '东方财富'

class Announcement(BaseModel):
    id: str
    symbol: str
    title: str
    kind: Literal["财报", "分红", "重大事项", "停复牌", "其他"]
    url: str
    published_at: datetime
    summary: str | None = None
```

### 3.2 `watched_symbols` / `holdings` 表(migration 0010)

```sql
CREATE TABLE watched_symbols (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,               -- 'SSE:600519'
  name TEXT NOT NULL,
  tag TEXT,                           -- '白酒' · '银行' · 用户自己打标
  added_at TIMESTAMP,
  UNIQUE(symbol)
);

CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  avg_cost NUMERIC NOT NULL,          -- 成本价
  opened_at TIMESTAMP,                -- 建仓日
  notes TEXT,
  UNIQUE(symbol)
);

CREATE TABLE market_snapshots (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts TIMESTAMP NOT NULL,
  open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC,
  volume BIGINT,
  PRIMARY KEY (symbol, interval, ts)
);
CREATE INDEX idx_snap_symbol_interval ON market_snapshots(symbol, interval, ts DESC);

CREATE TABLE market_news (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL,
  published_at TIMESTAMP NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_news_symbol_time ON market_news(symbol, published_at DESC);
```

---

## 4 · MarketDataProvider ABC + 实现

### 4.1 ABC(`execution/market/base.py`)

```python
class MarketDataProvider(ABC):
    id: ClassVar[str]         # 'akshare' · 'sina_realtime' · ...
    tier: ClassVar[Literal["free", "paid"]]
    capabilities: ClassVar[set[Capability]]  # {Capability.QUOTE, Capability.BARS, ...}

    async def get_quote(self, symbol: str) -> Quote: ...
    async def get_bars(self, symbol: str, interval: str, start: datetime, end: datetime) -> list[Bar]: ...
    async def get_news(self, symbol: str | None, since: datetime) -> list[NewsItem]: ...
    async def get_announcements(self, symbol: str, since: datetime) -> list[Announcement]: ...
    async def search_symbol(self, query: str) -> list[Symbol]: ...
    async def screen(self, criteria: ScreenCriteria) -> list[Symbol]: ...   # 选股

    # 不支持的 capability 走基类 raise NotSupportedError · Router 自动 fallback
```

### 4.2 v0 实现清单

| provider | tier | capabilities | 备注 |
|---|---|---|---|
| `akshare` | free | quote / bars / news / announcements / search / screen | 主力 · 分钟级延迟 |
| `sina_realtime` | free | **quote(秒级)** | 非官方 HTTP · poller 用 · 有限流按 5s/symbol |
| `baostock` | free | bars(历史全) | daily 回溯用 · 补 akshare 缺口 |

### 4.3 v0 stub(不接真接口 · 只留 ABC 实现 + raise NotImplementedError)

- `tushare_pro`(paid)
- `xtquant`(paid · Level-2)
- `efinance`(free · 冗余)

### 4.4 Provider Router(`execution/market/router.py`)

```python
class MarketDataRouter:
    """按 capability 路由到第一个支持的 enabled provider · 失败 fallback 到下一个。"""
    def __init__(self, providers: list[MarketDataProvider], priority: list[str]):
        ...

    async def quote(self, symbol: str) -> Quote:
        for p in self._sorted_by_priority(Capability.QUOTE):
            try:
                return await p.get_quote(symbol)
            except (RateLimitError, TransientError):
                continue
        raise NoProviderAvailableError(...)
```

---

## 5 · market-ticker-poller(秒级异动引擎)

### 5.1 背景进程

- FastAPI `lifespan` 启动一个 `asyncio.create_task(poller_loop())`
- 退出时优雅 cancel

### 5.2 轮循逻辑(`execution/market/poller.py`)

```python
async def poller_loop(router: MarketDataRouter, event_bus: EventBus, cfg: PollerConfig):
    """
    cfg.interval = 3 (default, seconds)
    cfg.symbols_source = 'watched ∪ holdings'
    cfg.thresholds = { 'sudden_spike_pct': 2.0, 'sudden_drop_pct': -2.0, 'window_seconds': 60 }
    """
    last_quote: dict[str, Quote] = {}
    while not stopping:
        symbols = await load_poll_symbols()
        async with anyio.create_task_group() as tg:
            for s in symbols:
                tg.start_soon(_tick_one, s, router, event_bus, last_quote, cfg)
        await anyio.sleep(cfg.interval)

async def _tick_one(symbol, router, event_bus, last_quote, cfg):
    q = await router.quote(symbol)
    prev = last_quote.get(symbol)
    if prev and _detect_anomaly(prev, q, cfg.thresholds):
        await event_bus.publish(MarketAnomalyEvent(symbol=symbol, from_=prev, to=q, kind=anomaly_kind))
    last_quote[symbol] = q
```

### 5.3 异动分类(由 thresholds 决定)

- `sudden_spike` · 窗口内涨 ≥ X%
- `sudden_drop` · 窗口内跌 ≥ X%
- `crash` · 跌 ≥ 8% 或触及跌停
- `limit_up` · 触及涨停
- `volume_spike` · 成交量 3σ 以上

### 5.4 事件写入 events 表

- `events.type = 'market.anomaly'`
- `events.data_json = {symbol, kind, from_price, to_price, change_pct, window_s}`
- triggers engine 订阅 `market.anomaly` → 执行配置的 action(例如 `send_notification`)

---

## 6 · 后端服务 + API

### 6.1 `services/market_service.py`

```python
class MarketService:
    async def get_quote(symbol)
    async def get_quote_batch(symbols)
    async def get_bars(symbol, interval, start, end)
    async def get_news(symbol=None, since, limit=50)
    async def get_announcements(symbol, since, limit=50)
    async def search(query)
    async def screen(criteria)

    async def add_watch(symbol, tag=None)
    async def remove_watch(symbol)
    async def list_watched()
    async def set_holdings(holdings: list[Holding])   # 全量替换 · CSV 导入用
    async def add_holding(holding)
    async def update_holding(symbol, **patch)
    async def remove_holding(symbol)
    async def list_holdings()
```

### 6.2 REST 路由(`api/routers/market.py`)

- `GET /api/market/quote/{symbol}` · 单条
- `POST /api/market/quotes` · 批量
- `GET /api/market/bars/{symbol}?interval=1m&start=...`
- `GET /api/market/news?symbol=...&limit=50`
- `GET /api/market/announcements?symbol=...`
- `GET /api/market/search?q=茅台`
- `POST /api/market/screen`
- `GET/POST/DELETE /api/market/watched`
- `GET/POST/PATCH/DELETE /api/market/holdings`
- `POST /api/market/holdings/import-csv`(multipart)

---

## 7 · Meta Tools(L01 对称)

`execution/tools/meta/market_tools.py`

| Tool | scope |
|---|---|
| `get_quote` | READ |
| `get_quote_batch` | READ |
| `get_bars` | READ |
| `get_news` | READ |
| `get_announcements` | READ |
| `search_symbol` | READ |
| `screen_stocks` | READ |
| `add_watched` | WRITE(默认 auto-approve) |
| `remove_watched` | WRITE |
| `list_watched` | READ |
| `add_holding` | WRITE(gate) |
| `update_holding` | WRITE(gate) |
| `remove_holding` | IRREVERSIBLE |
| `import_holdings_csv` | WRITE(gate) |
| `set_poller_thresholds` | WRITE(gate) |

---

## 8 · 前端

### 8.1 `web/app/market/page.tsx`(行情一体页)

- 自选 + 持仓 两 tab
- 自选行:代码 / 名称 / 最新 / 涨跌 / 涨跌幅 / 成交额 / 操作(移除 · 详情)
- 持仓行:上面 + 数量 / 成本 / 现值 / 盈亏 / 盈亏% / 建仓日
- 顶部:加自选 · 导入持仓 CSV · 当前 poller 状态(最近一次 tick 时间 · 延迟)
- 视觉纪律:Linear Precise 严格

### 8.2 `web/app/market/[symbol]/page.tsx`(详情页)

- K 线(lightweight-charts)· 5 个 interval 切换
- 新闻列表(从 cache)
- 公告列表
- "问 agent 归因"按钮 · 携带当前 symbol + 最新 quote 跳 chat

---

## 9 · 与已有 spec 对接

- **triggers**(Wave B.3 已交付):订阅 `market.anomaly` · action 用 `send_notification`(见 notification-channels)· **我们不写 trigger · 用户在 UI 建**
- **tasks** spec(未交付 · T1 负责):daily 8:30 跑 `generate_briefing` task · 依赖本 spec 的 news + bars
- **observatory**:不强依赖 · 有 observatory 的话 poller 的 tick latency / failure rate 可投到 traces

---

## 10 · 参考源码(动手前必读)

- akshare 源码:[`akshare/stock_feature/stock_realtime`](https://github.com/akfamily/akshare) 看它怎么调新浪 · 一条接口一分钟请求上限多少
- [`tushare/pro`](https://tushare.pro/document/2) · API quota 文档 · 付费 stub 的契约对照
- `ref-src-claude` · 没直接对标 · 参考 `tools/Read.ts` 的 cache invalidation 写 market_snapshots 的 TTL

---

## 11 · In-scope / Out-of-scope

### In-scope v0
- 4 张新表 + migration 0010
- Pydantic 域 + `MarketService`
- 3 个真 provider(akshare / sina_realtime / baostock)+ 3 个 stub
- `MarketDataRouter` + capability-based fallback
- `market-ticker-poller` 常驻(3s 默认 · 可配)
- 事件 `market.anomaly` 投到 events 表
- REST + Meta Tool 全套 · L01 对称
- `web/app/market/*` 两屏

### Out-of-scope v0
- 港股 / 美股(只占 Symbol.exchange 枚举位 · 不实现)
- 回测引擎(只提供 bars · skill 自己算)
- tick 级 Level-2(v1 xtquant)
- 机器学习选股(skill 层的事)
- 实时推送 WebSocket(v1 换 WS 替代 HTTP 轮询)

---

## 12 · 测试

- `tests/unit/market/test_providers_*.py` · mock HTTP · 每个 provider 解析正确 + 异常转换
- `tests/unit/market/test_router.py` · fallback 逻辑 · 优先级 · capability 匹配
- `tests/unit/market/test_poller.py` · 触发器判定 · 事件正确发布(mock event_bus)
- `tests/integration/test_market_api.py` · REST 全通
- `tests/integration/test_market_poller_to_trigger.py` · 闭环:poller → event → trigger → notification(mock channel)
- `tests/unit/test_learnings.py::test_market_dual_entry` · L01

---

## 13 · DoD checklist

- [ ] migration 0010 · 单 head
- [ ] 4 张表 + Pydantic 域
- [ ] 3 真 provider + 3 stub · Router + fallback
- [ ] Poller 常驻 · 3s 默认 · lifespan 启停
- [ ] events 投 `market.anomaly` · trigger integration test 绿
- [ ] REST 全套 + 14 Meta Tool · L01 对称测试绿
- [ ] `web/app/market` 两屏 · 视觉纪律过
- [ ] 所有测试绿 · CSV 导入手测过
- [ ] 手测:添加茅台自选 → 等 poller 3 轮 → 人为改阈值 → 看到 events 表多一条

## 14 · Decision-log

- 2026-04-19 · 不上 WebSocket · v0 HTTP 轮询足够 · WS 复杂度留 v1
- 2026-04-19 · 新闻/公告短缓存 1 天 · 防爆 akshare 频率限制
- 2026-04-19 · `watched_symbols ∪ holdings` 作为 poller 订阅集 · 不做"所有股票"(4000+ 太贵)
- 2026-04-19 · CSV 导入是 MVP 的持仓入口 · 不接券商 API(合规 + 稳定性成本高)
