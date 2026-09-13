import unittest
from runner import COLS, FRAME_BYTES, ROWS, encode_frame, validate_frame


class FrameTests(unittest.TestCase):
    def test_frame_is_17_rows_by_9_columns(self):
        frame = [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]
        frame[0][0] = [1, 2, 3]
        frame[16][8] = [253, 254, 255]
        encoded = encode_frame(frame)
        self.assertEqual(len(encoded), FRAME_BYTES)
        self.assertEqual(encoded[:3], bytes([1, 2, 3]))
        self.assertEqual(encoded[-3:], bytes([253, 254, 255]))

    def test_malformed_frames_fail_closed(self):
        with self.assertRaises(ValueError): validate_frame([])
        with self.assertRaises(ValueError): validate_frame([[[0, 0, 0]] * COLS] * (ROWS - 1))
        bad = [[[0, 0, 0] for _ in range(COLS)] for _ in range(ROWS)]
        bad[4][2] = [0, 999, 0]
        with self.assertRaises(ValueError): validate_frame(bad)


if __name__ == "__main__": unittest.main()
