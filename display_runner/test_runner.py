import unittest
import threading
from unittest.mock import patch
from runner import WebDisplay, COLS, FRAME_BYTES, ROWS, encode_frame, run, validate_frame


def frame(): return [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]


class FakeDisplay:
    def __init__(self): self.sent = []; self.closed = False
    def makeframe(self): return frame()
    def send(self, value): self.sent.append(value)
    def close(self): self.closed = True


class FrameTests(unittest.TestCase):
    def test_frame_is_17_rows_by_9_columns(self):
        value = frame()
        value[0][0] = [1, 2, 3]
        value[16][8] = [253, 254, 255]
        encoded = encode_frame(value)
        self.assertEqual(len(encoded), FRAME_BYTES)
        self.assertEqual(encoded[:3], bytes([1, 2, 3]))
        self.assertEqual(encoded[-3:], bytes([253, 254, 255]))

    def test_malformed_frames_fail_closed(self):
        with self.assertRaises(ValueError): validate_frame([])
        with self.assertRaises(ValueError): validate_frame([[[0, 0, 0]] * COLS] * (ROWS - 1))
        bad = [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]
        bad[4][2] = [0, 999, 0]
        with self.assertRaises(ValueError): validate_frame(bad)

    def test_static_frame_is_sent_once(self):
        stop = threading.Event()
        class Source:
            calls = 0
            def next(self):
                self.calls += 1
                if self.calls == 3: stop.set()
                return {"frame": frame(), "displayId": "clip:static", "sequence": 0, "static": True}
        display = FakeDisplay()
        run(Source(), display, stop)
        self.assertEqual(len(display.sent), 1)
        self.assertTrue(display.closed)

    def test_runner_fails_closed_after_five_source_errors(self):
        class Source:
            def next(self): raise OSError("offline")
        display = FakeDisplay()
        with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
            run(Source(), display, threading.Event())
        self.assertTrue(display.closed)


    def test_persistent_target_failures_stop_after_five_acknowledgments(self):
        stop = threading.Event()
        class Source:
            calls = 0
            def next(self):
                self.calls += 1
                if self.calls > 10: stop.set()
                return {"frame": frame(), "displayId": "clip:dynamic", "sequence": self.calls, "static": False}
        with patch("runner.urllib.request.urlopen", side_effect=OSError("target offline")) as post:
            with self.assertRaisesRegex(RuntimeError, "five consecutive failures"):
                run(Source(), WebDisplay("test-instance"), stop)
            self.assertEqual(post.call_count, 5)

    def test_failed_static_post_is_retried_then_deduplicated(self):
        stop = threading.Event()
        class Source:
            calls = 0
            def next(self):
                self.calls += 1
                if self.calls == 4: stop.set()
                return {"frame": frame(), "displayId": "clip:static", "sequence": 0, "static": True}
        class Response:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *_): pass
        with patch("runner.urllib.request.urlopen", side_effect=[OSError("transient"), Response()]) as post:
            run(Source(), WebDisplay("test-instance"), stop)
            self.assertEqual(post.call_count, 2)


    def test_static_keepalive_prevents_organizer_clip_takeover(self):
        stop = threading.Event()
        clock = [0.0]
        class Source:
            calls = 0
            def next(self):
                self.calls += 1
                if self.calls == 4: stop.set()
                return {"frame": frame(), "displayId": "clip:static", "sequence": 0, "static": True}
        def tick(_): clock[0] += 0.6
        display = FakeDisplay()
        with patch("runner.time.monotonic", side_effect=lambda: clock[0]), patch.object(stop, "wait", side_effect=tick):
            run(Source(), display, stop)
        self.assertEqual(len(display.sent), 2)


if __name__ == "__main__": unittest.main()
