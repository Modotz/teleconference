'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// Heavy (mediasoup, recorder, whiteboard…) — load only once a room is opened,
// not on every page that shares the root layout.
const MeetingRoom = dynamic(() => import('@/components/MeetingRoom'), { ssr: false });

/**
 * Keeps the active meeting mounted across client-side navigation.
 *
 * The /room/[roomId] route only *announces* its room here; the meeting itself
 * is rendered by this host (in the root layout), so going Back or to another
 * page minimizes the call instead of unmounting it. It ends only when the user
 * leaves (or is kicked / the host ends it), or when they open another room.
 */

interface MeetingRoute {
  /** The /room page for `roomId` mounted. */
  enter: (roomId: string) => void;
  /** The /room page for `roomId` unmounted (user navigated elsewhere). */
  exit: (roomId: string) => void;
}

const MeetingRouteContext = createContext<MeetingRoute>({
  enter: () => {},
  exit: () => {},
});

export function useMeetingRoute() {
  return useContext(MeetingRouteContext);
}

export default function MeetingHost({ children }: { children: React.ReactNode }) {
  // The meeting that's mounted, and the room whose page is currently open.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [inMeeting, setInMeeting] = useState(false);

  const enter = useCallback((id: string) => {
    // Opening a different room replaces (and so leaves) the current meeting;
    // the fresh MeetingRoom reports its own inMeeting on mount.
    setRouteId(id);
    setActiveId(id);
  }, []);
  const exit = useCallback((id: string) => {
    setRouteId((cur) => (cur === id ? null : cur));
  }, []);
  const route = useMemo(() => ({ enter, exit }), [enter, exit]);

  // Navigated away before actually joining → nothing worth keeping alive.
  useEffect(() => {
    if (activeId && routeId !== activeId && !inMeeting) setActiveId(null);
  }, [activeId, routeId, inMeeting]);

  const end = useCallback(() => {
    setActiveId(null);
    setInMeeting(false);
  }, []);

  return (
    <MeetingRouteContext.Provider value={route}>
      {children}
      {activeId && (
        <MeetingRoom
          key={activeId}
          roomId={activeId}
          minimized={routeId !== activeId}
          onActiveChange={setInMeeting}
          onExit={end}
        />
      )}
    </MeetingRouteContext.Provider>
  );
}
