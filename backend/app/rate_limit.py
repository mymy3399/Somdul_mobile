import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# In-memory per-IP sliding window. Fine for a single-process deployment;
# would need a shared store (e.g. Redis) behind multiple workers/instances.
_attempts: dict[str, deque] = defaultdict(deque)


def rate_limiter(max_attempts: int, window_seconds: int):
    def _check(request: Request):
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        bucket = _attempts[client_ip]

        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()

        if len(bucket) >= max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่อีกครั้งในภายหลัง",
            )

        bucket.append(now)

    return _check
