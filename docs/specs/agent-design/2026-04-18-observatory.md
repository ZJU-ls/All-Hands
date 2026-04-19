# 观测中心 Spec · Langfuse 自动部署 + 自动绑定

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列 spec** [2026-04-18-cockpit.md](./2026-04-18-cockpit.md) · [2026-04-18-triggers.md](./2026-04-18-triggers.md)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · 按本 spec § 10.5 对照 `ref-src-claude`(tool 的 scope=BOOTSTRAP / 配置凭证的 UX)

---

## 0 · TL;DR

- **第一次 `docker compose up` 就有能用的 trace 观测**,用户不需要手动去 Langfuse 注册 / 建 project / 抄 key
- compose 追加 `langfuse-server` + `langfuse-worker` + `clickhouse`(langfuse v3 必需)+ 复用 redis / postgres
- backend 启动时跑 **bootstrap 流程**(§ 5):等健康 → 注册 admin → 建 org/project → 取 key → 写入 env + DB → 热重载 `LangfuseCallbackHandler`
- `/observatory` 页面 = **左边 allhands-side summary 面板** + **右边 Langfuse UI iframe(自动登录)**
- Langfuse 挂了 **不 block** backend 启动:降级 `observability_enabled=False`,cockpit 标黄,trace 直接丢弃

---

## 1 · 问题陈述

v0 架构 L2 定义了"Langfuse observability",但今天:

- 用户装完 compose 后,得**自己**去 Langfuse UI 注册、建 project、抄 key 到 .env、重启 backend —— 这是 **5 步人工流程**,是 self-hosted 体验的最大噪声
- "一起 compose up 就能用"是 [product/00-north-star.md](../../../product/00-north-star.md) 的定位,但现在并不成立
- Trace 观测是 AI 平台的**必备能力**(不是可选),不能依赖用户手动配置

本 spec 把这 5 步人工流程变成**后端启动时自动跑一遍**的 bootstrap。

---

## 2 · 原则

### 2.1 零人工配置 · 开箱即用

普通用户路径:
```
docker compose up → 30-90s 等健康 → /observatory 点开就看到本地 Langfuse · 已登录 · 已建 project · 已经在收 trace
```

用户只需要改 `.env` 的情况:
- 想用**外部** Langfuse(非本地部署)→ 给 `LANGFUSE_HOST` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`,bootstrap 跳过自动注册
- 想改 admin 邮箱 / 固定密码 → 给 `LANGFUSE_ADMIN_EMAIL` / `LANGFUSE_ADMIN_PASSWORD`

### 2.2 幂等 · 重启 N 次不重复

bootstrap **每次启动都跑**。每一步先查再做:

- admin 存在? → 登录(不再注册)
- org 存在? → 取 id(不再建)
- project 存在? → 取 id(不再建)
- 已有 key? → 复用(不新造)

重启 10 次 ≠ 10 个 admin / 10 个 project。

### 2.3 优雅降级 · Langfuse 挂了 allhands 继续活

这是 **MVP 非常重要**的可靠性决策。Langfuse 是副产品,不是关键路径。

- 健康探测 60s 超时 → bootstrap 放弃 + 写 `observability_enabled=False`
- trace emit 路径变成**静默丢弃**(不抛异常,不阻塞 agent run)
- cockpit 健康面板标 `⚠ Langfuse disconnected`
- 后台每 5 分钟重试 bootstrap,恢复自愈

### 2.4 凭证最小暴露 · 安全优先

- 生成的 admin 密码 **32 字符随机**
- 写两份:明文写 `backend/data/langfuse-admin.txt`(gitignored + compose volume 挂载 · 用户能看到),DB 里 AES-256-GCM 加密存(key = env `ALLHANDS_SECRET_KEY`)
- 生成的 API key 只入 DB(AES 加密)+ 注入进程 env,**不**写回 `.env` 文件
- DB 里新增 `observability_config` 表 · 单行

### 2.5 Tool First · 观测中心也是平台能力

对 Lead Agent 暴露:
- `observatory.query_traces(filter, limit)`(READ)· 让 Lead 能回答"上周 writer 失败最多的是哪类任务"
- `observatory.get_trace(trace_id)`(READ)
- `observatory.bootstrap_now()`(BOOTSTRAP · 幂等 · 可用于"Langfuse 先挂了后起来"后让 Lead 手动触发恢复)

---

## 3 · compose 拓扑变更

`docker-compose.yml` 追加 3 个 service,并调整 allhands-backend 依赖。

### 3.1 新增 service

```yaml
langfuse-server:
  image: langfuse/langfuse:3       # pin minor 以 .env 控制
  environment:
    DATABASE_URL: postgres://...@postgres:5432/langfuse
    CLICKHOUSE_URL: http://clickhouse:8123
    CLICKHOUSE_MIGRATION_URL: clickhouse://clickhouse:9000
    REDIS_CONNECTION_STRING: redis://redis:6379/1
    NEXTAUTH_URL: http://langfuse:3000
    NEXTAUTH_SECRET: ${LANGFUSE_NEXTAUTH_SECRET}
    SALT: ${LANGFUSE_SALT}
    ENCRYPTION_KEY: ${LANGFUSE_ENCRYPTION_KEY}    # 32-byte hex
    LANGFUSE_INIT_PROJECT_ID: ""                  # 我们自己 bootstrap,不让 langfuse 自 init
    TELEMETRY_ENABLED: "false"
  depends_on: [postgres, clickhouse, redis]
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/public/health"]
    interval: 10s
    timeout: 3s
    retries: 6

