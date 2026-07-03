"""VideoSource: uniform frame supplier for webcam | file | rtsp.

The rest of the pipeline only ever sees `read() -> frame | None`, so the same
code runs on a live camera, a recorded clip, or a stream. Fails loud on
missing files, unopenable devices, and mid-stream disconnects.

Smoke test (M0):
    python -m src.capture --config config/settings.yaml [--headless] [--max-frames N] [--kind webcam|file|rtsp]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import yaml


class SourceError(RuntimeError):
    """Raised when a video source cannot be opened or recovered."""


class VideoSource:
    def __init__(self, cfg: dict):
        src = cfg.get("source")
        if not isinstance(src, dict):
            raise SourceError("settings.yaml is missing the 'source' section")
        self.kind = src.get("kind")
        if self.kind not in ("webcam", "file", "rtsp"):
            raise SourceError(f"source.kind must be webcam|file|rtsp, got: {self.kind!r}")
        self._src = src
        self._loop_file = bool(src.get("loop_file", False))
        self._reconnect_attempts = int(src.get("reconnect_attempts", 3))
        self._reconnect_delay_s = float(src.get("reconnect_delay_s", 2.0))
        self._cap: cv2.VideoCapture | None = None
        self._open()

    def _target(self):
        if self.kind == "webcam":
            return int(self._src.get("webcam_index", 0))
        if self.kind == "file":
            path = Path(self._src.get("file_path", ""))
            if not path.is_file():
                raise SourceError(f"video file not found: {path.resolve()}")
            return str(path)
        url = self._src.get("rtsp_url", "")
        if not url:
            raise SourceError("source.kind is rtsp but source.rtsp_url is empty")
        return url

    def _open(self) -> None:
        target = self._target()
        # CAP_DSHOW avoids the multi-second MSMF probe delay on Windows webcams.
        if self.kind == "webcam":
            cap = cv2.VideoCapture(target, cv2.CAP_DSHOW)
        else:
            cap = cv2.VideoCapture(target)
        if not cap.isOpened():
            raise SourceError(f"could not open {self.kind} source: {target!r}")
        self._cap = cap

    def read(self):
        """Return the next BGR frame, or None when a finite file ends.

        Webcam/RTSP dropouts trigger bounded reconnect attempts, then raise.
        """
        ok, frame = self._cap.read()
        if ok and frame is not None and frame.size > 0:
            return frame

        if self.kind == "file":
            if self._loop_file:
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = self._cap.read()
                if ok and frame is not None:
                    return frame
                raise SourceError("file source failed to restart on loop")
            return None  # clean end of clip

        for attempt in range(1, self._reconnect_attempts + 1):
            print(f"[capture] {self.kind} dropped, reconnect {attempt}/{self._reconnect_attempts}...",
                  file=sys.stderr)
            self.release()
            time.sleep(self._reconnect_delay_s)
            try:
                self._open()
            except SourceError:
                continue
            ok, frame = self._cap.read()
            if ok and frame is not None:
                return frame
        raise SourceError(f"{self.kind} source lost and could not be recovered")

    @property
    def fps_hint(self) -> float:
        """Container/driver-reported FPS; 0.0 when unknown."""
        fps = self._cap.get(cv2.CAP_PROP_FPS) if self._cap else 0.0
        return fps if fps and fps > 0 else 0.0

    def release(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()


def load_settings(path: str | Path) -> dict:
    p = Path(path)
    if not p.is_file():
        raise SourceError(f"settings file not found: {p.resolve()}")
    with open(p, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if not isinstance(cfg, dict):
        raise SourceError(f"settings file is empty or malformed: {p}")
    return cfg


def _smoke(args: argparse.Namespace) -> int:
    cfg = load_settings(args.config)
    if args.kind:
        cfg["source"]["kind"] = args.kind

    window = cfg.get("display", {}).get("window_name", "Parking POC")
    max_width = int(cfg.get("display", {}).get("max_width", 1280))
    frames, t0 = 0, time.perf_counter()

    with VideoSource(cfg) as source:
        print(f"[smoke] source={source.kind} fps_hint={source.fps_hint:.1f}")
        while frames < args.max_frames:
            frame = source.read()
            if frame is None:
                print("[smoke] end of file source")
                break
            frames += 1
            if not args.headless:
                h, w = frame.shape[:2]
                if w > max_width:
                    frame = cv2.resize(frame, (max_width, int(h * max_width / w)))
                cv2.imshow(window, frame)
                if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                    break

    elapsed = time.perf_counter() - t0
    fps = frames / elapsed if elapsed > 0 else 0.0
    print(f"[smoke] frames={frames} elapsed={elapsed:.2f}s measured_fps={fps:.1f}")
    if not args.headless:
        cv2.destroyAllWindows()
    return 0 if frames > 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VideoSource smoke test")
    parser.add_argument("--config", default="config/settings.yaml")
    parser.add_argument("--kind", choices=["webcam", "file", "rtsp"],
                        help="override source.kind from config")
    parser.add_argument("--headless", action="store_true",
                        help="no window; just read frames and report FPS")
    parser.add_argument("--max-frames", type=int, default=300)
    args = parser.parse_args()
    try:
        sys.exit(_smoke(args))
    except SourceError as e:
        print(f"[capture] FATAL: {e}", file=sys.stderr)
        sys.exit(2)
