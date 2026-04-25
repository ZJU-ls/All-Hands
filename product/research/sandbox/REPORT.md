# allhands 沙箱调研报告

> 范围:为 allhands "数字员工"提供执行任意文件 / 代码 / Office 操作的隔离环境
> 版本:2026-04-25 · v0 调研稿(非 ADR · 决策前的素材)
> 关联:CLAUDE.md §3.1 Tool First · ADR 0017 参考系统(Claude Code) · 后续若选型落定 → 写 ADR

---

## 0. TL;DR

- **目标场景**(用户列出的):写代码 / 整理文件 / 清理无用文件 / 操作 Excel 数据核对 + 类似批量本地任务。
- **核心结论**:这类场景需要的不是"语言级沙箱"(Pyodide / WASI),而是**带持久化工作区的 OS 级容器隔离** —— 文件系统、网络、进程、资源都要可控,且要能"挂载" 用户给定目录。
- **推荐路线**:**主线 Docker(rootless 优先)+ 工作区 bind-mount + seccomp/apparmor + 网络策略**;**云上托管备选 E2B**;**长远观察 Firecracker / microVM 路线**。
- **MVP 落地工作量**:~ 1.5 - 2 周(单 worker 起 docker、池化、Tool 接口、Excel 工具链镜像、超时/限额、审计日志)。
- **必须先于实现的决策**:① 沙箱是"每会话一个长生命周期容器" vs "每 Tool 调用一次性容器"② 工作区在宿主目录 vs 仅在容器内 + 文件下载 ③ 网络默认 deny 还是 allow。

---

## 1. 目标与非目标

### 1.1 目标(必须)

| # | 能力 | 说明 |
|---|------|------|
| C1 | **文件读写** | 限定到一个"工作区"路径下 · 不能逃逸 |
| C2 | **代码执行** | Python / Node / Shell · 装常见库(pandas / openpyxl / numpy / requests) |
| C3 | **Office 操作** | xlsx / docx / pdf 读写 · 至少 openpyxl + LibreOffice headless |
| C4 | **网络可控** | 默认按白名单/黑名单 · 可针对会话开/关 |
| C5 | **资源配额** | CPU / 内存 / 磁盘 / 单次执行时长 |
| C6 | **持久化** | 同一会话跨多次 Tool 调用复用文件 · uvicorn reload / 进程崩溃后能恢复 |
| C7 | **可观测** | 每次执行有 stdout/stderr/exit/耗时 · 进 LangFuse trace |
| C8 | **多租户** | 不同会话 / 不同用户的工作区严格隔离 |

### 1.2 非目标(本期不做)

- 完全防御内核 0day(Docker default 已经够 v0,后续要更高强度才上 gVisor / Firecracker)
- GPU 工作负载(后续 ADR)
- 浏览器自动化(已有 chrome-devtools MCP / `agent-browser` skill,不在沙箱主线)
- Windows 容器(我们暂时只跑 Linux 镜像)

### 1.3 隐含约束(来自 CLAUDE.md)

- **Tool First**:沙箱能力必须以 Meta Tool / Backend Tool 出现,Lead Agent 通过对话能用 · 同时 REST 给 UI 用(ADR 0017 + L01)
- **Pure-Function Loop**:沙箱执行结果走 `InternalEvent` · 不能在 AgentLoop 里藏状态(ADR 0018)
- **Layer Isolation**:`execution/` 调 `services/sandbox/`,`core/` 不许 import docker SDK
- **Confirmation Gate**:写文件 / 删除 / 执行 shell 这种 IRREVERSIBLE 必须走 `DeferredSignal`(L4 护栏)

---

## 2. 开源 / 商业方案横评

按"成熟度 × 我们用得上"分四档。

### 2.1 OS 级容器(主流推荐)

