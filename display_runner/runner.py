"""Acknowledged, bounded bridge from approved RGB frames to the organizer display."""
from __future__ import annotations

import fcntl
import hashlib
import http.client
import json
import math
import os
import re
import signal
import ssl
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

import certifi

ROWS, COLS, CHANNELS = 17, 9, 3
FRAME_BYTES = ROWS * COLS * CHANNELS
FPS = 30
REQUEST_TIMEOUT = 2.0
MAX_FRAME_AGE_MS = 750
MAX_FUTURE_SKEW_MS = 250
MAX_FAILURES = 5
USER_AGENT = "hackthisbuilding-display-runner/2.0"


def load_env() -> None:
    path = Path(__file__).parent / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if line and not line.lstrip().startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                os.environ.setdefault(name.strip(), value.strip())


def blank_frame() -> list[list[list[int]]]:
    return [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]


def validate_frame(value: object) -> list[list[list[int]]]:
    if not isinstance(value, list) or len(value) != ROWS:
        raise ValueError("frame must have exactly 17 rows")
    for row in value:
        if not isinstance(row, list) or len(row) != COLS:
            raise ValueError("each frame row must have exactly 9 columns")
        for pixel in row:
            if not isinstance(pixel, list) or len(pixel) != CHANNELS or any(type(channel) is not int or not 0 <= channel <= 255 for channel in pixel):
                raise ValueError("each pixel must contain three integer RGB channels")
    return value


def encode_frame(frame: object) -> bytes:
    return bytes(channel for row in validate_frame(frame) for pixel in row for channel in pixel)


def validate_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("display feed must be an object")
    validate_frame(payload.get("frame"))
    if not isinstance(payload.get("displayId"), str) or not 1 <= len(payload["displayId"]) <= 256:
        raise ValueError("display feed returned an invalid display ID")
    if type(payload.get("sequence")) is not int or payload["sequence"] < 0 or type(payload.get("static")) is not bool:
        raise ValueError("display feed returned invalid sequence metadata")
    generated_at = payload.get("generatedAt")
    if type(generated_at) not in (int, float) or not math.isfinite(generated_at):
        raise ValueError("display feed must include its server generation timestamp")
    age = time.time() * 1000 - generated_at
    if age > MAX_FRAME_AGE_MS or age < -MAX_FUTURE_SKEW_MS:
        raise ValueError("display frame expired or the source clock is out of sync")
    return payload


class InstanceLock:
    """Prevent two local processes from interleaving writes to one target."""
    def __init__(self, target_url: str, directory: Path | None = None) -> None:
        directory = directory or Path(tempfile.gettempdir())
        name = hashlib.sha256(target_url.encode()).hexdigest()[:24]
        self.path = directory / f"hackthisbuilding-display-{name}.lock"
        self.file = None

    def __enter__(self) -> "InstanceLock":
        self.file = self.path.open("a+")
        try:
            fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.file.close()
            self.file = None
            raise RuntimeError("another local runner already owns this display instance") from error
        return self

    def __exit__(self, *_: object) -> None:
        if self.file is not None:
            fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            self.file.close()
            self.file = None
        # Keep the inode: unlinking creates a race with another process's flock.


class Display(Protocol):
    def makeframe(self) -> list[list[list[int]]]: ...
    def send(self, frame: object) -> None: ...
    def close(self) -> None: ...


