import { pgTable, uuid, varchar, integer, timestamp, date, pgEnum } from 'drizzle-orm/pg-core';
import { guests } from './guests';
import { roomTypes, rooms } from './rooms';

export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
]);

export const reservations = pgTable('reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingReference: varchar('booking_reference', { length: 20 }).notNull().unique(),
  guestId: uuid('guest_id')
    .notNull()
    .references(() => guests.id, { onDelete: 'cascade' }),
  roomTypeId: uuid('room_type_id')
    .notNull()
    .references(() => roomTypes.id, { onDelete: 'restrict' }),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  checkInDate: date('check_in_date').notNull(),
  checkOutDate: date('check_out_date').notNull(),
  numberOfGuests: integer('number_of_guests').notNull().default(1),
  totalAmountCents: integer('total_amount_cents').notNull(),
  status: reservationStatusEnum('status').notNull().default('confirmed'),
  specialRequests: varchar('special_requests', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
