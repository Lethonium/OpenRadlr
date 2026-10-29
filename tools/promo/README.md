# Promo video capture

Scripts to record gameplay footage of OpenRadlr for a promo video and shorts/reels. The
footage is captured as numbered JPEG frames with timestamps; ffmpeg turns them into video
(editing is done separately). Nothing here is part of the product or CI.

## Why this exists

The first attempt ran on a 1 vCPU / 1.8 GB VPS without GPU. WebGL then runs in software and
the 3D view renders at ~1 fps (0.3 fps while capturing), so a 90 s promo plus shorts would
need 5-6 hours of capture. On a machine with a GPU, scale 1 (real time) should just work.
The time-scale knob below exists only as a fallback for machines without one.

## Run it

Needs Docker, ffmpeg (for the edit step) and the client's `node_modules`
(`cd client && npm ci`, or the Docker recipe in AGENTS.md).

```sh
docker build -t openradlr-server:promo .          # from the repo root
tools/promo/server.sh rolling-hills 20            # server + 20 bots on 127.0.0.1:8080
PROMO_DOCKER_ARGS="--device /dev/dri" tools/promo/run.sh tools/promo/shots/smoke.json
ls ~/.cache/openradlr/promo/raw/smoke             # frames/, frames.ffconcat, stills (*.png)
ffmpeg -f concat -safe 0 -i ~/.cache/openradlr/promo/raw/smoke/frames.ffconcat \
  -vf fps=30 -c:v libx264 -pix_fmt yuv420p smoke.mp4
```

`run.sh` uses the Playwright image (tag must match `client/package.json`) on the host
network. Output stays out of the repo (`PROMO_OUT`, default `~/.cache/openradlr/promo`).
Check first that the GPU is really used: the smoke shot should reach roughly 30+ fps.
If the machine has none, set `PROMO_GL=software` (slow, see above).

## Shot files

JSON, see the header of `rec.mjs`: `width`, `height`, `scale` (game speed, 1 = real time)
and `steps`: `goto`, `wait` (game seconds), `click`, `fill`, `select`, `key` (KeyboardEvent
code, e.g. `KeyC` camera, `KeyT` time of day, `KeyL` layout, `KeyV` 2D/3D, `KeyM` menu),
`power` (simulated trainer watts), `eval`, `still` (PNG), `rec: start|stop`.
Use 1920x1080 for the main video and 1080x1920 for shorts/reels.

## Slow-motion fallback (`time-scale.patch`)

For machines that cannot render in real time: run the game slower than wall time and
record every frame, then play it back at normal speed. `rec.mjs` slows the page clock by
`scale`; the server needs the matching `OPENRADLR_TIME_SCALE` (the patch adds it, plus the
idle timeout following the same clock). Apply it only on a throwaway copy, never merge it:

```sh
git archive HEAD | tar -x -C /tmp/openradlr-promo && cd /tmp/openradlr-promo
git apply /path/to/tools/promo/time-scale.patch
docker build -t openradlr-server:promo .
tools/promo/server.sh rolling-hills 20 0.025       # then "scale": 0.025 in the shot
```

## Plan / not done yet

- Storyboard and shot list (one 60-90 s promo, 3-4 shorts of 15-30 s) are still to be written.
  Hooks: bots so the road is never empty; self-hosting with one `docker compose up`;
  the 3D island; the spin studio.
- Record in metric units (the client defaults to imperial, so set km/h and kg in the rider
  panel via `localStorage` or the profile form before recording).
- No music yet; English only first. Titles and captions get added in the ffmpeg edit.
