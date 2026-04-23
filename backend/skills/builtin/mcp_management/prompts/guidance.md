# MCP 服务器管理 · allhands.mcp_management

管理 Model Context Protocol 服务器。MCP = 标准化的"外接工具包",一条配置 = 一堆 tool。

## 工具地图

| 场景 | 用这个 |
|---|---|
| 注册一个新 MCP 服务器(stdio / http-sse) | `add_mcp_server` |
| 改 MCP 配置(env / args / URL) | `update_mcp_server` |
| 删 MCP 服务器 | `delete_mcp_server`(IRREVERSIBLE) |
| 验证 MCP handshake 是否成功 | `test_mcp_connection` |
| 看某 MCP 暴露了哪些 tool(list_tools RPC) | `list_mcp_server_tools` |
| 直接调用 MCP 的某个 tool(调试用) | `invoke_mcp_server_tool` |

## 工作套路

1. **stdio vs http-sse** —— stdio 适合本地进程(fs / git / shell),http-sse 适合远端服务(你的 API / 他人的 public MCP)。用户说"装 filesystem" = stdio + npx @modelcontextprotocol/server-filesystem。
2. **先 test 后绑** —— `add_mcp_server` 后立刻 `test_mcp_connection`;不通就改配置再测,不要让用户绑完 3 个员工才发现 handshake 失败。
3. **工具暴露范围** —— 默认**不暴露** MCP 的所有 tool 给所有员工。员工要用某个 MCP tool,得在员工的 `tool_ids` 里显式写 `mcp.<server_name>.<tool_name>`。这是权限边界,不要默认打开。
