# workflow: 删 / 置顶 / 标签

## 删 (artifact_delete)

```
artifact_delete(artifact_id="abc")
```

- `IRREVERSIBLE` scope · 弹严肃 confirmation
- 软删 · artifact 30 天内可恢复(数据未真删)· 但用户视角"消失了"
- **只在用户明说时调** —— 「删掉那个 X」「不要 Y 了」「remove the deck」

不要主动删:
- 「这版不好」 → 不是删,是 update 改 / rollback 回去
- 「太多了,清理一下」 → 让用户挑哪些删 · 不要批量自决

## 置顶 (artifact_pin)

```
artifact_pin(artifact_id="abc", pinned=true)   # 置顶
artifact_pin(artifact_id="abc", pinned=false)  # 取消
```

pinned artifacts 在制品面板永远在最上面。适合用户说「这个常用的标记一下」「保留它」。

## 标签 (tags 字段)

`artifact_create` / `artifact_update` 接 `tags: [...]`。同一 artifact 一次写一组(覆盖 · 不是追加)。

```
artifact_create({
  ...,
  tags: ["q1-report", "draft", "internal"]
})
```

list / search 可按 tags 过滤(`artifact_list({tag: "q1-report"})`)。

## 常见坑

- ❌ 用 delete 当 update —— 用户说「重做一份」可能是想覆盖,不是删
- ❌ 主动 pin 大批 artifact 让面板"看起来整齐" → 反而让置顶失去意义
- ❌ tags 写太长(完整句子) → 当成关键词用 · 短(1-2 词)

## 总原则

**写制品的 agent 不主导清理。** 用户主导,你执行。
