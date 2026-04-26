# kind: drawio · 流程 / 时序 / 架构 / ER / 思维导图

## 何时用

- 用户说「画 drawio / 画流程图 / 时序图 / ER 图 / 架构图 / 思维导图 / 画张图」
- 需要后续用户在制品区编辑器里继续拖动改的
- 节点 + 连线 = 关系性表达,不是单纯文本

## 何时**不**用

- 简单关系链(< 5 节点)→ `mermaid` 更轻
- 数据图表(柱 / 饼 / 折线)→ `render_*` 即时图表 tools
- 截图式产物 → `image` (base64)

## 工具(单调用)

```
render_drawio({
  name: "<descriptive>",     # .drawio 后缀自动补
  xml: "<完整 mxfile XML>"
})
```

**唯一一个工具搞定** —— 落库 + 在聊天里渲染 + 用户能在制品区双击编辑。**不要**再调 `artifact_create` 和 `artifact_render`。

`xml` 接受三种形态(自动补外层):
- 完整 `<mxfile>...</mxfile>` —— 推荐
- 裸 `<mxGraphModel>...</mxGraphModel>` —— 自动包 mxfile / diagram
- 只给 `<mxCell>` 列表 —— 自动包完整骨架

## 设计契约 · 立体 · 圆角 · 阴影

drawio 默认渲染会偏几何朴素。allhands 的图要**好看**:圆角节点 / 柔和阴影 / 颜色家族化 / 间距合理。

### 节点 style 参考(直接复制粘贴)

| 角色 | style 串 |
|---|---|
| 起点 / 入口 | `ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;rounded=1;` |
| 普通处理 | `rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#5b6472;strokeWidth=1.5;shadow=1;` |
| 强调 / 关键 | `rounded=1;whiteSpace=wrap;html=1;fillColor=#e1ecf4;strokeColor=#1f5582;strokeWidth=2;shadow=1;fontStyle=1;` |
| 决策菱形 | `rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;shadow=1;` |
| 数据库 / 存储 | `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#d5e8d4;strokeColor=#82b366;shadow=1;` |
| 外部系统 / 用户 | `shape=actor;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;shadow=1;` |
| 错误 / 异常路径 | `rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;shadow=1;dashed=1;` |
| 子流程 / 分组 | `rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;shadow=0;dashed=1;verticalAlign=top;` |

### 边线 style 参考

| 类型 | style 串 |
|---|---|
| 标准箭头 | `endArrow=classic;html=1;rounded=1;strokeColor=#5b6472;strokeWidth=1.5;` |
| 强调流向 | `endArrow=classic;html=1;rounded=1;strokeColor=#2563eb;strokeWidth=2;` |
| 弱依赖 / 异步 | `endArrow=open;html=1;rounded=1;strokeColor=#8a93a3;dashed=1;` |
| 双向 | `startArrow=classic;endArrow=classic;html=1;rounded=1;strokeColor=#5b6472;` |

### 颜色家族(同一张图保持一致)

allhands 默认色板(蓝灰主调 + 状态色):

```
主流程蓝   #dae8fc / 边 #6c8ebf
强调蓝     #e1ecf4 / 边 #1f5582
警告黄     #fff2cc / 边 #d6b656
成功绿     #d5e8d4 / 边 #82b366
错误红     #f8cecc / 边 #b85450
中性灰     #f5f5f5 / 边 #666666
```

**一张图 ≤ 3 个色族**,不要彩虹。

### 必备:`shadow=1`

每个 vertex cell 加 `shadow=1` —— 给阴影,立刻立体。配合 `rounded=1` 圆角节点,出图就比默认直角好看 50%。

### 间距规则

- 同行节点水平间距 ≥ 80px
- 上下层级垂直间距 ≥ 80px
- 节点尺寸 default 120x60(ellipse 120x50 / 决策 120x70)
- 标签 `value` 文字尽量 ≤ 10 字,长了换行 `&#xa;`

## XML 完整示例:登录流程

