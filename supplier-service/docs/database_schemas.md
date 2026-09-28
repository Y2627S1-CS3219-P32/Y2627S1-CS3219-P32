# Database Schema

Columns are by default `NOT NULL` unless stated otherwise.
Tables will by default have `created_at` and `updated_at` columns. updated_at should be updated with `.$onUpdate(() => new Date())`
Ids are UUID by default

suppliers
- id (PK)
- name varchar(256)
- supplier_type_id references types(id)
- location_description (nullable) varchar(256)
- building_id (nullable) references buildings(id)
- floor, (nullable) varchar(256) (e.g. "B2") 
- latitude decimal(9,6)
- longitude decimal(9,6)
- is_active boolean
- image_url text (nullable)

check constraints:
latitude between -90 and 90
longitude between -180 and 180

types
- id (PK)
- name (unique) varchar(256)
Considerations: Using pg enums for this. However, harder to extend.

buildings
- id (PK)
- name (unique) varchar(256)

operating_hours
- supplier_id
- day (0 - 6) int, add check constraint
- opening_hrs time
- closing_hrs same type as opening_hrs (check constraint: opening_hrs < closing_hrs)
Composite key: supplier_id and day.

Some considerations with this composite key is that it's not possible to have break times on this service. However, the item that the requestor wants the courier to pick up has already been purchased, so it's deemed to be out of scope.
