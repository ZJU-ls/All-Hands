# 模型价格管家 · 工作流

你的目标:让 `model_prices` 覆盖表 **准确 + 有来源**。每一行 DB
overlay 都来自一手定价页(`provider 官网 / docs 站 / pricing.json`),
绝不凭直觉写价格。

## 何时被叫

用户说:「刷新一下 OpenAI 最新价格」「Anthropic Claude 4.7 调价了
吗」「这个新模型 deepseek-r1 我们的成本算对了吗」「检查一下我们
价格表准不准」 → 这套工作流。

## 标准三步法

### 1. 列出当前认知

```
list_model_prices()
```

读到一份完整列表 · 每行带 `source: code | db`。先弄清:
- 哪些模型走 **code seed**(开箱默认)
- 哪些已经在 **db overlay**(之前被人/agent 改过 · 看 `source_url` 知道引自哪)
- 是否有用户当前在用的 model 完全不在表里(ObservatoryService 该模型成本会显示 "—")

### 2. 上网查证

```
web_search("anthropic pricing claude 4.7 per million tokens")
fetch_url("https://www.anthropic.com/pricing")
```

- 优先访问厂商**官方定价页**(`anthropic.com/pricing` · `openai.com/pricing` ·
  `deepseek.com/pricing` · 阿里百炼 `dashscope.console.aliyun.com/billing`)
- 找不到官网公开页时再退到二手聚合站(LLM-Pricing.com / Helicone 等)
- **永远把找到的精确 URL 留下**,upsert 时填到 `source_url`

### 3. 写入覆盖表

```
upsert_model_price(
    model_ref="openai/gpt-4o-mini",
    input_per_million_usd=0.15,
    output_per_million_usd=0.60,
    source_url="https://openai.com/pricing",
    note="2026-04 standard pricing · prompt cache discount excluded"
)
```

注意:
- `model_ref` 形如 `openai/gpt-4o-mini` · 与 `LLMModel` 表里的 ref 一致
  (先 `list_models()` 确认你写对了 ref · 错的 ref 永远不会被命中)
- 价格单位是 **USD per 1,000,000 tokens** · 别把 per-1k 报价混进来
- `note` 写 caveat:promo 截止日期 / 是否含 cache 折扣 / 是否含图像 token 等
- 写入是 **WRITE + requires_confirmation=True** · 用户会看到一个 gate
  提示并核准 · 这是设计如此

## 撤销

```
delete_model_price_override(model_ref="openai/gpt-4o-mini")
```

→ 删除 db overlay 行 · cost 估算回落到 code seed(代码内置默认价)。
适用场景:发现自己之前写错了;或厂商把价改回原值。

## 不该做

- 不要在没有 `source_url` 的情况下硬写一个数 · schema 已经把
  `source_url` 标为 required · 但更重要的是它驱动审计
- 不要 promo / 跨地区差价直接覆盖标准价 · 写 note 说清楚或多写几行
- 不要批量"猜估" · 拿不准就 `delete_model_price_override` 让它回到代码默认
- 用户没让你查 · 不要主动 web_search 全表(费 quota · 有用户期望)

## 一次完整对话示例

> User: "我看 trace 里 gpt-4o-mini 成本算的不对,核一下 OpenAI 现在的价。"

```
list_model_prices()
→ gpt-4o-mini source=code · in=$0.15 · out=$0.60

web_search("openai gpt-4o mini pricing 2026 per million tokens")
→ https://openai.com/pricing · https://platform.openai.com/docs/pricing

fetch_url("https://openai.com/pricing")
→ "GPT-4o mini · Input: $0.15 / 1M · Output: $0.60 / 1M"

# 价格一致 · 不需要写 db 行 · 告诉用户:
"gpt-4o-mini 当前 code seed($0.15 in / $0.60 out)与 OpenAI 官网一致 ·
不需要覆盖。如成本仍不对,问题不在价格表,可能在 token 计数或
provider 路由(用 list_providers / list_models 排查)。"
```

> User: "那 claude opus 4.7 呢?Anthropic 那边好像调过价。"

```
web_search("anthropic claude opus 4.7 pricing per million tokens 2026")
→ https://www.anthropic.com/pricing

fetch_url("https://www.anthropic.com/pricing")
→ "Claude Opus 4.7 · Input: $15 / 1M · Output: $75 / 1M"
# (与 code seed 相同,也不必写)

# 假如官网现在显示 input $18 / output $90:
upsert_model_price(
    model_ref="anthropic/claude-opus-4-7",
    input_per_million_usd=18.0,
    output_per_million_usd=90.0,
    source_url="https://www.anthropic.com/pricing",
    note="2026-04 调价 · 替换 code seed 的 $15/$75"
)
```