langfuse-worker:
  image: langfuse/langfuse-worker:3
  environment: (同上关键几项)
  depends_on: [postgres, clickhouse, redis]

clickhouse:
  image: clickhouse/clickhouse-server:24.3
  environment:
    CLICKHOUSE_DB: default
    CLICKHOUSE_USER: default
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-clickhouse}
  volumes:
    - clickhouse_data:/var/lib/clickhouse
```

### 3.2 复用

- `postgres`:为 langfuse 建一个单独 database(bootstrap 跑 `CREATE DATABASE langfuse` if not exists · service/bootstrap 里做)
- `redis`:用独立 DB 编号(langfuse 用 `/1`,allhands 用 `/0`)

### 3.3 allhands-backend 改动

- `depends_on: [postgres, redis, langfuse-server]`(langfuse-server 失败 **不**阻塞 allhands → 用 `condition: service_started` 而不是 `service_healthy`)
- 新增 env:`LANGFUSE_HOST=http://langfuse-server:3000`(compose 内部),`LANGFUSE_PUBLIC_HOST=http://localhost:3000`(给浏览器 iframe 用)
- 挂 `backend/data:/app/data` volume(放 `langfuse-admin.txt`)

### 3.4 `.env.example` 追加

```bash
LANGFUSE_NEXTAUTH_SECRET=<开发默认随机值,生产提醒改>
LANGFUSE_SALT=<...>
LANGFUSE_ENCRYPTION_KEY=<64 hex chars>
CLICKHOUSE_PASSWORD=clickhouse

# 可选:外部 Langfuse · 填了则跳过 bootstrap
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=
# 可选:固定 admin 凭据(否则自动生成)
LANGFUSE_ADMIN_EMAIL=admin@allhands.local
LANGFUSE_ADMIN_PASSWORD=
```

---

## 4 · 数据模型

### 4.1 `observability_config`(新表 · single-row)

```sql
CREATE TABLE observability_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),     -- 单行守卫
    public_key TEXT,
    secret_key_encrypted BYTEA,                          -- AES-256-GCM
    host TEXT,
    org_id TEXT,
    project_id TEXT,
    admin_email TEXT,
    admin_password_encrypted BYTEA,
    bootstrap_status TEXT NOT NULL DEFAULT 'pending',    -- pending/ok/failed/external
    bootstrap_error TEXT,
    bootstrapped_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO observability_config (id) VALUES (1) ON CONFLICT DO NOTHING;
```

