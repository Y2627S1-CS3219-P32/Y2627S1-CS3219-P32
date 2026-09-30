// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Types for the existing supplier API response. Author review: Done.
export interface Supplier {
  id: string;
  name: string;
  type: string;
  buildingName: string | null;
  locationDescription: string | null;
  floor: string | null;
  latitude: string;
  longitude: string;
  isActive: boolean;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  isOpen: boolean;
}

// Body of PUT /suppliers/:id (Claude Code (Opus 5.5), 2026-09-29; author review: Done).
export interface SupplierUpdate {
  name: string;
  type: string;
  buildingName: string | null;
  floor: string | null;
  locationDescription: string | null;
  latitude: string;
  longitude: string;
  imageUrl: string | null;
  // Omitted keeps the current value (Claude Code (Opus 5.5), 2026-09-30; author review: Pending).
  isActive?: boolean;
}

// One operating period. day is 0 (Sunday) to 6 (Saturday); times are "HH:MM", and
// closingHrs may be "24:00". A closing time at or before the opening time runs past
// midnight (Claude Code (Opus 5.5), 2026-09-30; author review: Pending).
export interface OperatingPeriod {
  day: number;
  openingHrs: string;
  closingHrs: string;
}

// POST /suppliers takes the same body as PUT plus its operating hours, and GET /types
// and GET /buildings return these references (Claude Code (Opus 5.5), 2026-09-30;
// author review: Done; operatingHours: Pending).
export interface SupplierCreate extends SupplierUpdate {
  operatingHours: OperatingPeriod[];
}

export interface SupplierReference {
  id: string;
  name: string;
}

export interface SupplierFilters {
  name?: string;
  type?: string;
}
