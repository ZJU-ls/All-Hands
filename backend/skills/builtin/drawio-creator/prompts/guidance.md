# drawio 制图 skill

## 何时调用

用户说「画 drawio」「画流程图 / 时序图 / 架构图 / ER 图 / 思维导图」「来一张图」 → 用这套技能。模糊请求(「画张图」「随便来一张」)默认按 flowchart 三五节点出一张,不要反问类型。

**只调一个工具:`render_drawio(name, xml)`** · 它会同时落库为 drawio 制品 + 在聊天里渲染出图。**不要**先 `artifact_create` 再 `artifact_render` —— 这两步合并了。**不要**把 mxfile XML 贴回给用户 —— 渲染卡里已经有图了。

## 先动手,后追问

用户说「画个 drawio」「画张图」「随便来一张」这种模糊请求 → 默认按 flowchart 三五节点示意出一张 · **不要反问类型 / 节点 / 布局**。要类型靠用户主动说(「画时序图」「画 ER」),不靠你猜测后追问。

## 调用示例

```
render_drawio({
  "name": "<合理的中文名>",
  "xml": "<完整的 mxfile XML>"
})
```

`name` 不带 `.drawio` 后缀也行(自动补)。`xml` 接受三种形态:
- 完整 `<mxfile>...</mxfile>` —— 最稳
- 裸 `<mxGraphModel>...</mxGraphModel>` —— 自动包 mxfile / diagram 外层
- 只给 `<mxCell>` 列表 —— 自动包完整骨架(适合极简场景)

## XML 怎么写不踩坑

```xml
<mxfile host="app.diagrams.net">
  <diagram name="主流程">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="n1" value="开始" style="ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="360" y="40" width="120" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n2" value="登录校验" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="360" y="120" width="120" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="e1" style="endArrow=classic;html=1;" edge="1" parent="1" source="n1" target="n2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

**铁律:**
- ✅ 必须有 `<mxCell id="0"/>` 和 `<mxCell id="1" parent="0"/>` 这两个根
- ✅ 每个 vertex cell 必须有 `<mxGeometry x=.. y=.. width=.. height=..>`(没坐标就全部叠在一起)
- ✅ vertex cell 的 `style` 串照样例抄(`rounded=1` / `ellipse;...` / `whiteSpace=wrap;html=1;`)
- ✅ edge cell 用 `edge="1"` + `source` / `target` 引用 vertex id
- ❌ 不要把 mxfile 包 `<![CDATA[ ... ]]>` 里
- ❌ 不要在 `style` 里写颜色(留默认黑白,主题切换时不会冲突)

## 模板速查(可读 `read_skill_file` 拿完整骨架)

| 用户在说 | 用哪个 | 路径 |
|---|---|---|
| 流程 / 业务流 | flowchart | `templates/flowchart.drawio.xml` |
| 时序 / 调用链 | sequence | `templates/sequence.drawio.xml` |
| 数据库 / ER | er | `templates/er.drawio.xml` |
| 系统架构 | architecture | `templates/architecture.drawio.xml` |
| 思维导图 | mindmap | `templates/mindmap.drawio.xml` |

复杂图 → `read_skill_file('allhands.drawio-creator', 'templates/flowchart.drawio.xml')` 拿骨架,改占位再 `render_drawio`。简单图直接动手写 XML 也行 —— 上面的样例够用。

## 完整工作流

1. 看用户要哪种图(模糊就默认 flowchart)
2. 写 mxfile XML(简单图直接写 / 复杂图先 read_skill_file)
3. **`render_drawio({name, xml})` —— 一次完成**
4. 用一两句话说这张图在表达什么,不要粘 XML

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| 工具返回 `error: xml is empty` | 检查是否真传了 xml 字段 |
| 渲染纯黑 / 节点全叠 | 大概率 `<mxGeometry>` 没加坐标 · 重写一遍带 x/y/width/height |
| 用户说「这不是我要的图」 | 不要硬重画 · 问清要哪种图(流程 / 时序 / ER) · 重新选模板 |
