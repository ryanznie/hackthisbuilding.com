import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from runner import (
    COLS, FPS, FRAME_BYTES, MAX_FRAME_AGE_MS, MAX_FUTURE_SKEW_MS,
    REQUEST_TIMEOUT, ROWS, FrameSource, InstanceLock, PersistentHTTP, WebDisplay,
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

    def close(self):
        pass


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
    def __init__(self, status=204, data=b"", headers=None, will_close=False):
        self.status, self.data = status, data
        self.headers = {"Content-Length": str(len(data))} if headers is None else headers
        self.will_close = will_close
        self.consumed = False

    def getheader(self, name):
        return self.headers.get(name)

    def read(self, maximum):
        self.consumed = len(self.data) <= maximum
        return self.data[:maximum]


class Connection:
    def __init__(self, respond):
        self.respond = respond
        self.requests = []
        self.response = None
        self.closed = False

    def request(self, method, path, body=None, headers=None):
        if self.closed:
            raise AssertionError("closed connections must not be reused")
        if self.response is not None and not self.response.consumed:
            raise AssertionError("response body must be consumed before connection reuse")
        self.requests.append((method, path, body, headers))

    def getresponse(self):
        self.response = self.respond(*self.requests[-1])
        return self.response

    def close(self):
        self.closed = True


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
        def target(method, path, body, headers):
            nonlocal clip_attempts, successful_posts
            if body == encode_frame(colored_frame()):
                clip_attempts += 1
                if clip_attempts == 1:
                    successful_posts += 1
                    return Response(204)
            raise OSError("target died after the first acknowledgment")
        stop = Stop(200, self.clock)
        with patch("runner.http.client.HTTPSConnection", side_effect=lambda *args, **kwargs: Connection(target)):
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
        def send(method, path, body, headers):
            times.append(self.clock.now())
            self.assertEqual(body, bytes([20, 40, 60]) * ROWS * COLS)
            self.assertEqual(method, "POST")
            return Response(status=500 if len(times) == 1 else 204)
        with patch("runner.http.client.HTTPSConnection", side_effect=lambda *args, **kwargs: Connection(send)) as connect:
            with self.assertRaises(RuntimeError):
                display.send(colored_frame())
            display.send(colored_frame())
            display.send(colored_frame())
            self.assertEqual(connect.call_count, 2, "only the failed response should require a new connection")
            self.assertTrue(all(call.kwargs["timeout"] == REQUEST_TIMEOUT for call in connect.call_args_list))
        self.assertTrue(all(later - earlier >= 1 / FPS - 1e-10 for earlier, later in zip(times, times[1:])))

    def test_frame_source_authenticates_feed_and_status_requests(self):
        source = FrameSource("https://source.test", "private-token")
        def request(method, path, body, headers):
            self.assertEqual(headers["Authorization"], "Bearer private-token")
            return Response(200, json.dumps(payload()).encode()) if method == "GET" else Response(200, b'{"ok":true}')
        connection = Connection(request)
        with patch("runner.http.client.HTTPSConnection", return_value=connection) as connect:
            self.assertEqual(source.next(), payload())
            source.report_status(False, "source_unavailable")
            self.assertEqual(source.next(), payload(), "status response bodies must be drained before the next GET")
            self.assertEqual(connect.call_count, 1, "GET frames and status POSTs share the source connection")
            self.assertEqual(connect.call_args.kwargs["timeout"], REQUEST_TIMEOUT)
        self.assertEqual(connection.requests[0][1], "/api/display/frame")
        self.assertEqual(connection.requests[1][1], "/api/display/status")
        self.assertEqual(json.loads(connection.requests[1][2]), {"connected": False, "error": "source_unavailable"})
        source.close()
        oversized = Connection(lambda *args: Response(200, b"x" * 20000))
        with patch("runner.http.client.HTTPSConnection", return_value=oversized):
            with self.assertRaisesRegex(ValueError, "too large"):
                source.next()
        self.assertTrue(oversized.closed)

    def test_transport_reconnects_after_error_without_retrying_an_uncertain_post(self):
        broken = Connection(Mock(side_effect=OSError("response lost after request was sent")))
        healthy = Connection(lambda *args: Response(204))
        display = WebDisplay("test-target")
        with patch("runner.http.client.HTTPSConnection", side_effect=[broken, healthy]) as connect:
            with self.assertRaises(OSError):
                display.send(colored_frame())
            self.assertEqual(connect.call_count, 1)
            self.assertEqual(len(broken.requests), 1, "transport must not silently resend a POST")
            self.assertTrue(broken.closed)
            display.send(colored_frame())
            display.send(colored_frame())
            self.assertEqual(connect.call_count, 2)
            self.assertEqual(len(healthy.requests), 2, "healthy target posts reuse one connection")
        display.close()
        self.assertTrue(healthy.closed)

    def test_chunked_body_bound_and_server_close_both_discard_connection(self):
        too_large = Connection(lambda *args: Response(200, b"x" * 20000, headers={}))
        server_close = Connection(lambda *args: Response(200, b"ok", will_close=True))
        healthy = Connection(lambda *args: Response(200, b"ok"))
        client = PersistentHTTP("http://localhost:8787", None)
        with patch("runner.http.client.HTTPConnection", side_effect=[too_large, server_close, healthy]) as connect:
            with self.assertRaisesRegex(ValueError, "too large"):
                client.request("GET", "http://localhost:8787/frame", maximum=16384)
            self.assertTrue(too_large.closed)
            self.assertEqual(client.request("GET", "http://localhost:8787/frame"), b"ok")
            self.assertTrue(server_close.closed)
            self.assertEqual(client.request("GET", "http://localhost:8787/frame"), b"ok")
            self.assertEqual(connect.call_count, 3)
            self.assertEqual(connect.call_args.args, ("localhost", 8787))
        client.close()

    def test_persistent_transport_rejects_redirect_without_sending_credentials_elsewhere(self):
        redirected = Connection(lambda *args: Response(302, b"", headers={"Location": "https://elsewhere.test/"}))
        source = FrameSource("https://source.test", "private-token")
        with patch("runner.http.client.HTTPSConnection", return_value=redirected) as connect:
            with self.assertRaisesRegex(RuntimeError, "302"):
                source.next()
            self.assertEqual(connect.call_count, 1)
            self.assertEqual(len(redirected.requests), 1)
            self.assertTrue(redirected.closed)

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
