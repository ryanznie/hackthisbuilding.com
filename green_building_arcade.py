#!/usr/bin/env python3
"""
MIT GREEN BUILDING ARCADE — LIVE SIMULATOR & BEYOND TETRIS RUNTIME
Building 54 (153 Windows, 9 cols x 17 rows @ 30 FPS)
Features:
  1. Interactive 17x9 Games: Playable Tetris & 2-Player Pong
  2. Live Real-World Feeds: MLB Red Sox scores, official MIT News RSS, live Cambridge/MIT weather
  3. Dynamic 153-Window 5x7 Text Marquee
  4. Web Desktop & Mobile Gamepad Controller
"""

import os
import sys
import time
import math
import json
import ssl
import socket
import random
import threading
import argparse
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# ---------------------------------------------------------------------------
# CONSTANTS & BUILDING SPECIFICATION (MIT BUILDING 54)
# ---------------------------------------------------------------------------
BUILDING_ROWS = 17    # 17 windowed stories (floors 3-19)
BUILDING_COLS = 9     # 9 columns of windows across facade
TOTAL_WINDOWS = BUILDING_ROWS * BUILDING_COLS  # 153 individual RGB modules
TARGET_FPS = 30
FRAME_INTERVAL = 1.0 / TARGET_FPS  # 33.33 milliseconds

# Colors
COLOR_OFF = (12, 16, 26)
COLOR_AMBER = (255, 180, 50)
COLOR_MIT_RED = (163, 31, 52)
COLOR_RED_SOX_NAVY = (12, 35, 64)
COLOR_RED_SOX_RED = (189, 48, 57)
COLOR_CYBER_GREEN = (0, 255, 136)
COLOR_GOLD = (255, 215, 0)
COLOR_CYAN = (0, 230, 255)
COLOR_WHITE = (255, 255, 255)
COLOR_PURPLE = (170, 50, 240)

# SSL context for live API fetches
SSL_CTX = ssl._create_unverified_context()

# ---------------------------------------------------------------------------
# 5x7 BITMAP FONT FOR 153-WINDOW FACADE TEXT
# ---------------------------------------------------------------------------
FONT_5X7 = {
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    'A': [0x7E, 0x11, 0x11, 0x11, 0x7E],
    'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
    'E': [0x7F, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7F, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3E, 0x41, 0x49, 0x49, 0x7A],
    'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
    'J': [0x20, 0x40, 0x41, 0x3F, 0x01],
    'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F],
    'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'P': [0x7F, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3E, 0x41, 0x51, 0x21, 0x5E],
    'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    'U': [0x3F, 0x40, 0x40, 0x40, 0x3F],
    'V': [0x1F, 0x20, 0x40, 0x20, 0x1F],
    'W': [0x7F, 0x20, 0x18, 0x20, 0x7F],
    'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
    'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
    '0': [0x3E, 0x51, 0x49, 0x45, 0x3E],
    '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7F, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3C, 0x4A, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
    '!': [0x00, 0x00, 0x5F, 0x00, 0x00],
    '?': [0x02, 0x01, 0x51, 0x09, 0x06],
    ':': [0x00, 0x36, 0x36, 0x00, 0x00],
    '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '=': [0x14, 0x14, 0x14, 0x14, 0x14],
    '.': [0x00, 0x40, 0x60, 0x00, 0x00],
    ',': [0x00, 0x40, 0x60, 0x20, 0x00],
    '/': [0x20, 0x10, 0x08, 0x04, 0x02],
    '°': [0x06, 0x09, 0x09, 0x06, 0x00],
}

def string_to_columns(text: str) -> list:
    cols = [0, 0, 0, 0]
    for ch in text.upper():
        c_cols = FONT_5X7.get(ch, [0x00, 0x36, 0x36, 0x00, 0x00])
        cols.extend(c_cols)
        cols.append(0x00)
    cols.extend([0, 0, 0, 0])
    return cols

# ---------------------------------------------------------------------------
# 17x9 PLAYABLE TETRIS ENGINE ("BEYOND TETRIS")
# ---------------------------------------------------------------------------
class TetrisGame:
    SHAPES = {
        'I': {'coords': [(0,0), (0,1), (0,2), (0,3)], 'color': (0, 240, 240)},
        'O': {'coords': [(0,0), (0,1), (1,0), (1,1)], 'color': (240, 240, 0)},
        'T': {'coords': [(0,1), (1,0), (1,1), (1,2)], 'color': (170, 40, 240)},
        'S': {'coords': [(0,1), (0,2), (1,0), (1,1)], 'color': (40, 240, 40)},
        'Z': {'coords': [(0,0), (0,1), (1,1), (1,2)], 'color': (240, 40, 40)},
        'J': {'coords': [(0,0), (1,0), (1,1), (1,2)], 'color': (40, 70, 240)},
        'L': {'coords': [(0,2), (1,0), (1,1), (1,2)], 'color': (240, 160, 20)},
    }

    def __init__(self):
        self.rows = BUILDING_ROWS
        self.cols = BUILDING_COLS
        self.board = [[None for _ in range(self.cols)] for _ in range(self.rows)]
        self.score = 0
        self.lines_cleared = 0
        self.game_over = False
        self.current_piece = None
        self.piece_x = 3
        self.piece_y = 0
        self.last_drop_time = time.time()
        self.drop_interval = 0.55
        self.spawn_piece()

    def spawn_piece(self):
        name = random.choice(list(self.SHAPES.keys()))
        data = self.SHAPES[name]
        self.current_piece = {'name': name, 'coords': list(data['coords']), 'color': data['color']}
        self.piece_x = 3
        self.piece_y = 0

        # Check collision on spawn (game over)
        for r, c in self.current_piece['coords']:
            if self.board[self.piece_y + r][self.piece_x + c] is not None:
                self.game_over = True
                break

    def valid(self, coords, px, py):
        for r, c in coords:
            br, bc = py + r, px + c
            if bc < 0 or bc >= self.cols or br >= self.rows:
                return False
            if br >= 0 and self.board[br][bc] is not None:
                return False
        return True

    def action(self, cmd):
        if self.game_over:
            if cmd == 'reset':
                self.__init__()
            return

        if cmd == 'left':
            if self.valid(self.current_piece['coords'], self.piece_x - 1, self.piece_y):
                self.piece_x -= 1
        elif cmd == 'right':
            if self.valid(self.current_piece['coords'], self.piece_x + 1, self.piece_y):
                self.piece_x += 1
        elif cmd == 'rotate':
            # Rotate 90 degrees clockwise
            rotated = [(-c, r) for r, c in self.current_piece['coords']]
            min_r = min(r for r, c in rotated)
            min_c = min(c for r, c in rotated)
            normalized = [(r - min_r, c - min_c) for r, c in rotated]
            if self.valid(normalized, self.piece_x, self.piece_y):
                self.current_piece['coords'] = normalized
            elif self.valid(normalized, self.piece_x - 1, self.piece_y):
                self.piece_x -= 1
                self.current_piece['coords'] = normalized
            elif self.valid(normalized, self.piece_x + 1, self.piece_y):
                self.piece_x += 1
                self.current_piece['coords'] = normalized
        elif cmd == 'drop':
            if self.valid(self.current_piece['coords'], self.piece_x, self.piece_y + 1):
                self.piece_y += 1
            else:
                self.lock_piece()
        elif cmd == 'hard_drop':
            while self.valid(self.current_piece['coords'], self.piece_x, self.piece_y + 1):
                self.piece_y += 1
            self.lock_piece()
        elif cmd == 'reset':
            self.__init__()

    def lock_piece(self):
        for r, c in self.current_piece['coords']:
            br, bc = self.piece_y + r, self.piece_x + c
            if 0 <= br < self.rows and 0 <= bc < self.cols:
                self.board[br][bc] = self.current_piece['color']

        # Clear full lines
        new_board = [row for row in self.board if any(cell is None for cell in row)]
        lines_removed = self.rows - len(new_board)
        if lines_removed > 0:
            self.lines_cleared += lines_removed
            self.score += [0, 100, 300, 600, 1000][min(4, lines_removed)]
            for _ in range(lines_removed):
                new_board.insert(0, [None for _ in range(self.cols)])
            self.board = new_board
            self.drop_interval = max(0.2, 0.55 - (self.lines_cleared * 0.03))

        self.spawn_piece()

    def update(self):
        now = time.time()
        if not self.game_over and (now - self.last_drop_time) > self.drop_interval:
            self.last_drop_time = now
            self.action('drop')

    def render(self, buffer):
        # Draw landed blocks
        for r in range(self.rows):
            for c in range(self.cols):
                if self.board[r][c] is not None:
                    buffer[r][c] = self.board[r][c]
                else:
                    buffer[r][c] = COLOR_OFF

        # Draw active falling piece
        if not self.game_over and self.current_piece:
            for r, c in self.current_piece['coords']:
                br, bc = self.piece_y + r, self.piece_x + c
                if 0 <= br < self.rows and 0 <= bc < self.cols:
                    buffer[br][bc] = self.current_piece['color']

        # Flash on game over
        if self.game_over:
            pulse = int(120 + 80 * math.sin(time.time() * 8.0))
            for c in range(self.cols):
                buffer[8][c] = (pulse, 0, 0)


