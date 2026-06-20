/**
 * Virtual background using MediaPipe SelfieSegmentation (tasks-vision).
 *
 * We use the category mask (binary 0/1 per pixel) and composite pixel-by-pixel
 * — slower than GPU shaders but rock-solid for correctness. Browsers can still
 * hit 30 fps at 640x360.
 */

import {
  ImageSegmenter,
  FilesetResolver,
} from '@mediapipe/tasks-vision';

export type BackgroundMode =
  | { kind: 'none' }
  | { kind: 'blur'; amount?: number }
  | { kind: 'image'; src: string };

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

// MediaPipe/TFLite routes a few benign startup notices (e.g. "INFO: Created
// TensorFlow Lite XNNPACK delegate for CPU.") through console.error, which makes
// Next.js pop a red dev error overlay for something that is not an error. Demote
// those specific lines to console.log. Installed once, before the WASM loads.
let consoleFiltered = false;
function silenceBenignMediapipeLogs() {
  if (consoleFiltered || typeof console === 'undefined') return;
  consoleFiltered = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === 'string' &&
      /^INFO:|XNNPACK delegate|TensorFlow Lite/i.test(first)
    ) {
      console.log(...args);
      return;
    }
    orig(...args);
  };
}

export class VirtualBackgroundProcessor {
  private segmenter: ImageSegmenter | null = null;
  private srcVideo: HTMLVideoElement;
  private srcStream: MediaStream;
  /** Final output canvas — captured to produce the outbound MediaStream */
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Scratch canvas the size of the *video* — used for per-pixel work */
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  /** Scratch canvas the size of the *mask* — used to upscale the mask */
  private maskScratch: HTMLCanvasElement;
  private maskScratchCtx: CanvasRenderingContext2D;
  private bgImage: HTMLImageElement | null = null;
  private mode: BackgroundMode = { kind: 'none' };
  private rafId: number | null = null;
  private outputStream: MediaStream | null = null;
  private running = false;
  /** Cached upscaled mask alpha (Uint8 per pixel) */
  private maskAlpha: Uint8ClampedArray | null = null;
  /** MediaPipe VIDEO mode requires strictly-increasing timestamps. */
  private lastTimestamp = 0;
  /** Once segmentation has failed this many times, fall back to raw passthrough. */
  private segFailures = 0;

  constructor(srcStream: MediaStream) {
    this.srcStream = srcStream;
    const track = srcStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const w = settings.width || 640;
    const h = settings.height || 360;

    this.srcVideo = document.createElement('video');
    // Reuse the EXACT original stream so the camera capture is never
    // "abandoned" — Chrome will pause a track that has no active consumer,
    // and creating a wrapper MediaStream confuses that bookkeeping.
    this.srcVideo.srcObject = srcStream;
    this.srcVideo.muted = true;
    this.srcVideo.playsInline = true;
    this.srcVideo.autoplay = true;
    // Some browsers (Firefox, Safari, some Chromium builds) won't drive frames
    // on a detached <video>. Attach it to the DOM but make it invisible.
    this.srcVideo.style.position = 'fixed';
    this.srcVideo.style.top = '-9999px';
    this.srcVideo.style.left = '-9999px';
    this.srcVideo.style.width = '1px';
    this.srcVideo.style.height = '1px';
    this.srcVideo.style.opacity = '0';
    this.srcVideo.style.pointerEvents = 'none';
    document.body.appendChild(this.srcVideo);

    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.scratch = document.createElement('canvas');
    this.scratch.width = w;
    this.scratch.height = h;
    this.scratchCtx = this.scratch.getContext('2d', {
      willReadFrequently: true,
    })!;

    // Mask scratch is resized on first use to match the mask resolution
    this.maskScratch = document.createElement('canvas');
    this.maskScratchCtx = this.maskScratch.getContext('2d', {
      willReadFrequently: true,
    })!;
  }

