import unittest
import threading
from runner import COLS, FRAME_BYTES, ROWS, encode_frame, run, validate_frame


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


if __name__ == "__main__": unittest.main()