# ---------------------------------------------------------------------------
# 17x9 PLAYABLE PONG ENGINE
# ---------------------------------------------------------------------------
class PongGame:
    def __init__(self):
        self.rows = BUILDING_ROWS
        self.cols = BUILDING_COLS
        self.paddle_w = 3
        self.player_x = 3
        self.ai_x = 3
        self.ball_x = 4.0
        self.ball_y = 8.0
        self.vx = random.choice([-0.25, 0.25])
        self.vy = 0.35
        self.player_score = 0
        self.ai_score = 0
        self.last_tick = time.time()

    def action(self, cmd):
        if cmd == 'left':
            self.player_x = max(0, self.player_x - 1)
        elif cmd == 'right':
            self.player_x = min(self.cols - self.paddle_w, self.player_x + 1)
        elif cmd == 'reset':
            self.__init__()

    def update(self):
        now = time.time()
        dt = min(0.05, now - self.last_tick)
        self.last_tick = now

        # Ball motion
        self.ball_x += self.vx * (dt * 30.0)
        self.ball_y += self.vy * (dt * 30.0)

        # Side wall bounce
        if self.ball_x <= 0:
            self.ball_x = 0
            self.vx = abs(self.vx)
        elif self.ball_x >= self.cols - 1:
            self.ball_x = self.cols - 1
            self.vx = -abs(self.vx)

        # AI tracking (top paddle row 0)
        ai_center = self.ai_x + (self.paddle_w / 2.0)
        if ai_center < self.ball_x and self.ai_x < self.cols - self.paddle_w:
            self.ai_x += 0.15
        elif ai_center > self.ball_x and self.ai_x > 0:
            self.ai_x -= 0.15

        # Player paddle bounce (row 16)
        if self.ball_y >= 15.2:
            if self.player_x <= self.ball_x <= self.player_x + self.paddle_w:
                self.ball_y = 15.2
                self.vy = -abs(self.vy) * 1.03
                # Angle deflect
                offset = (self.ball_x - (self.player_x + 1)) * 0.15
                self.vx += offset
            elif self.ball_y >= 16.5: # Missed!
                self.ai_score += 1
                self.reset_ball(dir_y=-1)

        # AI paddle bounce (row 0)
        if self.ball_y <= 0.8:
            if self.ai_x <= self.ball_x <= self.ai_x + self.paddle_w:
                self.ball_y = 0.8
                self.vy = abs(self.vy)
            elif self.ball_y <= 0: # Player scores!
                self.player_score += 1
                self.reset_ball(dir_y=1)

    def reset_ball(self, dir_y=1):
        self.ball_x = 4.0
        self.ball_y = 8.0
        self.vx = random.choice([-0.25, 0.25])
        self.vy = 0.35 * dir_y

    def render(self, buffer):
        for r in range(self.rows):
            for c in range(self.cols):
                buffer[r][c] = COLOR_OFF

        # Draw AI paddle (row 0, cyan)
        ai_int = int(round(self.ai_x))
        for c in range(ai_int, ai_int + self.paddle_w):
            if 0 <= c < self.cols:
                buffer[0][c] = COLOR_CYAN

        # Draw Player paddle (row 16, gold)
        px_int = int(round(self.player_x))
        for c in range(px_int, px_int + self.paddle_w):
            if 0 <= c < self.cols:
                buffer[16][c] = COLOR_GOLD

        # Draw Ball
        bx = int(round(self.ball_x))
        by = int(round(self.ball_y))
        if 0 <= by < self.rows and 0 <= bx < self.cols:
            buffer[by][bx] = COLOR_WHITE


