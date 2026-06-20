/**
 * OpenAPI 3.0 specification for the public Voice Call API (v1).
 * Served as JSON at /api/v1/openapi.json and via Swagger UI at /api/v1/docs.
 */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Teleconference Voice Call API',
    version: '1.0.0',
    description:
      'Public API for third-party applications to create voice calls and ' +
      'mint guest access tokens. Call these endpoints from your BACKEND — ' +
      'the API key must never be exposed to a browser.\n\n' +
      'Typical flow:\n' +
      '1. `POST /calls` → get a `callId`.\n' +
      '2. `POST /calls/{id}/token` once per participant → get an `accessToken`.\n' +
      '3. Pass the `accessToken` to the browser; the @teleconf/voicecall-sdk ' +
      'uses it to join the call.',
  },
  servers: [
    { url: '/api/v1', description: 'Current server' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'Secret API key issued to your application.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      CreateCallResponse: {
        type: 'object',
        properties: {
          callId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      TokenRequest: {
        type: 'object',
        required: ['displayName'],
        properties: {
          displayName: {
            type: 'string',
            maxLength: 80,
            description: 'Name shown to other participants.',
            example: 'Budi Santoso',
          },
          externalId: {
            type: 'string',
            description:
              'Optional stable id from your system. If omitted a random ' +
              'participant id is generated.',
          },
        },
      },
      TokenResponse: {
        type: 'object',
        properties: {
          accessToken: {
            type: 'string',
            description: 'Short-lived JWT — give this to the browser/SDK.',
          },
          callId: { type: 'string', format: 'uuid' },
          participantId: { type: 'string' },
          expiresIn: {
            type: 'integer',
            description: 'Seconds until the token expires (join window).',
            example: 900,
          },
        },
      },
      CallStatus: {
        type: 'object',
        properties: {
          callId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          endedAt: { type: 'string', format: 'date-time', nullable: true },
          active: { type: 'boolean' },
          participantCount: { type: 'integer' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                participantId: { type: 'string' },
                displayName: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/calls': {
      post: {
        summary: 'Create a voice call',
        description:
          'Creates a new call. The media room is created lazily when the ' +
          'first participant joins.',
        operationId: 'createCall',
        responses: {
          201: {
            description: 'Call created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCallResponse' },
              },
            },
          },
          401: {
            description: 'Missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/calls/{id}': {
      get: {
        summary: 'Get call status',
        operationId: 'getCall',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Call status with connected participants',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CallStatus' },
              },
            },
          },
          404: {
            description: 'Call not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/calls/{id}/token': {
      post: {
        summary: 'Mint a guest access token',
        description:
          'Creates a short-lived access token for one participant. Mint one ' +
          'token per participant; give it to that participant\'s browser.',
        operationId: 'issueToken',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TokenRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Access token minted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenResponse' },
              },
            },
          },
          400: {
            description: 'displayName missing',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          404: { description: 'Call not found' },
          409: { description: 'Call already ended' },
        },
      },
    },
    '/calls/{id}/end': {
      post: {
        summary: 'End a call',
        description: 'Marks the call ended; no new participants may join.',
        operationId: 'endCall',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Call ended',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    callId: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
          404: { description: 'Call not found' },
        },
      },
    },
  },
};
