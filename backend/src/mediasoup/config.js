import os from 'os';

export const mediasoupConfig = {
  numWorkers: Math.min(os.cpus().length, 4),

  worker: {
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 40100,
  },

  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },

  webRtcTransport: {
    // MEDIASOUP_ANNOUNCED_IP may be a comma-separated list, e.g.
    // "127.0.0.1,10.11.14.216" — mediasoup emits an ICE candidate per entry,
    // so the SAME server works for localhost peers AND LAN peers at once.
    listenIps: (process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((announcedIp) => ({
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedIp,
      })),
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  },
};
