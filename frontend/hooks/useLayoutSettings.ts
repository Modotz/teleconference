'use client';

import { useCallback, useEffect, useState } from 'react';

export type LayoutMode = 'grid' | 'spotlight' | 'sidebar';

export interface LayoutSettings {
  mode: LayoutMode;
  showSelf: boolean;
  mirrorSelf: boolean;
  showNames: boolean;
  pinnedPeerId: string | null;
}

const DEFAULT: LayoutSettings = {
  mode: 'grid',
  showSelf: true,
  mirrorSelf: true,
  showNames: true,
  pinnedPeerId: null,
};

const KEY = 'teleconf:layout-settings';

function load(): LayoutSettings {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed, pinnedPeerId: null };
  } catch {
    return DEFAULT;
  }
}

export function useLayoutSettings() {
  const [settings, setSettings] = useState<LayoutSettings>(DEFAULT);

  // Hydrate from localStorage on mount (avoid SSR mismatch)
  useEffect(() => {
    setSettings(load());
  }, []);

  // Persist (everything except pinnedPeerId, which is session-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { pinnedPeerId: _omit, ...persistable } = settings;
    localStorage.setItem(KEY, JSON.stringify(persistable));
  }, [settings]);

  const update = useCallback(<K extends keyof LayoutSettings>(
    key: K,
    value: LayoutSettings[K]
  ) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const togglePin = useCallback((peerId: string) => {
    setSettings((s) => ({
      ...s,
      pinnedPeerId: s.pinnedPeerId === peerId ? null : peerId,
      // Pinning auto-switches to spotlight if currently grid
      mode: s.mode === 'grid' && s.pinnedPeerId !== peerId ? 'spotlight' : s.mode,
    }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT), []);

  return { settings, update, togglePin, reset };
}
