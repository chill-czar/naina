export type RoomStatus = 'available' | 'occupied' | 'maintenance' | 'cleaning';
export type ReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type FolioStatus = 'open' | 'closed' | 'settled';
export type FolioItemCategory = 'room' | 'dining' | 'spa' | 'laundry' | 'parking' | 'misc';

export interface RoomType {
  id: string;
  code: string;
  name: string;
  description: string;
  basePriceCents: number;
  maxOccupancy: number;
  amenities: string[];
}

export interface Room {
  id: string;
  roomNumber: string;
  roomTypeId: string;
  floor: number;
  status: RoomStatus;
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface Reservation {
  id: string;
  bookingReference: string;
  guestId: string;
  roomTypeId: string;
  roomId?: string | null;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  numberOfGuests: number;
  totalAmountCents: number;
  status: ReservationStatus;
  createdAt: string;
}

export interface Folio {
  id: string;
  reservationId: string;
  guestId: string;
  status: FolioStatus;
  balanceCents: number;
}

export interface FolioItem {
  id: string;
  folioId: string;
  description: string;
  category: FolioItemCategory;
  amountCents: number;
  createdAt: string;
}

export interface BookingDraft {
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  roomTypeId?: string;
  checkInDate?: string;
  checkOutDate?: string;
  numberOfGuests?: number;
  specialRequests?: string;
  status: 'collecting_info' | 'quoted' | 'confirmed';
}

export interface CheckAvailabilityParams {
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests?: number;
  roomTypeCode?: string;
}

export interface AvailableRoomOption {
  roomTypeId: string;
  name: string;
  availableCount: number;
  pricePerNightCents: number;
  totalNights: number;
  totalPriceCents: number;
}