| 方案 | 隔离强度 | 启动 | 文件挂载 | 学习/运维 | 备注 |
|------|---------|------|---------|----------|------|
| **Docker / Podman** | 中(共享内核 + namespace + cgroup) | 100ms-1s | bind-mount 直接 | 低 | 生态最成熟 · rootless 模式可接受 |
| **gVisor** (runsc) | 高(用户态内核拦截 syscall) | 1-2s · 性能损耗 10-30% | OK | 中 | Google 出品 · 防御力远超 docker default |
| **Firecracker** | 极高(KVM microVM) | 100-300ms | virtio-fs / vsock | 高 | AWS Lambda / Fly.io 底座 · 单机密度高 |
| **Kata Containers** | 极高(每容器一 VM) | 1-3s | OK | 高 | OCI 兼容 · 适合多租户 SaaS |

**判断**:v0 用 Docker rootless + seccomp 默认策略 + AppArmor profile 已经覆盖 95% 风险面。gVisor 是最划算的下一步升级(只换 runtime,代码不改)。Firecracker 留给"我们做 SaaS 多租户"那一天。

### 2.2 AI Agent 专用沙箱(直接对标我们)

| 方案 | 形态 | 主要卖点 | 自托管? | 适合我们? |
|------|------|---------|---------|----------|
| **E2B** (e2b.dev) | 云 SaaS · Firecracker microVM · Python/JS SDK | 启动 ~150ms · 文件系统 / 终端 / 端口转发 / 桌面 / 浏览器一站 | 部分(Infra 开源 firecracker-task-driver,但 control plane 不开源) | **强候选**作为云上备选;自托管要自己拼 control plane |
| **Daytona** | 自托管 dev environment · 容器 + DevContainer 规范 | 复用 VS Code DevContainer 镜像生态 | ✅ Apache-2 | 偏"远程 dev workspace",做 agent 一次性沙箱稍重 |
| **microsandbox** (Tristan Built) | OCI + microVM · 单二进制 | "cargo run 就跑"超轻 | ✅ Apache-2 | 还不够稳 · 关注但暂不押 |
| **Modal Sandbox** | SaaS · 按秒计费 | Python 友好 · GPU 现成 | ❌ | 备选(适合需要 GPU 的 agent task) |
| **Runloop / Codesandbox SDK** | SaaS | 起步快 | ❌ | 备选 |
| **OpenHands runtime** (All-Hands-AI) | 自托管 docker-in-docker · 给 agent 用 | 同行实现 · 可读源码学结构 | ✅ MIT | 借鉴架构 · 不直接拿来用(耦合自家 agent) |

**判断**:E2B 是这一档最能"开箱即用"的;但走 SaaS 意味着用户文件外发 → 跟 allhands "自部署"哲学冲突。**自托管主线 = Docker 自己拼**;**E2B 作为 Tool Provider 之一注册进 ToolRegistry**(scope=IRREVERSIBLE · 用户对话里能选)。

### 2.3 进程级 / 语言级(轻量但够不到我们的场景)

| 方案 | 适用 | 为什么不够 |
|------|------|----------|
| **Pyodide / WASI / WebContainer** | 浏览器或边缘跑 Python/JS | 不能跑 LibreOffice · 不能动宿主文件 |
| **nsjail / bubblewrap / firejail** | 单命令快速套个 namespace | 没工作区生命周期管理 · 没池化 · 我们要自己再写一层调度 |
| **macOS sandbox-exec / Linux Landlock** | 进程级文件系统白名单 | 不够防御 · 但**适合本地 dev mode 先跑通**(见 §6) |
| **chroot / FreeBSD jail** | 老派隔离 | 不阻拦 root 逃逸 · 不限网络/cgroup |

### 2.4 Claude Code 是怎么做的

**结论:Claude Code 本身不"沙箱化"** —— 它信任本地用户,靠**权限提示 + 显式工具白名单**把控:

