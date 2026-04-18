"""Domain error types. Raised by core / services, translated to HTTP in api layer."""

from __future__ import annotations


class DomainError(Exception):
    """Base class for all domain-layer errors."""


class InvariantViolation(DomainError):
    """A domain invariant was violated (e.g., employee has no tools)."""


class ToolNotFound(DomainError):
    def __init__(self, tool_id: str) -> None:
        super().__init__(f"Tool not found: {tool_id}")
        self.tool_id = tool_id


class EmployeeNotFound(DomainError):
    def __init__(self, ref: str) -> None:
        super().__init__(f"Employee not found: {ref}")
        self.ref = ref


class ConfirmationRejected(DomainError): ...


class ConfirmationExpired(DomainError): ...


class MaxIterationsReached(DomainError):
    def __init__(self, employee_name: str, limit: int) -> None:
        super().__init__(f"Employee '{employee_name}' reached max_iterations={limit}")
        self.employee_name = employee_name
        self.limit = limit


class MCPHandshakeFailed(DomainError):
    def __init__(self, server_name: str, detail: str) -> None:
        super().__init__(f"MCP handshake failed for '{server_name}': {detail}")
        self.server_name = server_name
        self.detail = detail


class MaxDispatchDepthExceeded(DomainError):
    """Raised when dispatch_employee would exceed MAX_DISPATCH_DEPTH (agent-design § 6.2 rule 5)."""

    def __init__(self, depth: int, limit: int) -> None:
        super().__init__(f"Dispatch depth {depth} exceeds MAX_DISPATCH_DEPTH={limit}.")
        self.depth = depth
        self.limit = limit


class SubRunFailed(DomainError):
    """Sub-run (dispatched employee) failed before producing a result (§ 6.3)."""

    def __init__(self, employee_id: str, reason: str) -> None:
        super().__init__(f"Sub-run of employee '{employee_id}' failed: {reason}")
        self.employee_id = employee_id
        self.reason = reason
