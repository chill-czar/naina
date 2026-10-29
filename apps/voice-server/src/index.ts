import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { AccessToken } from 'livekit-server-sdk';
import { config } from './config';
import {
  checkAvailability,
  getCallSession,
  saveCallSession,
  createRoomHold,
} from '@naina/hotel-pms-core';
import { liveKitAgentManager } from './pipeline/livekit-agent';
import { getHistoricalTurnLogs } from './pipeline/telemetry-logger';

export const app = new Hono();

// Global CORS Middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health Checks
const healthHandler = (c: any) => {
  return c.json({
    status: 'ok',
    service: 'Naina Voice Server (Hono)',
    runtime: 'Node.js / Hono Engine',
    geminiModel: config.gemini.model,
    cartesiaTts: config.cartesia.ttsModel,
    cartesiaStt: config.cartesia.sttModel,
    activeAgents: 'ready',
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// LiveKit Token & Agent Worker Dispatch Endpoint
app.post('/api/token', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const roomName = body.roomName || 'naina-concierge-room';
    const participantName =
      body.participantName || `guest-${Math.floor(1000 + Math.random() * 9000)}`;

    if (!config.livekit.apiKey || !config.livekit.apiSecret) {
      return c.json(
        { error: 'LiveKit API credentials not configured in environment variables' },
        500
      );
    }

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: participantName,
      name: participantName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // Proactively dispatch / join LiveKit agent worker to the room
    liveKitAgentManager.getOrCreateAgent(roomName).catch((err) => {
      console.error(`[hono] Failed to start LiveKit agent for room ${roomName}:`, err);
    });

    return c.json({
      token,
      url: config.livekit.url,
      roomName,
      participantName,
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to generate token' }, 400);
  }
});

// PMS Room Availability Endpoint
app.get('/api/rooms', async (c) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const checkInDate = c.req.query('checkInDate') || today;
    const checkOutDate = c.req.query('checkOutDate') || tomorrow;
    const guests = parseInt(c.req.query('guests') || '2', 10);

    const rooms = await checkAvailability({
      checkInDate,
      checkOutDate,
      numberOfGuests: guests,
    });

    return c.json({ rooms });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to check room availability' }, 500);
  }
});

// Historical Telemetry Endpoint
app.get('/api/telemetry', (c) => {
  try {
    const turns = getHistoricalTurnLogs();
    return c.json({ turns });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch telemetry' }, 500);
  }
});

// Persistent Call Session State Lookup
app.get('/api/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  try {
    const session = await getCallSession(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found or expired', id: sessionId }, 404);
    }
    return c.json({ session });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to load session' }, 500);
  }
});

// Update Session State or Create Room Hold
app.post('/api/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  try {
    const body = await c.req.json().catch(() => ({}));

    if (body.action === 'hold' && body.roomTypeId && body.checkInDate && body.checkOutDate) {
      const hold = await createRoomHold({
        sessionId,
        roomTypeId: body.roomTypeId,
        checkInDate: body.checkInDate,
        checkOutDate: body.checkOutDate,
        guestPhone: body.guestPhone,
      });
      return c.json({ success: true, hold });
    }

    const updated = await saveCallSession({
      id: sessionId,
      ...body,
    });

    return c.json({ success: true, session: updated });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update session' }, 500);
  }
});

// 404 Fallback
app.notFound((c) => {
  return c.json({ error: 'Endpoint Not Found' }, 404);
});

// Server bootstrap
let serverInstance: any = null;

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('src/index.ts') ||
    process.argv[1].endsWith('src/index.js') ||
    process.argv[1].endsWith('dist/index.js'));

if (isMain && process.env.NODE_ENV !== 'test') {
  serverInstance = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`🚀 Naina Voice Server (Hono) running on http://localhost:${info.port}`);
    }
  );

  // Graceful shutdown
  const shutdown = () => {
    console.log('[hono] Gracefully shutting down voice server...');
    if (serverInstance) {
      serverInstance.close(() => {
        console.log('[hono] HTTP server closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