class PersistentHTTP:
    """One bounded HTTP/1.1 connection per origin, with no hidden POST retries."""
    def __init__(self, url: str, context: ssl.SSLContext) -> None:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("display connection requires an HTTP(S) origin")
        self.origin = (parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        self.context = context
        self.connection: http.client.HTTPConnection | None = None

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def request(self, method: str, url: str, *, body: bytes | None = None, headers: dict[str, str] | None = None, statuses: tuple[int, ...] = (200,), maximum: int = 4096) -> bytes:
        parsed = urlsplit(url)
        origin = (parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        if origin != self.origin:
            raise ValueError("a persistent display connection cannot change origins")
        try:
            if self.connection is None:
                scheme, host, port = self.origin
                if scheme == "https":
                    self.connection = http.client.HTTPSConnection(host, port, timeout=REQUEST_TIMEOUT, context=self.context)
                else:
                    self.connection = http.client.HTTPConnection(host, port, timeout=REQUEST_TIMEOUT)
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            self.connection.request(method, path, body=body, headers={"User-Agent": USER_AGENT, **(headers or {})})
            response = self.connection.getresponse()
            declared = response.getheader("Content-Length")
            if declared is not None and int(declared) > maximum:
                raise ValueError("display HTTP response is too large")
            # Consume even status POST bodies before reusing this connection.
            content = response.read(maximum + 1)
            if len(content) > maximum:
                raise ValueError("display HTTP response is too large")
            if response.status not in statuses:
                raise RuntimeError(f"unexpected display HTTP response {response.status}")
            if response.will_close:
                self.close()
            return content
        except Exception:
            self.close()
            # The outer runner decides whether to retry; uncertain POST delivery
            # is never retried within this transport layer.
            raise


class WebDisplay:
    """A send succeeds only after the target acknowledges the exact RGB bytes."""
    def __init__(self, instance: str, base_url: str = "https://sundai.willsarg.com/api") -> None:
        if not re.fullmatch(r"[a-z]+-[a-z]+", instance):
            raise ValueError("GREEN_BUILDING_INSTANCE must be the server-issued adjective-animal name")
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("GREEN_BUILDING_API must be an HTTP(S) URL")
        self.url = f"{base_url.rstrip('/')}/i/{instance}/frame"
        self.context = ssl.create_default_context(cafile=certifi.where())
        self.http = PersistentHTTP(self.url, self.context)
        self.last_send = -math.inf

    def makeframe(self) -> list[list[list[int]]]:
        return blank_frame()

    def send(self, frame: object) -> None:
        payload = encode_frame(frame)
        # Include fallback/retry frames in the target's rate limit as well.
        delay = self.last_send + 1 / FPS - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self.last_send = time.monotonic()
        self.http.request("POST", self.url, body=payload, headers={"Content-Type": "application/octet-stream"}, statuses=(204,))

    def close(self) -> None:
        self.http.close()


class FrameSource:
    def __init__(self, url: str, token: str) -> None:
        if not url.startswith(("http://", "https://")) or not token:
            raise ValueError("DISPLAY_SOURCE_URL and DISPLAY_RUNNER_TOKEN are required")
        self.url = f"{url.rstrip('/')}/api/display/frame"
        self.status_url = f"{url.rstrip('/')}/api/display/status"
        self.token = token
        self.context = ssl.create_default_context(cafile=certifi.where())
        self.http = PersistentHTTP(self.url, self.context)

    def next(self) -> dict:
        content = self.http.request("GET", self.url, headers={"Authorization": f"Bearer {self.token}"}, maximum=16384)
        return validate_payload(json.loads(content))

    def report_status(self, connected: bool, error: str | None = None) -> None:
        body = {"connected": connected}
        if error:
            body["error"] = error
        self.http.request("POST", self.status_url, body=json.dumps(body).encode(), headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}, statuses=(200, 204))

    def close(self) -> None:
        self.http.close()


def run(source: FrameSource, display: Display, stop: threading.Event) -> None:
    last_key: tuple[str, int] | None = None
    last_status = -math.inf
    failures = 0

    def disconnected(reason: str) -> None:
        try:
            source.report_status(False, reason)
        except Exception:
            # The Worker must also expire the heartbeat if the source is down.
            pass

    def fallback() -> None:
        try:
            display.send(display.makeframe())
        except Exception:
            # Disconnected hardware needs its on-site fallback/operator procedure.
            pass

    try:
        while not stop.is_set():
            started = time.monotonic()
            stage = "source_unavailable"
            try:
                payload = validate_payload(source.next())
                if stop.is_set():
                    break
                key = (payload["displayId"], payload["sequence"])
                stage = "target_unavailable"
                heartbeat_due = time.monotonic() - last_status >= 1
                if key != last_key or heartbeat_due:
                    display.send(payload["frame"])
                    # Confirm the target at least once per heartbeat, including static scenes.
                    last_key = key
                stage = "status_unavailable"
                if heartbeat_due:
                    source.report_status(True)
                    last_status = time.monotonic()
                failures = 0
            except Exception as error:
                failures += 1
                print(f"display retry {failures}/{MAX_FAILURES}: {stage} ({type(error).__name__})", file=sys.stderr, flush=True)
                last_key = None  # Source recovery must restore even a static clip.
                last_status = -math.inf
                fallback()
                disconnected(stage)
                if failures >= MAX_FAILURES:
                    raise RuntimeError("display runner stopped after five consecutive failures") from error
            # Synchronous target acknowledgment limits dispatch to <= 30 FPS.
            stop.wait(max(0, 1 / FPS - (time.monotonic() - started)))
    finally:
        fallback()
        disconnected("runner_stopped")
        display.close()
        source.close()


def main() -> None:
    load_env()
    source = FrameSource(os.getenv("DISPLAY_SOURCE_URL", "http://127.0.0.1:8787"), os.environ["DISPLAY_RUNNER_TOKEN"])
    display = WebDisplay(os.environ["GREEN_BUILDING_INSTANCE"], os.getenv("GREEN_BUILDING_API", "https://sundai.willsarg.com/api"))
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    with InstanceLock(display.url):
        run(source, display, stop)


if __name__ == "__main__":
    main()