  async init() {
    silenceBenignMediapipeLogs();
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate,
        },
        runningMode: 'VIDEO',
        // Confidence mask (per-pixel 0..1 probability) is far more robust across
        // GPUs than the category mask, whose integer convention varies by
        // platform — on some mobile GPUs the category mask came back uniform,
        // erasing the person entirely.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    // On many mobile browsers the WebGL/GPU delegate "initialises" fine but
    // produces a broken (all-background) mask, erasing the person. CPU is slower
    // but correct, so prefer it on mobile. Desktop keeps the fast GPU path.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile =
      /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(pointer: coarse)').matches);
    const preferred: 'GPU' | 'CPU' = isMobile ? 'CPU' : 'GPU';
    const fallback: 'GPU' | 'CPU' = preferred === 'GPU' ? 'CPU' : 'GPU';
    try {
      this.segmenter = await make(preferred);
    } catch (err) {
      console.warn(
        `[VBG] ${preferred} delegate failed, retrying on ${fallback}`,
        err
      );
      this.segmenter = await make(fallback);
    }
  }

  setMode(mode: BackgroundMode) {
    this.mode = mode;
    if (mode.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = mode.src;
      img.onload = () => {
        this.bgImage = img;
      };
      img.onerror = () => {
        console.warn('Failed to load background image:', mode.src);
        this.bgImage = null;
      };
    } else {
      this.bgImage = null;
    }
  }

  async start(): Promise<MediaStream> {
    if (!this.segmenter) throw new Error('Call init() first');
    if (this.running) return this.outputStream!;
    this.running = true;

    // Make sure the source <video> is actually playing AND has dimensions
    // before we capture anything from the canvas.
    try {
      await this.srcVideo.play();
    } catch (err) {
      console.warn('srcVideo.play() rejected', err);
    }

    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.srcVideo.readyState >= 2 && this.srcVideo.videoWidth > 0) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        this.srcVideo.removeEventListener('loadeddata', check);
        this.srcVideo.removeEventListener('canplay', check);
        this.srcVideo.removeEventListener('playing', check);
        clearInterval(poll);
        clearTimeout(safety);
      };
      this.srcVideo.addEventListener('loadeddata', check);
      this.srcVideo.addEventListener('canplay', check);
      this.srcVideo.addEventListener('playing', check);
      // Belt-and-suspenders: poll in case events never fire
      const poll = setInterval(check, 100);
      const safety = setTimeout(() => {
        cleanup();
        resolve();
      }, 3000);
      check();
    });

    // Match canvas resolution to the actual video resolution now that we know it
    if (this.srcVideo.videoWidth > 0 && this.srcVideo.videoHeight > 0) {
      const w = this.srcVideo.videoWidth;
      const h = this.srcVideo.videoHeight;
      this.canvas.width = w;
      this.canvas.height = h;
      this.scratch.width = w;
      this.scratch.height = h;
    }

    // Paint the first frame immediately so the captured stream is not blank
    // (otherwise the self-tile renders black until the segmentation loop
    // produces its first composited frame).
    try {
      this.ctx.drawImage(this.srcVideo, 0, 0, this.canvas.width, this.canvas.height);
    } catch (e) {
      console.warn('Initial frame draw failed', e);
    }

    const out = (this.canvas as any).captureStream(30) as MediaStream;
    this.srcStream.getAudioTracks().forEach((t) => out.addTrack(t));
    this.outputStream = out;

    this.loop();
    return out;
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.outputStream?.getVideoTracks().forEach((t) => t.stop());
    this.outputStream = null;
  }

  destroy() {
    this.stop();
    this.segmenter?.close();
    this.segmenter = null;
    // CRITICAL: do NOT call .stop() on the cloned track. In Chrome, stopping
    // a clone reference-counts down the underlying camera source and can
    // mark the *original* track as ended too — killing the user's camera
    // until they re-getUserMedia. We just detach and let GC reclaim.
    this.srcVideo.srcObject = null;
    this.srcVideo.remove();
  }

  private loop = () => {
    if (!this.running || !this.segmenter) return;
    this.rafId = requestAnimationFrame(this.loop);

    const v = this.srcVideo;
    if (v.readyState < 2 || v.videoWidth === 0) return;

    // Skip segmentation entirely for "none" mode, or once it has repeatedly
    // failed (so blur "fails open" to the raw camera instead of a black tile).
    if (this.mode.kind === 'none' || this.segFailures > 30) {
      this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    // VIDEO mode requires a strictly-increasing timestamp; two rAF callbacks can
    // land in the same millisecond, which makes segmentForVideo throw.
    let ts = performance.now();
    if (ts <= this.lastTimestamp) ts = this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    // Synchronous API: returns result directly. Auto-disposes after this turn.
    // ANY failure here must not leave the canvas black — draw the raw frame so
    // the user always sees their camera even if segmentation breaks.
    let result;
    try {
      result = this.segmenter.segmentForVideo(v, ts);
    } catch (e) {
      this.segFailures++;
      if (this.segFailures <= 3) console.warn('[VBG] segmentForVideo failed', e);
      this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.segFailures = 0;
    try {
      this.render(result.confidenceMasks?.[0]);
    } catch (e) {
      console.warn('[VBG] render failed', e);
      this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    } finally {
      result.close();
    }
  };

  private render(mask: any /* MPMask */) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const v = this.srcVideo;

    // FALLBACK 1: always start by drawing the raw video. If anything after
    // this fails, the user at least sees their camera instead of black.
    this.ctx.drawImage(v, 0, 0, w, h);

    if (!mask) return;

    // Confidence mask: one float per pixel. For the selfie segmenter this is the
    // foreground (person) probability, but to be safe across model variants we
    // detect polarity from the corners (which are almost always background).
    let data: Float32Array;
    try {
      data = mask.getAsFloat32Array();
    } catch (e) {
      console.warn('[VBG] mask.getAsFloat32Array failed', e);
      return;
    }
    if (!data || data.length === 0) return;

    const mw: number = mask.width;
    const mh: number = mask.height;
    if (this.maskScratch.width !== mw || this.maskScratch.height !== mh) {
      this.maskScratch.width = mw;
      this.maskScratch.height = mh;
    }

    // Average the four corners. If they read "high", then high = background and
    // we must invert so the person (low at corners) ends up opaque.
    const cornerAvg =
      (data[0] +
        data[mw - 1] +
        data[(mh - 1) * mw] +
        data[mw * mh - 1]) /
      4;
    const invert = cornerAvg > 0.5; // corners look like foreground -> flip

    const maskImg = this.maskScratchCtx.createImageData(mw, mh);
    for (let i = 0; i < data.length; i++) {
      let p = data[i]; // person probability (after polarity fix)
      if (invert) p = 1 - p;
      // Soft alpha for feathered edges; clamp to a hard core/empty to avoid
      // a translucent halo of the background bleeding through.
      const a = p <= 0.3 ? 0 : p >= 0.7 ? 255 : Math.round(p * 255);
      const j = i * 4;
      maskImg.data[j] = 255;
      maskImg.data[j + 1] = 255;
      maskImg.data[j + 2] = 255;
      maskImg.data[j + 3] = a;
    }
    this.maskScratchCtx.putImageData(maskImg, 0, 0);

    // Build the masked-foreground in scratch
    this.scratchCtx.globalCompositeOperation = 'source-over';
    this.scratchCtx.clearRect(0, 0, w, h);
    this.scratchCtx.drawImage(v, 0, 0, w, h);
    this.scratchCtx.globalCompositeOperation = 'destination-in';
    this.scratchCtx.drawImage(this.maskScratch, 0, 0, w, h);
    this.scratchCtx.globalCompositeOperation = 'source-over';

    // Now redraw: background (blur/image) first, then person on top.
    if (this.mode.kind === 'blur') {
      const amount = this.mode.amount ?? 14;
      this.ctx.save();
      this.ctx.filter = `blur(${amount}px)`;
      this.ctx.drawImage(v, 0, 0, w, h);
      this.ctx.restore();
    } else if (this.mode.kind === 'image' && this.bgImage) {
      drawCover(this.ctx, this.bgImage, w, h);
    } else {
      // No valid bg → leave the raw video we drew at the top
      return;
    }

    this.ctx.drawImage(this.scratch, 0, 0);
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
) {
  if (!img.complete || img.naturalWidth === 0) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const ar = img.naturalWidth / img.naturalHeight;
  const targetAr = w / h;
  let dw, dh, dx, dy;
  if (ar > targetAr) {
    dh = h;
    dw = h * ar;
    dx = (w - dw) / 2;
    dy = 0;
  } else {
    dw = w;
    dh = w / ar;
    dx = 0;
    dy = (h - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}
