"""`allhands-seed` CLI — dev-only convenience for driving seed_service.

Two subcommands:

- `allhands-seed dev`     · idempotent run of `ensure_all_dev_seeds`
- `allhands-seed reset`   · drop every row from seeded tables, then reseed

Safety: `reset` refuses to run unless `ALLHANDS_ENV=dev`. Production operators
who set `ALLHANDS_SEED=1` to get one-shot seeding never get a destructive path.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import TYPE_CHECKING

from allhands.config import get_settings
from allhands.persistence.db import get_sessionmaker
from allhands.persistence.orm.models import (
    ConversationRow,
    EmployeeRow,
    EventRow,
    LLMModelRow,
    LLMProviderRow,
    MCPServerRow,
    MessageRow,
)
from allhands.services import seed_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# Rows cleared by `reset`. Order is child → parent so FKs don't trip.
_RESET_TABLES = (
    MessageRow,
    ConversationRow,
    EventRow,
    LLMModelRow,
    LLMProviderRow,
    EmployeeRow,
    MCPServerRow,
)


async def _do_dev() -> int:
    settings = get_settings()
    settings.ensure_data_dir()
    maker = get_sessionmaker()
    async with maker() as session, session.begin():
        report = await seed_service.ensure_all_dev_seeds(session)
    print("seed.dev.done")
    print(f"  providers     : {report.providers}")
    print(f"  models        : {report.models}")
    print(f"  employees     : {report.employees}")
    print(f"  skill mounts  : {report.skills_mount}")
    print(f"  mcp servers   : {report.mcp_servers}")
    print(f"  conversations : {report.conversations}")
    print(f"  events        : {report.events}")
    if report.warnings:
        print("  warnings:")
        for w in report.warnings:
            print(f"    - {w}")
    return 0


async def _do_reset() -> int:
    env = os.environ.get("ALLHANDS_ENV", get_settings().env)
    if env != "dev":
        print(
            f"allhands-seed reset refused: ALLHANDS_ENV={env!r} (only 'dev' allowed).",
            file=sys.stderr,
        )
        return 2

    settings = get_settings()
    settings.ensure_data_dir()
    maker = get_sessionmaker()

    async with maker() as session, session.begin():
        for row_type in _RESET_TABLES:
            await _truncate(session, row_type)

    async with maker() as session, session.begin():
        report = await seed_service.ensure_all_dev_seeds(session)

    print("seed.reset.done")
    print(f"  cleared tables : {len(_RESET_TABLES)}")
    print(
        f"  reseeded       : {report.providers} providers, "
        f"{report.employees} employees, {report.events} events"
    )
    return 0


async def _truncate(session: AsyncSession, row_type: type) -> None:
    from sqlalchemy import delete

    await session.execute(delete(row_type))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="allhands-seed",
        description="Dev-only seed runner. See docs/issues/open/I-0020.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("dev", help="Idempotently ensure all dev seed data exists.")
    sub.add_parser(
        "reset",
        help="Wipe seeded tables and reseed. Requires ALLHANDS_ENV=dev.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "dev":
        return asyncio.run(_do_dev())
    if args.command == "reset":
        return asyncio.run(_do_reset())
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
