import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from runner import (
    COLS, FPS, FRAME_BYTES, MAX_FRAME_AGE_MS, MAX_FUTURE_SKEW_MS,
    REQUEST_TIMEOUT, ROWS, FrameSource, InstanceLock, WebDisplay,
    blank_frame, encode_frame, run, validate_frame, validate_payload,
)


def colored_frame():
    return [[[20, 40, 60] for _ in range(COLS)] for _ in range(ROWS)]


def payload(sequence=0):
    return {"frame": colored_frame(), "displayId": "clip:approved", "sequence": sequence, "static": True, "generatedAt": 1_000_000}


class Clock:
    value = 1000.0

    def now(self):
        return self.value

    def sleep(self, duration):
        self.value += max(0, duration)


class Stop:
    def __init__(self, ticks, clock):
        self.remaining = ticks
        self.clock = clock

    def is_set(self):
        return self.remaining <= 0

    def wait(self, duration):
        self.clock.sleep(duration)
        self.remaining -= 1


class Source:
    def __init__(self, values):
        self.values = iter(values)
        self.statuses = []

    def next(self):
        value = next(self.values)
        if isinstance(value, Exception):
            raise value
        return value

    def report_status(self, connected, error=None):
        self.statuses.append((connected, error))


class Display:
    def __init__(self, fail_clips=0):
        self.fail_clips = fail_clips
        self.attempts = []
        self.sent = []
        self.closed = False

    def makeframe(self):
        return blank_frame()

    def send(self, value):
        self.attempts.append(value)
        if value != blank_frame() and self.fail_clips:
            self.fail_clips -= 1
            raise OSError("target unavailable")
        self.sent.append(value)

    def close(self):
        self.closed = True


