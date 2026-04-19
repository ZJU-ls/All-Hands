# allhands · Issues(类 Git Issue 的 bug 追踪)

> 本目录存放**产品缺陷**的追踪文件 —— 比 `plans/` 粒度小、比 `error-patterns.md` 时效强。
> 走查 Claude / 执行端 Claude / 用户三方共用,**人读机读都友好**。

---

## 为什么不直接用 GitHub Issue

- 本仓 CI 尚未对接 Issues;走查 Claude 没法 gh api 写
- 文件化 issue 进 git 有历史可 diff · 跨 session 有持久性
- 执行端自己能扫文件判断优先级 · 不依赖网络

未来如果对接 GitHub Issue,脚本从这里同步出去即可 —— 不丢信息。

---

## 目录结构

```
docs/issues/
├── README.md         ← 本文件
├── TEMPLATE.md       ← 新建 issue 拷贝此模板
├── INDEX.md          ← 表格索引(状态为 open/in-progress/blocked 的条目)
├── open/             ← 未解决 · 按 ID 存放
│   └── I-NNNN-<slug>.md
└── closed/           ← 已解决 · 移到此 · 保留历史
    └── I-NNNN-<slug>.md
```

---

## 生命周期

```
[发现] → open/I-NNNN.md (status: open)
     → 执行端拾起 → (status: in-progress)
     → 修完 → (status: closed) → 移到 closed/
     → 修不动 → (status: blocked) → 写 reason + 通知用户
```

**状态字典(frontmatter `status` 合法值)**
- `open` · 未被拾起 · 等修
- `in-progress` · 正在修 · 占用中(同一时刻同一 issue 只许一个 Claude 处理)
- `blocked` · 修不动 · 需要用户授权或外部依赖 · reason 字段必填
- `closed` · 已修 · 移到 closed/ · 必须附 commit sha + 回归测试名

---

## 严重程度(severity)

| 级别 | 含义 | 响应时限 |
|---|---|---|
| **P0** | blocker · 主路径断 · dev 起不来 · 数据丢失 | 下一 commit 前必修 |
| **P1** | 主要功能不可用 · 但有绕行 · 或**用户感知明显**的 UX 违约 | 当天修 |
| **P2** | 小 bug / polish / 文案 / 微互动 | 每周 batch 修 |

**升级规则**(见 [bug-fix-protocol.md](../claude/bug-fix-protocol.md)):
- P1 连续 3 天未修 → 升 P0
- P2 连续 10 天未修 → 升 P1

---

## 新建 issue 的流程

1. `cp docs/issues/TEMPLATE.md docs/issues/open/I-NNNN-<slug>.md`
2. 填 frontmatter + 正文(最少:repro / expected / actual / 证据)
3. 更新 [INDEX.md](INDEX.md) 表格
4. commit:`docs(issues): I-NNNN <一句话>`

---

## 关闭 issue 的流程

1. 在代码里修 + 写测试 · commit
2. issue 文件末尾追加 `## 关闭记录 · YYYY-MM-DD`:commit sha + 测试名 + 回归防御
3. 移文件:`mv docs/issues/open/I-NNNN-*.md docs/issues/closed/`
4. 更新 INDEX.md(从表格里删掉该行)
5. commit:`fix(I-NNNN): <一句话> + 回归测试 <test_name>`

**不许只改状态不移文件** —— INDEX.md 必须只显示还在 open/in-progress/blocked 的条目,closed 列在 `git log -- docs/issues/closed/` 自取。

---

## 给执行端 Claude 的约束

见 [`docs/claude/bug-fix-protocol.md`](../claude/bug-fix-protocol.md)。简短版:

- **每 task 结束前扫一次 open/ · P0 不清不给自己放行**
- **每天第一个 commit 前过一遍 INDEX · P1 挑一条今天修**
- **遇到新 bug 不许"顺手修" · 先立 issue · 除非它就是本 task 的阻塞**
- **修完必须迁到 closed/ · 不许只改 status**

---

## 和 `docs/claude/error-patterns.md` 的区别

| 维度 | issues/ | error-patterns.md |
|---|---|---|
| 对象 | **具体这一次**出现的 bug | 已经出现**两次以上**的**模式** |
| 生命周期 | open → closed · 几天级 | 永久 · 归档不删 |
| 粒度 | 一个具体 symptom | 一类 symptom 的根因 + 修法 |
| 谁读 | 执行端拾起 bug 时 | 动手前读一遍对应章节 |

**关系**:一个 P0 issue 被修好后,如果**根因是某类反复错**,在 error-patterns.md 新增一条 `E{nn}`;单次偶发的 bug 就停留在 closed/ · 不升级为 pattern。
