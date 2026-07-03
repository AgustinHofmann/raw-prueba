"""Generate a small synthetic clip so the file source can be tested without
real footage: a static 'lot' background with two moving car-like rectangles.
Not a detection target — M0 only needs frames flowing through VideoSource.

    python tools/make_synthetic_clip.py
"""

from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "data" / "sample_clips" / "synthetic_lot.mp4"
W, H, FPS, SECONDS = 960, 540, 25, 8


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(OUT), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    if not writer.isOpened():
        raise SystemExit("could not open VideoWriter (mp4v codec missing?)")

    background = np.full((H, W, 3), 70, np.uint8)
    for i in range(5):  # painted spot lines
        x = 120 + i * 150
        cv2.line(background, (x, 320), (x - 40, 500), (255, 255, 255), 3)

    total = FPS * SECONDS
    for t in range(total):
        frame = background.copy()
        x1 = int(50 + (t / total) * (W - 250))
        cv2.rectangle(frame, (x1, 360), (x1 + 130, 440), (30, 30, 200), -1)
        x2 = int(W - 200 - (t / total) * (W - 300))
        cv2.rectangle(frame, (x2, 250), (x2 + 110, 320), (200, 120, 30), -1)
        cv2.putText(frame, f"frame {t}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 2)
        writer.write(frame)

    writer.release()
    print(f"wrote {total} frames ({SECONDS}s @ {FPS}fps) -> {OUT}")


if __name__ == "__main__":
    main()
