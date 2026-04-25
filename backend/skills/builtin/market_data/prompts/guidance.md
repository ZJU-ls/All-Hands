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

## 调用示例

```
# 「我的 AAPL 仓位现在赚多少」
list_holdings()                             # 找到 AAPL 持仓 + cost_basis
get_quote(symbol="AAPL")                    # 拿当前价
# → 浮盈 = (current - cost_basis) * qty,模型自己算

# 「Tesla 最近有啥新闻」
get_news(symbols=["TSLA"], limit=5)

# 「找市值过 100B 且 PE < 30 的科技股」
search_symbol(q="tech")                     # 先确认 sector 关键词
screen_stocks(rules=["market_cap > 100e9", "pe < 30", "sector = 'Technology'"])
```

## 常见坑

- 港股代码带 `.HK` 后缀 · 美股不带 · A 股 `.SH` / `.SZ`
- `get_bars` 的 interval 取决于数据源 · 1m 数据通常只回溯 7 天
- `screen_stocks` rules 是字符串表达式 · 语法错只在调用时才报
- 修改 holding 后 portfolio_health 不立即重算 · 需要 stock_assistant 重跑
- batch quote 一次最多 50 · 超了切片调用

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `get_quote` 返回 "symbol_not_found" | 用 `search_symbol` 重新解析 · 用户可能输了名字而非代码 |
| `screen_stocks` 报 "rule parse error" | 简化条件 · 一次只验一条 · 用 SQL-like 语法 |
| `add_holding` 成功但 `list_holdings` 没出现 | 看 workspace_id 是否一致 · 默认都是 "default" |
| `set_poller_thresholds` 不触发 anomaly | 阈值和方向写反了:drop_pct 是负向跌幅 · up_pct 是正向涨幅 |
