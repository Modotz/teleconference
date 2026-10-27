'use client';

import { use, useEffect } from 'react';
import { useMeetingRoute } from '@/components/MeetingHost';

/**
 * The meeting UI is rendered by MeetingHost (root layout) so it survives
 * navigation; this route just tells the host which room is on screen.
 */
export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const { enter, exit } = useMeetingRoute();

  useEffect(() => {
    enter(roomId);
    return () => exit(roomId);
  }, [roomId, enter, exit]);

  return null;
}
