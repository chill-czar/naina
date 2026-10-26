import { pgTable, uuid, varchar, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { reservations } from './reservations';
import { guests } from './guests';

export const folioStatusEnum = pgEnum('folio_status', ['open', 'closed', 'settled']);
export const folioCategoryEnum = pgEnum('folio_category', [
  'room',
  'dining',
  'spa',
  'laundry',
  'parking',
  'misc',
]);

export const folios = pgTable('folios', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id')
    .notNull()
    .unique()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  guestId: uuid('guest_id')
    .notNull()
    .references(() => guests.id, { onDelete: 'cascade' }),
  status: folioStatusEnum('status').notNull().default('open'),
  balanceCents: integer('balance_cents').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const folioItems = pgTable('folio_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  folioId: uuid('folio_id')
    .notNull()
    .references(() => folios.id, { onDelete: 'cascade' }),
  description: varchar('description', { length: 255 }).notNull(),
  category: folioCategoryEnum('category').notNull().default('misc'),
  amountCents: integer('amount_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
