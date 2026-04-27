# workflow: 版本与回滚

## 版本怎么涨

每次 `artifact_update` 成功 → version + 1。前一版本不删,保留在 ArtifactVersion 表。

`Artifact.version` 字段 = 当前最新版本号。
列出历史:用户在制品面板 version switcher 里看(或后端 endpoint;agent 一般不需要直接查)。

## rollback · 回到前一版

用户说「回到 v3」「撤销刚才的改动」「上一版好看,用回上一版」:

```
artifact_rollback(artifact_id="abc", to_version=3)
```

- 注意:rollback 创建一个**新版本**(v{N+1}),内容拷自 to_version。**不**删除 v{N+1} 之前的版本(历史完整保留)
- 弹 confirmation gate(rollback 是 IRREVERSIBLE 范畴)
- 用户确认后,artifact 当前版本变成新的 v{N+1},内容是 v3 的

## 决定回滚还是新建

| 用户语义 | 工具 |
|---|---|
| 「撤销刚才的改」「回到上一版」 | `artifact_rollback(id, to_version=N-1)` |
| 「这次改方向不对,完全推倒重来」 | `artifact_update(id, mode=overwrite, content=新内容)` |
| 「保留旧版本作存档,新建一份」 | `artifact_create(...)` 创新 artifact · 别污染旧 id |

## 常见坑

- ❌ 把 rollback 当成"删除某个版本" → rollback 不删,只是把当前指针指回去 · 历史一直在
- ❌ rollback 用错 to_version(超出范围)→ 报错 · 先 list versions
- ❌ 多人并发改同一 artifact → 版本号会乱 · agent 操作前总 read 拿最新 v

## 失败兜底

| 现象 | 做什么 |
|---|---|
| `to_version` 超出 | `artifact_read(id)` 看当前 v · 选合法值 |
| 用户后悔 rollback | 再 rollback 到 rollback 之前的 v 就回来了 |
