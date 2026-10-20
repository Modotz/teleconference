'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRecordingEncryptor,
  ENCRYPTED_EXTENSION,
  type RecordingEncryptor,
} from '@/lib/recordingCrypto';

/**
 * Client-side recorder using MediaRecorder.
 *
 * Records whatever MediaStream you hand it (e.g. local camera+mic, or the
 * screen-share stream). Output is downloaded when recording stops.
 *
 * Pass a passphrase to `start()` and every chunk is encrypted in the browser
 * as it comes off the recorder — the download is then a `.webm.enc` that only
 * that passphrase opens (see lib/recordingCrypto and /recording/decrypt).
 * Without one you get a plain `.webm`, same as before.
 *
 * Limitation: this records ONLY the streams available on this client. It does
 * not produce a composite of all remote participants. For that you need
 * server-side recording (Mediasoup PlainTransport + GStreamer/FFmpeg).
 */
export function useRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [encrypted, setEncrypted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const start = useCallback(
    async (stream: MediaStream, filename = 'recording.webm', passphrase?: string) => {
      if (recorderRef.current) return;
      setError(null);

      let encryptor: RecordingEncryptor | null = null;
      if (passphrase) {
        try {
          // Key derivation is deliberately slow (PBKDF2, 250k rounds), so do it
          // before the recorder starts rather than mid-capture.
          encryptor = await createRecordingEncryptor(passphrase);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not prepare encryption');
          return;
        }
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      // Encryption is async, so chunks go through a promise chain — otherwise
      // two overlapping encrypts could land out of order and the file would be
      // unrecoverable.
      let queue: Promise<void> = Promise.resolve();
      let failure: unknown = null;

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        if (!encryptor) {
          chunksRef.current.push(e.data);
          return;
        }
        queue = queue.then(async () => {
          if (failure) return; // a broken chain can't produce a valid file
          try {
            const sealed = await encryptor!.encryptChunk(await e.data.arrayBuffer());
            chunksRef.current.push(sealed);
          } catch (err) {
            failure = err;
          }
        });
      };

      recorder.onstop = async () => {
        await queue;

        if (failure) {
          setError(
            failure instanceof Error
              ? `Recording failed to encrypt: ${failure.message}`
              : 'Recording failed to encrypt'
          );
          chunksRef.current = [];
          return;
        }

        const parts = encryptor
          ? [encryptor.header, ...chunksRef.current]
          : chunksRef.current;
        const blob = new Blob(parts, {
          type: encryptor ? 'application/octet-stream' : mimeType,
        });

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const base = filename.replace(/\.webm$/i, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}-${ts}${encryptor ? ENCRYPTED_EXTENSION : '.webm'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        chunksRef.current = [];
      };

      recorder.start(1000); // chunk every 1s
      recorderRef.current = recorder;
      setRecording(true);
      setEncrypted(!!encryptor);
      setElapsed(0);

      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    },
    []
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    setEncrypted(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { recording, encrypted, elapsed, error, clearError: () => setError(null), start, stop };
}
