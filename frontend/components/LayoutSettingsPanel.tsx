'use client';

import { useRef } from 'react';
import {
  X,
  Grid3x3,
  Layout,
  Sidebar,
  Sparkles,
  ImagePlus,
  Settings2,
} from 'lucide-react';
import type { LayoutMode, LayoutSettings } from '@/hooks/useLayoutSettings';
import type { BackgroundMode } from '@/lib/virtualBackground';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: LayoutSettings;
  onUpdate: <K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) => void;
  onReset: () => void;
  bgMode: BackgroundMode;
  onBgChange: (mode: BackgroundMode) => void;
  bgLoading?: boolean;
  bgError?: string | null;
  /** Object URL of the user's own uploaded background image, if any. */
  customBg?: string | null;
  /** Called with the chosen file when the user uploads a background. */
  onUploadBackground: (file: File) => void;
  /** Audio/video device selection. */
  devices?: {
    mics: MediaDeviceInfo[];
    cams: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
    micId: string;
    camId: string;
    speakerId: string;
    onMic: (id: string) => void;
    onCam: (id: string) => void;
    onSpeaker: (id: string) => void;
    noiseSuppress: boolean;
    onNoise: (on: boolean) => void;
  };
  /** Live-caption language. */
  captionLang?: string;
  onCaptionLang?: (lang: string) => void;
}

const CAPTION_LANGS: { code: string; label: string }[] = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'id-ID', label: 'Indonesia' },
  { code: 'ms-MY', label: 'Melayu' },
  { code: 'es-ES', label: 'Español' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'zh-CN', label: '中文 (普通话)' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'ru-RU', label: 'Русский' },
];

const BG_PRESETS: { key: string; label: string; mode: BackgroundMode; preview: string }[] = [
  { key: 'none', label: 'None', mode: { kind: 'none' }, preview: '∅' },
  { key: 'blur', label: 'Blur', mode: { kind: 'blur', amount: 14 }, preview: '◐' },
  // Lightweight stock backgrounds (Unsplash hosted). Replace with self-hosted if needed.
  {
    key: 'office',
    label: 'Office',
    mode: {
      kind: 'image',
      src: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1280&q=70',
    },
    preview: '🏢',
  },
  {
    key: 'beach',
    label: 'Beach',
    mode: {
      kind: 'image',
      src: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1280&q=70',
    },
    preview: '🌊',
  },
];

const MODES: { value: LayoutMode; label: string; icon: typeof Grid3x3; description: string }[] = [
  {
    value: 'grid',
    label: 'Grid',
    icon: Grid3x3,
    description: 'Equal-sized tiles for everyone',
  },
  {
    value: 'spotlight',
    label: 'Spotlight',
    icon: Layout,
    description: 'One big tile, others below',
  },
  {
    value: 'sidebar',
    label: 'Sidebar',
    icon: Sidebar,
    description: 'One big tile, others on the side',
  },
];

