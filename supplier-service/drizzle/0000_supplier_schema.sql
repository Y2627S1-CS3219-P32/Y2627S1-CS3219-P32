-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
-- Scope: Drizzle-generated migration from the student-defined schema.
-- Author review: Checked for consistency with the database specification md file.
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "operating_hours" (
	"supplier_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"opening_hrs" time NOT NULL,
	"closing_hrs" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_hours_supplier_id_day_opening_hrs_pk" PRIMARY KEY("supplier_id","day","opening_hrs"),
	CONSTRAINT "operating_hours_day_check" CHECK ("operating_hours"."day" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"supplier_type_id" uuid NOT NULL,
	"location_description" varchar(256),
	"building_id" uuid,
	"floor" varchar(256),
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"is_active" boolean NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_latitude_check" CHECK ("suppliers"."latitude" between -90 and 90),
	CONSTRAINT "suppliers_longitude_check" CHECK ("suppliers"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_supplier_type_id_types_id_fk" FOREIGN KEY ("supplier_type_id") REFERENCES "public"."types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;
