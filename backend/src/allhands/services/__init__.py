"""Services layer (L6). Application-level use cases composed from execution + persistence.

No framework types (FastAPI, LangGraph) leak here — services receive and return
plain core/ domain objects. The api/ layer translates those to HTTP / SSE.
"""