单行策略:永远只有一条。所有读写封装在 `persistence/repos/observability_config_repo.py`。

### 4.2 Domain model(`core/observability.py`)

```python
class BootstrapStatus(str, Enum):
    PENDING = "pending"
    OK = "ok"
    FAILED = "failed"
    EXTERNAL = "external"   # 用户给了外部 Langfuse · bootstrap 跳过

class ObservabilityConfig(BaseModel):
    public_key: str | None
    secret_key: str | None                   # 明文(内存中)
    host: str | None
    org_id: str | None
    project_id: str | None
    admin_email: str | None
    bootstrap_status: BootstrapStatus
    bootstrap_error: str | None
    bootstrapped_at: datetime | None
    observability_enabled: bool              # 派生:status == OK or EXTERNAL
```

---

## 5 · Bootstrap 流程(`services/observability_bootstrap.py`)

运行时机:FastAPI `lifespan` 启动事件里,**非阻塞**(起 asyncio task),backend API 先就绪。

### 5.1 8 步流程

```python
async def run_bootstrap() -> None:
    # 1. 检测配置
    cfg = await repo.load()
    if env.LANGFUSE_PUBLIC_KEY and env.LANGFUSE_SECRET_KEY:
        cfg.bootstrap_status = EXTERNAL
        cfg.host = env.LANGFUSE_HOST
        cfg.public_key = env.LANGFUSE_PUBLIC_KEY
        cfg.secret_key = env.LANGFUSE_SECRET_KEY
        await apply_to_process(cfg)   # 注入进程 env + init callback handler
        await repo.save(cfg)
        return

    # 2. 等 langfuse-server 健康(poll 60s)
    healthy = await wait_until_healthy(env.LANGFUSE_HOST, timeout=60)
    if not healthy:
        cfg.bootstrap_status = FAILED
        cfg.bootstrap_error = "langfuse health timeout"
        await repo.save(cfg)
        await emit_cockpit_alert("langfuse_disconnected")
        schedule_retry()              # 5 min 后重试
        return

    # 3. 确保 admin 用户(幂等)
    admin_email = env.LANGFUSE_ADMIN_EMAIL or cfg.admin_email or "admin@allhands.local"
    admin_password = env.LANGFUSE_ADMIN_PASSWORD or cfg.admin_password (decrypted) or gen_password_32()
    try:
        await langfuse_api.register(admin_email, admin_password, name="allhands bootstrap")
    except AlreadyExists:
        pass
    # 4. 登录拿 session cookie
    session = await langfuse_api.sign_in(admin_email, admin_password)

    # 5. 确保 organization
    org_id = cfg.org_id or await langfuse_api.ensure_organization(session, name="allhands")

    # 6. 确保 project
    project_id = cfg.project_id or await langfuse_api.ensure_project(session, org_id, name="allhands-default")

    # 7. 确保 API key pair(如果 cfg 里已经有一对且 Langfuse 验证有效 → 复用 · 否则重建)
    if cfg.public_key and cfg.secret_key and await langfuse_api.verify_keys(...):
        pk, sk = cfg.public_key, cfg.secret_key
    else:
        pk, sk = await langfuse_api.create_api_keys(session, project_id)

    # 8. 持久化 + 热加载
    cfg.public_key = pk
    cfg.secret_key = sk
    cfg.host = env.LANGFUSE_HOST
    cfg.org_id = org_id
    cfg.project_id = project_id
    cfg.admin_email = admin_email
    cfg.bootstrap_status = OK
    cfg.bootstrapped_at = now()
    await repo.save(cfg)               # encrypt password / secret_key
    await write_admin_credentials_file(admin_email, admin_password)   # data/langfuse-admin.txt
    await apply_to_process(cfg)        # env + reinit Langfuse CallbackHandler
```

### 5.2 幂等细节

