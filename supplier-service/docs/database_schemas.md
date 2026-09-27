# Database Schema

Columns are by default `NOT NULL` unless stated otherwise.
Tables will by default have `created_at` and `updated_at` columns.

suppliers
- id (PK)
- name
- supplier_type_id references types(id)
- location_description (nullable)
- building_id (nullable) references buildings(id)
- floor, string (e.g. "B2") (nullable)
- latitude
- longitude
- is_active
- image_url (nullable)

types
- id (PK)
- name (unique)
Considerations: Using pg enums for this. However, harder to extend.

buildings
- id (PK)
- name (unique)

operating_hours
- supplier_id
- day (0 - 6)
- opening_hrs (e.g. 0800hrs)
- closing_hrs
Composite key: supplier_id and day.

Some considerations with this composite key is that it's not possible to have break times on this service. However, the item that the requestor wants the courier to pick up has already been purchased, so it's deemed to be out of scope.
Operating hours starting from 0000hrs and ending at 2359hrs signifies full-day opening hours