export default function LayoutSettingsPanel({
  open,
  onClose,
  settings,
  onUpdate,
  onReset,
  bgMode,
  onBgChange,
  bgLoading,
  bgError,
  customBg,
  onUploadBackground,
  devices,
  captionLang,
  onCaptionLang,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const speakerSupported =
    typeof window !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  if (!open) return null;

  function isActiveBg(mode: BackgroundMode) {
    if (mode.kind !== bgMode.kind) return false;
    if (mode.kind === 'image' && bgMode.kind === 'image') return mode.src === bgMode.src;
    return true;
  }

  const customActive =
    bgMode.kind === 'image' && !!customBg && bgMode.src === customBg;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-40"
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Layout settings"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(420px,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto
          bg-slate-900 border border-slate-800 rounded-lg z-50 shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold">Layout Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Layout mode */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Layout</h3>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = settings.mode === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => onUpdate('mode', m.value)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded border-2 transition-colors
                      ${
                        active
                          ? 'border-blue-500 bg-blue-500/10 text-white'
                          : 'border-slate-700 hover:border-slate-600 text-slate-300'
                      }`}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {MODES.find((m) => m.value === settings.mode)?.description}
            </p>
          </section>

          {/* Virtual background */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              Virtual background
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {BG_PRESETS.map((preset) => {
                const active = isActiveBg(preset.mode);
                return (
                  <button
                    key={preset.key}
                    onClick={() => onBgChange(preset.mode)}
                    disabled={bgLoading}
                    className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition-colors disabled:opacity-50
                      ${
                        active
                          ? 'border-blue-500 bg-blue-500/10 text-white'
                          : 'border-slate-700 hover:border-slate-600 text-slate-300'
                      }`}
                  >
                    <div className="w-full aspect-video bg-slate-800 rounded flex items-center justify-center text-xl">
                      {preset.preview}
                    </div>
                    <span className="text-xs font-medium">{preset.label}</span>
                  </button>
                );
              })}

              {/* User's uploaded image (shown only after they upload one) */}
              {customBg && (
                <button
                  onClick={() => onBgChange({ kind: 'image', src: customBg })}
                  disabled={bgLoading}
                  className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition-colors disabled:opacity-50
                    ${
                      customActive
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-slate-700 hover:border-slate-600 text-slate-300'
                    }`}
                >
                  <div className="w-full aspect-video bg-slate-800 rounded overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={customBg}
                      alt="Custom background"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-xs font-medium">Custom</span>
                </button>
              )}

              {/* Upload your own background */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={bgLoading}
                className="flex flex-col items-center gap-1 p-2 rounded border-2 border-dashed
                  border-slate-700 hover:border-slate-500 text-slate-300 transition-colors disabled:opacity-50"
              >
                <div className="w-full aspect-video bg-slate-800 rounded flex items-center justify-center">
                  <ImagePlus className="w-5 h-5" />
                </div>
                <span className="text-xs font-medium">Upload</span>
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadBackground(file);
                  // reset so picking the same file again re-fires onChange
                  e.target.value = '';
                }}
              />
            </div>
            {bgLoading && (
              <p className="text-xs text-slate-400 mt-2">Loading segmentation model...</p>
            )}
            {bgError && (
              <p className="text-xs text-red-400 mt-2">{bgError}</p>
            )}
            <p className="text-xs text-slate-500 mt-2">
              Runs locally in your browser. Heavy on mobile — start with blur.
            </p>
          </section>

          {/* Devices */}
          {devices && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                <Settings2 className="w-4 h-4" />
                Devices
              </h3>

              <DeviceSelect
                label="Microphone"
                value={devices.micId}
                options={devices.mics}
                fallback="Microphone"
                onChange={devices.onMic}
              />
              <DeviceSelect
                label="Camera"
                value={devices.camId}
                options={devices.cams}
                fallback="Camera"
                onChange={devices.onCam}
              />
              {speakerSupported && devices.speakers.length > 0 && (
                <DeviceSelect
                  label="Speaker"
                  value={devices.speakerId}
                  options={devices.speakers}
                  fallback="Speaker"
                  onChange={devices.onSpeaker}
                />
              )}

              <Toggle
                label="Noise suppression"
                hint="Reduce background noise from your microphone"
                checked={devices.noiseSuppress}
                onChange={devices.onNoise}
              />
            </section>
          )}

          {/* Live captions */}
          {onCaptionLang && (
            <section>
              <h3 className="text-sm font-medium text-slate-300 mb-2">
                Live captions
              </h3>
              <label className="block">
                <span className="text-xs text-slate-400">Spoken language</span>
                <select
                  value={captionLang}
                  onChange={(e) => onCaptionLang(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {CAPTION_LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500 mt-2">
                The language you speak, for the Captions (CC) button.
              </p>
            </section>
          )}

          {/* Toggles */}
          <section className="space-y-1">
            <h3 className="text-sm font-medium text-slate-300 mb-2">Options</h3>

            <Toggle
              label="Show self view"
              hint="Display your own video tile in the layout"
              checked={settings.showSelf}
              onChange={(v) => onUpdate('showSelf', v)}
            />
            <Toggle
              label="Mirror my video"
              hint="Flip your camera horizontally (like a mirror)"
              checked={settings.mirrorSelf}
              onChange={(v) => onUpdate('mirrorSelf', v)}
            />
            <Toggle
              label="Show participant names"
              hint="Display name labels on each tile"
              checked={settings.showNames}
              onChange={(v) => onUpdate('showNames', v)}
            />
          </section>

          {settings.pinnedPeerId && (
            <section>
              <button
                onClick={() => onUpdate('pinnedPeerId', null)}
                className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
              >
                Unpin current spotlight
              </button>
            </section>
          )}

          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={onReset}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DeviceSelect({
  label,
  value,
  options,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  options: MediaDeviceInfo[];
  fallback: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
      >
        {options.length === 0 && <option value="">{fallback}</option>}
        {options.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${fallback} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-start justify-between gap-3 py-2 cursor-pointer"
    >
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        style={{
          width: 44,
          height: 24,
          padding: 2,
          backgroundColor: checked ? '#2563eb' : '#334155',
        }}
        className="shrink-0 rounded-full transition-colors relative flex items-center"
      >
        <span
          style={{
            width: 20,
            height: 20,
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
            transition: 'transform 150ms ease',
          }}
          className="block bg-white rounded-full"
        />
      </button>
    </div>
  );
}
