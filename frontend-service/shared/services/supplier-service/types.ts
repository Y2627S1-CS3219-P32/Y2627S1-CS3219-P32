// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
// Scope: Types for the existing supplier API response. Author review: pending.
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

export interface SupplierFilters {
  name?: string;
  type?: string;
}
