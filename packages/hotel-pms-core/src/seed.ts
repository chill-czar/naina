import { db } from './db';
import { roomTypes, rooms } from './schema';

export async function seed() {
  console.log('Seeding database...');

  await db
    .insert(roomTypes)
    .values({
      code: 'DELUXE_KING',
      name: 'Deluxe King Room',
      description: 'Spacious 420 sq ft room with plush California King bed, marble bathroom, and skyline views.',
      basePriceCents: 18900,
      maxOccupancy: 2,
      amenities: ['King Bed', 'High-speed Wi-Fi', 'Rain Shower', 'Espresso Machine', '55-inch OLED TV'],
    })
    .onConflictDoNothing();

  await db
    .insert(roomTypes)
    .values({
      code: 'EXECUTIVE_SUITE',
      name: 'Executive Balcony Suite',
      description: 'Luxurious 750 sq ft suite featuring separate living lounge, private furnished terrace, and deep soaking tub.',
      basePriceCents: 34900,
      maxOccupancy: 4,
      amenities: ['King Bed + Sofa Bed', 'Private Balcony', 'Soaking Tub', 'Complimentary Minibar', 'Lounge Access'],
    })
    .onConflictDoNothing();

  await db
    .insert(roomTypes)
    .values({
      code: 'STANDARD_QUEEN',
      name: 'Classic Queen Room',
      description: 'Comfortable 300 sq ft room equipped with ergonomic workspace, ideal for business travelers.',
      basePriceCents: 12900,
      maxOccupancy: 2,
      amenities: ['Queen Bed', 'Dedicated Desk', 'Coffee Maker', 'Walk-in Shower'],
    })
    .onConflictDoNothing();

  const allTypes = await db.select().from(roomTypes);
  const typeMap = new Map(allTypes.map((t) => [t.code, t.id]));

  const sampleRooms = [
    { roomNumber: '101', typeCode: 'STANDARD_QUEEN', floor: 1 },
    { roomNumber: '102', typeCode: 'STANDARD_QUEEN', floor: 1 },
    { roomNumber: '103', typeCode: 'DELUXE_KING', floor: 1 },
    { roomNumber: '201', typeCode: 'DELUXE_KING', floor: 2 },
    { roomNumber: '202', typeCode: 'DELUXE_KING', floor: 2 },
    { roomNumber: '203', typeCode: 'DELUXE_KING', floor: 2 },
    { roomNumber: '301', typeCode: 'EXECUTIVE_SUITE', floor: 3 },
    { roomNumber: '302', typeCode: 'EXECUTIVE_SUITE', floor: 3 },
  ];

  for (const r of sampleRooms) {
    const typeId = typeMap.get(r.typeCode);
    if (typeId) {
      await db
        .insert(rooms)
        .values({
          roomNumber: r.roomNumber,
          roomTypeId: typeId,
          floor: r.floor,
          status: 'available',
        })
        .onConflictDoNothing();
    }
  }

  console.log('Database seeded.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });

