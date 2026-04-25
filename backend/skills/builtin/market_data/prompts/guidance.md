# 行情数据 · 工作流

## 何时调用

用户提到具体股票代码 / 公司名 / 「股价」「K 线」「新闻」「持仓」「自选股」 → 这套技能。它是 **底层数据层** · 上层语义(briefing / anomaly)用 `allhands.stock_assistant`。

## 行情读取(只读 · 高频)

- `get_quote(symbol)` — 单股快照 · 价 / 涨跌 / 成交
- `get_quote_batch(symbols=[...])` — 一次最多 50 个 · 批量优先
- `get_bars(symbol, interval="1d|1h|1m", limit)` — K 线 · 用作图源
- `get_news(symbols?, limit)` — 个股 / 大盘新闻
- `get_announcements(symbol, limit)` — 公司公告(财报 / 重大事项)
- `search_symbol(q)` — 名称 / 代码模糊搜
- `screen_stocks(rules=[...])` — 多条件选股 · 例:`market_cap>100B AND pe<25`

## 自选股 / 持仓(WRITE)

- 自选:`list_watched / add_watched(symbol) / remove_watched(symbol)`
- 持仓:`list_holdings / add_holding(symbol, qty, cost_basis) / update_holding / remove_holding`
- 批量导入:`import_holdings_csv(csv_blob)` · 直接吃券商导出的 csv

## 监控阈值

- `set_poller_thresholds(symbol, drop_pct?, up_pct?, news_severity?)` — 单股阈值 · 突破后 trigger 系统会发 anomaly 事件

## 常见坑

- 港股代码带 `.HK` 后缀 · 美股不带 · A 股 `.SH` / `.SZ`
- get_bars 的 interval 取决于数据源 · 1m 数据通常只回溯 7 天
- screen_stocks rules 是字符串表达式 · 语法错只在调用时才报
- 修改 holding 后 portfolio_health 不立即重算 · 需要 stock_assistant 重跑
