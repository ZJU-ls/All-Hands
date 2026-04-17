# ADR 0005 · Lead Agent 能力边界:L4 + 护栏

**日期:** 2026-04-17  **状态:** Accepted

## Context

Lead Agent 的权限边界有 4 个候选:

- L1:只读 + 派遣
- L2:+ 即时创建员工
- L3:+ 修改 / 删除
- L4:+ 自举(改自己 prompt / 工具;造新 Lead Agent)

产品愿景是"理论上通过对话完成一切操作"——需要 L4。但 L4 的失控风险显著。

## Decision

**采用 L4,配套三层护栏:**

### 1. Confirmation Gate(按 scope 分级)

| Scope | Confirmation |
|---|---|
| READ | 不需要 |
| WRITE | 弹窗:摘要 + yes/no |
| IRREVERSIBLE | 弹窗 + 必填 diff + 双重确认(输入关键字) |
| BOOTSTRAP | 写候选版本,用户显式切换 |

### 2. 自举沙盒

- `propose_lead_agent_version` 写入 `lead_agent_versions` 表,**不生效**
- `switch_lead_agent_version` 切换指针,旧版本保留 30 天
- Lead Agent 不能创建新 Lead Agent(DB unique constraint 保证 singleton)

### 3. 审计

- 所有 Confirmation 决议 + BOOTSTRAP 操作写 `audit_events`
- 所有 tool 调用经 LangFuse,事后可溯源

## Rationale

- **产品叙事完整**:L4 才能实现"一个 Agent 搞定一切"的愿景
- **护栏覆盖失控路径**:不可逆 / 自举都有显式 gate,不是 "可能出问题"
- **可平滑降级**:如果实践中发现 L4 太激进,可通过 ConfirmationPolicy 提升到"全部需确认"模式,不需要重构

## Consequences

- 用户每次让 Lead Agent 创建/改/删员工都要点确认 → UX 成本 → v1 引入 "session 内首次确认" 优化
- `lead_agent_versions` 表会累积 → 30 天清理任务 → v1 加定时清理

## Alternatives considered

- **L3(无自举)** — 否:产品叙事退化为"高级调度器",与竞品区分度下降
- **L4 无护栏** — 否:必然出事故,失去用户信任
