import { useEffect } from 'react';
import { useVoiceCall } from './useVoiceCall';

export interface VoiceCallRoomProps {
  /** Base URL of the Teleconference backend */
  serverUrl: string;
  /** Access token from POST /api/v1/calls/:id/token */
  accessToken: string;
  /** Your display name shown locally */
  selfName?: string;
  /** Auto-join on mount (default true) */
  autoJoin?: boolean;
  /** Called after the user leaves / hangs up */
  onLeave?: () => void;
  /** Optional style overrides for the outer container */
  className?: string;
}

/**
 * Drop-in voice-call UI. Renders participant avatars, an active-speaker
 * highlight, mute, and hang-up — no styling framework required.
 *
 *   <VoiceCallRoom serverUrl="https://voice.example.com" accessToken={token} />
 */
export function VoiceCallRoom({
  serverUrl,
  accessToken,
  selfName = 'You',
  autoJoin = true,
  onLeave,
  className,
}: VoiceCallRoomProps) {
  const call = useVoiceCall({ serverUrl });

  useEffect(() => {
    if (autoJoin && accessToken) {
      call.join(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function handleLeave() {
    call.leave();
    onLeave?.();
  }

  const connecting = call.status === 'connecting' || call.status === 'idle';

  return (
    <div
      className={className}
      style={{
        fontFamily: 'system-ui, sans-serif',
        background: '#0f172a',
        color: '#e2e8f0',
        borderRadius: 16,
        padding: 24,
        maxWidth: 420,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {call.status === 'connected'
            ? 'In call'
            : call.status === 'error'
              ? 'Connection error'
              : call.status === 'ended'
                ? 'Call ended'
                : 'Connecting…'}
        </div>
        {call.error && (
          <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
            {call.error}
          </div>
        )}
      </div>

      {/* Avatars */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        <Avatar name={selfName} speaking={false} self />
        {call.participants.map((p) => (
          <Avatar key={p.peerId} name={p.displayName} speaking={p.speaking} />
        ))}
      </div>

      <div style={{ fontSize: 12, color: '#64748b' }}>
        {call.participants.length === 0
          ? 'Waiting for others to join…'
          : `${call.participants.length} other participant${
              call.participants.length > 1 ? 's' : ''
            }`}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={call.toggleMic}
          disabled={connecting}
          style={{
            ...btnStyle,
            background: call.micEnabled ? '#334155' : '#dc2626',
          }}
        >
          {call.micEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button
          onClick={handleLeave}
          style={{ ...btnStyle, background: '#dc2626' }}
        >
          Leave
        </button>
      </div>
    </div>
  );
}

function Avatar({
  name,
  speaking,
  self,
}: {
  name: string;
  speaking: boolean;
  self?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 600,
          border: `2px solid ${speaking ? '#4ade80' : 'transparent'}`,
          transition: 'border-color 120ms',
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <span style={{ fontSize: 11, color: '#cbd5e1', maxWidth: 64, textAlign: 'center' }}>
        {name}
        {self ? ' (you)' : ''}
      </span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  border: 'none',
  color: '#fff',
  padding: '10px 20px',
  borderRadius: 9999,
  cursor: 'pointer',
  fontSize: 14,
};
