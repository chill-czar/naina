import { pgTable, uuid, varchar, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const roomStatusEnum = pgEnum('room_status', [
  'available',
  'occupied',
  'maintenance',
  'cleaning',
]);

export const roomTypes = pgTable('room_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 150 }).notNull(),
  description: text('description').notNull(),
  basePriceCents: integer('base_price_cents').notNull(),
  maxOccupancy: integer('max_occupancy').notNull().default(2),
  amenities: text('amenities').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomNumber: varchar('room_number', { length: 20 }).notNull().unique(),
  roomTypeId: uuid('room_type_id')
    .notNull()
    .references(() => roomTypes.id, { onDelete: 'cascade' }),
  floor: integer('floor').notNull(),
  status: roomStatusEnum('status').notNull().default('available'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
