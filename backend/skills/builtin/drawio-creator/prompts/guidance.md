# 当用户让你画 drawio 图

按这三步走 · 别即兴写 mxfile,模型自由发挥的 mxfile 八成渲染纯黑。

## 1. 选模板

| 用户在说什么 | 用哪张模板 |
|---|---|
| 流程 / 业务流 / 用户旅程 | `templates/flowchart.drawio.xml` |
| 时序 / 调用链 / 协议交互 | `templates/sequence.drawio.xml` |
| 数据库 / ER / 实体关系 | `templates/er.drawio.xml` |
| 系统架构 / 服务拓扑 | `templates/architecture.drawio.xml` |
| 思维导图 / 大纲展开 | `templates/mindmap.drawio.xml` |

## 2. 拿模板内容

调 `read_skill_file` · `skill_id` 用 `allhands.drawio-creator` · `relative_path` 是上面表里的某一项:

```
read_skill_file(skill_id="allhands.drawio-creator", relative_path="templates/flowchart.drawio.xml")
```

返回的 `content` 就是合规的 mxfile XML 起手 · 已经包含了 `<mxfile>...<mxGraphModel>...<root>` 这些必须的外层骨架。

## 3. 改文字 · 加节点 · 不要重写骨架

模板里的占位符:
- `__TITLE__` · 主标题
- `__NODE_1__` `__NODE_2__` ... · 节点文字
- `__EDGE_1__` ... · 连线文字(若有)

替换占位符 · **保持外层 `<mxfile>` `<mxGraphModel>` `<root>` 这些标签** · 只动节点的 `value` 属性 · 节点数不够就照着已有节点的样式复制粘贴(同一份 `style` 串)。

不要凭空写下面这些 · 容易把图弄坏:
- ❌ 不要省略 `<mxCell id="0"/>` 和 `<mxCell id="1" parent="0"/>` 这两个根
- ❌ 不要删 `<mxGeometry .../>` · drawio 没坐标会全部叠在一起
- ❌ 不要在 `style` 里乱填颜色 · 留默认黑白线条 · 用户后续在编辑器里自己调
- ❌ 不要把 mxfile 包在 `<![CDATA[ ... ]]>` 里 · drawio 的 import 不识别

## 4. 调用 artifact_create

拿到改好的 XML 后:

```
artifact_create({
  "name": "<合理的中文名>.drawio",
  "kind": "drawio",
  "content": "<完整的 mxfile XML>",
  "description": "<一句话说明这张图在表达什么>"
})
```

完成 · **不要把 mxfile 内容回贴给用户** · 调一次 `artifact_render(id)` 让聊天里出预览卡即可。
