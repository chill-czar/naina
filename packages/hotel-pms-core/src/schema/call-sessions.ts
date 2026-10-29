import { pgTable, text, varchar, integer, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';

export const callSessions = pgTable('call_sessions', {
  id: text('id').primaryKey(),
  guestPhone: varchar('guest_phone', { length: 30 }),
  state: varchar('state', { length: 30 }).default('ACTIVE').notNull(),
  activeHoldId: text('active_hold_id'),
  collectedEntities: jsonb('collected_entities').default({}).notNull(),
  turnsHistory: jsonb('turns_history').default([]).notNull(),
  turnCount: integer('turn_count').default(0).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type CallSessionRow = typeof callSessions.$inferSelect;
export type InsertCallSessionRow = typeof callSessions.$inferInsert;
