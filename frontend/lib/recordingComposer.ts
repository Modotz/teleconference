/**
 * Builds a single composite MediaStream from many participants for recording:
 *   - VIDEO: all camera tiles laid out on a canvas (grid), or a big screen-share
 *     with camera thumbnails below when someone is presenting.
 *   - AUDIO: every participant's audio mixed together via Web Audio.
 *
 * The getters are polled live, so people joining/leaving (and screen shares
 * starting/stopping) are reflected during the recording.
 */

export interface VideoSource {
  stream: MediaStream;
  label?: string;
  isScreen?: boolean;
}

interface Opts {
  getVideoSources: () => VideoSource[];
  getAudioStreams: () => MediaStream[];
  width?: number;
  height?: number;
  fps?: number;
}

export interface Composite {
  stream: MediaStream;
  stop: () => void;
}

export function createCompositeStream({
  getVideoSources,
  getAudioStreams,
  width = 1280,
  height = 720,
  fps = 30,
}: Opts): Composite {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Cache one hidden <video> per source stream.
  const videos = new Map<string, HTMLVideoElement>();
  function videoFor(stream: MediaStream): HTMLVideoElement {
    let v = videos.get(stream.id);
    if (!v) {
      v = document.createElement('video');
      v.srcObject = stream;
      v.muted = true; // audio is mixed separately; avoid echo
      v.playsInline = true;
      v.autoplay = true;
      v.play().catch(() => {});
      videos.set(stream.id, v);
    }
    return v;
  }

  function drawCover(
    v: HTMLVideoElement,
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, y, w, h);
    if (!v.videoWidth || !v.videoHeight) return;
    const ar = v.videoWidth / v.videoHeight;
    const tAr = w / h;
    let dw, dh;
    if (ar > tAr) {
      dh = h;
      dw = h * ar;
    } else {
      dw = w;
      dh = w / ar;
    }
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(v, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawLabel(text: string, x: number, y: number, h: number) {
    if (!text) return;
    ctx.font = '14px sans-serif';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 6, y + h - 26, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 13, y + h - 12);
  }

  function render() {
    const sources = getVideoSources().filter((s) => s.stream);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    const screens = sources.filter((s) => s.isScreen);
    const cams = sources.filter((s) => !s.isScreen);

    if (screens.length) {
      // Spotlight: first screen on top, camera tiles as a thumbnail strip.
      const main = screens[0];
      const stripH = cams.length ? 140 : 0;
      const mainH = height - stripH;
      drawCover(videoFor(main.stream), 0, 0, width, mainH);
      drawLabel(main.label || 'Screen', 0, 0, mainH);

      const thumbs = cams;
      if (thumbs.length) {
        const tw = width / thumbs.length;
        thumbs.forEach((s, i) => {
          drawCover(videoFor(s.stream), i * tw, mainH, tw, stripH);
          drawLabel(s.label || '', i * tw, mainH, stripH);
        });
      }
    } else if (cams.length) {
      // Grid layout.
      const cols = Math.ceil(Math.sqrt(cams.length));
      const rows = Math.ceil(cams.length / cols);
      const cw = width / cols;
      const ch = height / rows;
      cams.forEach((s, i) => {
        const cx = (i % cols) * cw;
        const cy = Math.floor(i / cols) * ch;
        drawCover(videoFor(s.stream), cx, cy, cw, ch);
        drawLabel(s.label || '', cx, cy, ch);
      });
    }

    // Drop hidden videos for streams that are gone.
    const live = new Set(sources.map((s) => s.stream.id));
    for (const [id, v] of videos) {
      if (!live.has(id)) {
        v.srcObject = null;
        videos.delete(id);
      }
    }
  }

  let raf = 0;
  let last = 0;
  const frameInterval = 1000 / fps;
  function loop(t: number) {
    raf = requestAnimationFrame(loop);
    if (t - last < frameInterval) return;
    last = t;
    render();
  }
  render();
  raf = requestAnimationFrame(loop);

  // ---- Audio mixing ----
  const AudioCtx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtx();
  audioCtx.resume?.().catch(() => {});
  const dest = audioCtx.createMediaStreamDestination();
  const connected = new Map<string, MediaStreamAudioSourceNode>();

  function reconcileAudio() {
    const tracks: MediaStreamTrack[] = [];
    for (const s of getAudioStreams()) {
      for (const t of s.getAudioTracks()) tracks.push(t);
    }
    const liveIds = new Set(tracks.map((t) => t.id));
    for (const t of tracks) {
      if (!connected.has(t.id)) {
        try {
          const node = audioCtx.createMediaStreamSource(new MediaStream([t]));
          node.connect(dest);
          connected.set(t.id, node);
        } catch {
          /* ignore */
        }
      }
    }
    for (const [id, node] of connected) {
      if (!liveIds.has(id)) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
        connected.delete(id);
      }
    }
  }
  reconcileAudio();
  const audioTimer = window.setInterval(reconcileAudio, 1500);

  const canvasStream = (canvas as any).captureStream(fps) as MediaStream;
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  function stop() {
    cancelAnimationFrame(raf);
    clearInterval(audioTimer);
    for (const [, node] of connected) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    connected.clear();
    audioCtx.close?.().catch(() => {});
    canvasStream.getTracks().forEach((t) => t.stop());
    for (const [, v] of videos) v.srcObject = null;
    videos.clear();
  }

  return { stream, stop };
}
