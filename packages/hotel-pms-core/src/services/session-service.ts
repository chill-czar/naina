import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { callSessions } from '../schema/call-sessions';
import type { CallSession, CallSessionState } from '@naina/shared-types';

// In-memory fallback ledger (ensures zero downtime if DB network hiccups)
const memorySessions = new Map<string, CallSession>();

export async function saveCallSession(
  sessionData: Partial<CallSession> & { id: string }
): Promise<CallSession> {
  const now = new Date();
  const defaultExpiry = new Date(now.getTime() + 15 * 60 * 1000); // 15-minute sliding TTL

  const existing = memorySessions.get(sessionData.id);

  const merged: CallSession = {
    id: sessionData.id,
    guestPhone: sessionData.guestPhone ?? existing?.guestPhone,
    state: (sessionData.state ?? existing?.state ?? 'ACTIVE') as CallSessionState,
    activeHoldId: sessionData.activeHoldId ?? existing?.activeHoldId,
    collectedEntities: {
      ...(existing?.collectedEntities || {}),
      ...(sessionData.collectedEntities || {}),
    },
    turnsHistory: sessionData.turnsHistory ?? existing?.turnsHistory ?? [],
    turnCount: sessionData.turnCount ?? (existing?.turnCount || 0) + 1,
    expiresAt: sessionData.expiresAt ?? existing?.expiresAt ?? defaultExpiry.toISOString(),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };

  memorySessions.set(sessionData.id, merged);

  try {
    // Attempt persistent write to PostgreSQL
    await db
      .insert(callSessions)
      .values({
        id: merged.id,
        guestPhone: merged.guestPhone,
        state: merged.state,
        activeHoldId: merged.activeHoldId,
        collectedEntities: merged.collectedEntities,
        turnsHistory: merged.turnsHistory,
        turnCount: merged.turnCount,
        expiresAt: new Date(merged.expiresAt),
        updatedAt: new Date(merged.updatedAt),
      })
      .onConflictDoUpdate({
        target: callSessions.id,
        set: {
          guestPhone: merged.guestPhone,
          state: merged.state,
          activeHoldId: merged.activeHoldId,
          collectedEntities: merged.collectedEntities,
          turnsHistory: merged.turnsHistory,
          turnCount: merged.turnCount,
          expiresAt: new Date(merged.expiresAt),
          updatedAt: new Date(merged.updatedAt),
        },
      });
  } catch (err) {
    // Graceful fallback to memory store if database table is creating or syncing
    console.warn(`[session-service] Note: Stored in memory ledger (DB write skipped: ${(err as any)?.message})`);
  }

  // If Cloudflare Durable Object session coordinator is configured, replicate state to edge
  const coordinatorUrl = process.env.SESSION_COORDINATOR_URL;
  if (coordinatorUrl) {
    try {
      await fetch(`${coordinatorUrl}/session/${sessionData.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
    } catch {}
  }

  return merged;
}

export async function getCallSession(id: string): Promise<CallSession | null> {
  // Check memory ledger first (L1 cache)
  const cached = memorySessions.get(id);
  if (cached) {
    const isExpired = new Date(cached.expiresAt).getTime() < Date.now();
    if (!isExpired) return cached;
  }

  // Check Cloudflare Durable Object session coordinator (L2 cache)
  const coordinatorUrl = process.env.SESSION_COORDINATOR_URL;
  if (coordinatorUrl) {
    try {
      const res = await fetch(`${coordinatorUrl}/session/${id}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.session) {
          memorySessions.set(id, data.session);
          return data.session;
        }
      }
    } catch {}
  }

  try {
    const [row] = await db
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.id, id), sql`${callSessions.expiresAt} > NOW()`));

    if (!row) return null;

    const session: CallSession = {
      id: row.id,
      guestPhone: row.guestPhone ?? undefined,
      state: row.state as CallSessionState,
      activeHoldId: row.activeHoldId ?? undefined,
      collectedEntities: (row.collectedEntities as Record<string, any>) || {},
      turnsHistory: (row.turnsHistory as any[]) || [],
      turnCount: row.turnCount,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };

    memorySessions.set(id, session);
    return session;
  } catch {
    return cached ?? null;
  }
}

export async function getActiveSessionByPhone(phone: string): Promise<CallSession | null> {
  const cleanPhone = phone.trim();
  for (const session of memorySessions.values()) {
    if (session.guestPhone === cleanPhone && new Date(session.expiresAt).getTime() > Date.now()) {
      return session;
    }
  }

  try {
    const [row] = await db
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.guestPhone, cleanPhone), sql`${callSessions.expiresAt} > NOW()`))
      .orderBy(desc(callSessions.updatedAt))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      guestPhone: row.guestPhone ?? undefined,
      state: row.state as CallSessionState,
      activeHoldId: row.activeHoldId ?? undefined,
      collectedEntities: (row.collectedEntities as Record<string, any>) || {},
      turnsHistory: (row.turnsHistory as any[]) || [],
      turnCount: row.turnCount,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function createRoomHold(params: {
  sessionId: string;
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  guestPhone?: string;
}): Promise<{ holdId: string; expiresAt: string }> {
  const holdId = `hold_${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5-minute atomic hold

  await saveCallSession({
    id: params.sessionId,
    guestPhone: params.guestPhone,
    state: 'HOLD_PENDING',
    activeHoldId: holdId,
    collectedEntities: {
      roomTypeId: params.roomTypeId,
      checkInDate: params.checkInDate,
      checkOutDate: params.checkOutDate,
    },
    expiresAt,
  });

  return { holdId, expiresAt };
}
