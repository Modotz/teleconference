'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client-side recorder using MediaRecorder.
 *
 * Records whatever MediaStream you hand it (e.g. local camera+mic, or the
 * screen-share stream). Output is a .webm blob automatically downloaded when
 * recording stops.
 *
 * Limitation: this records ONLY the streams available on this client. It does
 * not produce a composite of all remote participants. For that you need
 * server-side recording (Mediasoup PlainTransport + GStreamer/FFmpeg).
 */
export function useRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const start = useCallback((stream: MediaStream, filename = 'recording.webm') => {
    if (recorderRef.current) return;

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = filename.replace('.webm', `-${ts}.webm`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      chunksRef.current = [];
    };

    recorder.start(1000); // chunk every 1s
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);

    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { recording, elapsed, start, stop };
}