- **Permission system**:每个 Bash / Edit / Write 调用按 `settings.json` 的 `permissions.allow / ask / deny` 三态决定是否弹确认。pre-tool hook 可拒绝。
- **Sandbox 模式(较新)**:在 macOS 用 `sandbox-exec` profile,Linux 用 Landlock + seccomp,默认拒网络 + 限文件写域 ⇒ 这就是 `Bash` 工具上 `dangerouslyDisableSandbox` 那个参数的来源。**这是进程级、单命令的轻沙箱**,不是容器。
- **Hooks**:`PreToolUse` / `PostToolUse` / `SessionStart` 等钩子让用户自己拦截 / 改写工具调用 → 把"沙箱"决定权外置给用户。
- **没有持久化工作区抽象**:CWD = 用户启动 CLI 时的目录,不分租户(单用户 CLI)。
- **MCP 工具走自己的进程**:server 跑在用户机 / 远端,Claude Code 不接管隔离。

**对我们的启发**:

1. **进程级沙箱(sandbox-exec / Landlock)适合"本地 dev 模式" + "Tool 默认更严"的双层防御**:即使我们用 Docker,容器内调用 shell 工具也可以再叠一层 Landlock 把工作区写域锁死。
2. **Permission / Hook 模型直接抄**:我们已经有 ConfirmationGate + DeferredSignal · pre/post hook 接到 sandbox 入口即可。
3. **Claude Code 没解决多租户/持久化** —— 因为它是单用户 CLI;allhands 是"组织平台",必须自己做 workspace 抽象。**这部分没现成可抄,得自己设计**。

---

## 3. 我们要具备的能力(往 Tool 上落)

按 CLAUDE.md §3.1 / §3.6,每个能力都要 ① 后端 service 一份实现 ② Backend Tool 让 Agent 调 ③ 必要时 REST 给 UI 直调。Scope 标注就是 ConfirmationGate 的依据。

### 3.1 必备 Tool 集(MVP)

| Tool ID(草案) | scope | 入参 | 备注 |
|---|---|---|---|
| `allhands.sandbox.create_workspace` | WRITE | `name, template?` | 一个会话/任务一个 workspace · 返回 workspace_id |
| `allhands.sandbox.list_workspaces` | READ | — | |
| `allhands.sandbox.delete_workspace` | IRREVERSIBLE | `workspace_id` | 走 ConfirmationGate |
| `allhands.sandbox.exec` | IRREVERSIBLE | `workspace_id, cmd, timeout, env?` | shell 执行 · 可流式 stdout |
| `allhands.sandbox.read_file` | READ | `workspace_id, path` | sandbox 路径 · ≤ 10MB |
| `allhands.sandbox.write_file` | WRITE | `workspace_id, path, content` | requires_confirmation 看 path 是否在已存在文件 |
| `allhands.sandbox.list_dir` | READ | `workspace_id, path` | |
| `allhands.sandbox.delete_path` | IRREVERSIBLE | `workspace_id, path` | |
| `allhands.sandbox.move_path` | WRITE | `workspace_id, src, dst` | |
| `allhands.sandbox.upload` | WRITE | `workspace_id, dst, bytes` | UI 拖拽进来 |
| `allhands.sandbox.download` | READ | `workspace_id, path` | UI 下载到本地 |
| `allhands.sandbox.run_python` | IRREVERSIBLE | `workspace_id, code, timeout` | 短代码段直接跑 · 内层是 exec 的封装 |
| `allhands.sandbox.snapshot` | WRITE | `workspace_id, label` | 后续做 rollback · 可选 |

> 13 个 tool 看起来多 · 实际后端只有 ~ 5 个 service 方法(workspace 生命周期 · exec · fs · upload/download · snapshot)。Tool 是薄壳。

### 3.2 后续可加(按场景)

