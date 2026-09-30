"""Small in-memory login throttle (per client IP + email).

Good enough for a single-process deployment (which the scheduler already
requires). If you ever run several instances, move this to Redis or Mongo.
"""

import time
from collections import defaultdict, deque
from threading import Lock

from app.core.config import settings


class LoginThrottle:
    def __init__(self, max_attempts: int, lockout_seconds: int):
        self.max_attempts = max_attempts
        self.lockout_seconds = lockout_seconds
        self._failures: dict[str, deque] = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._failures[key]
        while q and now - q[0] > self.lockout_seconds:
            q.popleft()
        return q

    def retry_after(self, *keys: str) -> int:
        """Seconds until any of the keys may try again (0 if not locked)."""
        now = time.monotonic()
        wait = 0
        with self._lock:
            for key in keys:
                q = self._prune(key, now)
                if len(q) >= self.max_attempts:
                    wait = max(wait, int(self.lockout_seconds - (now - q[0])) + 1)
        return wait

    def record_failure(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._prune(key, now).append(now)

    def reset(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._failures.pop(key, None)


login_throttle = LoginThrottle(settings.LOGIN_MAX_ATTEMPTS, settings.LOGIN_LOCKOUT_SECONDS)
