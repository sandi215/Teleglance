#!/usr/bin/env python3
"""Headless simulator journey test for TeleGlance (Even Realities G2).

Usage:
  1. Start the Vite dev server:  cd teleglance && npm run dev
  2. Start the simulator:       xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898
  3. Run:                        python3 scripts/sim-test.py [--base http://127.0.0.1:9898] [--out shots/]

Asserts the QA basics from the App Submission & QA Guidelines:
- app boots and lights pixels in the 576x288 framebuffer
- no console errors at boot
- tap journey changes the screen (home -> detail)
- double-tap on root raises the system exit dialog
Screenshots are saved to --out for the demo-video shot list.
"""
import argparse
import io
import json
import sys
import time
from urllib.request import Request, urlopen

from PIL import Image

READY_MARKER = "[teleglance] ready"  # app logs this once mounted
TIMEOUT_S = 60


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


def lit_pixels(img):
    assert img.mode == "RGBA", f"expected RGBA, got {img.mode}"
    assert img.size == (576, 288), f"expected 576x288, got {img.size}"
    return sum(1 for px in img.getdata() if px[3] > 0)


def wait_for_ready(base, timeout=TIMEOUT_S):
    deadline = time.time() + timeout
    since_id = 0
    while time.time() < deadline:
        data = get_json(base, f"/api/console?since_id={since_id}")
        for entry in data.get("entries", []):
            since_id = max(since_id, entry["id"])
            if READY_MARKER in entry.get("message", ""):
                return
        time.sleep(0.25)
    raise TimeoutError(f"App did not log {READY_MARKER!r} within {timeout}s")


def console_errors(base):
    data = get_json(base, "/api/console")
    return [
        e for e in data.get("entries", [])
        if e.get("level") in ("error",)
        or "Uncaught" in e.get("message", "")
        or "Failed to fetch" in e.get("message", "")
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:9898")
    ap.add_argument("--out", default="shots")
    args = ap.parse_args()

    import os
    os.makedirs(args.out, exist_ok=True)

    # /api/ping returns plain-text "pong", not JSON — read it raw.
    with urlopen(f"{args.base}/api/ping", timeout=10) as r:
        ping = r.read().decode("utf-8", errors="replace").strip()
    assert ping in ("pong", '"pong"', '{"message": "pong"}'), f"simulator not up (ping={ping!r})"
    print("ping: pong")
    wait_for_ready(args.base)
    print("ready marker seen")

    boot = get_png(args.base, "/api/screenshot/glasses")
    boot.save(f"{args.out}/01-home.png")
    n_boot = lit_pixels(boot)
    assert n_boot > 100, f"framebuffer blank after ready ({n_boot} lit px)"
    print(f"boot framebuffer: {n_boot} lit px")

    errs = console_errors(args.base)
    assert not errs, f"console errors at boot: {errs[:3]}"
    print("console: no errors at boot")

    # Journey (Day 4): home -> detail -> reply -> digest -> home ->
    # detail -> reply -> record -> menu -> sent -> home -> exit.
    # Assert pixel-level change (not just lit totals — two different
    # screens can share a similar lit count).
    def diff_pixels(a, b):
        return sum(1 for x, y in zip(a.getdata(), b.getdata()) if x != y)

    # (action, sleep_s, shot_name)
    steps = [
        ("click", 1.0, "02-detail-p1"),
        ("click", 1.0, "03-detail-p2"),
        ("click", 1.0, "04-reply-idle"),
        ("down", 1.0, "05-digest"),
        ("click", 1.0, "06-home-again"),
        ("click", 1.0, "07-detail-p1"),
        ("click", 1.0, "08-detail-p2"),
        ("click", 1.0, "09-reply-idle"),
        ("click", 1.0, "10-recording"),
        ("click", 2.0, "11-menu"),
        ("click", 1.5, "12-sent"),
        ("click", 1.0, "13-home-final"),
    ]
    prev, n_prev = boot, n_boot
    for i, (action, wait, name) in enumerate(steps, start=1):
        post_json(args.base, "/api/input", {"action": action})
        time.sleep(wait)
        shot = get_png(args.base, "/api/screenshot/glasses")
        shot.save(f"{args.out}/{name}.png")
        d = diff_pixels(prev, shot)
        assert d > 100, f"screen did not change after step {i} ({name}, diff {d}px)"
        print(f"step {i} {action} ({name}): {lit_pixels(shot)} lit px (diff {d}px: OK)")
        prev, n_prev = shot, lit_pixels(shot)

    # Double-tap on root should raise the system exit dialog (QA requirement).
    post_json(args.base, "/api/input", {"action": "double_click"})
    time.sleep(0.5)
    post_json(args.base, "/api/input", {"action": "double_click"})
    time.sleep(0.5)
    after_exit = get_png(args.base, "/api/screenshot/glasses")
    after_exit.save(f"{args.out}/14-exit-dialog.png")
    n_exit = lit_pixels(after_exit)
    assert abs(n_exit - n_prev) > 20, "exit dialog did not appear on double-tap"
    print(f"after double-tap: {n_exit} lit px (exit dialog: OK)")

    print("SIM TEST: PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - report and exit non-zero
        print(f"SIM TEST: FAIL — {e}", file=sys.stderr)
        sys.exit(1)