- `sandbox.excel.read_sheet` / `write_sheet` / `compare`(基于 openpyxl 的特化 tool · 比 agent 自写 Python 省 token)
- `sandbox.pdf.extract_text`
- `sandbox.git.clone` / `commit` / `diff`(代码场景)
- `sandbox.diagnose`(返回容器状态 / 资源占用 / 最近 N 条日志)

### 3.3 渲染端(L09 / L10)

- `RenderEnvelope` 的 `WorkspaceTree`(目录树)、`FilePreview`(图 / 表 / 文)、`ExecLog`(stdout 流)三个组件 · 走现有 component-registry
- 跟 plan tool / sub-agent trace 一样,在 ToolCallCard 展开区里渲染

---

## 4. 实现方案(主线 · Docker 自托管)

### 4.1 架构分层

```
L05 execution/sandbox/
  ├── runtime.py          # SandboxRuntime ABC(create / exec / fs / destroy)
  ├── docker_runtime.py   # 默认实现:docker SDK
  ├── e2b_runtime.py      # 备选实现:e2b-sdk(后期)
  └── tools/              # 13 个 Tool 的 executor(薄壳 · 调 service)

L06 services/sandbox_service.py
  ├── 池化(预热 N 个 idle 容器)
  ├── 工作区注册(WorkspaceRepo · 持久化到 DB)
  ├── 配额(用户/会话级)
  └── 审计(每次 exec → LangFuse + DB)

L03 persistence/
  ├── models/workspace.py        # id, owner, status, image, created_at, last_used_at, quota_*
  └── models/sandbox_audit.py    # exec 记录

L08/L07 api/
  └── routers/sandbox.py         # REST:列表 / 详情 / 文件浏览 / 下载流(UI 直用)
```

**Layer 检查**:`core/` 没有 docker import;`execution/sandbox/` 不直接 import `docker` 类型暴露给 `services` —— 用自己定义的 `ExecResult` / `WorkspaceHandle` Pydantic DTO。

### 4.2 容器配置(默认 image)

```dockerfile
# allhands/sandbox-base:0.1
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-calc libreoffice-writer \
    poppler-utils \
    git curl jq ripgrep fd-find \
    nodejs npm \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    pandas openpyxl xlsxwriter \
    numpy requests httpx beautifulsoup4 lxml \
    pypdf python-docx \
    pillow

RUN useradd -m -u 1000 sandbox
USER sandbox
WORKDIR /workspace
```

启动参数:

```python
client.containers.run(
    image="allhands/sandbox-base:0.1",
    name=f"ws-{workspace_id}",
    user="1000:1000",
    read_only=True,                       # 根文件系统只读
    tmpfs={"/tmp": "size=256m"},
    volumes={host_workspace_dir: {"bind": "/workspace", "mode": "rw"}},
    network_mode="sandbox-egress",        # 自定 bridge · iptables 限白名单
    mem_limit="2g",
    nano_cpus=2_000_000_000,              # 2 cores
    pids_limit=512,
    cap_drop=["ALL"],
    security_opt=["no-new-privileges:true",
                  "seccomp=/etc/allhands/seccomp.json",
                  "apparmor=allhands-sandbox"],
    detach=True,
    init=True,
)
```

### 4.3 池化 / 生命周期

- **每会话一个长生命周期容器**(默认):exec 一次进 docker exec · 文件累积 · 用户离开 30 分钟 → 容器 stop(workspace 文件留着)· 24h 不动 → 镜像化 + 删容器 · 7d 不动 → 询问归档
- **快速池**:预热 3-5 个 idle 容器,用户开新会话直接绑定(摊薄 1s 启动)
- 容器死 / 宿主重启 → `WorkspaceRepo` 是 SoT,服务起来时按需 re-create container 挂回原 host dir

### 4.4 工作区落盘策略(关键决策)

**选项 A(推荐)**:`{ALLHANDS_DATA}/workspaces/<workspace_id>/` 在宿主上 · bind-mount 进容器
- 优:崩溃不丢 · 备份简单 · UI 走 REST 直读
- 劣:宿主上有真实文件 · 要清理

