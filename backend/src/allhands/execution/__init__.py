"""Execution layer (L5).

Owns: ToolRegistry, AgentRunner (LangGraph create_react_agent wrapper),
ConfirmationGate, MCP client adapter, SkillRegistry. All LangGraph / LangChain /
mcp types must stay inside this package; nothing above services/ should know
they exist.

v0 scaffold lands in this package incrementally per plans/0001-mvp-v0.md.
"""
