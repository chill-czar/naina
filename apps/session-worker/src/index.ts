import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CallSession, CallSessionState } from '@naina/shared-types';

export interface Env {
  CALL_SESSIONS: DurableObjectNamespace<CallSessionDurableObject>;
}

/**
 * CallSessionDurableObject
 *
 * Runs inside Cloudflare's global edge network (V8 isolates).
 * Each active call session / room ID has exactly ONE instance globally,
 * ensuring strongly consistent actor coordination with zero race conditions.
 */
export class CallSessionDurableObject extends DurableObject {
  private session: CallSession | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Initialize session from transactional local SQLite storage
    if (!this.session) {
      this.session = ((await this.ctx.storage.get('session')) as CallSession) || null;
    }

    // GET /session or /state - Retrieve active session & turn history
    if (request.method === 'GET') {
      if (!this.session) {
        return new Response(JSON.stringify({ error: 'Session not found or expired' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ session: this.session }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /hold - 5-minute atomic room hold
    if (request.method === 'POST' && url.pathname.endsWith('/hold')) {
      const body = (await request.json().catch(() => ({}))) as any;
      const holdId = `hold_${Math.random().toString(36).slice(2, 10)}`;
      const holdExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      this.session = {
        id: body.sessionId || this.session?.id || 'unknown',
        guestPhone: body.guestPhone ?? this.session?.guestPhone,
        state: 'HOLD_PENDING',
        activeHoldId: holdId,
        collectedEntities: {
          ...(this.session?.collectedEntities || {}),
          roomTypeId: body.roomTypeId,
          checkInDate: body.checkInDate,
          checkOutDate: body.checkOutDate,
        },
        turnsHistory: this.session?.turnsHistory ?? [],
        turnCount: this.session?.turnCount || 0,
        expiresAt: holdExpiresAt,
        createdAt: this.session?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.ctx.storage.put('session', this.session);
      // Schedule automatic release in 5 minutes
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);

      return new Response(
        JSON.stringify({ success: true, hold: { holdId, expiresAt: holdExpiresAt }, session: this.session }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POST / - Update turns or session state
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Partial<CallSession>;
      const now = new Date();
      const defaultExpiry = new Date(now.getTime() + 15 * 60 * 1000); // 15-minute sliding TTL

      this.session = {
        id: body.id || this.session?.id || 'unknown',
        guestPhone: body.guestPhone ?? this.session?.guestPhone,
        state: (body.state ?? this.session?.state ?? 'ACTIVE') as CallSessionState,
        activeHoldId: body.activeHoldId ?? this.session?.activeHoldId,
        collectedEntities: {
          ...(this.session?.collectedEntities || {}),
          ...(body.collectedEntities || {}),
        },
        turnsHistory: body.turnsHistory ?? this.session?.turnsHistory ?? [],
        turnCount: body.turnCount ?? (this.session?.turnCount || 0) + 1,
        expiresAt: body.expiresAt ?? this.session?.expiresAt ?? defaultExpiry.toISOString(),
        createdAt: this.session?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      };

      await this.ctx.storage.put('session', this.session);
      // Schedule sliding TTL alarm
      await this.ctx.storage.setAlarm(new Date(this.session.expiresAt).getTime());

      return new Response(JSON.stringify({ success: true, session: this.session }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  }

  /**
   * Alarm lifecycle handler:
   * Called by Cloudflare Workers runtime when the scheduled alarm fires.
   */
  async alarm(): Promise<void> {
    if (!this.session) return;
    const now = Date.now();
    const expiry = new Date(this.session.expiresAt).getTime();

    if (now >= expiry) {
      if (this.session.state === 'HOLD_PENDING') {
        console.log(`[DurableObject] 5-minute hold ${this.session.activeHoldId} expired for session ${this.session.id}`);
        this.session.state = 'DROPPED';
        this.session.activeHoldId = undefined;
        await this.ctx.storage.put('session', this.session);
      } else {
        console.log(`[DurableObject] 15-minute TTL reached for session ${this.session.id}. Purging.`);
        await this.ctx.storage.deleteAll();
        this.session = null;
      }
    }
  }
}

// Hono Cloudflare Worker API router
const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'Naina Cloudflare Durable Object Session Coordinator',
    runtime: 'Cloudflare Workers (workerd)',
    timestamp: new Date().toISOString(),
  });
});

// Route session requests to the specific Durable Object stub for the given session ID
app.all('/session/:id/*', async (c) => {
  const sessionId = c.req.param('id');
  const id = c.env.CALL_SESSIONS.idFromName(sessionId);
  const stub = c.env.CALL_SESSIONS.get(id);

  // Forward request to the Durable Object instance
  return await stub.fetch(c.req.raw);
});

app.all('/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  const id = c.env.CALL_SESSIONS.idFromName(sessionId);
  const stub = c.env.CALL_SESSIONS.get(id);

  return await stub.fetch(c.req.raw);
});

export default app;
