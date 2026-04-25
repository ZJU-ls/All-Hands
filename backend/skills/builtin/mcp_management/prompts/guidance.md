# MCP 服务器管理 · allhands.mcp_management

## 何时调用

用户说「加 MCP」「装 filesystem MCP」「test MCP」「让员工用 X 工具」(注:外接 MCP 工具) → 这套技能。

## 工作流

1. **判断 transport** — stdio(本地进程 · fs / git / shell)or http-sse(远端服务)
2. **注册** — `add_mcp_server(name, transport, command/url, args?, env?)`
3. **立刻测** — `test_mcp_connection(server_id)` · handshake 通才算注册成功
4. **看暴露的 tools** — `list_mcp_server_tools(server_id)`
5. **赋权给员工** — 员工的 `tool_ids` 显式加 `mcp.<server_name>.<tool_name>` · 不会默认全开

## 工具地图

| 场景 | 用 |
|---|---|
| 注册 MCP | `add_mcp_server` |
| 改 MCP | `update_mcp_server` |
| 删 MCP | `delete_mcp_server`(IRREVERSIBLE) |
| 测 handshake | `test_mcp_connection` |
| 列 MCP tool | `list_mcp_server_tools` |
| 调试调一个 MCP tool | `invoke_mcp_server_tool` |

## 调用示例

```
# 「装 filesystem MCP · 让 agent 能读本地仓」
add_mcp_server(
  name="filesystem",
  transport="stdio",
  command="npx",
  args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/repo"]
)
test_mcp_connection(server_id="srv_xxx")  # 必须 ok
list_mcp_server_tools(server_id="srv_xxx")  # 看暴露了 read_file / write_file 等
# 然后给员工挂 tool_id "mcp.filesystem.read_file"
```

## 常见坑

- **stdio MCP 在 docker 里要装 npx / python · 系统不预装就 handshake 失败**
- **http-sse URL 必须是 SSE 端点** · 不是普通 HTTP 路径 · 必须返回 `text/event-stream`
- **MCP tool 默认不暴露给员工** — 这是权限边界 · 必须员工 `tool_ids` 显式列才能用
- **修改 env 后** 必须重新 `test_mcp_connection` · 进程重启才生效
- **同一个 MCP server 注册 2 次** · name 必须唯一 · 重复名会被拒

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `test_mcp_connection` 报 "ECONNREFUSED" | http-sse URL 错或目标没启动 · 让用户先启动服务 |
| `test_mcp_connection` stdio 报 "command not found" | command 不存在 · 检查 PATH · docker 内可能要装 nodejs |
| `list_mcp_server_tools` 返回空 | MCP server 已连但没声明 tool · 看对方实现 |
| 员工用某 MCP tool 仍报 "tool not registered" | 员工的 tool_ids 里没显式列 `mcp.<name>.<tool>` · 走 update_employee 加上 |