**选项 B**:容器内 named volume · 仅通过 Tool 取出
- 优:更隔离 · 没"宿主文件残留"
- 劣:UI 文件浏览要走代理 · 容器删 = 数据没

→ **选 A**(allhands 是自部署 · 用户本就拥有宿主)。`ALLHANDS_DATA` 走环境变量,默认 `~/.allhands/data`。

### 4.5 网络策略

- 自建 docker bridge `sandbox-egress`
- iptables 默认 DROP · ALLOW 列表通过 `WorkspaceQuota.allowed_domains`(默认含 pypi / npmjs / github)
- DNS 走自托管 dnsmasq + ipset 解析白名单 → 自动放行 IP
- 用户在 UI 切换"开放公网"开关 → 通过 Meta Tool 改 quota,**WRITE + Confirmation**

### 4.6 与 AgentLoop 的对接(ADR 0018 兼容)

- Tool executor `async def`,调 `services.sandbox_service.exec(...)`
- 长 exec(> 5s)走 `ToolCallProgress` 内部事件流 stdout 给前端
- exec 失败 / 超时 → tool 返回 `{ok: false, exit, stdout, stderr, killed_reason}`,**不抛异常进 loop**(loop 自治判断重试)
- IRREVERSIBLE 走 ConfirmationGate · 审批 payload 里带"将执行的命令 + 工作区 ID + 预估资源"

### 4.7 测试矩阵

```
tests/unit/sandbox/
  test_workspace_repo.py
  test_runtime_protocol.py        # ABC 契约
  test_docker_runtime.py           # 起真 docker · 标 @integration
  test_tools_registration.py       # L01 回归:13 个 tool 都注册 · scope 正确
tests/integration/sandbox/
  test_workspace_lifecycle.py      # create → exec → reload service → exec 仍能用
  test_seccomp_blocks_mount.py     # 沙箱内 mount /etc 应失败
  test_egress_default_deny.py
  test_excel_roundtrip.py          # 拷 fixture xlsx 进去 · openpyxl 改 · 读出来对账
```

---

## 5. 技术选型 · 依赖明细

### 5.1 Python 端

| 依赖 | 用途 | 备注 |
|------|------|------|
| `docker` (SDK) | 起容器 / exec | 主线 · ✅ |
| `aiodocker` | async 版 | 可选 · `docker` 也能在线程池里跑 |
| `python-on-whales` | docker compose 风格 | 不必要 |
| `fastapi.UploadFile` | 文件上传 | 已有 |
| `aiofiles` | 工作区文件流式读写 | 加 |
| `e2b` | 备选 runtime | 后期 |

### 5.2 镜像里的工具栈

- 必装:python3.12 · node20 · git · ripgrep · jq · curl · libreoffice-calc/writer · poppler · pandas/openpyxl/numpy/requests/httpx/pypdf/python-docx/pillow
- 可选(按场景动态加 image variant):tex-live · ffmpeg · playwright · postgres-client

### 5.3 隔离层

- **MVP**:Docker rootless + seccomp default + AppArmor profile + cap_drop=ALL + read_only rootfs + tmpfs
- **升级位**:把 docker runtime 换成 `runsc`(gVisor)· 一行 daemon.json · 代码零改
- **极端模式**:同一 SandboxRuntime ABC 实现一份 firecracker driver(借鉴 microsandbox / firecracker-containerd)

### 5.4 不引入

- ❌ Kubernetes(自部署平台 · 单机起步 · k8s 是包袱)
- ❌ docker-compose 来管 sandbox 容器(我们要程序化生命周期 · 直接用 SDK)
- ❌ E2B 作为唯一方案(自部署哲学冲突)
- ❌ 自己写 namespace/cgroup wrapper(轮子已经够好)

---

## 6. 落地路线(分阶段)

### Phase 0 · 决策窗(本周内)

