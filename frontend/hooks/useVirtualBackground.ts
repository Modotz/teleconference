'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VirtualBackgroundProcessor, type BackgroundMode } from '@/lib/virtualBackground';

interface Options {
  /** Called with the new MediaStream whenever the background changes. */
  onStreamChange: (stream: MediaStream) => void;
}

/**
 * Manages a single VirtualBackgroundProcessor tied to the supplied source
 * camera stream. When mode is 'none' the original stream is used directly;
 * otherwise a processed stream from the canvas is produced.
 */
export function useVirtualBackground(srcStream: MediaStream | null, options: Options) {
  const [mode, setMode] = useState<BackgroundMode>({ kind: 'none' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processorRef = useRef<VirtualBackgroundProcessor | null>(null);
  const lastSrcRef = useRef<MediaStream | null>(null);

  const apply = useCallback(
    async (next: BackgroundMode) => {
      setError(null);

      if (!srcStream) {
        setMode(next);
        return;
      }

      // Switching to "none": stop processor and use the raw stream
      if (next.kind === 'none') {
        if (processorRef.current) {
          processorRef.current.destroy();
          processorRef.current = null;
        }
        options.onStreamChange(srcStream);
        setMode(next);
        return;
      }

      // First time enabling background → create + init processor
      try {
        if (!processorRef.current || lastSrcRef.current !== srcStream) {
          setLoading(true);
          processorRef.current?.destroy();
          processorRef.current = new VirtualBackgroundProcessor(srcStream);
          await processorRef.current.init();
          lastSrcRef.current = srcStream;
          const outStream = await processorRef.current.start();
          options.onStreamChange(outStream);
        }
        processorRef.current.setMode(next);
        setMode(next);
      } catch (err: any) {
        console.error('Virtual background error', err);
        setError(err.message || 'Failed to enable virtual background');
        if (processorRef.current) {
          processorRef.current.destroy();
          processorRef.current = null;
        }
        if (srcStream) options.onStreamChange(srcStream);
        setMode({ kind: 'none' });
      } finally {
        setLoading(false);
      }
    },
    [srcStream, options]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.destroy();
      processorRef.current = null;
    };
  }, []);

  return { mode, apply, loading, error };
}
