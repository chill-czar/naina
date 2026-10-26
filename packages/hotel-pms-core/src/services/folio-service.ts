import { eq } from 'drizzle-orm';
import { db } from '../db';
import { folios, folioItems, reservations, rooms } from '../schema';

export async function getFolioByRoomNumber(roomNumber: string) {
  const [activeReservation] = await db
    .select({
      reservationId: reservations.id,
      bookingReference: reservations.bookingReference,
      folioId: folios.id,
      balanceCents: folios.balanceCents,
      status: folios.status,
    })
    .from(rooms)
    .innerJoin(reservations, eq(reservations.roomId, rooms.id))
    .innerJoin(folios, eq(folios.reservationId, reservations.id))
    .where(eq(rooms.roomNumber, roomNumber.trim()));

  if (!activeReservation) {
    return null;
  }

  const items = await db
    .select()
    .from(folioItems)
    .where(eq(folioItems.folioId, activeReservation.folioId));

  return {
    roomNumber,
    bookingReference: activeReservation.bookingReference,
    balanceFormatted: `$${(activeReservation.balanceCents / 100).toFixed(2)}`,
    status: activeReservation.status,
    charges: items.map((i) => ({
      description: i.description,
      category: i.category,
      amountFormatted: `$${(i.amountCents / 100).toFixed(2)}`,
      date: i.createdAt.toISOString().split('T')[0],
    })),
  };
}

export async function addFolioCharge(
  folioId: string,
  description: string,
  amountCents: number,
  category: 'room' | 'dining' | 'spa' | 'laundry' | 'parking' | 'misc' = 'dining'
) {
  const [item] = await db
    .insert(folioItems)
    .values({
      folioId,
      description,
      amountCents,
      category,
    })
    .returning();

  const [folio] = await db.select().from(folios).where(eq(folios.id, folioId));
  if (folio) {
    await db
      .update(folios)
      .set({
        balanceCents: folio.balanceCents + amountCents,
        updatedAt: new Date(),
      })
      .where(eq(folios.id, folioId));
  }

  return item;
}