class Response:
    def __init__(self, status=204, data=b""):
        self.status, self.data = status, data

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, maximum):
        return self.data[:maximum]


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        for method in ("time", "monotonic"):
            patched = patch(f"runner.time.{method}", self.clock.now)
            patched.start()
            self.addCleanup(patched.stop)
        patched = patch("runner.time.sleep", self.clock.sleep)
        patched.start()
        self.addCleanup(patched.stop)

    def test_exact_rgb_orientation_and_invalid_channels(self):
        frame = blank_frame()
        frame[0][0], frame[-1][-1] = [1, 2, 3], [253, 254, 255]
        encoded = encode_frame(frame)
        self.assertEqual(len(encoded), FRAME_BYTES)
        self.assertEqual(encoded[:3], bytes([1, 2, 3]))
        self.assertEqual(encoded[-3:], bytes([253, 254, 255]))
        for bad in ([], frame[:-1], [row[:-1] for row in frame]):
            with self.assertRaises(ValueError):
                validate_frame(bad)
        for channel in (True, -1, 256, 1.5, "5", None):
            bad = copy.deepcopy(frame)
            bad[0][0][0] = channel
            with self.assertRaises(ValueError):
                encode_frame(bad)

    def test_rejects_expired_future_or_malformed_feed_metadata(self):
        self.assertEqual(validate_payload(payload())["displayId"], "clip:approved")
        for fields in ({"generatedAt": 1_000_000 - MAX_FRAME_AGE_MS - 1},
                       {"generatedAt": 1_000_000 + MAX_FUTURE_SKEW_MS + 1},
                       {"generatedAt": True}, {"generatedAt": float("nan")},
                       {"generatedAt": None}, {"sequence": -1},
                       {"sequence": True}, {"static": "true"}, {"displayId": ""}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                validate_payload({**payload(), **fields})

    def test_static_clip_deduplicates_only_acknowledged_frames(self):
        source = Source([payload()] * 4)
        display = Display()
        run(source, display, Stop(4, self.clock))
        self.assertEqual(display.sent.count(colored_frame()), 1)
        self.assertEqual(display.sent[-1], blank_frame())
        self.assertEqual(source.statuses, [(True, None), (False, "runner_stopped")])
        self.assertTrue(display.closed)

    def test_static_clip_retries_after_one_target_failure(self):
        source = Source([payload()] * 4)
        display = Display(fail_clips=1)
        run(source, display, Stop(4, self.clock))
        self.assertEqual(display.attempts.count(colored_frame()), 2)
        self.assertEqual(display.sent.count(colored_frame()), 1)
        self.assertEqual(source.statuses[:2], [(False, "target_unavailable"), (True, None)])

    def test_five_target_failures_stop_despite_healthy_source(self):
        source = Source([payload(index) for index in range(10)])
        display = Display(fail_clips=100)
        with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
            run(source, display, Stop(10, self.clock))
        self.assertEqual(display.attempts.count(colored_frame()), 5)
        self.assertFalse(any(connected for connected, _ in source.statuses))
        self.assertTrue(display.closed)

    def test_source_failure_blanks_then_restores_same_static_clip(self):
        source = Source([payload(), OSError("source offline"), payload()])
        display = Display()
        run(source, display, Stop(3, self.clock))
        self.assertEqual(display.sent, [colored_frame(), blank_frame(), colored_frame(), blank_frame()])
        self.assertIn((False, "source_unavailable"), source.statuses)

    def test_stale_source_never_reaches_display_and_stops_after_five_failures(self):
        source = Source([{**payload(), "generatedAt": 900_000}] * 10)
        display = Display()
        with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
            run(source, display, Stop(10, self.clock))
        self.assertTrue(display.sent)
        self.assertTrue(all(frame == blank_frame() for frame in display.sent))
        self.assertFalse(any(connected for connected, _ in source.statuses))

    def test_connected_heartbeat_continues_for_static_clip(self):
        clock = self.clock
        events = []
        class FreshSource(Source):
            def next(self):
                return {**payload(), "generatedAt": clock.now() * 1000}
            def report_status(self, connected, error=None):
                events.append("connected" if connected else "disconnected")
                super().report_status(connected, error)
        class AcknowledgedDisplay(Display):
            def send(self, value):
                super().send(value)
                if value == colored_frame():
                    events.append("acknowledged")
        source = FreshSource([])
        display = AcknowledgedDisplay()
        run(source, display, Stop(70, self.clock))
        self.assertGreaterEqual(source.statuses.count((True, None)), 3)
        for index, event in enumerate(events):
            if event == "connected":
                self.assertGreater(index, 0)
                self.assertEqual(events[index - 1], "acknowledged", "each positive heartbeat must follow a new target acknowledgment")

    def test_target_dying_during_static_clip_stops_without_false_connected_heartbeats(self):
        clock = self.clock
        class FreshSource(Source):
            def next(self):
                return {**payload(), "generatedAt": clock.now() * 1000}
        source = FreshSource([])
        display = WebDisplay("test-target")
        clip_attempts = 0
        successful_posts = 0
        def target(request, **kwargs):
            nonlocal clip_attempts, successful_posts
            if request.data == encode_frame(colored_frame()):
                clip_attempts += 1
                if clip_attempts == 1:
                    successful_posts += 1
                    return Response(204)
            raise OSError("target died after the first acknowledgment")
        stop = Stop(200, self.clock)
        with patch("runner.urllib.request.urlopen", side_effect=target):
            with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
                run(source, display, stop)
        self.assertGreater(stop.remaining, 0, "target failure must stop the runner before the test's stop deadline")
        self.assertEqual(successful_posts, 1)
        self.assertEqual(clip_attempts, 6, "first successful frame followed by five failed confirmations")
        self.assertEqual(source.statuses.count((True, None)), 1)
        self.assertEqual(source.statuses[0], (True, None))
        self.assertEqual(source.statuses.count((False, "target_unavailable")), 5)
        self.assertEqual(source.statuses[-1], (False, "runner_stopped"))

    def test_unavailable_health_endpoint_cannot_leave_dispatch_running(self):
        class UnreachableStatus(Source):
            def report_status(self, connected, error=None):
                raise OSError("status endpoint offline")
        source = UnreachableStatus([payload()] * 10)
        display = Display()
        with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
            run(source, display, Stop(10, self.clock))
        self.assertEqual(display.sent.count(colored_frame()), 5)
        self.assertEqual(display.sent[-1], blank_frame())
        self.assertTrue(display.closed)

    def test_web_display_requires_ack_and_rates_all_posts_including_retries(self):
        display = WebDisplay("test-target")
        times = []
        def send(request, **kwargs):
            times.append(self.clock.now())
            self.assertEqual(request.data, bytes([20, 40, 60]) * ROWS * COLS)
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(kwargs["timeout"], REQUEST_TIMEOUT)
            return Response(status=500 if len(times) == 1 else 204)
        with patch("runner.urllib.request.urlopen", side_effect=send):
            with self.assertRaises(RuntimeError):
                display.send(colored_frame())
            display.send(colored_frame())
            display.send(colored_frame())
        self.assertTrue(all(later - earlier >= 1 / FPS - 1e-10 for earlier, later in zip(times, times[1:])))

    def test_frame_source_authenticates_feed_and_status_requests(self):
        source = FrameSource("https://source.test", "private-token")
        requests = []
        def request(req, **kwargs):
            requests.append(req)
            self.assertEqual(req.get_header("Authorization"), "Bearer private-token")
            self.assertEqual(kwargs["timeout"], REQUEST_TIMEOUT)
            return Response(200, json.dumps(payload()).encode()) if req.get_method() == "GET" else Response()
        with patch("runner.urllib.request.urlopen", side_effect=request):
            self.assertEqual(source.next(), payload())
            source.report_status(False, "source_unavailable")
        self.assertEqual(requests[0].full_url, "https://source.test/api/display/frame")
        self.assertEqual(requests[1].full_url, "https://source.test/api/display/status")
        self.assertEqual(json.loads(requests[1].data), {"connected": False, "error": "source_unavailable"})
        with patch("runner.urllib.request.urlopen", return_value=Response(200, b"x" * 20000)):
            with self.assertRaisesRegex(ValueError, "too large"):
                source.next()

    def test_instance_lock_excludes_duplicate_but_releases_on_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            target = "https://target.test/i/test-target/frame"
            with InstanceLock(target, Path(directory)):
                with self.assertRaisesRegex(RuntimeError, "another local runner"):
                    with InstanceLock(target, Path(directory)):
                        self.fail("duplicate instance acquired")
                with InstanceLock(target + "-other", Path(directory)):
                    pass
            with InstanceLock(target, Path(directory)):
                pass


if __name__ == "__main__":
    unittest.main()
