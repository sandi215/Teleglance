#!/usr/bin/env python3
"""Record the TeleGlance Day 6 demo video (Even Realities Heads Up).

Captures the glasses framebuffer (576x288 RGBA) at 10 fps while driving
the scripted journey from DESIGN.md §6, then writes a timing manifest
for the assembly step (scripts/assemble-demo.py).

Usage:
  1. Backend + Vite + simulator up (see BUILD-PLAN.md / build-log Day 6).
  2. python3 scripts/record-demo.py [--base http://127.0.0.1:9898]
  3. python3 scripts/assemble-demo.py   (title/end cards + captions)

The journey (holds in seconds, captions from DESIGN.md §6):
  home -> detail -> detail p2 -> reply idle -> digest -> home ->
  detail -> detail p2 -> reply idle -> recording -> menu (Send) ->
  sent -> home -> focus chat 2 -> detail -> home -> exit.
The Send step posts the real draft to DEMO_TARGET_CHAT (the real
Telegram demo group) — that is the point of the video.
"""
import argparse
import io
import json
import os
import sys
import threading
import time
from urllib.request import Request, urlopen

from PIL import Image

READY_MARKER = "[teleglance] ready"
BASE_DEFAULT = "http://127.0.0.1:9898"
FRAMES_DIR = os.path.expanduser("~/workspace/hackathons/even-realities/.tmp/demo-frames")
MANIFEST = os.path.expanduser("~/workspace/hackathons/even-realities/.tmp/demo-manifest.json")
FPS = 10


def get_json(base, path):
    with urlopen(f"{base}{path}", timeout=10) as r:
        return json.loads(r.read())


def get_png(base, path):
    with urlopen(f"{base}{path}", timeout=15) as r:
        return Image.open(io.BytesIO(r.read()))


def post_json(base, path, body):
    req = Request(
        f"{base}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=10) as r:
        return r.read()


def wait_for_ready(base, timeout=60):
    deadline = time.time() + timeout
    since_id = 0
    while time.time() < deadline:
        try:
            data = get_json(base, f"/api/console?since_id={since_id}")
        except Exception:
            time.sleep(0.5)
            continue
        for entry in data.get("entries", []):
            since_id = max(since_id, entry["id"])
            if READY_MARKER in entry.get("message", ""):
                return
        time.sleep(0.25)
    raise TimeoutError(f"App did not log {READY_MARKER!r} within {timeout}s")


def composite_black(rgba):
    """Glasses framebuffer is RGBA on black; flatten for video."""
    bg = Image.new("RGB", rgba.size, (0, 0, 0))
    bg.paste(rgba, mask=rgba.split()[3])
    return bg


class Capturer(threading.Thread):
    def __init__(self, base):
        super().__init__(daemon=True)
        self.base = base
        self.stop_flag = threading.Event()
        self.count = 0
        os.makedirs(FRAMES_DIR, exist_ok=True)
        for f in os.listdir(FRAMES_DIR):
            os.remove(os.path.join(FRAMES_DIR, f))

    def run(self):
        next_t = time.time()
        while not self.stop_flag.is_set():
            try:
                img = composite_black(get_png(self.base, "/api/screenshot/glasses"))
                img.save(f"{FRAMES_DIR}/frame_{self.count:05d}.png")
                self.count += 1
            except Exception as e:  # noqa: BLE001 - keep capturing
                print(f"capture hiccup: {e}", file=sys.stderr)
            next_t += 1.0 / FPS
            delay = next_t - time.time()
            if delay > 0:
                time.sleep(delay)

    def stop(self):
        self.stop_flag.set()
        self.join(timeout=5)


# (action, hold_seconds_after_action, caption)
# action None = just hold on the current screen.
STEPS = [
    (None, 10.0, "Unread at a glance"),
    ("click", 8.0, "Channel messages, newest first"),
    ("click", 5.0, "Channel messages, newest first"),
    ("click", 3.0, "Reply with your voice"),
    ("down", 10.0, "Channel digest in seconds"),
    ("click", 5.0, "Back home"),
    ("click", 4.0, "Pick a chat to reply"),
    ("click", 3.0, "Pick a chat to reply"),
    ("click", 3.0, "Tap to record a reply"),
    ("click", 5.0, "Recording — demo transcript"),
    ("click", 11.5, "AI draft — Send, Rewrite or Cancel"),
    ("click", 7.0, "Sent — one tap"),
    ("click", 4.0, "Back home"),
    ("down", 3.0, "Switch chats"),
    ("click", 6.0, "Second chat"),
    ("double_click", 2.0, "Double-tap goes home"),
    ("double_click", 4.0, "Double-tap to exit"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE_DEFAULT)
    args = ap.parse_args()

    with urlopen(f"{args.base}/api/ping", timeout=10) as r:
        ping = r.read().decode("utf-8", errors="replace").strip()
    assert ping in ("pong", '"pong"', '{"message": "pong"}'), f"simulator not up (ping={ping!r})"
    print("ping: pong")
    wait_for_ready(args.base)
    print("ready marker seen")

    cap = Capturer(args.base)
    cap.start()
    t0 = time.time()
    manifest = []
    try:
        for action, hold, caption in STEPS:
            start = time.time() - t0
            if action:
                post_json(args.base, "/api/input", {"action": action})
                print(f"t={start:6.1f}s action={action} hold={hold}s :: {caption}")
            else:
                print(f"t={start:6.1f}s hold={hold}s :: {caption}")
            manifest.append(
                {"start": round(start, 2), "duration": hold, "caption": caption, "action": action}
            )
            time.sleep(hold)
    finally:
        cap.stop()
    total = time.time() - t0
    print(f"captured {cap.count} frames over {total:.1f}s")
    with open(MANIFEST, "w") as f:
        json.dump({"fps": FPS, "total": round(total, 2), "steps": manifest}, f, indent=2)
    print(f"manifest: {MANIFEST}")
    print("RECORD: DONE")


if __name__ == "__main__":
    main()
