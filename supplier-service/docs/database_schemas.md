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
- closing_hrs same type as opening_hrs
Composite key: supplier_id, day, opening_hrs

Did not put a check constraint on opening_hrs < closing_hrs to provide flexibility on overnight hours (example 22:00 - 02:00). Non-overlapping times will be checked in the service layer as well.

Operating hours: 0 is Sunday, in line with postgres and javascript.

Missing day means it's closed.
