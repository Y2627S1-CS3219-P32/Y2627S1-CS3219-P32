/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Parsing and applying user-events and supplier-events to the local copies
 * (users: id, display name, role, soft delete; suppliers: append-only versions
 * without imageUrl), and parsing saga commands from order-commands.
 * Author review: Pending.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { supplierVersions, users, type OperatingPeriod } from "../db/schema.js";
import { UUID_PATTERN } from "../orders/input.js";
import { SAGA_COMMANDS, type SagaCommandType } from "../orders/write.js";

export class InvalidMessageError extends Error {}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidMessageError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new InvalidMessageError(`${what} must be a positive integer`);
  return value;
}

function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new InvalidMessageError(`${what} must be a UUID`);
  return value.toLowerCase();
}

function string(value: unknown, what: string): string {
  if (typeof value !== "string") throw new InvalidMessageError(`${what} must be a string`);
  return value;
}

function nullableString(value: unknown, what: string): string | null {
  return value === null ? null : string(value, what);
}

// user-events: { type, eventId, version, user: {...} } or { type: "user.deleted", userId }.
// Only id, displayName and role are kept; the password hash is never stored.
export async function applyUserEvent(message: unknown): Promise<void> {
  const event = record(message, "user event");
  const version = positiveInteger(event.version, "version");

  if (event.type === "user.deleted") {
    const userId = positiveInteger(event.userId, "userId");
    // A deletion that arrives first is stored as a tombstone so the older creation is skipped.
    await db.insert(users).values({ id: userId, version, deletedAt: new Date() })
      .onConflictDoUpdate({
        target: users.id,
        set: { version, deletedAt: sql`now()` },
        setWhere: sql`${users.version} < ${version}`,
      });
    return;
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    throw new InvalidMessageError(`Unknown user event type: ${String(event.type)}`);
  }
  const user = record(event.user, "user");
  const values = {
    id: positiveInteger(user.id, "user.id"),
    displayName: string(user.displayName, "user.displayName"),
    role: string(user.role, "user.role"),
    version,
    deletedAt: null,
  };
  await db.insert(users).values(values)
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: values.displayName, role: values.role, version, deletedAt: null },
      setWhere: sql`${users.version} < ${version}`,
    });
}

function operatingHours(value: unknown): OperatingPeriod[] {
  if (!Array.isArray(value)) throw new InvalidMessageError("supplier.operatingHours must be an array");
  return value.map((item, index) => {
    const period = record(item, `operatingHours[${index}]`);
    if (typeof period.day !== "number" || !Number.isInteger(period.day) || period.day < 0 || period.day > 6) {
      throw new InvalidMessageError(`operatingHours[${index}].day must be 0-6`);
    }
    return {
      day: period.day,
      openingHrs: string(period.openingHrs, `operatingHours[${index}].openingHrs`),
      closingHrs: string(period.closingHrs, `operatingHours[${index}].closingHrs`),
    };
  });
}

// supplier-events: every event appends a version; redeliveries of a version are ignored.
export async function applySupplierEvent(message: unknown): Promise<void> {
  const event = record(message, "supplier event");
  const version = positiveInteger(event.version, "version");

  if (event.type === "supplier.deleted") {
    await db.insert(supplierVersions)
      .values({ supplierId: uuid(event.supplierId, "supplierId"), version, deleted: true })
      .onConflictDoNothing();
    return;
  }

  if (event.type !== "supplier.created" && event.type !== "supplier.updated") {
    throw new InvalidMessageError(`Unknown supplier event type: ${String(event.type)}`);
  }
  const supplier = record(event.supplier, "supplier");
  if (typeof supplier.isActive !== "boolean") throw new InvalidMessageError("supplier.isActive must be a boolean");
  await db.insert(supplierVersions).values({
    supplierId: uuid(supplier.id, "supplier.id"),
    version,
    deleted: false,
    name: string(supplier.name, "supplier.name"),
    type: string(supplier.type, "supplier.type"),
    buildingName: nullableString(supplier.buildingName, "supplier.buildingName"),
    floor: nullableString(supplier.floor, "supplier.floor"),
    locationDescription: nullableString(supplier.locationDescription, "supplier.locationDescription"),
    latitude: string(supplier.latitude, "supplier.latitude"),
    longitude: string(supplier.longitude, "supplier.longitude"),
    isActive: supplier.isActive,
    operatingHours: operatingHours(supplier.operatingHours),
    // imageUrl is deliberately not stored.
  }).onConflictDoNothing();
}

// order-commands from the saga orchestrator: { commandId, type, orderId }.
export function parseSagaCommand(message: unknown): { commandId: string; type: SagaCommandType; orderId: string } {
  const command = record(message, "command");
  if (typeof command.type !== "string" || !Object.hasOwn(SAGA_COMMANDS, command.type)) {
    throw new InvalidMessageError(`Unknown command type: ${String(command.type)}`);
  }
  return {
    commandId: uuid(command.commandId, "commandId"),
    type: command.type as SagaCommandType,
    orderId: uuid(command.orderId, "orderId"),
  };
}
