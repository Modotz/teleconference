'use client';

import { useState } from 'react';
import { File, Download } from 'lucide-react';
import { getServerBase } from '@/lib/config';

interface Props {
  message: {
    id: string;
    username: string;
    content: string;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: string | null;
    attachmentSize?: number | null;
    createdAt: string;
  };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ChatMessage({ message }: Props) {
  const [lightbox, setLightbox] = useState(false);

  const isImage = message.attachmentType?.startsWith('image/');
  const isAudio = message.attachmentType?.startsWith('audio/');
  const url = message.attachmentUrl ? `${getServerBase()}${message.attachmentUrl}` : null;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-blue-400 font-medium">{message.username}</span>
        <span className="text-xs text-slate-500">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {message.content && (
        <div className="text-slate-200 break-words whitespace-pre-wrap">
          {message.content}
        </div>
      )}

      {url && isImage && (
        <>
          <button
            onClick={() => setLightbox(true)}
            className="mt-1 block w-full max-w-[240px] rounded overflow-hidden bg-black/30 hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={message.attachmentName || 'image'}
              className="w-full h-auto block"
              loading="lazy"
            />
          </button>
          {lightbox && (
            <div
              onClick={() => setLightbox(false)}
              className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-zoom-out"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={message.attachmentName || 'image'}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </>
      )}

      {url && isAudio && (
        <audio src={url} controls preload="metadata" className="mt-1 w-full max-w-[260px]" />
      )}

      {url && !isImage && !isAudio && (
        <a
          href={url}
          download={message.attachmentName || undefined}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-2 max-w-full bg-slate-800 hover:bg-slate-700 rounded px-3 py-2"
        >
          <File className="w-4 h-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-slate-100 truncate">
              {message.attachmentName || 'file'}
            </div>
            {message.attachmentSize != null && (
              <div className="text-xs text-slate-400">
                {formatSize(message.attachmentSize)}
              </div>
            )}
          </div>
          <Download className="w-4 h-4 shrink-0 text-slate-400" />
        </a>
      )}
    </div>
  );
}