写 ADR `00NN-sandbox-foundation.md`,定:
- Runtime = Docker rootless(SandboxRuntime ABC 留口)
- 工作区 = 选项 A(宿主 bind-mount)
- 网络 = 默认 deny + 白名单
- 沙箱 / 会话 = 1:1 长生命周期 + 池化预热

### Phase 1 · MVP(1.5 周)

1. `services/sandbox_service.py` + `WorkspaceRepo` + alembic migration
2. `execution/sandbox/runtime.py` ABC + `docker_runtime.py`
3. 5 个核心 tool:`create_workspace` / `exec` / `read_file` / `write_file` / `list_dir`
4. 镜像 `allhands/sandbox-base:0.1` + `Dockerfile.sandbox`(进 repo)
5. 单元 + 集成测试 · L01 注册回归
6. UI:ChatPanel 里 Tool 调用展开渲染 stdout · 文件浏览先用 list_dir + read_file 凑(独立 Workspace 页面留 Phase 2)

### Phase 2 · 体验(1 周)

7. 完整 13 个 Tool · `delete / move / upload / download / snapshot / run_python`
8. REST `routers/sandbox.py` + 独立 `/workspaces/<id>` UI 页面(Tool First 双入口)
9. Excel 特化 Tool · PDF 文本抽取 Tool
10. 配额 / 审计 / 网络白名单 UI

### Phase 3 · 加固(按需)

- gVisor runtime · 网络出口 mTLS proxy · workspace 备份 / 归档
- E2B runtime adapter(为有"我不想暴露宿主"诉求的用户)
- Firecracker / microsandbox 评估

---

## 7. 风险与未决问题

| # | 风险 | 缓解 |
|---|------|------|
| R1 | rootless docker 在某些 Linux 发行版(老内核 / 缺 cgroup v2)起不来 | 文档里给出最低内核 5.13 + 提供 `docker-rootful` 兜底脚本 |
| R2 | Excel 用 LibreOffice headless 在并发下偶发卡死 | 单 ws 串行 · 加 60s 超时 · 严重时切换到 `gnumeric` |
| R3 | 工作区不断膨胀 / 用户传入大文件 | 默认 quota 5GB · 上传大于 100MB 走 confirmation |
| R4 | 容器 escape 0day | 升级路径已在 §5.3 第二档 · v0 接受残余风险并在文档明示 |
| R5 | 多用户并发资源争抢 | `services` 层加全局并发 semaphore + per-user quota |
| R6 | macOS / Windows 开发机怎么跑沙箱? | macOS 用 Docker Desktop(VM 内) · 本地 dev 也支持 `sandbox-exec` adapter 跑无 docker 模式 · 测试只在 Linux CI 跑全套 |

---

## 8. 参考资料

- Claude Code 文档:permission system / hooks / sandbox-exec(macOS)/ Landlock(Linux)
- E2B docs · firecracker-task-driver(开源部分)
- gVisor: https://gvisor.dev/docs/
- Firecracker: https://firecracker-microvm.github.io/
- Docker rootless: https://docs.docker.com/engine/security/rootless/
- OpenHands runtime 源码(同行参考):https://github.com/All-Hands-AI/OpenHands(关注 `openhands/runtime/impl/docker/`)
- microsandbox: https://github.com/microsandbox/microsandbox
- Daytona: https://www.daytona.io/

---

## 9. 给评审者的 3 个问题

1. 自部署哲学下,**E2B 这种 SaaS runtime 是否作为可选项接进来**(允许用户在 UI 里切到"云沙箱")?还是禁掉只走自托管?
2. **沙箱默认网络策略 = deny + 白名单** 是否激进?写代码场景里 pip / npm 必须默认放行,这个白名单要不要做"包管理器一键"?
3. 工作区是否需要"可分享 / 多 agent 共用"?如果要,写隔离要不要做(比如同时只一个 agent 写)?
