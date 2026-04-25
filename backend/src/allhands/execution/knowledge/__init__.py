"""KB execution package — parsers, chunker, embedder, vec store, retriever, ingest.

Stays in L5 (execution). Public surface re-exported here so the service
layer above only imports `allhands.execution.knowledge`.
"""

from allhands.execution.knowledge.chunker import Chunker, ChunkerConfig
from allhands.execution.knowledge.parsers import (
    Parser,
    ParseResult,
    Section,
    detect_mime,
    get_parser_for,
    register_parser,
)

__all__ = [
    "Chunker",
    "ChunkerConfig",
    "ParseResult",
    "Parser",
    "Section",
    "detect_mime",
    "get_parser_for",
    "register_parser",
]