| 步骤 | 幂等策略 |
|---|---|
| register | 409 / "already exists" → 吞掉,继续登录 |
| sign_in | 密码不对 → reset(只在**没有外部 env 密码**时):重新 gen password + 调 `/api/admin/reset-password`(内部 endpoint · 需在 server 端提供) · 还是不行 → FAILED 并 alert |
| ensure_organization | 列出所有 orgs,名字匹配则返回 id;否则 POST 创建 |
| ensure_project | 同上 |
| verify_keys | 用 `pk/sk` 调一次 trace write probe |
| 文件写 | 存在则比较内容,不一致再覆盖 |

### 5.3 Backoff · 失败重试

- 首次超时 → 后台 task 每 5 min 重试一次
- 每次重试走完整 8 步(幂等保证)
- 连续失败 > 10 次 → cockpit alert `langfuse_bootstrap_permanently_failing`

### 5.4 热加载 Langfuse CallbackHandler

- `observability/langfuse_handler.py` 暴露 `reinit(pk, sk, host)` 方法
- bootstrap 成功 → 调用 reinit
- AgentRunner 在构造 LangGraph agent 时 `if observability_enabled: attach handler`
- 如果 bootstrap 在 agent run 之后才成功 → 从这次 run 的**后续** token 开始有 trace(历史 run 的 trace 丢失可接受)

---

## 6 · `/observatory` 页面

### 6.1 布局

左边:allhands-side summary(280px 固定宽)
右边:Langfuse UI iframe(自适应)

### 6.2 Summary 面板内容(SSR)

`GET /api/observatory/summary` 返回(service 层聚合 events + runs 表):

```python
class ObservatorySummary(BaseModel):
    traces_total: int            # runs 总数(allhands 侧的口径)
    failure_rate_24h: float      # 失败率 %
    latency_p50_s: float         # 过去 24h 各 run duration p50
    avg_tokens_per_run: int
    by_employee: list[{employee_id, employee_name, runs_count}]
    observability_enabled: bool
    bootstrap_status: BootstrapStatus
    bootstrap_error: str | None
```

显示模块:trace 总数 / 失败率 / 延迟 / token · 按员工分布 · 顶部若 `observability_enabled=False` 的**明显警告条** + 一键"现在重试 bootstrap"按钮(调 `observatory.bootstrap_now`)

### 6.3 Langfuse iframe 免登录

用户点 `/observatory` · iframe 的 `src` 是 **allhands 后端代理** 路径 `/api/observatory/ui/*`:

- 后端 proxy 请求 → 附加 Langfuse session cookie(用 bootstrap 拿到的 admin session)
- Langfuse UI 在 iframe 内就像已登录
- v0:共用 admin session(单用户 self-host,风险可接受)
- v1:每个 allhands 用户 → 建 Langfuse 用户 / SSO

**安全注意**:proxy 路径必须 enforce allhands 用户已登录,否则 anon 访问 = admin 权限泄漏。

### 6.4 视觉 · 遵守 CLAUDE.md § 3.5

- 左 summary 用 token · 不用 icon
- warning banner 用 `#d97706`(已有语义色)
- iframe 不用边框阴影

---

## 7 · Meta Tools

写 `execution/tools/meta/observatory.py`:

| Tool id | scope | 语义 |
|---|---|---|
| `allhands.meta.observatory.query_traces` | READ | 查 trace · 支持 filter: `{employee_id, status, from, to, limit}` · 返回摘要列表(带 trace_id 能点到 UI)|
| `allhands.meta.observatory.get_trace` | READ | 按 trace_id 取完整 · 包含 span / token / latency |
| `allhands.meta.observatory.get_status` | READ | 返回 bootstrap_status + observability_enabled(Lead 可以自查"我现在有没有被观测") |
| `allhands.meta.observatory.bootstrap_now` | BOOTSTRAP | 幂等触发一次 bootstrap(不做"重置密码"等破坏性操作) · 在 Langfuse 先挂后起来时能让用户说一句话让 Lead 自己恢复 |

