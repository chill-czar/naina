import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { roomTypes, rooms, guests, reservations, folios, folioItems } from '../schema';
import type { CheckAvailabilityParams, AvailableRoomOption } from '@naina/shared-types';

function countNights(checkInDate: string, checkOutDate: string): number {
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);
  const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
  return Math.max(1, Math.ceil(diffTime / 86400000));
}

export async function checkAvailability(
  params: CheckAvailabilityParams
): Promise<AvailableRoomOption[]> {
  const { checkInDate, checkOutDate, numberOfGuests = 1, roomTypeCode } = params;
  const nights = countNights(checkInDate, checkOutDate);
  const types = await db.select().from(roomTypes);
  const results: AvailableRoomOption[] = [];

  for (const rt of types) {
    if (numberOfGuests > rt.maxOccupancy) continue;
    if (roomTypeCode && rt.code.toLowerCase() !== roomTypeCode.toLowerCase()) continue;

    const allRooms = await db.select().from(rooms).where(eq(rooms.roomTypeId, rt.id));
    const overlappingReservations = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.roomTypeId, rt.id),
          sql`${reservations.status} IN ('confirmed', 'checked_in')`,
          sql`${reservations.checkInDate} < ${checkOutDate}`,
          sql`${reservations.checkOutDate} > ${checkInDate}`
        )
      );

    const availableCount = Math.max(0, allRooms.length - overlappingReservations.length);

    if (availableCount > 0) {
      results.push({
        roomTypeId: rt.id,
        code: rt.code,
        name: rt.name,
        description: rt.description,
        maxOccupancy: rt.maxOccupancy,
        amenities: rt.amenities,
        availableCount,
        pricePerNightCents: rt.basePriceCents,
        totalNights: nights,
        totalPriceCents: rt.basePriceCents * nights,
      });
    }
  }

  return results;
}

export interface CreateReservationInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  specialRequests?: string;
}

export async function createReservation(input: CreateReservationInput) {
  let [guest] = await db.select().from(guests).where(eq(guests.email, input.email));
  if (!guest) {
    [guest] = await db
      .insert(guests)
      .values({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
      })
      .returning();
  }

  const [rt] = await db.select().from(roomTypes).where(eq(roomTypes.id, input.roomTypeId));
  if (!rt) {
    throw new Error(`Room type with id ${input.roomTypeId} not found`);
  }

  const nights = countNights(input.checkInDate, input.checkOutDate);
  const totalAmountCents = rt.basePriceCents * nights;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const bookingReference = `NAINA-${randomSuffix}`;

  const [reservation] = await db
    .insert(reservations)
    .values({
      bookingReference,
      guestId: guest.id,
      roomTypeId: rt.id,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      numberOfGuests: input.numberOfGuests,
      totalAmountCents,
      specialRequests: input.specialRequests,
      status: 'confirmed',
    })
    .returning();

  const [folio] = await db
    .insert(folios)
    .values({
      reservationId: reservation.id,
      guestId: guest.id,
      status: 'open',
      balanceCents: totalAmountCents,
    })
    .returning();

  await db.insert(folioItems).values({
    folioId: folio.id,
    description: `${rt.name} (${nights} nights @ $${(rt.basePriceCents / 100).toFixed(2)}/night)`,
    category: 'room',
    amountCents: totalAmountCents,
  });


  return {
    bookingReference: reservation.bookingReference,
    guestName: `${guest.firstName} ${guest.lastName}`,
    roomTypeName: rt.name,
    checkInDate: reservation.checkInDate,
    checkOutDate: reservation.checkOutDate,
    numberOfGuests: reservation.numberOfGuests,
    totalNights: nights,
    totalAmountFormatted: `$${(totalAmountCents / 100).toFixed(2)}`,
    status: reservation.status,
  };
}

export async function getReservationByReference(reference: string) {
  const [res] = await db
    .select({
      bookingReference: reservations.bookingReference,
      status: reservations.status,
      checkInDate: reservations.checkInDate,
      checkOutDate: reservations.checkOutDate,
      numberOfGuests: reservations.numberOfGuests,
      totalAmountCents: reservations.totalAmountCents,
      roomTypeName: roomTypes.name,
      guestFirstName: guests.firstName,
      guestLastName: guests.lastName,
      guestPhone: guests.phone,
      guestEmail: guests.email,
    })
    .from(reservations)
    .innerJoin(roomTypes, eq(reservations.roomTypeId, roomTypes.id))
    .innerJoin(guests, eq(reservations.guestId, guests.id))
    .where(eq(reservations.bookingReference, reference.toUpperCase().trim()));

  if (!res) return null;

  return {
    ...res,
    guestName: `${res.guestFirstName} ${res.guestLastName}`,
    totalAmountFormatted: `$${(res.totalAmountCents / 100).toFixed(2)}`,
  };
}

export async function cancelReservation(reference: string) {
  const [updated] = await db
    .update(reservations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(reservations.bookingReference, reference.toUpperCase().trim()))
    .returning();

  if (!updated) {
    throw new Error(`Reservation ${reference} not found.`);
  }

  return {
    bookingReference: updated.bookingReference,
    status: updated.status,
    message: `Reservation ${updated.bookingReference} has been successfully cancelled.`,
  };
}
