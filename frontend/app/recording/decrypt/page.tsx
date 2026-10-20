'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock, Upload, Download, Play } from 'lucide-react';
import { decryptRecording, DecryptError } from '@/lib/recordingCrypto';

/**
 * Opens a `.webm.enc` produced by the in-meeting recorder.
 *
 * Everything happens in the browser — the file is never uploaded, and the
 * passphrase never leaves this tab. It works offline, which matters: someone
 * recovering an old recording should not need our server to be up.
 */
export default function DecryptRecordingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs outlive the component unless we let them go.
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  function pick(f: File | null) {
    setFile(f);
    setError(null);
    if (result) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
  }

  async function run() {
    if (!file || !passphrase) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await decryptRecording(file, passphrase, setProgress);
      setResult({
        url: URL.createObjectURL(blob),
        name: file.name.replace(/\.webm\.enc$/i, '').replace(/\.enc$/i, '') + '.webm',
      });
    } catch (err) {
      setError(
        err instanceof DecryptError
          ? err.message
          : 'Could not decrypt this file. Check that it is a .webm.enc recording.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 flex items-start justify-center p-6">
      <div className="w-full max-w-lg mt-10">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Lock className="w-5 h-5 text-brand-600 dark:text-brand-300" />
          Open an encrypted recording
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          Decryption runs entirely in your browser. The file is not uploaded and the
          passphrase is never sent anywhere.
        </p>

        <div className="mt-6 space-y-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex items-center gap-3 rounded border border-dashed border-gray-300 dark:border-slate-700 px-4 py-6 hover:bg-gray-100 dark:hover:bg-slate-900 text-left"
          >
            <Upload className="w-5 h-5 shrink-0 text-gray-500 dark:text-slate-400" />
            <span className="min-w-0">
              <span className="block text-sm truncate">
                {file ? file.name : 'Choose a .webm.enc file'}
              </span>
              {file && (
                <span className="block text-xs text-gray-500 dark:text-slate-400">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              )}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".enc"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />

          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) run();
            }}
            placeholder="Passphrase"
            className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
          />

          <button
            onClick={run}
            disabled={!file || !passphrase || busy}
            className="w-full rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-4 py-2 text-sm"
          >
            {busy ? `Decrypting… ${Math.round(progress * 100)}%` : 'Decrypt'}
          </button>

          {error && (
            <div className="rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded border border-gray-200 dark:border-slate-800 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <Play className="w-4 h-4" />
                Decrypted successfully
              </div>
              <video src={result.url} controls className="w-full rounded bg-black" />
              <a
                href={result.url}
                download={result.name}
                className="inline-flex items-center gap-2 rounded bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 px-3 py-2 text-sm"
              >
                <Download className="w-4 h-4" />
                Save {result.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
