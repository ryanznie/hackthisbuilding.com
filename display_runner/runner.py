"""Trusted bridge from the approved queue to a Green Building Display target."""
from __future__ import annotations

import json
import os
import re
import signal
import ssl
import threading
import time
import urllib.request
from pathlib import Path
from typing import Protocol

import certifi

ROWS, COLS, CHANNELS = 17, 9, 3
FRAME_BYTES = ROWS * COLS * CHANNELS
USER_AGENT = "hackthisbuilding-display-runner/1.0"


def load_env() -> None:
    path = Path(__file__).parent / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip())


def validate_frame(value: object) -> list[list[list[int]]]:
    if not isinstance(value, list) or len(value) != ROWS:
        raise ValueError("frame must have exactly 17 rows")
    frame: list[list[list[int]]] = []
    for row in value:
        if not isinstance(row, list) or len(row) != COLS:
            raise ValueError("each frame row must have exactly 9 columns")
        validated_row: list[list[int]] = []
        for pixel in row:
            if not isinstance(pixel, list) or len(pixel) != CHANNELS or any(type(channel) is not int or channel < 0 or channel > 255 for channel in pixel):
                raise ValueError("each pixel must contain three integer RGB channels")
            validated_row.append(pixel)
        frame.append(validated_row)
    return frame


def encode_frame(frame: object) -> bytes:
    return bytes(channel for row in validate_frame(frame) for pixel in row for channel in pixel)


class Display(Protocol):
    def makeframe(self) -> list[list[list[int]]]: ...
    def send(self, frame: object) -> None: ...
    def close(self) -> None: ...


class WebDisplay:
    """Simulator adapter with the same makeframe/send surface as the building."""
    def __init__(self, instance: str, base_url: str = "https://sundai.willsarg.com/api") -> None:
        if not re.fullmatch(r"[a-z]+-[a-z]+", instance):
            raise ValueError("GREEN_BUILDING_INSTANCE must be the exact server-issued adjective-animal name")
        self.url = f"{base_url.rstrip('/')}/i/{instance}/frame"
        self.context = ssl.create_default_context(cafile=certifi.where())
        self.condition = threading.Condition()
        self.pending: bytes | None = None
        self.running = True
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._sender, name="building-frame-sender", daemon=True)
        self.thread.start()

    def makeframe(self) -> list[list[list[int]]]:
        return [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]

    def send(self, frame: object) -> None:
        payload = encode_frame(frame)
        with self.condition:
            if self.error:
                error, self.error = self.error, None
                raise RuntimeError("the display sender failed") from error
            self.pending = payload
            self.condition.notify()

    def _sender(self) -> None:
        while self.running:
            with self.condition:
                self.condition.wait_for(lambda: self.pending is not None or not self.running)
                if not self.running:
                    return
                payload, self.pending = self.pending, None
            try:
                request = urllib.request.Request(self.url, data=payload, headers={"Content-Type": "application/octet-stream", "User-Agent": USER_AGENT}, method="POST")
                with urllib.request.urlopen(request, timeout=3, context=self.context) as response:
                    if response.status != 204:
                        raise RuntimeError(f"unexpected display response {response.status}")
            except Exception as error:
                self.error = error

    def close(self) -> None:
        self.running = False
        with self.condition:
            self.condition.notify()
        self.thread.join(timeout=4)


class FrameSource:
    def __init__(self, url: str, token: str) -> None:
        if not url.startswith(("http://", "https://")) or not token:
            raise ValueError("DISPLAY_SOURCE_URL and DISPLAY_RUNNER_TOKEN are required")
        self.url = f"{url.rstrip('/')}/api/display/frame"
        self.token = token
        self.context = ssl.create_default_context(cafile=certifi.where())

    def next(self) -> dict[str, object]:
        request = urllib.request.Request(self.url, headers={"Authorization": f"Bearer {self.token}", "User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=3, context=self.context) as response:
            payload = json.load(response)
        validate_frame(payload.get("frame"))
        if not isinstance(payload.get("displayId"), str) or type(payload.get("sequence")) is not int or type(payload.get("static")) is not bool:
            raise ValueError("display feed returned invalid metadata")
        return payload


def run(source: FrameSource, display: Display, stop: threading.Event) -> None:
    last_key: tuple[str, int] | None = None
    failures = 0
    try:
        while not stop.is_set():
            started = time.monotonic()
            try:
                payload = source.next()
                key = (str(payload["displayId"]), int(payload["sequence"]))
                if key != last_key:
                    display.send(payload["frame"])
                    last_key = key
                failures = 0
            except Exception as error:
                failures += 1
                if failures >= 5:
                    raise RuntimeError("display runner stopped after five consecutive failures") from error
            stop.wait(max(0, 1 / 30 - (time.monotonic() - started)))
    finally:
        display.close()


def main() -> None:
    load_env()
    source = FrameSource(os.getenv("DISPLAY_SOURCE_URL", "http://127.0.0.1:8787"), os.environ["DISPLAY_RUNNER_TOKEN"])
    display = WebDisplay(os.environ["GREEN_BUILDING_INSTANCE"], os.getenv("GREEN_BUILDING_API", "https://sundai.willsarg.com/api"))
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    run(source, display, stop)


if __name__ == "__main__":
    main()
