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
}

// POST /suppliers takes the same body as PUT, and GET /types and GET /buildings
// return these references (Claude Code (Opus 5.5), 2026-09-30; author review: Pending).
export type SupplierCreate = SupplierUpdate;

export interface SupplierReference {
  id: string;
  name: string;
}

export interface SupplierFilters {
  name?: string;
  type?: string;
}
