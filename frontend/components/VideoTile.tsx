'use client';

import { useEffect, useRef } from 'react';
import {
  Pin,
  PinOff,
  Hand,
  Mic,
  MicOff,
  Maximize2,
  PictureInPicture2,
} from 'lucide-react';

interface Props {
  stream: MediaStream | null;
  username: string;
  muted?: boolean;
  isLocal?: boolean;
  isScreen?: boolean;
  label?: string;
  mirror?: boolean;
  showName?: boolean;
  pinned?: boolean;
  handRaised?: boolean;
  isSpeaking?: boolean;
  /** Mic state for the indicator. undefined = no indicator (e.g. screen tiles). */
  micOn?: boolean;
  /** Camera state. When false, show a name/avatar placeholder instead of black. */
  camOn?: boolean;
  /** Audio output device id (applied via setSinkId on supported browsers). */
  speakerId?: string;
  /** Connection quality: 'good' | 'ok' | 'poor'. */
  quality?: string;
  onTogglePin?: () => void;
  thumb?: boolean;
}

export default function VideoTile({
  stream,
  username,
  muted,
  isLocal,
  isScreen,
  label,
  mirror,
  showName = true,
  pinned,
  handRaised,
  isSpeaking,
  micOn,
  camOn,
  speakerId,
  quality,
  onTogglePin,
  thumb,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  }

  async function togglePip() {
    const v = videoRef.current as any;
    if (!v) return;
    try {
      if ((document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      /* PiP unsupported or blocked */
    }
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    // Swapping srcObject on a running <video> (e.g. raw camera -> virtual-bg
    // canvas stream) can leave it paused on a black frame in Chrome. Kick it
    // back into playback explicitly. The promise rejects harmlessly if the
    // element is torn down mid-swap, so swallow it.
    el.play().catch(() => {});
  }, [stream]);

  // Route audio to the chosen output device (local tiles are muted anyway).
  useEffect(() => {
    const el = videoRef.current as any;
    if (!el || !speakerId || isLocal) return;
    if (typeof el.setSinkId === 'function') {
      el.setSinkId(speakerId).catch(() => {});
    }
  }, [speakerId, isLocal, stream]);

  const ringClass = isSpeaking
    ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-slate-950'
    : pinned
      ? 'ring-2 ring-blue-500'
      : '';

  return (
    <div
      ref={containerRef}
      className={`group relative bg-black rounded-lg overflow-hidden transition-shadow ${
        isScreen ? 'aspect-[16/10]' : 'aspect-video'
      } ${ringClass}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted || isLocal}
        className={`w-full h-full ${isScreen ? 'object-contain' : 'object-cover'} ${
          mirror ? 'scale-x-[-1]' : ''
        }`}
      />

      {/* Camera-off placeholder: avatar initials + name instead of a black tile */}
      {camOn === false && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-800">
          <div
            className={`rounded-full bg-slate-600 flex items-center justify-center font-semibold uppercase text-slate-100 ${
              thumb ? 'w-10 h-10 text-base' : 'w-20 h-20 text-3xl'
            }`}
          >
            {(label || username || '?').charAt(0)}
          </div>
          {!thumb && (
            <span className="text-slate-300 text-sm px-2 text-center truncate max-w-[90%]">
              {label || username}
            </span>
          )}
        </div>
      )}

      {handRaised && (
        <div
          className={`absolute ${
            thumb ? 'top-1 left-1' : 'top-2 left-2'
          } bg-yellow-500/90 text-white rounded-full p-1.5 shadow-lg animate-bounce`}
          title="Hand raised"
        >
          <Hand className={thumb ? 'w-3 h-3' : 'w-4 h-4'} />
        </div>
      )}

      {(showName || micOn !== undefined || quality) && (
        <div
          className={`absolute bottom-1.5 left-1.5 flex items-center gap-1 px-2 py-0.5 bg-black/60 rounded ${
            thumb ? 'text-xs' : 'text-sm'
          }`}
        >
          {quality && (
            <span
              className="flex items-end gap-[1.5px] h-3 mr-0.5"
              title={`Connection: ${quality}`}
            >
              {[0, 1, 2].map((i) => {
                const active =
                  quality === 'good' ? 3 : quality === 'ok' ? 2 : 1;
                const color =
                  quality === 'good'
                    ? 'bg-green-400'
                    : quality === 'ok'
                      ? 'bg-yellow-400'
                      : 'bg-red-400';
                return (
                  <span
                    key={i}
                    className={`w-[3px] rounded-sm ${i < active ? color : 'bg-slate-600'}`}
                    style={{ height: `${(i + 1) * 4}px` }}
                  />
                );
              })}
            </span>
          )}
          {micOn !== undefined &&
            (micOn ? (
              <Mic className={thumb ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            ) : (
              <MicOff
                className={`text-red-400 ${thumb ? 'w-3 h-3' : 'w-3.5 h-3.5'}`}
              />
            ))}
          {showName && (
            <span>
              {label || `${username}${isLocal ? ' (you)' : ''}`}
              {isScreen && ' • screen'}
            </span>
          )}
        </div>
      )}

      {/* Top-right controls: pin / fullscreen / picture-in-picture */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
        {onTogglePin && !isScreen && (
          <button
            onClick={onTogglePin}
            aria-label={pinned ? 'Unpin' : 'Pin'}
            title={pinned ? 'Unpin' : 'Pin to spotlight'}
            className={`p-1.5 rounded bg-black/60 hover:bg-black/80 transition-opacity
              ${pinned ? 'opacity-100 text-blue-400' : 'opacity-0 group-hover:opacity-100 text-white'}`}
          >
            {pinned ? (
              <PinOff className="w-3.5 h-3.5" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {typeof document !== 'undefined' &&
          (document as any).pictureInPictureEnabled &&
          camOn !== false && (
            <button
              onClick={togglePip}
              aria-label="Picture in picture"
              title="Picture in picture"
              className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
          )}
        <button
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
          title="Fullscreen"
          className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
