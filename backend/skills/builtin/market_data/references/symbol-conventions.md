# Symbol 代码约定 · 不同市场的格式

> `read_skill_file('allhands.market_data', 'references/symbol-conventions.md')` · 用户给个名字时先按这个解析。

## 美股

格式:`<TICKER>` · 全大写 · 无后缀

| 输入 | 标准代码 |
|---|---|
| 苹果 / Apple | `AAPL` |
| 特斯拉 / Tesla | `TSLA` |
| 微软 | `MSFT` |
| 谷歌 / 字母表 | `GOOGL`(A 类)或 `GOOG`(C 类) |
| 亚马逊 | `AMZN` |
| Meta / 脸书 | `META` |
| 英伟达 | `NVDA` |
| 伯克希尔 A / B | `BRK.A` / `BRK.B` |

ETF 也是裸代码:`SPY` `QQQ` `VOO`

## 港股

格式:`<DIGITS>.HK` · 5 位数字补 0 · `.HK` 后缀必须

| 输入 | 标准代码 |
|---|---|
| 腾讯 | `00700.HK` |
| 阿里巴巴-SW | `09988.HK` |
| 美团 | `03690.HK` |
| 友邦保险 | `01299.HK` |
| 香港交易所 | `00388.HK` |

## A 股(沪深)

格式:`<DIGITS>.SH` 或 `<DIGITS>.SZ` · 6 位数字 · 沪 SH / 深 SZ

| 输入 | 标准代码 |
|---|---|
| 茅台 | `600519.SH` |
| 五粮液 | `000858.SZ` |
| 宁德时代 | `300750.SZ`(创业板) |
| 工商银行 | `601398.SH` |

判别规则:`60 / 68` 开头 → SH;`00 / 30` 开头 → SZ。

## 加密货币(若用此 skill)

格式:`<COIN>-USD` 或 `<COIN>-USDT`

| 输入 | 标准代码 |
|---|---|
| 比特币 | `BTC-USD` |
| 以太坊 | `ETH-USD` |
| Solana | `SOL-USD` |

## 解析流程(用户给名字时)

```
用户:「查一下宁德时代股价」
  ↓
1. search_symbol(q="宁德时代")
   → [{symbol: "300750.SZ", name: "宁德时代", market: "SZ"}]
2. get_quote(symbol="300750.SZ")
3. 返回价 / 涨跌
```

## 常见坑

- 用户说「苹果」可能指 `AAPL`(美股)也可能指 `09618.HK`(京东 · 不是苹果) · 多义优先确认
- A 股和港股的中文同名股很多(腾讯 vs 腾讯控股) · 不确定时反问
- ETF 代码可能与个股冲突(`PINS` 既是 Pinterest 也可能被解析成别的)
- 数字代码缺位(给「700」而不是 `00700.HK`) · 默认补 0 + 加 .HK