**不**给 Lead:删除 trace / 改 Langfuse 配置 / 重置 admin 密码。这些要人手操作(面板或 shell)。

### 7.1 `query_traces` description(必须写 Claude Code 风格)

```
Query observability traces recorded in Langfuse for this workspace.
Use this to answer questions like:
  - "how many runs did writer do this week"
  - "what's the P50 latency today"
  - "show me the failed runs in the last hour"

Do NOT use this when:
  - you just need *current* workspace state (use cockpit.get_workspace_summary)
  - the user asks for a specific trace link (use observatory.get_trace)

filter fields: employee_id, status (ok/failed), from (ISO), to (ISO), limit.
Returns: list of {trace_id, employee_id, status, duration_s, tokens, started_at}.
```

### 7.2 Lead Agent prompt 补丁

在 `lead_agent.md` 加段:
> When answering analytic questions ("last week", "last month", "how many"), prefer `observatory.query_traces` over trying to re-read conversation history. You have the data in Langfuse.

---

## 8 · API

| Endpoint | 说明 |
|---|---|
| `GET /api/observatory/summary` | § 6.2 |
| `GET /api/observatory/status` | bootstrap 状态 |
| `POST /api/observatory/bootstrap` | 手动触发 bootstrap(管理员) |
| `GET /api/observatory/ui/*` | iframe proxy 到 langfuse-server · 附带 session cookie |
| `GET /api/observatory/traces` | REST 版 query_traces(给前端 summary 用) |
| `GET /api/observatory/traces/{id}` | REST 版 get_trace |

REST 与 Meta Tool 共用 `services/observatory_service.py` 一份实现(L01 Tool First 硬要求)。

---

## 9 · 运维 / 故障场景

| 场景 | 处理 |
|---|---|
| 第一次 `docker compose up`,langfuse init migration 跑 5 min | bootstrap `wait_until_healthy` 60s 内不够 → 标 FAILED + 5 min 后重试 · 用户进 `/observatory` 看到"正在 bootstrap" 提示 |
| 用户重启 backend 只停 backend,Langfuse 依然在 | bootstrap 看到 Langfuse healthy + cfg 已有 keys + verify_keys 成功 → 跳过,200ms 内完成 |
| 用户改了 `.env` 加了外部 Langfuse | bootstrap 检测 env 存在 → status=EXTERNAL · 不 touch Langfuse(也不写 admin 文件) |
| Langfuse 磁盘满 | trace 写失败 → callback handler 吞掉(不抛) · cockpit 健康标黄 · 下次 bootstrap retry 会 verify_keys 失败 → FAILED |
| `ALLHANDS_SECRET_KEY` 被改 | AES 解密 `secret_key_encrypted` 失败 → 清 cfg · 重跑 bootstrap → 生成新 API key |

---

## 10 · 与已有 / 并列 spec 的重叠

