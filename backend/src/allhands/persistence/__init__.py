"""Persistence layer (L3).

Owns SQLAlchemy models (ORM) and repository interfaces. Depends only on core/.
Do NOT import api/, services/, or execution/ here.
"""

from allhands.persistence.db import get_engine, get_sessionmaker
from allhands.persistence.orm import Base

__all__ = ["Base", "get_engine", "get_sessionmaker"]
