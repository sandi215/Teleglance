#!/usr/bin/env python3
"""Assemble the TeleGlance Day 6 demo video from record-demo.py output.

Reads ~/workspace/hackathons/even-realities/.tmp/demo-frames/ +
demo-manifest.json, builds title / landed / end cards with PIL, and
concatenates with ffmpeg:
  title (12s) + journey (captions per manifest) + landed card (6s)
  + end card (15s)  ->  demo/teleglance-demo.mp4  (<= 3 min, no audio)

Green on black throughout, matching the glasses display.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.expanduser("~/workspace/hackathons/even-realities")
TMP = os.path.join(BASE, ".tmp")
FRAMES = os.path.join(TMP, "demo-frames")
MANIFEST = os.path.join(TMP, "demo-manifest.json")
OUT_DIR = os.path.expanduser("~/workspace/hackathons/even-realities/teleglance/demo")
OUT = os.path.join(OUT_DIR, "teleglance-demo.mp4")

W, H = 1152, 648  # 16:9 — glasses frame (1152x576) + 72px caption band below
GREEN = (0, 255, 0)
DIM = (0, 180, 0)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

TITLE_S = 12
LANDED_S = 6
END_S = 15


def card(path, lines):
    """lines: list of (text, font_size, bold, color, y)."""
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for text, size, bold, color, y in lines:
        f = ImageFont.truetype(FONT_BOLD if bold else FONT, size)
        bbox = d.textbbox((0, 0), text, font=f)
        x = (W - (bbox[2] - bbox[0])) // 2
        d.text((x, y), text, font=f, fill=color)
    img.save(path)
    return path


def main():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    steps = manifest["steps"]
    os.makedirs(OUT_DIR, exist_ok=True)

    title = card(
        os.path.join(TMP, "card-title.png"),
        [
            ("TeleGlance", 110, True, GREEN, 170),
            ("Track 01 · Messaging & News", 44, False, GREEN, 330),
            ("Telegram at a glance — Even Realities “Heads Up”", 32, False, DIM, 400),
        ],
    )
    landed = card(
        os.path.join(TMP, "card-landed.png"),
        [
            ("Sent ✓", 96, True, GREEN, 150),
            ("Reply landed in the Telegram group", 38, False, GREEN, 300),
            ("“TeleGlance Demo” — verified live via the Bot API", 36, False, DIM, 360),
        ],
    )
    end = card(
        os.path.join(TMP, "card-end.png"),
        [
            ("TeleGlance", 84, True, GREEN, 150),
            ("github.com/sandi215/teleglance", 40, False, GREEN, 280),
            ("Track 01 · Messaging & News — Telegram", 34, False, GREEN, 350),
            ("Built with Even Hub SDK + free simulator", 32, False, DIM, 410),
        ],
    )

    # drawtext captions for the journey, timed from the manifest.
    draws = []
    for s in steps:
        start, dur, cap = s["start"], s["duration"], s["caption"]
        cap_end = start + dur
        safe = cap.replace("'", "").replace(":", "\\:")
        draws.append(
            f"drawtext=fontfile={FONT}:text='{safe}':fontsize=30:fontcolor=0x00FF00:"
            f"box=1:boxcolor=black:boxborderw=16:x=(w-text_w)/2:y=h-56:"
            f"enable='between(t,{start:.2f},{cap_end:.2f})'"
        )
    filters = ",".join(draws)

    fc = (
        f"[0:v]scale={W}:{H},setsar=1,fps=30[v0];"
        f"[1:v]scale=1152:576:flags=neighbor,pad={W}:{H}:0:0:black,setsar=1,fps=30,{filters}[v1];"
        f"[2:v]scale={W}:{H},setsar=1,fps=30[v2];"
        f"[3:v]scale={W}:{H},setsar=1,fps=30[v3];"
        f"[v0][v1][v2][v3]concat=n=4:v=1:a=0[out]"
    )
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1", "-t", str(TITLE_S), "-i", title,
        "-framerate", "10", "-i", os.path.join(FRAMES, "frame_%05d.png"),
        "-loop", "1", "-t", str(LANDED_S), "-i", landed,
        "-loop", "1", "-t", str(END_S), "-i", end,
        "-filter_complex", fc,
        "-map", "[out]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        OUT,
    ]
    print("assembling:", " ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
         "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", OUT],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(probe.stdout)
    fmt = info["format"]
    st = info["streams"][0]
    print(f"video: {OUT}")
    print(f"duration: {float(fmt['duration']):.1f}s  size: {int(fmt['size'])/1e6:.1f} MB  "
          f"{st['width']}x{st['height']} @ {st['r_frame_rate']}")
    assert float(fmt["duration"]) <= 180, "video over 3 minutes!"
    print("ASSEMBLE: DONE")


if __name__ == "__main__":
    main()