| 已有 / 并列 | 关系 | 协调 |
|---|---|---|
| `observability/langfuse_handler.py` | 需要加 `reinit(pk, sk, host)` 方法 | 如果当前只能启动时 init,本 spec 强制改成运行时可替换 |
| [cockpit.md § 3.2 HealthSnapshot](./2026-04-18-cockpit.md#32) | `langfuse` 健康项由本 spec 提供数据 | `observability_service.get_health()` → cockpit 聚合 |
| [triggers.md § 4.2 events 表](./2026-04-18-triggers.md#42) | 加事件 `observability.bootstrap_ok` / `observability.bootstrap_failed` | 用同一 EventBus.publish |
| `docker-compose.yml` | 本 spec 追加 3 service | **拉最新** `docker-compose.yml` 再 patch · 不覆盖中间产出 |
| `alembic/versions/` | 本 spec 加 `0006_add_observability_config.py` | 按时间次序 |

---

## 10.5 · 参考源码(动手前必读)

> 写 bootstrap / proxy / callback 热加载代码前,对照 [`docs/claude/reference-sources.md`](../../claude/reference-sources.md)。

| 本 spec 涉及 | 对标 ref-src-claude 入口 | 抽什么 · 适配方向 |
|---|---|---|
| **§ 5 bootstrap 幂等流程** | `ref-src-claude` 的工具自检 / MCP 初始化流程(V04 tool 注册 · V0N Hooks lifecycle) | Claude Code 注册 tool / 启动 MCP / 处理 "已存在" 场景的套路。**重点抽:每一步"先查再做"的日志友好写法** · 抗重启 |
| **§ 5.4 CallbackHandler 热加载** | Claude Code 的 config 热加载(settings.json 改了不重启进程 · V04 或 Configuration) | 运行时替换配置的模式。**抽:old handler 的 graceful drain + new handler 的 swap in** · 避免 trace 丢失 |
| **§ 7.1 `query_traces` description** | Claude Code 的 Task / TodoWrite tool description(V04) | 三段式:when to use / when NOT to use / params。抄这个结构,别写"此工具用于查询轨迹" |
| **§ 7 Meta Tool scope=BOOTSTRAP** | Claude Code 没有直接对应 scope(我们自己独有) | 但 Claude Code 的 "permission escalation"(V04 末段)值得看:**BOOTSTRAP 类 tool 虽然不改业务数据,但改的是"配置状态",UX 上仍要有区分视觉**。在前端 confirmation 面板上用独立 tag `BOOTSTRAP` · 不与 IRREVERSIBLE 视觉混 |
| **§ 6.3 iframe session 注入(proxy)** | (无直接对标 · Claude Code 不做 web proxy) | 参考:Claude Code 的 transient tool(V04 末段)/ hooks 中"仅当前会话生效的状态"。**抽:session 存哪 / 怎么续 · 防止每请求都重登**。代码侧自行实现 |
| **§ 5.1 第 3 步 gen_password_32 + 双写** | Claude Code 的 secret handling / `API key` 存储(Configuration 子章) | 凭证写盘的审慎做法:gitignore 路径 + 权限 `0600` + 不回写 .env。照搬 |

**查阅工作流**:每个子模块实现前 `Read` 对应入口 · 1 行笔记(`ref-src: V04 tool registration 幂等模式 → ensure_organization 照此`)· 进 commit message。

---

## 11 · 测试

- `tests/unit/services/test_observability_bootstrap.py` — mock Langfuse API · 测 8 步每一步 + 幂等 + FAILED 场景
- `tests/unit/services/test_observability_config_repo.py` — AES 加解密 · 单行守卫
- `tests/integration/observability/test_bootstrap_e2e.py` — 实跑 Langfuse container(`docker compose up langfuse-server`)· 验证 admin / org / project / key 全建起来
- `tests/integration/observability/test_degrade.py` — Langfuse 故意停 · backend 启动正常 · `observability_enabled=False` · trace emit 不抛
- `tests/integration/observability/test_external.py` — 给 `LANGFUSE_PUBLIC_KEY` → bootstrap 跳过注册
- `tests/integration/api/test_observatory_api.py` — summary · status · proxy
- `tests/unit/tools/test_observatory_meta_tools.py` — 4 个 Meta Tool 的 scope / description / schema
- `tests/e2e/observatory.spec.ts`(playwright)— 进 `/observatory` → 看到 summary 数字 + iframe 加载(检测 DOM 不是 login 页)

---

## 12 · 开放问题 · Decision defaults

1. **Q**: Langfuse 内部 endpoint `/api/admin/reset-password` 可能没开放 · 怎么"已存在但密码不对"?
   **Default**: v0 方案 —— 在 DB cfg 有 admin_password_encrypted 时,**信任 DB**(bootstrap 每次用 DB 里的密码登录 · 不用 env 除非 env 显式给);如果 DB 也没有 → 当作"坏状态",写 FAILED + cockpit alert,让用户手动处理。不做密码 reset。

2. **Q**: ClickHouse 增加 5-10GB volume 压力,用户接受吗?
   **Default**: 接受。observability 是一等能力。在 `.env.example` 和 README 里明确。v1 可加 `OBSERVABILITY_MODE=minimal` 关 ClickHouse(langfuse v2 后端,功能减)。

3. **Q**: Langfuse version pin 到哪个 major?
   **Default**: `langfuse:3`(当前稳定)· 写死在 compose · 升级走 ADR。

4. **Q**: iframe SSO 跨 origin 会有 cookie SameSite 问题?
   **Default**: proxy 同源(都走 allhands 后端 `/api/observatory/ui/*`)解决。不用 CORS 任何放宽。

5. **Q**: bootstrap 失败,用户在 UI 怎么看?
   **Default**: `/observatory` 顶部有 warning banner + 错误详情 + "重试" 按钮(调 `POST /api/observatory/bootstrap`)。cockpit 健康面板标黄。

---

## 13 · In-scope / Out-of-scope

### In-scope(v0)

- [ ] `docker-compose.yml` 追加 langfuse-server / langfuse-worker / clickhouse + .env.example 补齐
- [ ] `0006_add_observability_config.py` migration
- [ ] `core/observability.py` + `persistence/repos/observability_config_repo.py`(含 AES 加解密)
- [ ] `services/observability_bootstrap.py`(8 步 + 幂等 + retry scheduler)
- [ ] `services/observatory_service.py`(summary + traces 查询 · 调 Langfuse 公共 API)
- [ ] `observability/langfuse_handler.py` 加 `reinit`
- [ ] 4 个 Meta Tool · 6 个 REST endpoint
- [ ] `web/app/observatory/page.tsx` + summary 面板组件
- [ ] iframe proxy 后端实现(同源)
- [ ] cockpit 健康面板接入 bootstrap_status
- [ ] § 11 所有测试
- [ ] `product/04-architecture.md` 新章节 L2.1 Langfuse Bootstrap + § L5.7 Meta Tools 表加 4 条

### Out-of-scope(v1+)

- 多用户 SSO / 每个 allhands 用户一个 Langfuse user
- Langfuse 升级流水线(auto-migrate)
- ClickHouse 关闭模式(minimal)
- Trace 自定义保留期

---

## 14 · DoD checklist

- [ ] 干净 `docker compose up --build` · `/observatory` 90s 内能看到 trace(含 bootstrap 自动完成)
- [ ] 停 langfuse-server 再启 backend · backend 启动正常 · `/observatory` 显示 "disconnected" · 启 langfuse 回来 · 5 min 内自愈
- [ ] `.env` 设外部 Langfuse · bootstrap 跳过(status=external) · trace 写入外部
- [ ] `backend/data/langfuse-admin.txt` 存在 · gitignored · 权限 `0600`
- [ ] DB 里 `secret_key_encrypted` 是密文 · 改 `ALLHANDS_SECRET_KEY` 能看到解密失败 → 自动重跑
- [ ] Lead 对话 `observatory.query_traces(filter={employee_id:"writer"})` 返回合理数据
- [ ] cockpit 健康面板显示 `Langfuse ● ok` / `⚠ bootstrap failed`
- [ ] `./scripts/check.sh` 全绿

---

## 15 · 交给 autopilot 前的最后一步

执行端按:§ 0 必读 → § 10.5 对标 ref-src-claude → § 13 in-scope 逐条推进。

**特别提醒**:
- **Langfuse 自部署版本 API 随版本变化**。动手前**必须**实际启一个 langfuse-server `:3` · 用 curl 把本 spec § 5 每一步的 endpoint 都试一遍(不要只看文档,文档过时概率很大)。发现 endpoint 名 / payload 不匹配 → 优先调整本 spec(PR 附 Decision-log),再开始 service 代码。
- 凭证写盘路径、加密算法、权限位不得"为了简化"省略。安全相关 DoD 一个都不能跳。

---

## Decision-log

- **2026-04-18 创建**:observatory spec 成立;Langfuse 与 allhands 捆绑 compose 自部署 · 默认开启