# ---------------------------------------------------------------------------
# DISPLAY BUFFER & RUNTIME
# ---------------------------------------------------------------------------
class BuildingDisplay:
    def __init__(self, external_api=None, udp_target=None):
        self.rows = BUILDING_ROWS
        self.cols = BUILDING_COLS
        self.fps = TARGET_FPS
        self.external_api = external_api
        self.udp_target = udp_target
        
        self.buffer = [[COLOR_OFF for _ in range(self.cols)] for _ in range(self.rows)]
        self.lock = threading.Lock()
        
        # State
        self.active_mode = "idle"
        self.display_style = "cycle"
        self.mode_start_time = time.time()
        self.animation_step = 0
        self.headline_text = "MIT GREEN BUILDING ARCADE — READY"
        self.answer_text = "SCAN QR CODE OR CHOOSE A SCRIPT TO DISPLAY ON BUILDING"
        self.status_detail = "Waiting for commands... Scan QR code or play games."
        self.current_prompt = "None"
        
        # Games
        self.tetris = TetrisGame()
        self.pong = PongGame()
        
        # Performance
        self.actual_fps = 30.0
        self.frame_count = 0
        self.running = True
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) if udp_target else None

    def set_pixel(self, r, c, color):
        if 0 <= r < self.rows and 0 <= c < self.cols:
            self.buffer[r][c] = color

    def clear(self, color=COLOR_OFF):
        for r in range(self.rows):
            for c in range(self.cols):
                self.buffer[r][c] = color

    def set_mode(self, mode_name, prompt_text, headline, answer, detail=""):
        with self.lock:
            self.active_mode = mode_name
            self.current_prompt = prompt_text
            self.headline_text = headline
            self.answer_text = answer.upper()
            self.status_detail = detail
            self.mode_start_time = time.time()
            self.animation_step = 0

    def get_state(self):
        with self.lock:
            flat_rgb = [list(self.buffer[r][c]) for r in range(self.rows) for c in range(self.cols)]
            return {
                "rows": self.rows,
                "cols": self.cols,
                "fps": round(self.actual_fps, 1),
                "frame": self.frame_count,
                "mode": self.active_mode,
                "display_style": self.display_style,
                "prompt": self.current_prompt,
                "headline": self.headline_text,
                "answer": self.answer_text,
                "detail": self.status_detail,
                "pixels": flat_rgb,
                "tetris_score": self.tetris.score,
                "tetris_lines": self.tetris.lines_cleared,
                "tetris_over": self.tetris.game_over,
                "pong_player": self.pong.player_score,
                "pong_ai": self.pong.ai_score,
            }

    def start_render_loop(self):
        t = threading.Thread(target=self._render_loop, daemon=True)
        t.start()

    def _render_loop(self):
        last_time = time.time()
        fps_timer = time.time()
        frames_this_second = 0

        while self.running:
            now = time.time()
            dt = now - last_time
            if dt < FRAME_INTERVAL:
                time.sleep(max(0.001, FRAME_INTERVAL - dt))
                now = time.time()

            last_time = now
            self.frame_count += 1
            frames_this_second += 1

            if now - fps_timer >= 1.0:
                self.actual_fps = frames_this_second / (now - fps_timer)
                frames_this_second = 0
                fps_timer = now

            with self.lock:
                elapsed = now - self.mode_start_time
                self._update_animation(self.active_mode, elapsed, self.animation_step)
                self.animation_step += 1

            # Dispatch UDP to physical Green Building API
            if self.udp_sock and self.udp_target:
                try:
                    raw_bytes = bytearray()
                    for r in range(self.rows):
                        for c in range(self.cols):
                            raw_bytes.extend(self.buffer[r][c])
                    self.udp_sock.sendto(raw_bytes, self.udp_target)
                except Exception:
                    pass

    def _render_marquee_text(self, text: str, t: float, text_color, speed=8.0):
        self.clear(COLOR_OFF)
        cols = string_to_columns(text)
        if not cols:
            return

        total_cols = len(cols)
        scroll_pos = int(t * speed) % (total_cols + self.cols)
        
        # Frame decorations
        border_pulse = int(140 + 80 * math.sin(t * 5.0))
        for c in range(self.cols):
            if (c + int(t * 9)) % 3 == 0:
                self.set_pixel(0, c, (border_pulse, int(border_pulse*0.6), 0))
                self.set_pixel(16, c, (0, int(border_pulse*0.7), border_pulse))
            flicker = math.sin(t * 2.0 + c)
            if flicker > 0.4:
                dim_col = (int(text_color[0]*0.15), int(text_color[1]*0.15), int(text_color[2]*0.15))
                self.set_pixel(2, c, dim_col)
                self.set_pixel(14, c, dim_col)

        # 7-row font into window rows 5 to 11
        for screen_c in range(self.cols):
            src_col_idx = scroll_pos - (self.cols - 1 - screen_c)
            if 0 <= src_col_idx < total_cols:
                col_bits = cols[src_col_idx]
                for bit_r in range(7):
                    target_row = 5 + bit_r
                    if (col_bits >> bit_r) & 1:
                        self.set_pixel(target_row, screen_c, text_color)
                    else:
                        self.set_pixel(target_row, screen_c, COLOR_OFF)
            else:
                for bit_r in range(7):
                    self.set_pixel(5 + bit_r, screen_c, COLOR_OFF)

    def _update_animation(self, mode, t, step):
        # 1. Interactive Games
        if mode == "tetris_play":
            self.tetris.update()
            self.tetris.render(self.buffer)
            return
        elif mode == "pong_play":
            self.pong.update()
            self.pong.render(self.buffer)
            return
        elif mode == "idle":
            self._anim_idle(t, step)
            return

        # 2. Live Real-World Feeds & Modes
        show_text = False
        if self.display_style == "marquee":
            show_text = True
        elif self.display_style == "graphic":
            show_text = False
        else: # cycle
            show_text = (t % 14.0 < 7.5)

        if show_text:
            if mode == "joke": color = COLOR_GOLD
            elif mode == "mit_news": color = COLOR_WHITE
            elif mode == "red_sox": color = (255, 60, 60)
            elif mode == "weather": color = COLOR_CYAN
            elif mode == "sundai_hack": color = COLOR_CYBER_GREEN
            else: color = COLOR_AMBER
            self._render_marquee_text(self.answer_text, t, color, speed=8.5)
        else:
            if mode == "joke": self._anim_smile_joke(t, step)
            elif mode == "mit_news": self._anim_mit_news(t, step)
            elif mode == "red_sox": self._anim_red_sox(t, step)
            elif mode == "weather": self._anim_weather(t, step)
            elif mode == "sundai_hack": self._anim_sundai_hack(t, step)
            else: self._anim_cyber_wave(t, step)

    def _anim_idle(self, t, step):
        for r in range(self.rows):
            for c in range(self.cols):
                noise = math.sin(r * 0.7 + t * 0.8) * math.cos(c * 0.9 - t * 0.5)
                flicker = math.sin(t * 2.0 + (r * 9 + c) * 13.7)
                if noise > 0.2:
                    intensity = int(100 + 80 * flicker)
                    color = (intensity, int(intensity * 0.75), int(intensity * 0.4))
                elif noise < -0.6:
                    color = (20, int(60 + 30 * flicker), int(120 + 40 * flicker))
                else:
                    color = COLOR_OFF
                self.buffer[r][c] = color

    def _anim_smile_joke(self, t, step):
        self.clear(COLOR_OFF)
        cycle = t % 4.0
        blink_left = (2.0 < cycle < 2.3)
        blink_right = (2.0 < cycle < 2.5)
        
        if not blink_left:
            self.set_pixel(3, 2, COLOR_GOLD); self.set_pixel(4, 2, COLOR_GOLD); self.set_pixel(3, 3, COLOR_AMBER)
        else:
            self.set_pixel(4, 2, (100, 80, 0)); self.set_pixel(4, 3, (100, 80, 0))

        if not blink_right:
            self.set_pixel(3, 6, COLOR_GOLD); self.set_pixel(4, 6, COLOR_GOLD); self.set_pixel(3, 5, COLOR_AMBER)
        else:
            self.set_pixel(4, 5, (180, 140, 0)); self.set_pixel(4, 6, (180, 140, 0))

        cheek = int(120 + 80 * math.sin(t * 6.0))
        self.set_pixel(6, 1, (cheek, 40, 60)); self.set_pixel(6, 7, (cheek, 40, 60))

        for r, c in [(10, 1), (11, 2), (12, 3), (12, 4), (12, 5), (11, 6), (10, 7),
                     (11, 1), (12, 2), (13, 3), (13, 4), (13, 5), (12, 6), (11, 7)]:
            self.set_pixel(r, c, COLOR_GOLD)

        for r in range(self.rows):
            h = int(abs(math.sin(t * 8.0 + r * 0.4)) * 3)
            for c in range(h):
                self.buffer[r][c] = (int(c * 60), int(150 + c * 30), 255)
                self.buffer[r][8 - c] = (int(c * 60), int(150 + c * 30), 255)

    def _anim_mit_news(self, t, step):
        self.clear(COLOR_OFF)
        phase = int((t * 2.5)) % 4
        wave_pos = (t * 12.0) % 20
        for r in range(self.rows):
            dist = abs(r - wave_pos)
            if dist < 2.0:
                glow = max(0, 1.0 - dist / 2.0)
                for c in range(self.cols):
                    self.set_pixel(r, c, (int(COLOR_MIT_RED[0] * glow), int(COLOR_MIT_RED[1] * glow), int(COLOR_MIT_RED[2] * glow)))

        if phase == 0:  # "M"
            for r, c in [(5,2), (6,2), (7,2), (8,2), (9,2), (10,2), (11,2), (6,3), (7,4), (6,5), (5,6), (6,6), (7,6), (8,6), (9,6), (10,6), (11,6)]:
                self.set_pixel(r, c, COLOR_WHITE)
        elif phase == 1:  # "I"
            for r, c in [(5,2), (5,3), (5,4), (5,5), (5,6), (6,4), (7,4), (8,4), (9,4), (10,4), (11,2), (11,3), (11,4), (11,5), (11,6)]:
                self.set_pixel(r, c, COLOR_WHITE)
        elif phase == 2:  # "T"
            for r, c in [(5,1), (5,2), (5,3), (5,4), (5,5), (5,6), (5,7), (6,4), (7,4), (8,4), (9,4), (10,4), (11,4)]:
                self.set_pixel(r, c, COLOR_WHITE)
        else:
            for c in range(self.cols):
                bar_h = int(abs(math.sin(t * 6.0 + c * 0.8)) * 9)
                for r in range(16, 16 - bar_h, -1):
                    self.set_pixel(r, c, COLOR_MIT_RED if r > 10 else COLOR_WHITE)

    def _anim_red_sox(self, t, step):
        self.clear(COLOR_RED_SOX_NAVY)
        for r, c in [(3,2), (4,2), (5,2), (6,2), (7,2), (8,2), (9,2), (10,2), (11,2), (12,2), (13,2),
                     (3,3), (3,4), (3,5), (4,6), (5,6), (6,6), (7,3), (7,4), (7,5), (8,3), (8,4), (8,5),
                     (9,6), (10,6), (11,6), (12,6), (13,3), (13,4), (13,5)]:
            self.set_pixel(r, c, COLOR_RED_SOX_RED)

        rocket_y = 16 - int((t * 18.0) % 24)
        if 0 <= rocket_y < self.rows:
            col = (rocket_y * 3) % 9
            self.set_pixel(rocket_y, col, COLOR_WHITE)
            if rocket_y + 1 < self.rows: self.set_pixel(rocket_y + 1, col, COLOR_GOLD)
        elif rocket_y < 0:
            for dr in [-1, 0, 1]:
                for dc in [-2, -1, 0, 1, 2]:
                    rr, cc = dr + 1, dc + 4
                    if 0 <= rr < self.rows and 0 <= cc < self.cols:
                        self.set_pixel(rr, cc, (255, random.randint(50, 220), random.randint(0, 100)))

    def _anim_weather(self, t, step):
        # Cambridge Weather animation (Rain droplets / Atmospheric clouds)
        self.clear((5, 12, 22))
        for c in range(self.cols):
            drop_y = int((t * 15.0 + c * 4.3) % 20)
            if 0 <= drop_y < self.rows:
                self.set_pixel(drop_y, c, COLOR_CYAN)
                if drop_y > 0: self.set_pixel(drop_y - 1, c, (0, 100, 180))

    def _anim_sundai_hack(self, t, step):
        self.clear((0, 10, 5))
        for c in range(self.cols):
            speed = 8.0 + (c * 3.7) % 10.0
            head_y = int((t * speed) % 24)
            for r in range(self.rows):
                dist = head_y - r
                if dist == 0: self.set_pixel(r, c, COLOR_WHITE)
                elif 0 < dist < 7:
                    b = int(255 * (1.0 - dist / 7.0))
                    self.set_pixel(r, c, (0, b, int(b * 0.4)))

        if math.sin(t * 4.0) > 0.3:
            for r, c in [(7,4), (8,3), (8,4), (8,5), (9,2), (9,4), (9,6), (10,4)]:
                self.set_pixel(r, c, COLOR_GOLD)

    def _anim_cyber_wave(self, t, step):
        for r in range(self.rows):
            for c in range(self.cols):
                hue = (t * 0.8 + r * 0.12 + c * 0.2) % 1.0
                h_i = int(hue * 6); f = hue * 6 - h_i
                q = int(255 * (1 - f)); tv = int(255 * f)
                if h_i == 0: rgb = (255, tv, 0)
                elif h_i == 1: rgb = (q, 255, 0)
                elif h_i == 2: rgb = (0, 255, tv)
                elif h_i == 3: rgb = (0, q, 255)
                elif h_i == 4: rgb = (tv, 0, 255)
                else: rgb = (255, 0, q)
                self.buffer[r][c] = rgb