```xml
<mxfile host="app.diagrams.net" agent="allhands">
  <diagram name="登录流程">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>

        <mxCell id="start" value="用户提交账号密码"
                style="ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;"
                vertex="1" parent="1">
          <mxGeometry x="340" y="40" width="160" height="50" as="geometry"/>
        </mxCell>

        <mxCell id="check" value="格式校验"
                style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#5b6472;strokeWidth=1.5;shadow=1;"
                vertex="1" parent="1">
          <mxGeometry x="360" y="140" width="120" height="60" as="geometry"/>
        </mxCell>

        <mxCell id="db" value="查询用户表"
                style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#d5e8d4;strokeColor=#82b366;shadow=1;"
                vertex="1" parent="1">
          <mxGeometry x="360" y="240" width="120" height="80" as="geometry"/>
        </mxCell>

        <mxCell id="judge" value="账号匹配?"
                style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;shadow=1;"
                vertex="1" parent="1">
          <mxGeometry x="360" y="360" width="120" height="70" as="geometry"/>
        </mxCell>

        <mxCell id="ok" value="发放 token&#xa;返回成功"
                style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1ecf4;strokeColor=#1f5582;strokeWidth=2;shadow=1;fontStyle=1;"
                vertex="1" parent="1">
          <mxGeometry x="200" y="480" width="140" height="60" as="geometry"/>
        </mxCell>

        <mxCell id="fail" value="返回 401"
                style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;shadow=1;dashed=1;"
                vertex="1" parent="1">
          <mxGeometry x="500" y="480" width="120" height="60" as="geometry"/>
        </mxCell>

        <mxCell id="e1" style="endArrow=classic;html=1;rounded=1;strokeColor=#5b6472;strokeWidth=1.5;" edge="1" parent="1" source="start" target="check">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e2" style="endArrow=classic;html=1;rounded=1;strokeColor=#5b6472;strokeWidth=1.5;" edge="1" parent="1" source="check" target="db">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e3" style="endArrow=classic;html=1;rounded=1;strokeColor=#5b6472;strokeWidth=1.5;" edge="1" parent="1" source="db" target="judge">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e4" value="是" style="endArrow=classic;html=1;rounded=1;strokeColor=#2563eb;strokeWidth=2;" edge="1" parent="1" source="judge" target="ok">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e5" value="否" style="endArrow=classic;html=1;rounded=1;strokeColor=#b85450;strokeWidth=2;" edge="1" parent="1" source="judge" target="fail">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## 复杂图 → 用模板

记不住完整骨架时,先 `read_skill_file('allhands.artifacts', 'templates/drawio/<type>.drawio.xml')` 拉骨架,再改占位符 (`__TITLE__` / `__NODE_*__` / `__EDGE_*__`)。

| 类型 | 模板路径 |
|---|---|
| 流程图 | `templates/drawio/flowchart.drawio.xml` |
| 时序图 | `templates/drawio/sequence.drawio.xml` |
| ER 图 | `templates/drawio/er.drawio.xml` |
| 系统架构 | `templates/drawio/architecture.drawio.xml` |
| 思维导图 | `templates/drawio/mindmap.drawio.xml` |

## 铁律(违反 = 渲染翻车)

- ✅ 必须 `<mxCell id="0"/>` + `<mxCell id="1" parent="0"/>` 两个根
- ✅ 每个 vertex 必须有 `<mxGeometry x= y= width= height=>` 否则全部叠在一起
- ✅ edge 用 `edge="1"` + `source` / `target` 引用 vertex id
- ✅ 默认加 `shadow=1` 立刻立体
- ❌ 不要把 mxfile 包在 `<![CDATA[...]]>` 里
- ❌ 不要 fontStyle=2(斜体)— drawio 中文斜体丑
- ❌ 不要在 `style` 里乱填字体 — 留默认

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 渲染纯黑 | 大概率 mxGeometry 漏了坐标 · 重新检查每个节点的 x/y/width/height |
| 节点全叠在 (0,0) | 同上 · `<mxGeometry>` 必须显式给坐标 |
| 用户说「太丑了」 | 加 `shadow=1` + 改 fillColor 为色板里的柔和色 + 加 strokeWidth |
| 用户说「不是这种类型」 | 别硬重画 · 问清楚要哪种(流程 / 时序 / ER) · 重选模板 |
