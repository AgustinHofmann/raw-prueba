# Parking POC — webcam parking detection + fit

Local proof-of-concept: detect vehicles from one camera, decide open/occupied
per operator-drawn spot, and judge whether a car physically **fits** in an open
spot. Built milestone by milestone (M0–M6); this README grows with each one.

## Setup (M0)

Requires Python 3.11 (installed here via `uv python install 3.11`).

```powershell
cd parking-poc
python3.11 -m venv .venv          # or: uv venv --python 3.11 .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run the source smoke test (M0)

All tunables live in `config/settings.yaml`. Pick the input under `source:`
(`kind: webcam | file | rtsp`) — nothing else changes between a live camera,
a recorded clip, or a stream.

```powershell
# window with live frames (q/Esc to quit)
python -m src.capture

# no window, just read frames and report FPS; override source from the CLI
python -m src.capture --headless --max-frames 200 --kind file
python -m src.capture --headless --max-frames 100 --kind webcam
```

A synthetic test clip lives at `data/sample_clips/synthetic_lot.mp4`
(regenerate with `python tools/make_synthetic_clip.py`). Drop real parking
footage into `data/sample_clips/` and point `source.file_path` at it.

## Status

- [x] M0 — environment + `VideoSource` (webcam/file/rtsp)
- [ ] M1 — vehicle detection (YOLO11n)
- [ ] M2 — spot calibration tool
- [ ] M3 — occupancy + debounce
- [ ] M4 — fit v1 (relative)
- [ ] M5 — fit v2 (metric homography)
- [ ] M6 — API + dashboard

## Known limitations

- Single camera, a handful of spots; no plate reading, no cloud, no multi-cam.
- Windows webcams open with DirectShow (`CAP_DSHOW`) to avoid slow MSMF probing.