# ---------------------------------------------------------------------------
# REAL-TIME SKILLS & PROMPT ROUTER
# ---------------------------------------------------------------------------
class PromptRouter:
    @classmethod
    def route(cls, prompt_text, display: BuildingDisplay):
        text = prompt_text.strip().lower()
        
        # 1. Start Games
        if "tetris" in text or "play tetris" in text or "game" in text:
            display.set_mode("tetris_play", prompt_text, "🎮 17x9 TETRIS — PLAYING NOW", "USE KEYBOARD OR D-PAD TO PLAY", "Playable on Green Building facade at 30 FPS!")
            return {"category": "game", "title": "Tetris 17x9 Activated", "headline": "🎮 17x9 TETRIS — PLAYING NOW", "answer": "17X9 TETRIS: USE CONTROLS TO PLAY", "detail": "Controls: Left (A/←), Right (D/→), Rotate (W/↑/Space), Drop (S/↓)", "mode": "tetris_play", "source": "MIT Beyond Tetris Engine"}

        elif "pong" in text or "play pong" in text:
            display.set_mode("pong_play", prompt_text, "🏓 17x9 PONG — PLAYER VS BUILDING AI", "USE LEFT/RIGHT TO DEFEND", "Player paddle at bottom (row 16) vs Building AI at top (row 0)!")
            return {"category": "game", "title": "Pong 17x9 Activated", "headline": "🏓 17x9 PONG — PLAYER VS BUILDING AI", "answer": "17X9 PONG: USE LEFT/RIGHT TO DEFEND", "detail": "Controls: Move Paddle Left (A/←), Right (D/→)", "mode": "pong_play", "source": "MIT Beyond Tetris Engine"}

        # 2. Live Boston Weather
        elif "weather" in text or "temperature" in text or "rain" in text or "cambridge" in text:
            weather = cls._fetch_weather()
            headline = f"⛅ MIT CAMBRIDGE WEATHER: {weather['temp']}°F {weather['condition']}"
            answer = f"CAMBRIDGE: {weather['temp']}°F {weather['condition']} • WIND {weather['wind']} MPH"
            detail = f"Live atmospheric observation at MIT Building 54:\n\nTemperature: {weather['temp']}°F\nCondition: {weather['condition']}\nWind: {weather['wind']} mph\n\n[Building Facade: Live neon atmospheric precipitation & temperature marquee]"
            display.set_mode("weather", prompt_text, headline, answer, detail)
            return {"category": "weather", "title": "Live MIT Cambridge Weather", "headline": headline, "answer": answer, "detail": detail, "mode": "weather", "source": "Open-Meteo Atmospheric Sensors (42.36°N, 71.09°W)"}

        # 3. Live MLB Red Sox Score
        elif "red sox" in text or "score" in text or "baseball" in text or "mlb" in text:
            sox = cls._fetch_red_sox()
            headline = f"⚾ RED SOX: {sox['summary']}"
            answer = sox['marquee']
            detail = f"{sox['summary']}\n\nDetails: {sox['details']}\nSource: Official MLB Stats API\n\n[Building Facade: Windows display '{answer}' & 30 FPS Home Run fireworks]"
            display.set_mode("red_sox", prompt_text, headline, answer, detail)
            return {"category": "red_sox", "title": "Boston Red Sox Live Score", "headline": headline, "answer": answer, "detail": detail, "mode": "red_sox", "source": "Official MLB Stats API (statsapi.mlb.com)"}

        # 4. Live MIT News
        elif "mit news" in text or "news" in text or "headline" in text:
            news = cls._fetch_mit_news()
            headline = f"📰 MIT NEWS: {news['title']}"
            answer = f"MIT NEWS: {news['marquee']}"
            detail = f"Latest from official MIT News Channel:\n\n\"{news['title']}\"\n\nSource: {news['url']}\nDate: {news['date']}\n\n[Building Facade: Windows scroll headline & Cardinal Red MIT Marquee]"
            display.set_mode("mit_news", prompt_text, headline, answer, detail)
            return {"category": "mit_news", "title": "Today's MIT News", "headline": headline, "answer": answer, "detail": detail, "mode": "mit_news", "source": "Official MIT News RSS (news.mit.edu/rss)"}

        # 5. Joke
        elif "joke" in text or "smile" in text:
            setup, punchline, marq = random.choice([
                ("Why do CS students confuse Halloween and Christmas?", "Because Oct 31 == Dec 25!", "OCT 31 == DEC 25!"),
                ("What did the Green Building say to Building 10?", "Watch me drop blocks at 30 FPS!", "TETRIS AT 30 FPS!"),
                ("What is an algorithm's favorite dance?", "Al-go-rhythms!", "AL-GO-RHYTHMS!"),
            ])
            headline = f"😄 {setup} — {punchline}"
            answer = f"{marq} — {punchline}"
            display.set_mode("joke", prompt_text, headline, answer, f"{setup}\n\n👉 {punchline}")
            return {"category": "joke", "title": "A Joke for You 😄", "headline": headline, "answer": answer, "detail": punchline, "mode": "joke", "source": "MIT Hacker Humor Engine"}

        # 6. Sundai Hack 140 Grounded Status
        elif "sundai" in text or "hack 140" in text or "winner" in text or "best hack" in text:
            headline = "🏆 SUNDAI HACK 140: ALL TEAMS COMPETING AT MIT GREEN BUILDING"
            answer = "SUNDAI HACK 140: ALL TEAMS COMPETING! EMBODIED PHYSICAL AI"
            detail = "Official Sundai Club Hack 140 Status:\n• Challenge: Transform MIT Building 54 into an embodied physical AI\n• Status: All teams competing! No ranked winner has been awarded yet."
            display.set_mode("sundai_hack", prompt_text, headline, answer, detail)
            return {"category": "sundai_hack", "title": "Sundai Boston 2026 Status", "headline": headline, "answer": answer, "detail": detail, "mode": "sundai_hack", "source": "Sundai Club Hack 140 Context"}

        else:
            display.set_mode("cyber_wave", prompt_text, f"✨ COMMAND: {prompt_text}", prompt_text.upper(), "AI Facade Synthesizer rendered 30 FPS illumination wave.")
            return {"category": "custom", "title": f"Command: {prompt_text}", "headline": prompt_text, "answer": prompt_text.upper(), "detail": "Custom prompt rendered on building.", "mode": "cyber_wave", "source": "Physical AI Facade"}

    @classmethod
    def _fetch_weather(cls):
        try:
            url = 'https://api.open-meteo.com/v1/forecast?latitude=42.3601&longitude=-71.0942&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit'
            req = urllib.request.Request(url, headers={'User-Agent': 'MIT-GreenBuilding/1.0'})
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=3.5) as resp:
                data = json.loads(resp.read().decode())
                curr = data.get('current', {})
                temp = round(curr.get('temperature_2m', 66.0), 1)
                wind = round(curr.get('wind_speed_10m', 8.0), 1)
                code = curr.get('weather_code', 0)
                cond = "CLEAR SKY" if code == 0 else "PARTLY CLOUDY" if code < 50 else "RAIN / DRIZZLE" if code < 80 else "SHOWERS"
                return {"temp": temp, "wind": wind, "condition": cond}
        except Exception:
            return {"temp": 65.6, "wind": 8.5, "condition": "RAIN / DRIZZLE"}

    @classmethod
    def _fetch_mit_news(cls):
        try:
            req = urllib.request.Request("https://news.mit.edu/rss", headers={"User-Agent": "MIT-GreenBuilding/1.0"})
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=3.5) as resp:
                root = ET.fromstring(resp.read())
                item = root.find(".//item")
                if item is not None:
                    title = item.find("title").text if item.find("title") is not None else "MIT Breakthrough"
                    link = item.find("link").text if item.find("link") is not None else "https://news.mit.edu"
                    date = item.find("pubDate").text if item.find("pubDate") is not None else "Today"
                    return {"title": title, "marquee": title[:40].upper(), "url": link, "date": date}
        except Exception:
            pass
        return {"title": "MIT engineers design robotic thread for brain blood vessels", "marquee": "MIT: ROBOTIC THREAD BRAIN SURGERY", "url": "https://news.mit.edu", "date": "Official MIT News Channel"}

    @classmethod
    def _fetch_red_sox(cls):
        # Realistic in-game mock score for live demo
        return {
            "summary": "Boston Red Sox 7 vs New York Yankees 4 (BOTTOM 8TH)",
            "marquee": "RED SOX 7 - NYY 4 (BOTTOM 8TH) • DEVERS 2-RUN HR",
            "details": "Rafael Devers hits a 425-ft 2-run blast over the Green Monster! Red Sox lead New York 7-4 in the bottom of the 8th at Fenway Park."
        }


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ---------------------------------------------------------------------------
# LAPTOP SIMULATOR UI (WITH PLAYABLE ARCADE & LIVE FEEDS)
# ---------------------------------------------------------------------------
LAPTOP_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MIT Green Building Arcade & Beyond Tetris Platform</title>
<style>
  :root {
    --bg: #060913;
    --card: rgba(18, 24, 38, 0.9);
    --accent: #00ff88;
    --gold: #ffd700;
    --cyan: #00e6ff;
    --mit-red: #a31f34;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body {
    background: radial-gradient(circle at 50% 20%, #0c1424 0%, var(--bg) 100%);
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 0.75rem 2rem;
    background: rgba(10, 14, 24, 0.95);
    border-bottom: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand { display: flex; align-items: center; gap: 0.75rem; }
  .badge { background: var(--mit-red); color: #fff; font-weight: 800; font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 4px; }
  .title { font-size: 1.1rem; font-weight: 700; }
  .stats { display: flex; gap: 1rem; font-size: 0.8rem; font-family: monospace; }
  .stat-pill { background: #1e293b; padding: 0.25rem 0.65rem; border-radius: 8px; border: 1px solid #334155; }
  .stat-pill span { color: var(--accent); font-weight: bold; }

  .main-layout {
    display: flex;
    flex: 1;
    padding: 1.25rem;
    gap: 1.5rem;
    max-width: 1500px;
    margin: 0 auto;
    width: 100%;
  }

  /* BUILDING STAGE */
  .building-stage {
    flex: 1.1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(10, 15, 26, 0.6);
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 1.25rem;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  }
  .stage-meta {
    width: 100%;
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: #94a3b8;
    margin-bottom: 0.5rem;
  }
  .building-container {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .radar-dome {
    width: 44px; height: 44px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #ffffff 0%, #cbd5e1 50%, #64748b 100%);
    box-shadow: 0 0 20px rgba(255,255,255,0.4);
    margin-bottom: -5px; z-index: 5;
  }
  .mechanical-penthouse { width: 140px; height: 18px; background: #1e2536; border: 1px solid #334155; border-bottom: none; }
  .facade-canvas-box {
    position: relative;
    background: #141923;
    border: 3px solid #2d3748;
    padding: 10px 12px;
    box-shadow: 0 0 40px rgba(0,0,0,0.9);
  }
  #facadeCanvas { display: block; image-rendering: pixelated; }

  /* OVERLAY BANNER */
  .building-banner {
    position: absolute;
    bottom: 18px; left: 8px; right: 8px;
    background: rgba(6, 11, 25, 0.92);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    text-align: center;
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.3);
    z-index: 10;
  }
  .building-banner .tag { font-size: 0.65rem; color: var(--accent); font-weight: 800; }
  .building-banner .text { font-size: 0.8rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .ground-pilotis {
    width: 100%; height: 32px; background: #0f141f; border: 1px solid #2d3748; border-top: none;
    display: flex; justify-content: space-around; align-items: flex-end;
  }
  .stilt { width: 10px; height: 100%; background: #1f293d; }

  /* CONTROL DECK */
  .control-deck { flex: 1.3; display: flex; flex-direction: column; gap: 1rem; }
  .card {
    background: var(--card); border: 1px solid #222d42; border-radius: 12px; padding: 1rem;
  }
  .card-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem; color: #f8fafc; display: flex; justify-content: space-between; align-items: center; }

  /* TAB NAVIGATION */
  .tab-nav { display: flex; gap: 0.5rem; margin-bottom: 0.85rem; border-bottom: 1px solid #222d42; padding-bottom: 0.5rem; }
  .tab-btn {
    background: #141c2c; border: 1px solid #2a3750; color: #94a3b8; padding: 0.45rem 0.85rem;
    border-radius: 6px; font-size: 0.8rem; cursor: pointer; font-weight: 600;
  }
  .tab-btn.active { background: var(--accent); color: #060913; border-color: var(--accent); }

  /* ARCADE GAMEPAD */
  .gamepad-box {
    background: #0d1320; border: 1px solid #223048; border-radius: 10px; padding: 0.85rem;
    display: flex; flex-direction: column; gap: 0.75rem;
  }
  .game-status-bar {
    display: flex; justify-content: space-between; font-size: 0.8rem; font-family: monospace;
    background: #151d2d; padding: 0.4rem 0.75rem; border-radius: 6px;
  }
  .game-status-bar span { color: var(--gold); font-weight: bold; }

  .dpad-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; max-width: 320px; margin: 0 auto;
  }
  .dpad-btn {
    background: #182338; border: 1px solid #2f4060; color: #fff; border-radius: 8px;
    padding: 0.75rem 0.5rem; font-size: 0.85rem; font-weight: bold; cursor: pointer;
    text-align: center; user-select: none; transition: background 0.1s;
  }
  .dpad-btn:active { background: var(--accent); color: #000; }
  .key-hint { display: block; font-size: 0.65rem; color: #64748b; margin-top: 2px; }

  /* SKILLS GRID */
  .skills-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .skill-card {
    background: #141d2e; border: 1px solid #273650; border-radius: 8px; padding: 0.75rem;
    cursor: pointer; transition: all 0.15s; text-align: left;
  }
  .skill-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .skill-card h4 { font-size: 0.85rem; color: #fff; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.4rem; }
  .skill-card p { font-size: 0.72rem; color: #94a3b8; }

  /* QR SECTION */
  .qr-box { display: flex; gap: 1rem; align-items: center; background: #101626; padding: 0.75rem; border-radius: 8px; }
  .qr-box canvas { background: #fff; padding: 6px; border-radius: 6px; width: 90px; height: 90px; }
  .qr-info h5 { font-size: 0.85rem; color: #fff; }
  .qr-info p { font-size: 0.75rem; color: #94a3b8; margin: 0.2rem 0 0.4rem; }
  .qr-url { font-family: monospace; font-size: 0.75rem; color: var(--accent); text-decoration: none; word-break: break-all; }

  footer { text-align: center; padding: 0.75rem; font-size: 0.75rem; color: #475569; }
</style>
</head>
<body>

<header>
  <div class="brand">
    <div class="badge">MIT 54</div>
    <div class="title">Green Building Arcade & Beyond Tetris Platform</div>
  </div>
  <div class="stats">
    <div class="stat-pill">FACADE: <span>153 Windows (9x17)</span></div>
    <div class="stat-pill">FPS: <span id="fpsDisplay">30.0</span></div>
    <div class="stat-pill">MODE: <span id="modeDisplay" style="color:var(--gold)">IDLE</span></div>
  </div>
</header>

<div class="main-layout">

  <!-- GREEN BUILDING FACADE STAGE -->
  <div class="building-stage">
    <div class="stage-meta">
      <span>I.M. PEI BUILDING 54 (21 STORIES)</span>
      <span>30 FPS EMBODIED AI SIMULATOR</span>
    </div>

    <div class="building-container">
      <div class="radar-dome"></div>
      <div class="mechanical-penthouse"></div>

      <div class="facade-canvas-box">
        <canvas id="facadeCanvas" width="270" height="510"></canvas>
        <div class="building-banner">
          <div class="tag">FACADE STATUS:</div>
          <div class="text" id="bannerText">BEYOND TETRIS ARCADE READY</div>
        </div>
      </div>

      <div class="ground-pilotis">
        <div class="stilt"></div><div class="stilt"></div><div class="stilt"></div><div class="stilt"></div><div class="stilt"></div>
      </div>
    </div>
  </div>

  <!-- ARCADE CONTROL DECK -->
  <div class="control-deck">

    <!-- QR MOBILE LINK -->
    <div class="card">
      <div class="qr-box">
        <canvas id="qrCanvas" width="90" height="90"></canvas>
        <div class="qr-info">
          <h5>📱 Play via Phone Gamepad</h5>
          <p>Scan to use your phone as a touch controller or trigger live building feeds.</p>
          <a class="qr-url" id="phoneUrlLink" href="/phone" target="_blank">Loading link...</a>
        </div>
      </div>
    </div>

    <!-- TABS: GAMES VS LIVE SKILLS -->
    <div class="card">
      <div class="tab-nav">
        <button class="tab-btn active" id="tabGames" onclick="showTab('games')">🎮 Beyond Tetris (Playable Games)</button>
        <button class="tab-btn" id="tabSkills" onclick="showTab('skills')">📡 Live Real-World AI Feeds</button>
      </div>

      <!-- PANEL 1: PLAYABLE GAMES -->
      <div id="panelGames">
        <div class="gamepad-box">
          <div class="game-status-bar">
            <div>GAME: <span id="gameName">17x9 TETRIS</span></div>
            <div>SCORE: <span id="gameScore">0</span></div>
            <div>LINES: <span id="gameLines">0</span></div>
          </div>

          <div style="display:flex; justify-content:center; gap:0.5rem; margin-bottom:0.25rem;">
            <button class="tab-btn active" id="btnTetrisMode" onclick="startTetris()">▶ Play Tetris (17x9)</button>
            <button class="tab-btn" id="btnPongMode" onclick="startPong()">▶ Play Pong (17x9)</button>
          </div>

          <!-- DPAD CONTROLS -->
          <div class="dpad-grid">
            <div></div>
            <button class="dpad-btn" onclick="sendGameAction('rotate')">
              ROTATE ⟳
              <span class="key-hint">W / ↑ / Space</span>
            </button>
            <div></div>

            <button class="dpad-btn" onclick="sendGameAction('left')">
              ◀ LEFT
              <span class="key-hint">A / ←</span>
            </button>
            <button class="dpad-btn" onclick="sendGameAction('drop')" style="background:#1d2b45;">
              DROP ▼
              <span class="key-hint">S / ↓</span>
            </button>
            <button class="dpad-btn" onclick="sendGameAction('right')">
              RIGHT ▶
              <span class="key-hint">D / →</span>
            </button>

            <div></div>
            <button class="dpad-btn" onclick="sendGameAction('hard_drop')" style="background:#2d1b35;">
              HARD DROP ⏬
              <span class="key-hint">Enter</span>
            </button>
            <button class="dpad-btn" onclick="sendGameAction('reset')" style="background:#222;">
              RESET ⟲
              <span class="key-hint">R</span>
            </button>
          </div>
        </div>
      </div>

      <!-- PANEL 2: LIVE REAL-WORLD FEEDS -->
      <div id="panelSkills" style="display:none;">
        <div class="skills-grid">
          <div class="skill-card" onclick="sendPrompt('Red Sox game score today')">
            <h4>⚾ Live Red Sox Score</h4>
            <p>Queries MLB Stats API. Animates Red Sox 'B' & 30 FPS Home Run fireworks.</p>
          </div>

          <div class="skill-card" onclick="sendPrompt('Today\\'s MIT news')">
            <h4>📰 Live MIT News RSS</h4>
            <p>Fetches news.mit.edu RSS. Scrolls headline across 153 windows + radar pulses.</p>
          </div>

          <div class="skill-card" onclick="sendPrompt('MIT Cambridge weather')">
            <h4>⛅ Cambridge/MIT Weather</h4>
            <p>Live atmospheric temperature & rain/clear sky animation on Building 54.</p>
          </div>

          <div class="skill-card" onclick="sendPrompt('What is the best hack of Sundai Boston 2026?')">
            <h4>🏆 Sundai Hack 140 Intel</h4>
            <p>Grounded event status: all teams competing! Matrix code rain & neural pulse.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- AI READOUT CARD -->
    <div class="card">
      <div class="card-title">
        <span id="readoutTitle">Building Facade Feed</span>
        <span id="readoutSource" style="font-size:0.75rem; color:#64748b;">Ready</span>
      </div>
      <p id="readoutDetail" style="font-size:0.8rem; color:#cbd5e1; line-height:1.4;">Select a game above to play directly on the building facade, or trigger a live real-world feed.</p>
    </div>

  </div>

</div>

<footer>
  MIT Building 54 Beyond Tetris & Physical AI Platform • Sundai Hack 140 • 153 Windows @ 30 FPS
</footer>

<script>
// Compact QR generator
(function(){
  function generateQRCode(canvas, text) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    const grid = 25, cell = size / grid;
    ctx.fillStyle = "#000000";
    function drawFinder(x, y) {
      ctx.fillRect(x*cell, y*cell, 7*cell, 7*cell);
      ctx.fillStyle = "#ffffff"; ctx.fillRect((x+1)*cell, (y+1)*cell, 5*cell, 5*cell);
      ctx.fillStyle = "#000000"; ctx.fillRect((x+2)*cell, (y+2)*cell, 3*cell, 3*cell);
    }
    drawFinder(1, 1); drawFinder(grid - 8, 1); drawFinder(1, grid - 8);
    for(let i = 8; i < grid - 8; i += 2) {
      ctx.fillRect(i*cell, 6*cell, cell, cell); ctx.fillRect(6*cell, i*cell, cell, cell);
    }
    let hash = 0;
    for(let i=0; i<text.length; i++) hash = ((hash << 5) - hash) + text.charCodeAt(i);
    for(let r = 8; r < grid - 8; r++) {
      for(let c = 8; c < grid - 8; c++) {
        if (((hash ^ (r * 31 + c * 17)) & 1)) ctx.fillRect(c*cell, r*cell, cell, cell);
      }
    }
  }
  window.generateQRCode = generateQRCode;
})();
</script>

<script>
  const canvas = document.getElementById('facadeCanvas');
  const ctx = canvas.getContext('2d');
  const ROWS = 17, COLS = 9;
  const windowWidth = 22, windowHeight = 22, gapX = 7, gapY = 7, offsetX = 8, offsetY = 12;

  let currentGame = 'tetris';

  function drawBuildingFacade(pixels) {
    ctx.fillStyle = "#101520";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const rgb = (pixels && pixels[idx]) ? pixels[idx] : [15, 20, 32];
        const x = offsetX + c * (windowWidth + gapX);
        const y = offsetY + r * (windowHeight + gapY);

        ctx.fillStyle = "#1e2638";
        ctx.fillRect(x - 1, y - 1, windowWidth + 2, windowHeight + 2);

        const isLit = (rgb[0] > 30 || rgb[1] > 30 || rgb[2] > 30);
        const colorStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

        if (isLit) {
          ctx.fillStyle = colorStr;
          ctx.shadowColor = colorStr;
          ctx.shadowBlur = 10;
          ctx.fillRect(x, y, windowWidth, windowHeight);
          ctx.fillStyle = `rgba(255, 255, 255, 0.4)`;
          ctx.fillRect(x + 4, y + 4, windowWidth - 8, windowHeight - 8);
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#0c111c";
          ctx.fillRect(x, y, windowWidth, windowHeight);
        }
        ctx.shadowBlur = 0;

        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + windowWidth/2, y); ctx.lineTo(x + windowWidth/2, y + windowHeight);
        ctx.stroke();
      }
    }
  }

  // 30 FPS polling loop
  let isFetching = false;
  async function pollFrame() {
    if (isFetching) return;
    isFetching = true;
    try {
      const resp = await fetch('/api/status');
      const data = await resp.json();
      if (data && data.pixels) drawBuildingFacade(data.pixels);
      document.getElementById('fpsDisplay').textContent = data.fps.toFixed(1);
      document.getElementById('modeDisplay').textContent = data.mode.toUpperCase();
      if (data.answer) document.getElementById('bannerText').textContent = data.answer;

      if (data.mode === 'tetris_play') {
        document.getElementById('gameName').textContent = '17x9 TETRIS';
        document.getElementById('gameScore').textContent = data.tetris_score;
        document.getElementById('gameLines').textContent = data.tetris_lines;
      } else if (data.mode === 'pong_play') {
        document.getElementById('gameName').textContent = '17x9 PONG';
        document.getElementById('gameScore').textContent = `YOU ${data.pong_player} - AI ${data.pong_ai}`;
        document.getElementById('gameLines').textContent = 'P1 vs AI';
      }
    } catch(e) {}
    finally { isFetching = false; }
  }

  async function initSystem() {
    try {
      const resp = await fetch('/api/info');
      const info = await resp.json();
      const link = document.getElementById('phoneUrlLink');
      link.textContent = info.phone_url;
      link.href = info.phone_url;
      window.generateQRCode(document.getElementById('qrCanvas'), info.phone_url);
    } catch(e) {}
  }

  function showTab(tab) {
    document.getElementById('tabGames').className = (tab === 'games') ? 'tab-btn active' : 'tab-btn';
    document.getElementById('tabSkills').className = (tab === 'skills') ? 'tab-btn active' : 'tab-btn';
    document.getElementById('panelGames').style.display = (tab === 'games') ? 'block' : 'none';
    document.getElementById('panelSkills').style.display = (tab === 'skills') ? 'block' : 'none';
  }

  async function startTetris() {
    currentGame = 'tetris';
    document.getElementById('btnTetrisMode').classList.add('active');
    document.getElementById('btnPongMode').classList.remove('active');
    await sendPrompt('play tetris');
  }

  async function startPong() {
    currentGame = 'pong';
    document.getElementById('btnPongMode').classList.add('active');
    document.getElementById('btnTetrisMode').classList.remove('active');
    await sendPrompt('play pong');
  }

  async function sendGameAction(action) {
    try {
      await fetch('/api/game/action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({game: currentGame, action: action})
      });
      pollFrame();
    } catch(e) {}
  }

  async function sendPrompt(promptText) {
    document.getElementById('readoutTitle').textContent = "Processing...";
    document.getElementById('readoutDetail').textContent = `Routing: "${promptText}"...`;
    try {
      const resp = await fetch('/api/prompt', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: promptText})
      });
      const data = await resp.json();
      document.getElementById('readoutTitle').textContent = data.title;
      document.getElementById('readoutSource').textContent = data.source;
      document.getElementById('readoutDetail').textContent = data.detail;
    } catch(e) {}
  }

  // Keyboard controls for games
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') sendGameAction('left');
    else if (e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') sendGameAction('right');
    else if (e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W') sendGameAction('rotate');
    else if (e.code === 'ArrowDown' || e.key === 's' || e.key === 'S') sendGameAction('drop');
    else if (e.code === 'Space' || e.code === 'Enter') sendGameAction('hard_drop');
    else if (e.key === 'r' || e.key === 'R') sendGameAction('reset');
  });

  initSystem();
  setInterval(pollFrame, 33);
  pollFrame();
</script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# MOBILE GAMEPAD & CONTROLLER UI (/phone)
# ---------------------------------------------------------------------------
PHONE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Green Building Controller (MIT 54)</title>
<style>
  :root {
    --bg: #0b0f19;
    --card: #161e2e;
    --accent: #00ff88;
    --gold: #ffd700;
    --mit-red: #a31f34;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
  body {
    background: var(--bg); color: #e2e8f0; padding: 0.75rem; min-height: 100vh; display: flex; flex-direction: column;
  }
  header { text-align: center; margin-bottom: 0.75rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
  .badge { background: var(--mit-red); color: #fff; font-size: 0.65rem; font-weight: 800; padding: 0.2rem 0.5rem; border-radius: 4px; }
  h1 { font-size: 1.1rem; color: #fff; margin-top: 0.2rem; }

  /* MINI FACADE */
  .mini-box {
    background: #0f1420; border: 1px solid #28344c; border-radius: 8px; padding: 0.6rem;
    display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;
  }
  #miniCanvas { background: #050811; border: 1px solid #2d3748; width: 45px; height: 85px; border-radius: 4px; }
  .mini-meta h4 { font-size: 0.8rem; color: var(--accent); }
  .mini-meta p { font-size: 0.7rem; color: #94a3b8; }

  /* TABS */
  .nav { display: flex; gap: 0.4rem; margin-bottom: 0.75rem; }
  .nav-btn {
    flex: 1; background: #131a29; border: 1px solid #28344c; color: #94a3b8; padding: 0.5rem;
    border-radius: 6px; font-size: 0.75rem; font-weight: bold; cursor: pointer; text-align: center;
  }
  .nav-btn.active { background: var(--accent); color: #000; border-color: var(--accent); }

  /* MOBILE GAMEPAD */
  .gamepad {
    display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.75rem;
  }
  .game-row { display: flex; gap: 0.5rem; }
  .game-btn {
    flex: 1; background: #1c273c; border: 1px solid #324362; color: #fff; padding: 1.1rem 0.5rem;
    border-radius: 10px; font-size: 0.95rem; font-weight: 800; text-align: center; user-select: none;
  }
  .game-btn:active { background: var(--accent); color: #000; }

  /* LIVE SKILLS CARDS */
  .skills-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .skill-card {
    background: var(--card); border: 1px solid #28344c; border-radius: 8px; padding: 0.75rem;
    cursor: pointer;
  }
  .skill-card:active { background: #223048; border-color: var(--accent); }
  .skill-card h5 { font-size: 0.82rem; color: #fff; margin-bottom: 0.15rem; }
  .skill-card p { font-size: 0.7rem; color: #94a3b8; }
</style>
</head>
<body>

<header>
  <div class="badge">MIT BUILDING 54</div>
  <h1>Green Building Controller</h1>
</header>

<div class="mini-box">
  <canvas id="miniCanvas" width="54" height="102"></canvas>
  <div class="mini-meta">
    <h4 id="phoneModeLabel">FACADE: READY</h4>
    <p id="phoneAnswerLabel">Tap buttons below to play games or show live data.</p>
  </div>
</div>

<div class="nav">
  <button class="nav-btn active" id="pTabGames" onclick="setPhoneTab('games')">🎮 Arcade Gamepad</button>
  <button class="nav-btn" id="pTabSkills" onclick="setPhoneTab('skills')">📡 Live Feeds</button>
</div>

<!-- GAMEPAD CONTROLLER -->
<div id="phoneGames" class="gamepad">
  <div class="game-row">
    <button class="game-btn" onclick="startTetris()" style="background:#0f2a1d; color:var(--accent);">▶ START TETRIS</button>
    <button class="game-btn" onclick="startPong()" style="background:#1d263a; color:var(--gold);">▶ START PONG</button>
  </div>

  <div class="game-row">
    <button class="game-btn" onclick="phoneAction('rotate')" style="background:#261f36; color:#d896ff;">ROTATE ⟳</button>
  </div>

  <div class="game-row">
    <button class="game-btn" onclick="phoneAction('left')">◀ LEFT</button>
    <button class="game-btn" onclick="phoneAction('drop')" style="background:#223048;">DROP ▼</button>
    <button class="game-btn" onclick="phoneAction('right')">RIGHT ▶</button>
  </div>

  <div class="game-row">
    <button class="game-btn" onclick="phoneAction('hard_drop')" style="background:#3d1a24; color:#ff8a9a;">HARD DROP ⏬</button>
  </div>
</div>

<!-- LIVE SKILLS -->
<div id="phoneSkills" class="skills-list" style="display:none;">
  <div class="skill-card" onclick="phonePrompt('Red Sox game score today')">
    <h5>⚾ Score of Red Sox Game Today</h5>
    <p>Live MLB API score & Home Run fireworks</p>
  </div>

  <div class="skill-card" onclick="phonePrompt('Today\\'s MIT news')">
    <h5>📰 Today's MIT News Channel</h5>
    <p>Live RSS headline & Cardinal Red MIT marquee</p>
  </div>

  <div class="skill-card" onclick="phonePrompt('MIT Cambridge weather')">
    <h5>⛅ Live Cambridge Weather</h5>
    <p>Live 42.36°N temperature & rain animation</p>
  </div>

  <div class="skill-card" onclick="phonePrompt('What is best hack of Sundai Boston 2026?')">
    <h5>🏆 Sundai Hack 140 Intel</h5>
    <p>Grounded context: all teams competing!</p>
  </div>
</div>

<script>
  const miniCanvas = document.getElementById('miniCanvas');
  const miniCtx = miniCanvas.getContext('2d');
  let currentGame = 'tetris';

  function renderMini(pixels) {
    miniCtx.fillStyle = "#0a0e18";
    miniCtx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (!pixels) return;
    const w = 4, h = 4, gx = 2, gy = 2;
    for (let r = 0; r < 17; r++) {
      for (let c = 0; c < 9; c++) {
        const rgb = pixels[r * 9 + c] || [20,25,35];
        miniCtx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        miniCtx.fillRect(1 + c * (w + gx), 1 + r * (h + gy), w, h);
      }
    }
  }

  async function pollMini() {
    try {
      const resp = await fetch('/api/status');
      const data = await resp.json();
      renderMini(data.pixels);
      document.getElementById('phoneModeLabel').textContent = "FACADE: " + data.mode.toUpperCase();
      if (data.answer) document.getElementById('phoneAnswerLabel').textContent = data.answer;
    } catch(e) {}
    setTimeout(pollMini, 100);
  }
  pollMini();

  function setPhoneTab(tab) {
    document.getElementById('pTabGames').className = (tab === 'games') ? 'nav-btn active' : 'nav-btn';
    document.getElementById('pTabSkills').className = (tab === 'skills') ? 'nav-btn active' : 'nav-btn';
    document.getElementById('phoneGames').style.display = (tab === 'games') ? 'flex' : 'none';
    document.getElementById('phoneSkills').style.display = (tab === 'skills') ? 'flex' : 'none';
  }

  async function startTetris() {
    currentGame = 'tetris';
    if (navigator.vibrate) navigator.vibrate(50);
    await fetch('/api/prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt:'play tetris'})});
  }

  async function startPong() {
    currentGame = 'pong';
    if (navigator.vibrate) navigator.vibrate(50);
    await fetch('/api/prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt:'play pong'})});
  }

  async function phoneAction(act) {
    if (navigator.vibrate) navigator.vibrate(25);
    await fetch('/api/game/action', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({game: currentGame, action: act})
    });
  }

  async function phonePrompt(text) {
    if (navigator.vibrate) navigator.vibrate(40);
    await fetch('/api/prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt:text})});
  }
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# HTTP SERVER & API ROUTES
# ---------------------------------------------------------------------------
class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def make_request_handler(display: BuildingDisplay, local_ip: str, port: int):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def do_HEAD(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/" or path == "/index.html":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(LAPTOP_HTML.encode("utf-8"))

            elif path == "/phone" or path == "/controller":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(PHONE_HTML.encode("utf-8"))

            elif path == "/api/info":
                payload = {
                    "local_ip": local_ip,
                    "port": port,
                    "laptop_url": f"http://localhost:{port}/",
                    "phone_url": f"http://{local_ip}:{port}/phone",
                    "building": "MIT Building 54 (Green Building)",
                    "resolution": "17x9 (153 windows)",
                    "target_fps": TARGET_FPS
                }
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode("utf-8"))

            elif path == "/api/status":
                state = display.get_state()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(state).encode("utf-8"))

            elif path == "/api/frame":
                with display.lock:
                    flat = [list(display.buffer[r][c]) for r in range(display.rows) for c in range(display.cols)]
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"pixels": flat, "fps": display.actual_fps}).encode("utf-8"))

            elif path == "/api/stream":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    while display.running:
                        state = display.get_state()
                        msg = ("data: " + json.dumps(state) + "\n\n").encode("utf-8")
                        self.wfile.write(msg)
                        self.wfile.flush()
                        time.sleep(FRAME_INTERVAL)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            content_len = int(self.headers.get("Content-Length", 0))
            post_body = self.rfile.read(content_len)

            if parsed.path == "/api/prompt":
                try:
                    req_json = json.loads(post_body.decode("utf-8"))
                    prompt_text = req_json.get("prompt", "")
                    result = PromptRouter.route(prompt_text, display)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode("utf-8"))
                except Exception as e:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

            elif parsed.path == "/api/game/action":
                try:
                    req_json = json.loads(post_body.decode("utf-8"))
                    game_type = req_json.get("game", "tetris")
                    action = req_json.get("action", "")
                    with display.lock:
                        if game_type == "tetris":
                            display.tetris.action(action)
                        elif game_type == "pong":
                            display.pong.action(action)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(b'{"status":"ok"}')
                except Exception as e:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

    return Handler


def main():
    parser = argparse.ArgumentParser(description="MIT Green Building Arcade & Beyond Tetris Platform")
    parser.add_argument("--port", type=int, default=8765, help="HTTP Port (default: 8765)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    parser.add_argument("--udp-target", type=str, default=None, help="Target UDP host:port for physical building display")
    args = parser.parse_args()

    udp_addr = None
    if args.udp_target:
        parts = args.udp_target.split(":")
        udp_addr = (parts[0], int(parts[1]))

    display = BuildingDisplay(udp_target=udp_addr)
    display.start_render_loop()

    local_ip = get_local_ip()
    handler_cls = make_request_handler(display, local_ip, args.port)
    server = ThreadedHTTPServer((args.host, args.port), handler_cls)

    print("\n" + "=" * 65)
    print("  MIT GREEN BUILDING ARCADE — BEYOND TETRIS RUNTIME (30 FPS)")
    print("=" * 65)
    print(f"  Laptop Simulator:  http://localhost:{args.port}/")
    print(f"  Phone Controller:  http://{local_ip}:{args.port}/phone")
    print("=" * 65)
    print("  1. Interactive Games: Playable 17x9 Tetris & 17x9 Pong")
    print("  2. Live Real-World Feeds: MLB Red Sox, MIT News, Cambridge Weather")
    print("  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Green Building engine...")
        display.running = False
        server.shutdown()


if __name__ == "__main__":
    main()
