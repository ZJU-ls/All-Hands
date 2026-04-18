"""APScheduler wrapper for timer triggers — spec § 5.1.

Owns an AsyncIOScheduler instance and keeps its jobs in sync with the
enabled timer-kind triggers in the repo. The FastAPI lifespan calls
`start()` on startup and `shutdown()` on shutdown; CRUD routes call
`reload()` so job state tracks persistence.

Each job is a thin callback → `fire_callback(trigger, TIMER)`. The
scheduler does not know about defenses or action handlers; that is the
executor's job.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from allhands.core import Trigger, TriggerFire, TriggerFireSource, TriggerKind

FireCallback = Callable[[Trigger, TriggerFireSource], Awaitable[TriggerFire]]
FetchCallback = Callable[[str], Awaitable[Trigger | None]]

logger = logging.getLogger(__name__)


def _cron_to_apscheduler(cron: str, timezone: str) -> CronTrigger:
    """Parse 5-field cron ("m h dom mon dow") into an APScheduler CronTrigger."""
    fields = cron.split()
    if len(fields) != 5:
        raise ValueError(f"cron must have 5 fields, got {len(fields)}: {cron!r}")
    minute, hour, day, month, dow = fields
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=dow,
        timezone=timezone,
    )


class TimerScheduler:
    def __init__(
        self,
        fire_callback: FireCallback,
        fetch_callback: FetchCallback,
    ) -> None:
        self._fire = fire_callback
        self._fetch = fetch_callback
        self._scheduler = AsyncIOScheduler()

    async def start(self) -> None:
        if not self._scheduler.running:
            self._scheduler.start()

    async def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def add_trigger(self, trigger: Trigger) -> None:
        if trigger.kind is not TriggerKind.TIMER or not trigger.enabled:
            return
        if trigger.timer is None:
            raise ValueError(f"timer trigger {trigger.id} missing timer spec")
        try:
            apt = _cron_to_apscheduler(trigger.timer.cron, trigger.timer.timezone)
        except Exception as exc:
            logger.warning(
                "timer.cron.invalid",
                extra={"trigger_id": trigger.id, "error": str(exc)},
            )
            return
        self._scheduler.add_job(
            self._run_job,
            trigger=apt,
            id=trigger.id,
            args=[trigger.id],
            replace_existing=True,
        )

    def remove_trigger(self, trigger_id: str) -> None:
        if self._scheduler.get_job(trigger_id) is not None:
            self._scheduler.remove_job(trigger_id)

    async def reload(self, triggers: list[Trigger]) -> None:
        """Replace the current job set with one derived from `triggers`."""
        wanted = {t.id for t in triggers if t.kind is TriggerKind.TIMER and t.enabled}
        for job in list(self._scheduler.get_jobs()):
            if job.id not in wanted:
                self._scheduler.remove_job(job.id)
        for t in triggers:
            self.add_trigger(t)

    def job_ids(self) -> list[str]:
        return [job.id for job in self._scheduler.get_jobs()]

    async def _run_job(self, trigger_id: str) -> None:
        trigger = await self._fetch(trigger_id)
        if trigger is None or not trigger.enabled:
            return
        try:
            await self._fire(trigger, TriggerFireSource.TIMER)
        except Exception:
            logger.exception("timer.fire.failed", extra={"trigger_id": trigger_id})


__all__ = ["TimerScheduler"]
