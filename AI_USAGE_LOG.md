<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Record this session's AI assistance. 
Author review: Checked for correctness. -->

# AI usage log (General)

## 2026-09-30: Cloud Build and Cloud Run deployment scripts

- Tool: Claude Code (Opus 5.5). Mode: Boilerplate generation (deployment config) and verification.
- Exact prompt: `yes go ahead, sg sounds good, pull from main and go on a branch first`
  (following a discussion about the database size, Secret Manager usage, ingress/egress, and
  internal vs public services).
- Key response: Added a Cloud Build config that builds and pushes the frontend, user,
  supplier, and supplier tooling images to Artifact Registry (`asia-southeast1`, repository
  `foc`); a `.gcloudignore`; and `deploy.sh` with one-time setup (Cloud SQL PostgreSQL,
  databases, Secret Manager secrets, IAM, Private Google Access), migration jobs, service
  deployment, and a supplier seed job.
- Affected files: `cloudbuild.yaml`, `.gcloudignore`, `deploy.sh`, `README.md`, and this log.
- Verification: `gcloud builds submit --config cloudbuild.yaml` succeeded and pushed all four
  images; `bash -n deploy.sh` passed. `deploy.sh` has not yet been run against GCP.
- Author review: Done.

## 2026-09-30: Supplier database over Cloud SQL private IP

- Tool: Claude Code (Opus 5.5). Mode: Debugging and implementation.
- Exact prompt: `We couldn't load the suppliers. Please try again in a moment.`
- Key response: Diagnosed from Cloud Run logs that supplier-service's all-traffic VPC egress
  also routed its Cloud SQL connector traffic, which could not reach the instance's public IP.
  After the student chose Cloud SQL private IP over Cloud NAT, updated `deploy.sh` to set up
  Private Service Access, attach the instance to the VPC, and connect supplier-service and its
  migrate/seed jobs to the private IP; user-service keeps the Cloud SQL connector.
- Affected files: `deploy.sh` and this log.
- Verification: redeployed with `./deploy.sh`; `supplier-migrate` connected over the private IP
  and the student confirmed the supplier directory loads on the deployed frontend.
- Author review: Pending.


# AI usage log (User Service)

## 2026-10-15: User-service Pub/Sub event architecture

- Tool: Copilot SDK in VS Code. Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `I have decided on this architecture for the user service: I want to use event-driven architecture to store user information, creations, deletions, so that coupling is minimised. This project uses GCP and I want to use pubsub as my event stream. Do the following: Add a pubsub emulator in this docker environment for local dev. Modify the cloud script to handle pubsub. Make my user service emit events for state changes. Create a worker to ingest events and update the local PostgreSQL database of the user service.`
- Key response:
  - Added the Pub/Sub emulator and event worker to local Docker Compose, and
    updated the Cloud deployment script to provision the topic and an
    authenticated push subscription.
  - Changed registration, administrator bootstrap and CRUD, and self-service
    profile/password updates to publish versioned user-created, user-updated,
    and user-deleted events. Events contain password hashes, not plaintext
    passwords.
  - Added a worker that applies events transactionally to the PostgreSQL
    projection and ignores stale or duplicate deliveries.
  - Documented the asynchronous projection behavior and local/cloud setup.
- Affected files: `README.md`, `AI_USAGE_LOG.md`, `compose.yaml`,
  `compose.dev.yaml`, `deploy.sh`, `user-service/README.md`,
  `user-service/package.json`, `user-service/package-lock.json`,
  `user-service/src/db/schema.ts`,
  `user-service/src/repositories/users.repository.ts`,
  `user-service/src/services/auth.service.ts`,
  `user-service/src/services/users.service.ts`,
  `user-service/src/events/user-events.ts`,
  `user-service/src/events/parse-user-event.ts`,
  `user-service/src/events/parse-user-event.test.ts`, and
  `user-service/src/worker.ts`.
- Verification: user-service tests passed (9/9), strict TypeScript checking,
  Compose configuration validation, `bash -n deploy.sh`, and Drizzle schema
  migration-plan generation passed. A live Compose end-to-end test was not run
  because the Docker daemon was unavailable.
- Author review: Pending.

## 2026-10-01: Editing operating hours

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `editing of operating hours should also be possible from the edit screen.`
- Key response:
  - `GET /suppliers` returns each supplier's `operatingHours` (as `HH:MM`,
    sorted by day and opening time). `PUT /suppliers/:id` accepts an optional
    `operatingHours` array, validated as for POST; when sent, it replaces all of
    the supplier's hours in the same transaction as the row update, and when
    omitted the hours are kept.
  - The edit dialog reuses the operating hours picker, preselecting the matching
    preset or opening the custom editor with the supplier's current hours.
- Affected files: `supplier-service/src/operating-hours-input.ts`,
  `supplier-service/src/index.ts`, `supplier-service/test/suppliers.test.mjs`,
  `supplier-service/README.md`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/app/services/supplier-service/components/OperatingHoursPicker.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCreateDialog.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierEditDialog.vue`,
  and this log.
- Verification: supplier-service typecheck and route tests (27/27) and the
  frontend Nuxt typecheck passed.
- Author review: Pending.

## 2026-09-30: Operating hours on supplier creation

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `can you implement operating hours upon supplier creation? provide a set of pre-defined selections (open 24/7, 9-5pm etc and allow for a custom field that allows the user to add day by day and hour by hour). refer to the schema.`
- Key response:
  - `POST /suppliers` accepts an optional `operatingHours` array of
    `{ day, openingHrs, closingHrs }`, following the existing `operating_hours`
    schema (0 is Sunday, overnight periods allowed, missing day means closed).
    Periods are validated in the service layer, including the documented
    non-overlap check, and inserted in the same transaction as the supplier.
  - The add-supplier dialog has an operating hours picker with presets (open
    24/7, every day 9am–5pm, weekdays 9am–5pm, every day 8am–10pm, no hours) and
    a custom editor with per-day open/closed and 24-hour toggles, multiple
    periods per day, and copying one day's hours to every day.
- Affected files: `supplier-service/src/operating-hours-input.ts`,
  `supplier-service/src/index.ts`, `supplier-service/test/suppliers.test.mjs`,
  `supplier-service/README.md`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/app/services/supplier-service/components/OperatingHoursPicker.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCreateDialog.vue`,
  and this log.
- Verification: supplier-service typecheck and route tests (25/25) and the
  frontend Nuxt typecheck passed.
- Author review: Pending.

## 2026-09-30: Redirect to first-administrator setup

- Tool: ChatGPT (GPT-6). Mode: Implementation and verification.
- Exact prompt: `when there is no admin, immediately reroute to the setup page`
- Key response: Added global route middleware that checks the existing
  bootstrap-availability endpoint and redirects visitors to `/setup/admin`
  while first-admin setup is available. It leaves the setup route accessible
  and propagates service failures other than the expected unavailable 404.
- Affected files: `frontend-service/app/middleware/bootstrap.global.ts` and
  this log.
- Verification: frontend Nuxt typecheck and `git diff --check` passed.
- Author review: Done.

## 2026-09-30: Administrator user management

- Tool: ChatGPT (GPT-6). Mode: Implementation and verification.
- Exact prompt: `under /admin/users, insert UI to remove a user, promote a user to admin, and demote an admin to user; prevent the current admin from demoting or deleting themselves.`
- Key response:
  - Added administrator-only Nuxt proxy routes for updating a user's role and
    deleting a user, forwarding authentication and service errors.
  - Added role promotion/demotion and deletion controls to `/admin/users`,
    including confirmations, pending states, success/error feedback, and
    hiding self-demotion and self-deletion actions.
  - Enforced self-demotion prevention in the user service, alongside its
    existing self-deletion and last-administrator protections.
- Affected files: `AI_USAGE_LOG.md`,
  `frontend-service/app/pages/admin/users.vue`,
  `frontend-service/server/api/user-service/users/[id].put.ts`,
  `frontend-service/server/api/user-service/users/[id].delete.ts`,
  `user-service/src/administrator-constraints.ts`,
  `user-service/src/auth.test.ts`,
  `user-service/src/controllers/users.controller.ts`,
  `user-service/src/services/users.service.ts`.
- Verification: user-service tests (6/6), frontend Nuxt typecheck, backend
  TypeScript compilation, and `git diff --check` passed.
- Author review: Done.

## 2026-09-30: Root environment example

- Tool: ChatGPT (GPT-6). Mode: Implementation and documentation.
- Exact prompt: `add an env example to the root`
- Key response: Added a root `.env.example` for the Compose JWT configuration
  and documented copying it to `.env` and replacing the JWT secret.
- Affected files: `.env.example`, `README.md`.
- Author review: Pending.

## 2026-09-30: Migrating user-service storage to PostgreSQL

- Tool: ChatGPT (GPT-6). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `Migrate user service sqlite to postgresql. Dont worry about the existing db. Treat it as a fresh start.`
- Key response:
  - Replaced the SQLite schema and synchronous database calls with PostgreSQL,
    Drizzle's node-postgres driver, and asynchronous repository/service/controller
    flows.
  - Added PostgreSQL startup seeding, case-insensitive unique display-name
    indexing, and explicit PostgreSQL unique-constraint handling.
  - Added a Compose PostgreSQL database and schema migration job; the user
    service waits for the migration to complete before starting.
  - Updated Docker, package dependencies, setup documentation, and the demo
    seed email address.
- Affected files: `compose.yaml`, `user-service/Dockerfile`,
  `user-service/README.md`, `user-service/drizzle.config.ts`,
  `user-service/package.json`, `user-service/package-lock.json`,
  `user-service/src/controllers/auth.controller.ts`,
  `user-service/src/controllers/users.controller.ts`, `user-service/src/db.ts`,
  `user-service/src/db/schema.ts`, `user-service/src/errors.ts`,
  `user-service/src/index.ts`, `user-service/src/middleware/authorization.ts`,
  `user-service/src/repositories/users.repository.ts`,
  `user-service/src/services/auth.service.ts`,
  `user-service/src/services/users.service.ts`, and this log.
- Verification: user-service tests and TypeScript checks passed; Compose
  configuration validation passed.
- Author review: Done.

## 2026-09-30: Self-service account updates

- Tool: ChatGPT (GPT-6). Mode: Implementation, validation, and documentation.
- Exact prompt: `FR6.2 allow users to change display name according to FR; FR6.3 change email according to FR; FR6.4 change password according to FR; FR6.5 reject new passwords equal to old password.`
- Key response:
  - Added authenticated `PATCH /me` and a frontend proxy for self-service
    updates to display name, university email, and password.
  - Reused the registration validators and uniqueness constraints for profile
    changes; email changes require a matching confirmation.
  - Password changes require the current password, enforce password policy,
    and reject reuse of the existing password.
  - Added profile edit fields and success/error feedback.
- Affected files: `frontend-service/app/pages/profile.vue`,
  `frontend-service/server/api/user-service/me.patch.ts`,
  `user-service/README.md`, `user-service/src/controllers/auth.controller.ts`,
  `user-service/src/repositories/users.repository.ts`,
  `user-service/src/routes/auth.routes.ts`,
  `user-service/src/services/auth.service.ts`, and this log.
- Verification: user-service tests passed (5/5), backend and frontend typechecks
  passed, and an HTTP integration check confirmed profile/email updates, same-
  password rejection, current-password verification, password-policy validation,
  and successful login with the changed password.
- Author review: Done.

## 2026-09-30: Separating profile editing

- Tool: ChatGPT (GPT-6). Mode: Implementation and verification.
- Exact prompt: `separate out the edit page`
- Key response:
  - Made `/profile` a read-only account summary with an Edit profile link.
  - Moved the existing display-name, email, and password form to the
    authenticated `/profile/edit` page, with links back to the profile.
  - Corrected route rendering by making the profile summary an index page,
    so Nuxt resolves the edit page as a sibling rather than a nested page
    without a parent `<NuxtPage>` outlet.
- Affected files: `frontend-service/app/pages/profile/index.vue`,
  `frontend-service/app/pages/profile/edit.vue`, and this log.
- Verification: frontend Nuxt typecheck and production build passed; browser
  navigation was checked after rebuilding Compose.
- Author review: Done.

## 2026-09-30: Bootstrapping the first administrator

- Tool: ChatGPT (GPT-6). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `Find a way to improve the creation of the first admin. Remove seeding of user data directly, and bootstrap it instead`
- Design choice selected: one-time setup page protected by a configured bootstrap secret.
- Key response:
  - Removed all automatic user seeding from user-service startup and removed
    demo credentials from the login form.
  - Added a first-admin setup page and secret-protected bootstrap endpoint.
    The endpoint serializes concurrent attempts and refuses setup after an
    administrator already exists; regular account/email/password validation
    applies to the created account.
  - Follow-up: removed the setup link from sign-in and made the setup route
    return 404 when bootstrap is disabled or an administrator already exists.
  - Documented configuration and recommended removing the bootstrap secret
    from the runtime environment after setup.
- Affected files: `compose.yaml`, `frontend-service/app/pages/login.vue`,
  `frontend-service/app/pages/setup/admin.vue`,
  `frontend-service/server/api/user-service/bootstrap.post.ts`,
  `frontend-service/server/api/user-service/bootstrap.get.ts`,
  `frontend-service/server/services/user-service/errors.ts`,
  `user-service/README.md`, `user-service/src/config.ts`, `user-service/src/db.ts`,
  `user-service/src/controllers/auth.controller.ts`, `user-service/src/routes/auth.routes.ts`,
  `user-service/src/services/auth.service.ts`, and this log.
- Verification: user-service tests (5/5), backend and frontend typechecks,
  frontend production build, and Compose config validation passed. A disposable
  fresh PostgreSQL integration test confirmed missing/wrong secret rejection,
  registration validation, successful first-admin creation, rejection of a
  second bootstrap, and successful administrator login. Follow-up route
  verification confirmed setup availability changes from HTTP 200 to HTTP 404
  after the first admin, repeated bootstrap POST returns 404, and the sign-in
  page no longer displays a setup link.
- Author review: Done.

## 2026-09-30: Account registration validation and display names

- Tool: ChatGPT (GPT-6). Mode: Implementation, tests, documentation, and verification.
- Exact prompts:
  - `FR3: allow users to register with a display name, university email address, and password; enforce the specified display-name, email-domain, uniqueness, and password requirements, preferably server-side.`
  - `change it so that displaynames have no spaces, only -`
  - `add AI acknowledgements`
- Key response:
  - Added a separate display-name field while retaining the existing account name.
  - Enforced display-name format and case-insensitive uniqueness, the allowed
    email domains, and password complexity and length in the user service.
  - Updated the signup and profile interfaces, added a SQLite migration for
    existing users, and documented the registration rules.
  - Revised display names to allow letters and hyphens only, with no spaces;
    the startup migration normalizes legacy values and generates fallbacks when
    existing values cannot be retained.
  - Added inline AI assistance disclosures to the changed and new implementation
    files and updated the user-service documentation disclosure.
- Affected files: `frontend-service/app/pages/profile.vue`,
  `frontend-service/app/pages/signup.vue`,
  `frontend-service/app/services/user-service/components/UserCard.vue`,
  `frontend-service/shared/services/user-service/types.ts`,
  `user-service/README.md`, `user-service/src/auth.test.ts`,
  `user-service/src/db.ts`, `user-service/src/db/schema.ts`,
  `user-service/src/errors.ts`, `user-service/src/registration-validation.ts`,
  `user-service/src/repositories/users.repository.ts`,
  `user-service/src/services/auth.service.ts`,
  `user-service/src/services/users.service.ts`, and this log.
- Verification: user-service tests passed (5/5), frontend and user-service
  typechecks passed, and SQLite migration/registration checks passed.
- Author review: Done.

# AI usage log (Supplier Service)

## 2026-10-15: CRUD for supplier types and buildings

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `add CRUD for supplier buildings and types. this building and types should be two buttons somewhere on the add supplier modal (bottom left). clicking on those buttons will display a modal that has a textbox for the user to add their buildings/types.`
- Design decisions made by the student: CRUD for types and buildings; two buttons at the
  bottom left of the add-supplier modal, each opening a modal with a textbox to add entries.
- Choices made by Claude Code, awaiting student review: administrator-only
  `POST /types`, `PUT /types/:id`, `DELETE /types/:id` (and the same for `/buildings`)
  with a `{ "name" }` body; duplicate names and deleting an entry still used by a
  supplier return 409; a rename applies to every supplier using the entry.
- Key response:
  - supplier-service: one router serves both tables (`GET` moved there unchanged).
    The UUID parameter check moved to `params.ts` for reuse.
  - Frontend: Nuxt proxy routes and client calls; a management dialog listing entries
    with add, rename, and delete. Closing it reloads the add-supplier dropdowns, and
    changes reload the supplier list.
- Affected files: `supplier-service/src/index.ts`, `supplier-service/src/params.ts`,
  `supplier-service/src/reference-routes.ts`, `supplier-service/src/supplier-input.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/server/services/supplier-service/client.ts`,
  `frontend-service/server/api/supplier-service/types.post.ts`,
  `frontend-service/server/api/supplier-service/types/[id].put.ts`,
  `frontend-service/server/api/supplier-service/types/[id].delete.ts`,
  `frontend-service/server/api/supplier-service/buildings.post.ts`,
  `frontend-service/server/api/supplier-service/buildings/[id].put.ts`,
  `frontend-service/server/api/supplier-service/buildings/[id].delete.ts`,
  `frontend-service/app/services/supplier-service/components/SupplierReferenceDialog.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCreateDialog.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  and this log.
- Verification: supplier-service `npm run typecheck` passed, and `npm test` passed
  30/30. Frontend `npm run typecheck` passed. The UI was not exercised in a browser.
- Author review: Pending.

## 2026-09-30: Supplier PUT and DELETE changed to plain CRUD

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `turns out the versioned edit/delete thing was for another service. just make it work like a normal crud operation where the writes/deletes update the database directly, no need to create copies. isActive is just a simple toggle (admin sees all, student sees only active ones)`
- Design decisions made by the student: PUT and DELETE write directly to the
  database with no copies; `isActive` is a plain toggle, with admins seeing all
  suppliers and students only active ones.
- Key response:
  - supplier-service:
    - PUT updates the row in place (same `id`, hours untouched). It accepts an
      optional boolean `isActive`; omitting it keeps the current value.
      Inactive suppliers can now be edited (the 409 is gone).
    - DELETE removes the operating hours and then the supplier in one
      transaction. Missing ids return 404 (the 409 is gone).
    - POST accepts the same optional `isActive`, defaulting to active.
  - Frontend: the edit dialog has an "Active" checkbox and no longer mentions
    versions. Inactive cards now show the "⋯" menu. The delete confirmation
    says the delete is permanent and points to the Active toggle.
- Affected files: `supplier-service/src/index.ts`,
  `supplier-service/src/supplier-input.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/server/api/supplier-service/suppliers/[id].delete.ts`,
  `frontend-service/app/services/supplier-service/components/SupplierEditDialog.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCard.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  and this log.
- Verification: supplier-service `npm run typecheck` passed, and `npm test`
  passed 23/23. Frontend `npm run typecheck` passed.
- Author review: Pending.

## 2026-09-30: Automatic migrations during Docker Compose startup

- Tool: ChatGPT (GPT-6). Mode: Debugging, implementation, documentation, and verification.
- Exact prompt: `supplier-service-1 | cause: error: relation "suppliers" does not exist ... This happens when I run docker compose up --build.`
- Key response:
  - Diagnosed that PostgreSQL health only verified connectivity and that Compose
    started the supplier API without applying its Drizzle migration.
  - Added a one-shot Compose migration service and made the API wait for its
    successful completion. Included migration files in the tooling image.
  - Documented automatic Compose migrations and the separate manual migration
    step for direct npm startup.
- Affected files: `compose.yaml`, `supplier-service/Dockerfile`,
  `supplier-service/README.md`.
- Author review: Done.

## 2026-09-30: Administrator POST /suppliers and add-supplier form

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `next, POST. this is where the button you saw previously in the mock up was supposed to be wired to. the name, floor, and imageUrl should be an input field, supplier type a dropdown (from the existing supplier types), location_description a textarea, building_id also a dropdown from existing building types. latitude and longitude may obtain the user's location through the geolocation api as a simplified implementation first. again, this method is only accessible by admin users.`
- Design decisions made by the student (asked before implementation, because
  AGENTS.md reserves interface decisions for the student):
  - The dropdown lists come from two new endpoints, `GET /types` and
    `GET /buildings`, each returning `[{ id, name }]` and requiring login.
  - The POST body uses the same shape as PUT, referring to the type and building
    by name.
- Key response:
  - supplier-service:
    - Added `GET /types`, `GET /buildings`, and an admin-only `POST /suppliers`.
    - POST reuses PUT's body validation. It returns 201 with the new supplier,
      which is active and has no operating hours.
    - Moved the type/building name lookup into a `toSupplierRow` helper shared by
      POST and PUT.
  - Frontend:
    - Added Nuxt proxy routes for `/types`, `/buildings`, and `POST /suppliers`.
    - Added the mockup's round "+" button, shown to admins only. On phones it
      sits above the bottom navigation.
    - The "+" button opens `SupplierCreateDialog`:
      - Name, floor, and image URL are text inputs.
      - Type and building are dropdowns. Building includes a "No building" option.
      - Location description is a textarea.
      - A "Use my location" button fills latitude and longitude from the browser
        geolocation API. The coordinate fields stay editable as a fallback.
- Affected files: `supplier-service/src/index.ts`, `supplier-service/src/supplier-input.ts`
  (header only), `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`,
  `frontend-service/server/services/supplier-service/client.ts`,
  `frontend-service/server/api/supplier-service/suppliers.post.ts`,
  `frontend-service/server/api/supplier-service/types.get.ts`,
  `frontend-service/server/api/supplier-service/buildings.get.ts`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/app/services/supplier-service/components/SupplierCreateDialog.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `README.md`, and this log.
- Verification:
  - supplier-service `npm run typecheck` passed, and `npm test` passed 20/20
    (4 new tests).
  - Frontend `npm run build` and `npm run typecheck` passed.
  - End to end through Docker:
    - Without a login, POST returned 401. A student got 403.
    - An admin POST with an unknown building got 400, and a valid one got 201.
    - The student could see the new supplier.
  - Headless Edge with an emulated geolocation:
    - The "+" button appeared for the admin but not the student.
    - The dropdowns listed 4 types and 16 buildings, and the location
      description was a textarea.
    - "Use my location" filled the coordinates, and submitting added the card.
  - The test suppliers were deleted afterwards.
- Author review: Done.

## 2026-09-29: Supplier authentication and administrator PUT/DELETE

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `okay. lets go back to the supplier service backend. 1) revise GET such that it redirects to the login screen with the appropriate error code (403?) if a user is unauthenticated. 2) Implement DELETE and PUT. implement it such that admin users can hover over each card and see a horizontal "..." that they can click on in order to perform these operations. their credentials are also checked on the backend. for DELETE and PUT, it's a soft delete/put, where those rows are marked inactive (isActive=false). regular users (role = student) cannot see inactive rows, but admins can. we're deferring POST on purpose, do not implement it at this point fo time.`
- Design decisions made by the student (asked before implementation, because
  AGENTS.md reserves them for the student):
  - supplier-service resolves the caller by forwarding the bearer token to
    user-service `GET /me`.
  - PUT is a versioned update: the old row becomes inactive and a new active row
    is inserted.
  - An unauthenticated GET returns 401, not 403.
  - PUT can edit name, type, location fields, and image URL.
- Key response:
  - supplier-service:
    - Added `requireAuthentication` and `requireAdministrator` middleware, a
      `{ error }` JSON error handler, and PUT body validation.
    - GET now hides inactive suppliers from non-admins.
    - PUT runs in a transaction. It locks the row, deactivates it, inserts the
      edited version, and copies its operating hours.
    - DELETE soft-deletes (sets `isActive: false`). Unknown ids return 404, and
      inactive ones return 409.
  - Frontend:
    - The Nuxt proxy routes forward the login cookie as a bearer token, and pass
      400/401/403/404/409 through.
    - `/suppliers` now requires login, and a 401 redirects to `/login`.
    - Admins get a hover-revealed "⋯" menu on each active card (Edit opens a
      dialog, Delete asks for confirmation). Inactive cards are faded.
  - Compose: added `USER_SERVICE_BASE_URL`. POST was not implemented.
- Affected files: `supplier-service/src/index.ts`, `supplier-service/src/auth.ts`,
  `supplier-service/src/errors.ts`, `supplier-service/src/supplier-input.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`,
  `frontend-service/server/services/supplier-service/client.ts`,
  `frontend-service/server/api/supplier-service/suppliers.get.ts`,
  `frontend-service/server/api/supplier-service/suppliers/[id].put.ts`,
  `frontend-service/server/api/supplier-service/suppliers/[id].delete.ts`,
  `frontend-service/shared/services/supplier-service/types.ts`,
  `frontend-service/app/pages/suppliers.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCard.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierEditDialog.vue`,
  `compose.yaml`, `README.md`, and this log.
- Verification:
  - supplier-service `npm run typecheck` passed, and `npm test` passed 16/16
    (9 new tests, using a stub user-service).
  - Frontend `npm run build` and `npm run typecheck` passed.
  - End to end through Docker, against a temporary supplier that was removed
    afterwards:
    - Logged out, the API returned 401 and `/suppliers` redirected to `/login`.
    - A student got 403 on PUT and DELETE.
    - An admin PUT with an unknown type got 400. A valid admin PUT created a new
      version with copied hours.
    - The student saw only the new version; the admin saw both.
    - DELETE returned 204, and repeating it returned 409.
  - Headless Edge showed the "⋯" menu and edit dialog for the admin, and no menu
    for the student.
- Author review: Done.

## 2026-09-29: Supplier screen restyled after the original mockup

- Tool: Claude Code (Opus 5.5). Mode: Implementation and verification.
- Exact prompt: `this was the original design of the supplier screen. could we keep the current search functionality, add the image on the right of every card element from the mockup and add the location description from the mockup too?`
  (with a screenshot of the mockup)
- Key response: Replaced the three-column card grid with the mockup's layout: a
  centred "Suppliers" title and a single column of cards. Each card shows the name,
  a status badge and a type badge, then a pin with the location. The supplier photo
  (or initials) sits on the right of each card. The location reads
  `Building · Level N (description)` and links to Google Maps. The name/type search
  was kept, restyled in the blue palette the other pages use. The status badge shows
  Open now, Closed now, or Inactive, not the mockup's Active/Inactive. The mockup's
  "+" button was not added.
- Affected files: `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCard.vue`, and
  this log.
- Verification: `npm run typecheck` passed. Headless Edge screenshots at 1280px and
  390px showed the list layout, with no horizontal overflow on the phone width.
- Author review: Done, description looks like what I described.

## 2026-09-29: Tailwind refactor of the frontend supplier module

- Tool: Claude Code (Opus 5.5). Mode: Refactoring and verification.
- Exact prompt: `refactor the frontend service supplier module to use tailwind`
- Key response: Replaced the supplier directory's custom CSS classes with Tailwind
  utilities in `SupplierDirectory.vue` and `SupplierCard.vue`, keeping the original
  breakpoints (480/700/1000/1500px) as arbitrary variants. Reduced `main.css` to a
  `@theme` font and a `@layer base` block, and removed the unused hero, header, and
  footer styles. Global element rules now sit in the base layer, so utilities on
  other pages win over them. For example, the nav links now show their own colours
  instead of `a{color:inherit}`.
- Affected files: `frontend-service/app/assets/css/main.css`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierCard.vue`, and
  this log.
- Verification: `npm run build` and `npm run typecheck` passed. Headless Edge
  screenshots of the old build and the refactor at 1440, 850, 600 and 390px were
  pixel-compared. The supplier layout matched, apart from a sub-pixel 1px shift in
  the desktop search panel.
- Author review: Done, refactor looks as expected.

## 2026-09-29: Hot reloading for development

- Tool: Claude Code (Opus 5.5). Mode: Configuration, documentation, and verification.
- Exact prompts: `how do i enable hot reloading for these services?`, then
  `help me implement the changes`
- Key response: Added `tsx` to supplier-service and `tsx watch` `dev` scripts to
  supplier-service and user-service. Added a `compose.dev.yaml` override that runs
  the backends with `tsx watch` and the frontend with `nuxt dev` (reusing the
  existing `tooling` and `build` Dockerfile stages), using Compose `develop.watch`
  to sync source edits into containers instead of bind mounts, which do not
  reliably propagate file events on Windows.
- Affected files: `compose.dev.yaml`, `supplier-service/package.json`,
  npm-generated `supplier-service/package-lock.json`, `user-service/package.json`,
  `README.md`, and this log.
- Verification: With `docker compose -f compose.yaml -f compose.dev.yaml up --build --watch`,
  all services started; editing `src/index.ts` restarted supplier-service and
  user-service; editing `frontend-service/app/app.vue` triggered a Vite HMR update.
  Test edits were reverted.
- Author review: Check for correctness.

## 2026-09-28: Frontend decoupling from supplier service

- Tool: Claude Code (Opus 5.5). Mode: Configuration, documentation, and git.
- Exact prompt: `decouple the frontend service from the supplier service first. i wish to cherrypick the commit over to another branch first`
- Key response: Removed the frontend's Compose `depends_on: supplier-service` and
  the supplier-service health check that existed only for that dependency, so the
  frontend starts on its own. Made the frontend README self-contained (startup
  notes and full AI disclosure inline, rather than linking this log, which does
  not exist on `main`). Split the work into two commits: `c383e50` adds only
  `frontend-service/` and can be cherry-picked without conflicts; `d6ea86c` wires
  the root `compose.yaml`, `README.md`, `.env.example`, and this log on `supplier`.
- Affected files: `compose.yaml`, `README.md`, `frontend-service/README.md`, and
  this log.
- Author review: Done review of these changes.
- Verification: With supplier-service stopped, the frontend started and served the
  page (200); the proxy route returned 502 and the page showed its error state.
  After restarting supplier-service, the route returned all 21 suppliers.

## 2026-09-28: Nuxt frontend verification (Codex continuation)

- Tool: Claude Code (Opus 5.5). Mode: Implementation, configuration, and verification.
- Exact prompt: `ran out of credits on codex. could you continue with this status update from it?
for context, frontend-service is being set up. The frontend’s supplier screen and server-side API forwarding are in place. It preserves the API’s open-first ordering and uses the repository’s supplier photos locally. I’m installing its dependencies and wiring Compose, then I’ll check the build, container connection, and browser layout.`
- Key response: Found that dependencies and the Compose wiring were already in
  place. `nuxt typecheck` failed because the shared supplier type imports had one
  `../` too many (the build passed since type imports are erased), so changed them
  to Nuxt's `#shared` alias. Added a follow-up note to the Codex entry below.
- Affected files: `frontend-service/app/services/supplier-service/components/SupplierCard.vue`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `frontend-service/app/services/supplier-service/composables/useSuppliers.ts`,
  `frontend-service/server/services/supplier-service/client.ts`, and this log.
- Author review: Done review of these changes.
- Verification: `npm run build` and `npm run typecheck` passed. Compose started the
  database, supplier-service, and frontend on port 3001. The Nuxt route returned
  all 21 suppliers from supplier-service over the Compose network, `?name=cafe`
  filtered correctly, and supplier photos were served locally. Headless Edge
  screenshots confirmed the three-column desktop layout (1440px) and single-column
  phone layout (390px) without horizontal overflow.


## 2026-09-28: Nuxt frontend service

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, configuration, and verification.
- Exact prompt: `build a frontend service (nuxtjs). edit the compose file, add a dependency on the supplier service. the frontend will call supplier-service on the same network. do ensure the segregation of the code on the frontend as well (separated by the services you see in the folder). you may shift the port numbers around (since supplier service is on 3000 already) to avoid clashing. the service will have its own dependencies as well, do manage that`
- Key response: Added an independent Nuxt frontend on host port 3001, with a
  service-specific supplier directory, filters, and request states. A Nuxt server
  endpoint forwards requests to supplier-service:3000 over Compose's default
  network using private runtime configuration (the Compose dependency was later removed). Added service folders for supplier,
  user, order, and credit frontend code, an independent dependency manifest and
  lockfile, and a multi-stage Dockerfile.
- Affected files: Authored files in `frontend-service/`, `compose.yaml`,
  `.env.example`, `README.md`, and this log. `frontend-service/package-lock.json`
  is npm-generated. The six files under `frontend-service/public/images/suppliers/`
  are copies of the user-supplied repository assets, not AI-generated images.
- Follow-up: Verification, a typecheck fix, and removal of the Compose dependency
  were done with Claude Code; see the two entries above.
- Author review: Done review of these frontend changes.

## 2026-09-28: Supplier response joins

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, tests, and documentation.
- Exact prompt: `perform the join to join building names and type, and reflect that in get suppliers/. supplier type id and building id should be omitted from the response`
- Key response: GET /suppliers now returns the joined `type` and `buildingName`,
  excluding `supplierTypeId` and `buildingId`. A left join preserves suppliers
  without a building and returns `buildingName: null`. Filtering and open-first
  ordering remain in place.
- Affected files: `supplier-service/src/index.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/README.md`, and
  this log. The project README links this consolidated disclosure.
- Author review: Response changes verified.
- Verification: Typecheck and build passed. All seven integration tests passed,
  including correct names from two different buildings, null building handling,
  omission of both foreign-key ID fields, filtering, and opening-time behavior.

## 2026-09-28: GET suppliers happy path

- Tool: ChatGPT / Codex (GPT-6). Mode: Implementation, tests, and documentation.
- Exact prompt: `implement the GET suppliers route. optional query parameters for name (fuzzy search) and type. implement for happy path first (200). all suppliers currently open should appear before suppliers currently closed.`
- Clarification: Asked whether fuzzy search meant case-insensitive partial
  matching or typo tolerance. Exact answer: `Case-insensitive partial match`.
- Clarification: Asked to return a JSON array of supplier fields plus `isOpen`,
  use Singapore time, include inactive suppliers as closed, and filter `type` by
  its name (e.g. Food). Exact answer: `Yes, use those defaults`.
- Key response: Added GET /suppliers with optional AND-combined name and exact
  type-name filters. Open suppliers sort first, followed by name and UUID.
  Opening status handles daily periods and previous-day overnight carryover in
  Asia/Singapore, including Saturday-to-Sunday rollover. Inactive suppliers are
  closed. Empty results return HTTP 200 with an empty array.
- Affected files: `supplier-service/src/index.ts`,
  `supplier-service/src/db/opening-hours.ts`,
  `supplier-service/test/suppliers.test.mjs`, `supplier-service/package.json`,
  `supplier-service/README.md`, `README.md`, and this log.
- Verification: Typecheck and build passed. Six integration tests passed against
  a uniquely named disposable PostgreSQL database, including HTTP filtering,
  open-first ordering, literal wildcard input, and 11 clock/period boundary cases.
  The test database was removed afterward.
- Runtime verification: Rebuilt and restarted the Compose supplier-service and
  confirmed HTTP 200 responses for unfiltered, name-only, type-only, combined,
  and no-match requests through host port 3000.
- Author review: Review done for these route changes.

## 2026-09-28: pgAdmin connection diagnosis

- Tool: ChatGPT / Codex (GPT-6). Mode: Debugging and configuration correction.
- Exact prompt: `yeah, i thought so too, but it says password is wrong`
- Key response: Windows PostgreSQL owns host port 5432. The Compose database
  had no published port. Confirmed supplier/supplier authentication against the
  container's network address with SCRAM authentication, then published the
  container on 127.0.0.1:5433 for desktop pgAdmin.
- Affected files: `compose.yaml`, `.env.example`, `supplier-service/README.md`,
  `README.md`, and this log.
- Author review: Verified connection changes are the correct fix.
- Verification: Applied the mapping with `docker compose up -d supplier-db`,
  preserving the existing volume. A Windows-host TCP connection to
  `127.0.0.1:5433` authenticated as `supplier`, connected to `suppliers`, and
  confirmed all four public tables remain present.

## 2026-09-28: COM2 seed naming

- Tool: ChatGPT / Codex (GPT-6). Mode: Seed data correction and documentation.
- Exact prompt: `standardise com2 and com 2 to COM2`
- Key response: Standardized the two building references to `COM2` and the
  printer name to `Printer @ COM2` in the seed snapshot. The seed now has 16
  distinct building names. Fixed supplier UUIDs and the source CSV are preserved.
- Affected files: `supplier-service/src/db/seed-data.ts`,
  `supplier-service/README.md`, and this log.
- Author review: Done

## 2026-09-28: Supplier seed from CSV

- Tool: ChatGPT / Codex (GPT-6).
- Mode: CSV inspection, seed implementation, documentation, and verification.
- Exact prompt: `next, i want you to take a look at ../data/csv. this file contains some seed data for the supplier service. write a seed file (compatible with the current schema) from that csv data`
- Source located at `data/csv/supplier-seed-data.csv` in this repository.
- Clarification question: The CSV has opening/closing times but no weekdays or
  active status. How should the seed fill those required details?
- Exact answer: `All suppliers active; hours every day (Sunday–Saturday)`
- Key response: Created a typed snapshot of all 21 CSV suppliers and a Drizzle
  seed script. It reuses the four type names and 17 exact building names, creates
  seven daily periods per new supplier, and uses fixed supplier UUIDs to skip
  existing seed suppliers on reruns. Writes are transactional, with a dry-run
  option that rolls back all changes.
- Conversion: Decoded Windows-1252 source data, trimmed surrounding whitespace,
  retained source names and image URLs, converted blank optional fields to null
  and HHMMhrs to database times. Coordinates retain their source precision until
  PostgreSQL rounds them to six decimal places. The source CSV is unchanged.
- Affected files: `supplier-service/src/db/seed-data.ts`,
  `supplier-service/src/db/seed.ts`, `supplier-service/package.json`,
  `supplier-service/README.md`, `README.md`, and this log.
- Author review: Seed files work as expected.
  apply to earlier work only.
- Verification: Typecheck, build, and Docker tooling build passed. Compared every
  converted field in all 21 records with the CSV, including quoted commas and
  Windows-1252 apostrophes. The CLI dry run inserted 21 suppliers and 147 periods,
  then rolled back. Database verification checked all mappings and exact decimal
  rounding, lookup reuse, and seven daily periods per supplier. A second seed
  inserted nothing and preserved edited suppliers, hours, and timestamps.
  Verified all database contents were unchanged after rollback; no seed data was
  committed during this task.

## 2026-09-28: Supplier schema implementation and migration

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Implementation of the student-defined schema, migration generation,
  migration execution, documentation, and verification.
- Exact prompt: `refer to docs/database_schemas.md. edit the schema file, generate migrations, and migrate`
- Clarification question: The notes specify UUIDs and timestamp columns but not
  their defaults or timezone. Since AGENTS.md reserves schema decisions for you,
  which should I implement? (updated_at will use your specified $onUpdate callback.)
- Exact answer: `Generated UUIDs; timestamptz with defaultNow()`
- Key response: Implemented `types`, `buildings`, `suppliers`, and
  `operating_hours`, including the documented nullability, unique names, foreign
  keys, coordinate and weekday checks, and three-column operating-hours primary
  key. Added the user-confirmed UUID and timestamp defaults and the documented
  Drizzle `$onUpdate` callback. Generated `0000_supplier_schema.sql`.
- Affected files: `supplier-service/src/db/schema.ts`,
  `supplier-service/drizzle/0000_supplier_schema.sql`, Drizzle-generated
  `supplier-service/drizzle/meta/0000_snapshot.json` and `meta/_journal.json`,
  `supplier-service/docs/database_schemas.md`, `supplier-service/README.md`,
  `README.md`, and this log. Generated JSON metadata is attributed here because
  JSON does not support header comments.
- Execution: Applied `0000_supplier_schema.sql` to the Compose `supplier-db`
  database `suppliers`. Its recorded migration hash matches the SQL file.
- Verification: Typecheck and build passed. A Drizzle transaction verified
  generated UUIDs, timestamp defaults, nullable fields, inclusive coordinate
  endpoints, overnight and multiple daily opening periods, and `$onUpdate` on
  all four tables. Thirteen invalid-input cases verified range, uniqueness,
  foreign-key, primary-key, and not-null constraints. All test records rolled
  back; all four tables contain zero records. A second generation reported no
  schema changes, and rerunning migration left one migration history entry.
- Author review: The latest schema, migration, and documentation changes await
  student review; prior review statements apply to earlier work only.

## 2026-09-28: Node globals in the Drizzle configuration

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Debugging, configuration fix, and documentation.
- Exact prompt: ``Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig -- tsconfig looks correct already, and ive restarted typescript server``
- Clarification: The user confirmed the affected file is
  `supplier-service/drizzle.config.ts`.
- Key response: Node types were installed and source typechecking passed, but
  `drizzle.config.ts` was excluded by `include: ["src/**/*.ts"]`. Included it in
  the editor/typecheck project and added a build config that preserves
  source-only compilation and the `dist/index.js` entry point.
- Affected files: `supplier-service/tsconfig.json`,
  `supplier-service/tsconfig.build.json`, `supplier-service/package.json`,
  `supplier-service/Dockerfile`, `supplier-service/README.md`, `README.md`,
  and this log.
- Verification: Typecheck now includes `drizzle.config.ts` and passes. The build
  passes and still emits `dist/index.js`. Both Docker targets build successfully.
- Author review: Check for correctness.

## 2026-09-28: Drizzle setup

- Tool: ChatGPT / Codex (GPT-6).
- Mode: Boilerplate generation, documentation, and verification.
- Exact prompt: `take a look at agents.md first. next, set up drizzle orm`
- Key response: Added Drizzle ORM with the node-postgres driver, a shared
  connection pool using `DATABASE_URL`, Drizzle Kit configuration and commands,
  an empty schema scaffold, and opt-in Docker tooling for the existing database.
  The existing schema notes leave column types and defaults unspecified;
  the student retains responsibility for finalizing and implementing that design.
- Affected files: `supplier-service/package.json`, npm-generated
  `supplier-service/package-lock.json`, `supplier-service/src/db/index.ts`,
  `supplier-service/src/db/schema.ts`, `supplier-service/src/db/check.ts`,
  `supplier-service/drizzle.config.ts`, `supplier-service/drizzle/.gitkeep`,
  Drizzle-generated `supplier-service/drizzle/meta/_journal.json`,
  `supplier-service/Dockerfile`, `compose.yaml`, `.env.example`,
  `supplier-service/README.md`, `README.md`, and this log.
- Attribution: Authored text files have header comments. `package.json` uses
  a `//` metadata field because JSON does not support comments. The generated
  lockfile, migration journal, and empty directory marker are attributed here.
- Verification: TypeScript typecheck and build passed; production and tooling
  Docker builds passed; read-only Drizzle connection checks passed in both
  images; migration generation passed on Windows and in Docker with zero tables;
  the empty migration journal applied successfully using Docker tooling.
  No application tables were created. Drizzle initialized its migration metadata.
- Dependency audit: Production dependencies reported zero vulnerabilities.
  Drizzle Kit's development dependency chain reported four moderate findings
  associated with esbuild; npm's suggested fix requires a breaking downgrade.
- Author review: Check for correctness.

# AI usage log (Order Service)

## 2026-10-17: Order service implementation

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `ok you have enough information i feel`, following a conversation in which
  the student specified the order service: local user copy (id, display name, role, soft
  delete) and append-only supplier copy (everything except `imageUrl`) built from
  `user-events` and `supplier-events`; the `orders` table with a `current_state` column and
  the `order_events` table as log and transactional outbox; FR10–FR13 endpoints
  (`POST /orders`, `GET /orders` with state/supplier filters, `+`/`-` sorting and cursor
  pagination, `GET /orders/me`, accept/cancel/pickup/deliver/confirm); the states and the
  orchestrated saga commands (`OpenOrder`, `RejectOrder`, `AbortOrder`, `SettleOrder`); and
  expiry by a database sweep. When asked, Claude gave feedback and options (for example the
  `current_state` column, the sweep instead of Cloud Tasks, and the `AbortOrder` and
  `SettleOrder` names); the student made the choices.
- Key response:
  - New `order-service` (Express, Drizzle, PostgreSQL) with a local HS256 JWT check, the
    student-defined schema and migration, and one write path that appends an event and
    updates `current_state` in the same transaction.
  - Pub/Sub push consumers for user and supplier events and saga commands (idempotent via
    event versions and command ids), an outbox relay to `order-events`, and internal routes
    authenticated by Google OIDC tokens or a local shared secret.
  - Compose services for the order database, migrations, the service, and a ticker that runs
    the expiry sweep and outbox relay every minute.
- Affected files: `order-service/` (all files), `compose.yaml`, `compose.dev.yaml`, and this log.
- Verification: `npm test` (15/15 integration tests against PostgreSQL), strict TypeScript
  checking, `drizzle-kit migrate`, and a local startup smoke test passed. The Compose stack
  was not run because Docker was unavailable. Cloud deployment is not yet wired.
- Author review: Pending.

## 2026-10-17: Order pages in the frontend

- Tool: Claude Code (Opus 5.5). Mode: Implementation, verification.
- Exact prompt: ten mockup images of the Orders, New Order, Edit Order and order details pages
  (desktop and mobile), with `N1 N2 are navigation bars btw, if the frontend already has them,
  use it, if not ignore it`. The student then chose: a required title column, a supplier
  dropdown plus free-text delivery location, editing of title/description/location while
  `OPEN` (reward fixed), and no order number (heading "Order Details").
- Key response:
  - order-service: `title` column, requester/courier display names in responses,
    `GET /orders/:orderId`, `GET /orders/:orderId/events`, `PATCH /orders/:orderId`
    (`order.edited`), and comma-separated `state` filters; description limit 500.
  - frontend: Orders link in the existing navigation; Orders page with All/Open/In
    Progress/Done tabs, supplier filter, sorting and "Load more"; New Order and Edit Order
    forms; Order Details page with the viewer's action and the history grouped by day.
    Available credits are not shown because credit-service does not exist yet.
- Affected files: `order-service/src/`, `order-service/drizzle/`, `order-service/test/`,
  `order-service/README.md`, `frontend-service/` (order-service pages, components, server
  routes, shared types, `app.vue`, `nuxt.config.ts`), `compose.yaml`, and this log.
- Verification: order-service tests (17/17) and the Nuxt typecheck passed. Checked in Chrome
  against the Pub/Sub emulator with the real user, supplier and order services: listing,
  filters, creating, editing, completing (settled by a stand-in orchestrator), and mobile layouts.
- Author review: Pending.

# AI usage log (Notification Service)

## 2026-10-17: Notification service and live order updates

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `go ahead`, following a conversation in which the student specified the
  notification service: ingress all with local JWT verification, WebSockets, listening to all
  order events (credit events later) with attribute-based filtering, a map of user id to
  sockets, and one subscription per instance so every instance receives every event. The
  student chose short-lived tickets for WebSocket authentication because the JWT is in an
  httpOnly cookie.
- Key response:
  - order-service publishes `type` and `orderId` as Pub/Sub message attributes.
  - New `notification-service`: `POST /tickets` (JWT → signed single-use ticket), `/ws`
    WebSocket endpoint with origin checks, heartbeats and closing at JWT expiry, a per-instance
    filtered pull subscription deleted on shutdown, and routing of each order event to the
    requester's and courier's sockets.
  - frontend: ticket endpoint, a shared reconnecting WebSocket composable, and live updates on
    the Orders and Order Details pages in place of polling.
- Affected files: `notification-service/` (all files), `order-service/src/events/`,
  `order-service/test/orders.test.mjs`, `order-service/README.md`,
  `frontend-service/server/api/notification-service/`, `frontend-service/app/services/notification-service/`,
  `frontend-service/app/services/order-service/components/OrderBoard.vue`,
  `frontend-service/app/pages/orders/[id]/index.vue`, `frontend-service/nuxt.config.ts`,
  `compose.yaml`, `compose.dev.yaml`, and this log.
- Verification: notification-service tests (4/4), order-service tests (17/17), strict
  TypeScript and Nuxt typechecks passed. On the Pub/Sub emulator with two notification
  instances, an order event reached users connected to different instances (~120ms), a
  stopped instance deleted its subscription, and the Order Details page updated in Chrome
  without reloading. Docker Compose and Cloud deployment were not run.
- Author review: Pending.

## 2026-10-17: Stored notifications, notification panel and toasts

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `ok add the source column and go ahead`, following the student's request for
  toasts and a notification panel backed by a notifications table and a paginated
  `GET /notifications`, and a discussion of storing through a shared subscription, keying rows
  by the source event id, and adding a `source` column.
- Key response:
  - notification-service: PostgreSQL `notifications` table (unique on source, event and user),
    notification rules in one place, a shared `notification-store` subscription that stores
    each event once with retries, `GET /notifications` (cursor paged), `GET
    /notifications/unread-count`, `POST /notifications/read`, and live `notification` pushes.
  - frontend: Nuxt proxy routes, a bell with unread badge and a panel of past notifications
    (mark as read, load more), and toasts for live notifications.
- Affected files: `notification-service/` (schema, migration, rules, store, API, subscription,
  tests, README, Dockerfile, package files), `frontend-service/` (notification-service server
  routes, client, types, components, composable, `app.vue`), `compose.yaml`, and this log.
- Verification: notification-service tests (7/7) and the Nuxt typecheck passed. On the Pub/Sub
  emulator the seeded order events were stored once per recipient, and in Chrome the badge,
  panel (mobile and desktop), toast, and marking as read worked.
- Author review: Pending.


# AI usage log (Credit Service)

## 2026-10-18: Align Credit TD and PRD with existing service contracts

- Tool: ChatGPT / Codex (GPT-6). Mode: Repository inspection and documentation editing.
- Exact prompt:

  ```text
  Revise the Credit technical design and product requirements documents to:
  1. Use integer user IDs.
  2. Align order references with the Order service's existing mapping.
  3. Clarify how the Order service validates JWTs and how this applies to Credit.

  Focus on the Credit service. Defer orchestration and changes to other services.
  ```
- Key response: Updated user references to integers while retaining UUID errand/request IDs;
  aligned errand references and event fields with Order (`orderId`, `type`, `eventId`,
  `occurredAt`, Pub/Sub attributes); replaced candidate Redis delivery with existing Pub/Sub.
  Documented Order’s current JWT and internal authentication behavior, corrected the
  registration projection assumption, and kept verified-user integration explicit.
  Deferred orchestration and other-service changes; kept Credit-only verification.
- Affected files: `credit-service/docs/credit-service-tech-design.md`,
  `credit-service/docs/credit-service-prd.md`, and this log.
- Verification: Checked Markdown fences, parsed JSON examples, and searched for stale
  UUID user fields, taskOrderId references, and Redis delivery instructions. No runtime changes.
- Author review: Pending.

## 2026-10-18: Select event-driven account provisioning

- Tool: ChatGPT / Codex (GPT-6). Mode: Documentation editing.
- Exact prompt: `Proceed with event-driven account provisioning through Credit's dedicated Pub/Sub subscription, including duplicate and deletion handling, pending-account responses, and existing-user backfill.`
- Key response: Updated TD and PRD to make the user-event consumer the single
  provisioning path. Added minimal versioned lifecycle state for deletion tombstones;
  removed the allocation API and request-triggered grants; aligned schema, transaction
  flows, authentication, deployment, and verification scenarios with that choice.
  Credit retains financial history after deletion; existing holds remain releasable.
- Affected files: `credit-service/docs/credit-service-tech-design.md`,
  `credit-service/docs/credit-service-prd.md`, and this log.
- Verification: Parsed JSON examples, checked Markdown fences and route/flow consistency,
  searched for superseded provisioning instructions, and ran git diff --check.
  Documentation only; no runtime tests run.
- Author review: Pending.

## 2026-10-18: Document lookup access and credit number encoding

- Tool: ChatGPT / Codex (GPT-6). Mode: Documentation editing and explanation.
- Exact prompt:

  ```text
  Proceed with the proposed lookup access rules and credit number encoding.
  Clarify the CANCELLED state and explain how the design ensures idempotency.
  ```
- Key response: Documented internal-caller lookup access and the whole-credit JSON
  number contract with Order-compatible reward bounds, safe balance bounds, exact
  BIGINT conversion, and atomic recipient-overflow rejection. Clarified the cancellation
  marker and request/order-level idempotency in the design.
- Affected files: Credit TD, Credit PRD, and this log.
- Verification: Checked JSON examples, monetary limits, lookup wording, and
  git diff --check. No runtime code changed.
- Author review: Pending.

## 2026-10-18: Finalize cancellation guards and shared movement design

- Tool: ChatGPT / Codex (GPT-6). Mode: Documentation editing.
- Exact prompt: `Proceed with release-before-reserve cancellation handling and the shared movement design using available and reserved balance buckets.`
- Key response: Updated TD and PRD with terminal CANCELLED, a reserve link nullable
  only for that state, atomic zero-movement cancellation results/outbox events,
  state-transition rules, replay behavior, and both reserve/release arrival orders.
  Clarified the shared movement operation and kept business checks in the handlers.
  Reworked diagrams to exit before balance changes for pending/deleted identities.
- Affected files: `credit-service/docs/credit-service-tech-design.md`,
  `credit-service/docs/credit-service-prd.md`, and this log.
- Verification: Checked JSON examples, Markdown fences, sequence-diagram branch
  balance, reservation state coverage, schema relationships, and stale policy text.
  Ran git diff --check. Documentation only; no runtime tests run.
- Author review: Pending.

## 2026-10-18: Refine redundant schema fields

- Tool: ChatGPT / Codex (GPT-6). Mode: Documentation editing and design discussion.
- Exact prompt:

  ```text
  Review whether lifecycle state can be consolidated into credit accounts and
  reservation state derived from credit order history. Store the initial grant
  amount in credit orders, and remove the original request ID and redundant
  outbox fields, including attempts and last error.

  Reassess stored results and versioning, considering whether operations can
  reproduce their outcomes reliably from committed history.
  ```
- Key response: Removed original_request_id, outbox event_type, attempts, and last_error.
  Moved the actual initial_grant amount from accounts to ALLOCATE CreditOrders.
  The design review also covered account/lifecycle consolidation, version removal,
  result representation, and deriving reservation state from command history.
- Affected files: Credit TD, Credit PRD, and this log.
- Verification: Parsed JSON examples, checked Markdown fences and removed schema fields,
  and ran git diff --check. No runtime code changed.
- Author review: Pending.

## 2026-10-18: Apply four-table model and remove versions

- Tool: ChatGPT / Codex (GPT-6). Mode: Documentation editing.
- Exact prompt: `Apply the four-table model and remove version fields. Retain the existing outcome representation while the proposed alternative remains under review.`
- Key response: Revised TD and PRD to use credit_accounts, credit_orders,
  credit_transactions, and credit_outbox. Merged permanent deletion into accounts,
  removed separate user/reservation tables, and derived per-errand state from
  successful command history and actual ledger movements. Removed stored lifecycle
  and reservation counters and Credit event version fields. Existing upstream user
  messages remain accepted with their extra version metadata ignored. Retained the
  existing JSON result field and explicitly deferred the structured-outcome proposal.
  Updated ERD, locks, cancellation/provisioning flows, API descriptions, retention,
  and verification scenarios for the selected model.
- Affected files: `credit-service/docs/credit-service-tech-design.md`,
  `credit-service/docs/credit-service-prd.md`, and this log.
- Verification: Checked the four schema sections and ERD, removed table/column
  references, retained result schema, JSON examples, Markdown fences, and sequence
  branches. Ran git diff --check. No runtime implementation or tests changed.
- Author review: Pending.

## 2026-10-18: Profile credit balance UI

- Tool: ChatGPT / Codex (GPT-6). Mode: UI implementation and verification.
- Exact prompt: `Begin with the profile credit balance UI, displaying available credits prominently, reserved credits secondarily, and total credits with lower visual emphasis.`
- Key response: Added a responsive credit summary with loading, account setup pending,
  unavailable, and Retry states. Added an authenticated read-only Nuxt proxy with
  safe-integer balance validation and sanitized dependency errors. Scoped fetch data
  to the signed-in user and added private local and Compose service configuration.
- Affected files: Credit component, shared balance type, server client and proxy,
  profile page, Nuxt config, frontend environment example, credit frontend README,
  frontend environment in compose.yaml, and this log.
- Verification: Frontend typecheck, production build, and git diff --check passed.
  A real browser exercised desktop and mobile layouts, loading, setup pending,
  service failure, Retry, zero and maximum balances, invalid upstream balances,
  and missing-cookie authentication against controlled service responses.
  Screenshots and the verification script are in /tmp/credit-ui-proof and
  /tmp/credit-ui-check.cjs. The full order-to-credit workflow was not tested.
- Author review: Pending.

## 2026-10-18: Integrate Drizzle into Credit

- Tool: Codex (GPT-6). Mode: Schema migration, implementation, and verification.
- Exact prompt: `Integrate Drizzle ORM into the Credit service.`
- Key response: Defined the four existing tables in Drizzle, derived account and
  transaction types from the schema, and replaced direct PostgreSQL queries with
  Drizzle builders and transactions. Preserved advisory locks, exact bigint arithmetic,
  JSONB replay matching, and the publisher's dedicated connection. Adopted the original
  idempotent SQL as the first tracked migration and added schema generation tooling.
- Affected files: Credit schema, database access, migration metadata, Dockerfile,
  dependencies, tests, README, and this log.
- Verification: All 17 PostgreSQL and HTTP tests passed, including populated-schema
  adoption, repeated and concurrent migration, financial rollback, and response
  compatibility. Real Pub/Sub checks passed for push provisioning, credit operations,
  broker outages, and stable-event redelivery after acknowledgment. The production
  Docker image built and applied migrations twice to a fresh database.
- Author review: Pending.

## 2026-10-18: Replace Credit mutation APIs with Pub/Sub commands

- Tool: Codex (GPT-6). Mode: Contract design, implementation, and verification.
- Exact prompt: `Implement the Credit-owned Pub/Sub command flow for reserve, release, and transfer, replacing their direct HTTP mutation APIs.`
- Key response: Added explicit command parsing, an authenticated push consumer,
  durable command subscription provisioning, and a validating publisher CLI.
  Removed the three mutation routes and migrated verification callers to Pub/Sub.
  Commands acknowledge only after a final outcome and outbox commit. Temporary
  prerequisites retry, and inactive accounts produce durable rejection outcomes.
- Affected files: Credit consumer, configuration, provisioning, account handling,
  publisher CLI, tests, existing design documents, README, Compose, and this log.
- Verification: All 21 PostgreSQL and transport tests passed. A reproduced alternate-URL
  authentication bypass is blocked by route-local push identity checks. Real Pub/Sub checks
  exercised the CLI, all three commands, duplicate replay, outcome correlation,
  pending-account and early-transfer retries, cancellation, inactive-user rejection,
  removed mutation routes, authentication, broker outage, and outbox crash recovery.
  The rebuilt local API and publisher are healthy, and the command subscription
  targets the authenticated push handler.
- Author review: Pending.

## 2026-10-18: Separate Credit command decisions

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- Exact prompt: `Extract separate reserve, release, and transfer handlers within the existing command module. Retain shared transaction logic and replace repeated command and reservation-state strings with typed constants.`
- Key response: Added private decision handlers in commands.ts and shared constants
  for command kinds, message types, and reservation states. Derived domain types
  from those constants. Retained common locking, replay handling, balance writes,
  and atomic outcome persistence.
- Affected files: Credit command module, constants, types, account and query code,
  schema type definitions, event adapters, README, and this log.
- Verification: The same 21 PostgreSQL and transport tests passed before and after
  the refactor. Typechecking passed, and Drizzle reported no schema changes.
  Real Pub/Sub checks passed for all three commands, replay, rejection, correlated
  outcomes, prerequisite retries, cancellation, authentication, broker outage,
  and outbox recovery. Independent review found no behavioral regressions.
- Author review: Pending.

## 2026-10-18: Remove predeployment compatibility tooling

- Tool: Codex (GPT-6). Mode: Cleanup.
- Exact prompt: `Remove unnecessary backfill and database-adoption support because Credit has not been deployed. Assess whether the credit module should be named core.`
- Key response: Removed the offline user backfill tool and npm command. Replaced
  the initial SQL with Drizzle-generated schema creation and removed the test step
  that erased the migration journal to simulate database adoption. Updated the
  README, PRD, and technical design. Retained the credit domain name and normal
  migration tracking and serialization.
- Affected files: Credit backfill entry point, npm scripts, initial migration,
  migration test, README, design documents, and this log.
- Verification: Generated the initial migration from the current schema and
  confirmed that its snapshot matches the tracked snapshot. Reviewed callers
  and the diff. Tests were not run for this cleanup.
- Author review: Pending.

# AI usage log (Saga Orchestrator)

## 2026-10-18: Saga orchestrator

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `ignore the sync service for now, you can go ahead and build the orchestrator,
  branch off of credti service branch`, after the student had designed the orchestrated saga
  (order.created → reserve → OpenOrder/RejectOrder, timeout → AbortOrder and release,
  order.completed → transfer → SettleOrder) and the credit service had moved to commands over
  Pub/Sub (`credit-commands`) with results on `credit-events`.
- Key response: new `saga-orchestrator` service: a saga row per order, credit results matched by
  request id, idempotent handling of redelivered events, a transactional outbox for commands,
  releases on timeout, cancellation and expiry, transfer and settlement on completion, and a
  timeout sweep; Compose services and a ticker.
- Affected files: `saga-orchestrator/` (all files), `compose.yaml`, `compose.dev.yaml`, and this log.
- Verification: 8 integration tests passed. On the Pub/Sub emulator with the real user, order and
  credit services: orders opened after reservation, a 900-credit order was rejected with
  `INSUFFICIENT_CREDITS`, a cancelled order released its credits, a completed order transferred
  12 credits to the courier and settled, and balances matched (988/260 and 1012/140). With
  credit-service stopped, the order was aborted after the timeout, and once credit-service
  returned the delayed reserve and the release cancelled out, leaving the balance unchanged.
- Author review: Pending.

## 2026-10-18: Publish outbox events before responding

- Tool: Claude Code (Opus 5.5). Mode: Debugging and implementation.
- Exact prompt: `publish before responding and make that a pr`, after the student asked why the
  credit publisher runs all the time but the order outbox relay does not, and Claude explained
  that Cloud Run throttles CPU after a response, stalling relays left running in the background.
- Key response: order-service and saga-orchestrator now await their outbox relay before
  responding (to users, Pub/Sub pushes and Cloud Scheduler); failures are still logged and left
  for the every-minute relay.
- Affected files: `order-service/src/events/outbox.ts`, `order-service/src/orders/write.ts`,
  `order-service/src/index.ts`, `order-service/test/orders.test.mjs`,
  `saga-orchestrator/src/outbox.ts`, `saga-orchestrator/src/saga.ts`,
  `saga-orchestrator/src/index.ts`, `saga-orchestrator/test/saga.test.mjs`, and this log.
- Verification: order-service (18/18) and saga-orchestrator (9/9) tests, including new checks
  that events are published by the time the response arrives.
- Author review: Pending.

## 2026-10-18: Supplier-service local user copy and event worker

- Tool: Claude Code (Opus 5.5). Mode: Implementation, refactoring, tests, documentation, and verification.
- Exact prompt: `this prompt is only for the supplier service. we're switching to using a copy of
  the users database (usersTable). we already have the user service pubsub set up but we're still
  on the old implementation where the supplier service talks to the user service directly.
  create a worker, listen to user.created, user.updated, and user.deleted. on the event, update
  your local copy of users. we currently have some operations that is dependent on user
  authentication, and those are to be refactored to keep in line with the local copy.`
  When asked which columns to keep, the student chose to mirror order-service (id, displayName,
  role, version, deletedAt; no password hash).
- Key response:
  - supplier-service: `users` table and migration, a separate push worker (`src/worker.ts`) that
    applies user events with a version guard and deletion tombstones, and authentication that
    verifies JWTs locally with `JWT_SECRET` and reads the caller's role from the local copy
    (401 for deleted users, retryable 503 before the user has replicated) instead of calling
    user-service `GET /me`.
  - Compose and `deploy.sh`: the worker service and its push subscription; supplier-service gets
    `JWT_SECRET` in place of `USER_SERVICE_BASE_URL`.
- Affected files: `supplier-service/` (`src/auth.ts`, `src/worker.ts`, `src/user-events.ts`,
  `src/errors.ts`, `src/index.ts`, `src/db/schema.ts`, `drizzle/0001_local_users.sql` and meta,
  tests, README, package files), `compose.yaml`, `compose.dev.yaml`, `deploy.sh`, and this log.
- Verification: supplier-service tests (42/42) and the strict TypeScript typecheck passed. On
  Docker Compose with the Pub/Sub emulator, a newly registered user reached the local copy, could
  list suppliers (200) but not create types (403), and a display-name change was applied as
  `user.updated`. Cloud deployment was not run.
- Author review: Pending.

## 2026-10-18: Frontend handling of supplier-service local authorization

- Tool: Claude Code (Opus 5.5). Mode: Implementation, documentation, and verification.
- Exact prompt: `okay. make the changes to the frontend service (supplier) as well. note the auth
  changes`, following the supplier-service switch to a local user copy (earlier prompt: `just to
  clarify, the supplier service will also be emitting events. perhaps you should change the name
  of the service ...`, which renamed the worker to `supplier-event-worker`).
- Key response: the Nuxt supplier client forwards supplier-service's 503 (account not yet in the
  local user copy) with its message instead of turning it into a 502; the supplier directory shows
  an account-setup state and retries every 2 seconds (up to 5 times), and the delete action reports
  it. 401 (now also for deleted users) still redirects to login.
- Affected files: `frontend-service/server/services/supplier-service/client.ts`,
  `frontend-service/app/services/supplier-service/components/SupplierDirectory.vue`,
  `frontend-service/README.md`, and this log.
- Verification: the Nuxt typecheck passed. On Docker Compose, a validly signed token for a user not
  in the supplier copy returned 503 with the setup message through `/api/supplier-service/suppliers`,
  and an expired token returned 401. The directory's retry behaviour was not checked in a browser.
- Author review: Pending.

## 2026-10-18: Supplier events (transactional outbox)

- Tool: Claude Code (Opus 5.5). Mode: Implementation, tests, documentation, and verification.
- Exact prompt: `okay. next, emit events when there is any modification to the supplier service.
  here's the shape of the payload. send it to the event bus accordingly with the expected name`,
  with the student's `SupplierSnapshot`, `SupplierEventPayload`, and `SupplierEvent` types. When
  asked how events should be delivered, the student chose a transactional outbox (over publishing
  directly after commit).
- Key response:
  - supplier-service: `supplier_event_sequence` and a `supplier_events` outbox table; POST, PUT, and
    DELETE /suppliers, type/building renames (one `supplier.updated` per affected supplier), and the
    seed write events in the same transaction as the change. The API relays unpublished rows to the
    `supplier-events` topic after each commit (ordering key and `supplierId` attribute = supplier
    id, `type` attribute), and the event worker's `POST /outbox/publish` sweep retries anything left.
  - Compose: API Pub/Sub settings, a `supplier-ticker` for the sweep, and startup after
    order-service (whose `supplier-events` subscription must exist first). `deploy.sh`: the topic,
    API settings, and a Cloud Scheduler job for the sweep.
- Affected files: `supplier-service/` (`src/supplier-events.ts`, `src/index.ts`,
  `src/reference-routes.ts`, `src/worker.ts`, `src/db/schema.ts`, `src/db/seed.ts`,
  `drizzle/0002_supplier_events.sql` and meta, tests, README, package.json), `compose.yaml`,
  `deploy.sh`, and this log.
- Verification: supplier-service tests (50/50) and the strict TypeScript typecheck passed. On Docker
  Compose with the Pub/Sub emulator, creating, editing, and deleting a supplier published versions
  1-3 and order-service stored them in `supplier_versions` (ending in a tombstone); the test
  supplier and type were removed afterwards. Cloud deployment was not run.

# AI usage log (Order Ranking Service)

## 2026-10-31: Smart request-to-courier ranking with explanations

- Tool: Claude Code (Opus 5.5). Mode: Design discussion and implementation.
- Exact prompt: `order-ranking-service makes sense, and for openai key ill give it to you later, just build it first, and then also you can start docker if u want to, and also finally one mroe question: is it possible to make it explainable, like having a threshold for time and coordinates and semantic similarity and if the similarity is high, then we show why we suggested that?`
  (following the student's design: a separate service keeping a local copy of orders from
  order events and embedding each order on creation, with time of day and coordinates
  added to the embedding).
- Key response: Added `order-ranking-service`, which copies orders from `order-events` and
  suppliers from `supplier-events`, embeds orders in the background (OpenAI, or a keyless
  hashing fallback) with retry back-off, and ranks open orders per courier from separate
  parts (meaning, distance, time of day as a circular feature, preferences, reward). Each
  part that reaches its threshold becomes a reason. The parts are kept separate instead of
  one longer vector so each can be explained and weighted. Added a For You tab, reasons on
  order cards, browser location, a preferences dialog, and Compose services.
- Affected files: `order-ranking-service/`, `compose.yaml`, `.env.example`,
  `frontend-service/` (order board, order card, ranking components, Nuxt endpoints, types,
  config), and this log.
- Verification: 17 unit and integration tests pass against PostgreSQL with pgvector and a
  stand-in OpenAI server; the frontend passes `nuxt typecheck`. Not yet run end to end in
  Docker Compose (the build failed because the machine's disk was full) and not yet run
  with a real OpenAI key. Not added to `deploy.sh` or `cloudbuild.yaml`.
- Author review: Pending.

## 2026-11-01: Fixes to the ranking explanations, embeddings and For You refresh

- Tool: Claude Code (Opus 5.5). Mode: Debugging and implementation.
- Exact prompt: `sector 1, backlog, fix the problems with pr 26 and you can push directly to the pr`
  (following a review of PR 26).
- Key response: The time reason says "orders like this" only when both orders have
  embeddings that reach the semantic threshold. Orders are embedded again when their
  supplier arrives after them or changes name or type, or when an order moves to another
  supplier; a new `embedding_input_version` column (migration 0001) stops an embedding of
  the old text that was in flight from being stored. Past deliveries are only orders in
  `DELIVERED`, `COMPLETE` or `SETTLED`, not every accepted order. The order board refreshes
  the For You list, not the hidden ordinary list, after a failed action and on
  notifications. Test teardown waits for database connections to close.
- Affected files: `order-ranking-service/` (score, consumers, embedding job, queries, app,
  schema, migration 0001, tests, README), `frontend-service/` (order board, ranked list,
  rankings key), and this log.
- Verification: `npm test` in order-ranking-service, 23/23, against PostgreSQL 16 with
  pgvector 0.6.0 and the stand-in OpenAI server; new tests failed before each fix. The
  frontend passes `nuxt typecheck`. The For You refresh was checked in headless Chromium
  against the Nuxt dev server with stand-in services, before and after the fix. Not run in
  Docker Compose or with a real OpenAI key.
- Author review: Pending.

# AI usage log (Deployment)

## 2026-10-18: Deploying the order, notification, credit and saga services

- Tool: Claude Code (Opus 5.5). Mode: Boilerplate generation (deployment config) and implementation.
- Exact prompt: `Uh, let's do the deployment.`
- Key response: Cloud Build images for the order, notification, credit and saga services (with
  tooling images for Drizzle migrations); `deploy.sh` creates their databases, secrets, topics,
  a Cloud Scheduler identity and Pub/Sub permissions, runs migrations and credit's
  subscription setup, deploys the services (internal ingress with OIDC-checked internal routes;
  notification-service public with CPU always on for WebSockets; one always-on credit
  publisher), creates push subscriptions and every-minute Cloud Scheduler jobs, and gives the
  frontend the new URLs. credit-service's outbox publisher answers health checks when `PORT` is
  set, so it can run on Cloud Run.
- Affected files: `cloudbuild.yaml`, `deploy.sh`, `credit-service/src/events/publisher.ts`, and this log.
- Verification: `bash -n deploy.sh`, Cloud Build YAML parsing, and a credit-service typecheck.
- Author review: Pending.

## 2026-10-18: Production fixes after deploying supplier events

- Tool: Claude Code (Opus 5.5). Mode: Debugging and operations.
- Exact prompts: `for 1 can we manualy do it`, `ok go ahead`, `ok ive merged it, go ahead and
  deploy`, and `yes` (after asking whether "Your account is still being set up" came from
  user-service).
- Key response: a tested one-off SQL backfill recorded supplier.created for the 21 existing
  production suppliers in supplier-service's outbox (identical payloads to its own code, safe to
  repeat); a one-off job republished user.created for existing users through user-service's
  publisher, so supplier-service, order-service and credit-service (subscribed after those users
  signed up) caught up; notification-service now accepts WebSockets from https://nusfoc.com, and
  `deploy.sh` keeps that origin.
- Affected files: `deploy.sh` and this log (the backfill and republish ran as one-off Cloud Run jobs).
- Verification: all 21 suppliers and 3 users were delivered (204/200) to each consuming service;
  supplier-service stopped answering 503; nusfoc.com passes the WebSocket origin check (401
  without a ticket) while unknown origins get 403.
- Author review: Pending.

## 2026-10-18: Refactor Credit commands around financial operations

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- Exact prompt: `ok lets go`, approving the preceding operation-based refactor plan.
- Key response: Moved account eligibility and financial-history checks into private
  reserve, release, and transfer handlers. Replaced internal reservation-state
  branching with recorded reserve, release, and transfer facts. Each handler describes
  its movement once for balance writes, ledger entries, and outcome deltas. Kept
  reservation states in existing responses and retained the four-table schema.
- Affected files: Credit command and query modules, PostgreSQL tests, README, and this log.
- Verification: All 37 PostgreSQL and transport tests passed against both the original
  implementation and the refactor, including 16 new characterization cases with
  ledger and outbox assertions. Typechecking passed. Real Pub/Sub checks passed for
  commands, replay, rejection, prerequisite retries, cancellation, authentication,
  broker outage, and stable event replay after publish-before-mark failure. Tests used
  a disposable database and separate emulator. Independent review found no regressions
  for valid financial histories. Provisioning recovery and correlation-ID policy were
  left unchanged.
- Author review: Pending.

## 2026-10-18: Separate Credit boundaries and remove testing-driven service wiring

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- User instructions: Create a new branch, separate HTTP handlers, business logic,
  and database access; remove the Credit services contract and testing-driven
  wiring; rename business methods and inputs so they do not depend on events.
  Follow-up: Rename authentication helpers and the branch to
  `lucius/refactor-credit-service`.
- Key response: Created `codex/credit-service-layers`. Replaced the `credit/`
  folder with HTTP controllers/routes, business services, and SQL repositories.
  `createApp()` takes no arguments; controllers import business functions directly.
  Removed aggregate service contracts, controller factories, and the publisher's
  test-only callback. Account initialization and deactivation accept request and
  user IDs; only the adapter parses user events. Credit operations expose reserve,
  release, and transfer functions. Account creation and its initial grant remain
  atomic. HTTP error mapping stays at the boundary, and financial transactions
  retain replay, locking, ledger, and outbox guarantees.
  Renamed the branch as requested and replaced `internal(req, true)` / `internal(req)`
  with `requirePubSubCaller(req)` / `requireInternalCaller(req)`; shared credential
  verification remains private. Build and architecture checks passed after renaming.
- Affected files: Credit source modules, PostgreSQL/HTTP/Pub/Sub tests,
  architecture checks, test script, README, and this log.
- Verification: All 41 tests passed against a disposable PostgreSQL database,
  including real HTTP requests. Actual Pub/Sub push delivery passed provisioning,
  reserve/replay/rejection/transfer/release, dependency retries, cancellation,
  authentication, broker outage, and publish-before-mark recovery. Independent
  review found no confirmed regressions. The architecture check prevents transport
  inputs and aggregate service contracts from returning to business services.
  No schema changes or deployment. Provisioning recovery and correlation-ID policy
  remain unchanged.
- Author review: Pending.

## 2026-10-19: Group Credit interfaces into event and HTTP handlers

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- User instruction: `ok fix it then`, approving separate event-handler and
  http-handler folders, with message parsing owned by the event boundary and
  both interfaces calling shared services.
- Key response: Moved incoming message handlers and combined parsers into
  `event-handler/`; moved HTTP read/health handlers, auth, and error mapping into
  `http-handler/`. App registers routes directly. Shared UUID and positive-int32
  parsing lives in `validation.ts`, preserving boundary-specific error codes.
  Outcome construction lives with services; outgoing publishing lives in
  `messaging/`; provisioning and command tools live in `scripts/`. Updated package,
  Compose, development, test, and README paths. No new forwarding contracts.
- Verification: All 41 tests passed on disposable PostgreSQL, strict typechecking
  and Compose configuration validation passed, and real Pub/Sub verification
  passed account provisioning, CLI commands, duplicate delivery, business
  rejections, dependency retries, cancellation, authentication, broker outage,
  and publish-before-mark recovery. Independent review found no regressions.
  Disposable verification containers were removed. No deployment or schema change.
- Author review: Pending.

## 2026-10-19: Let Credit handler modules own their routes

- Tool: Codex (GPT-6). Mode: Refactoring.
- User instruction: Have app initialize the two handlers and define routes inside
  the handler modules.
- Key response: HTTP and event handler modules export their own Express routers.
  App mounts both routers between JSON parsing and error handling. Fixed remaining
  imports after the shared modules were moved into `common/`; updated README and
  the transport test import accordingly.
- Verification: Build and architecture test passed. Real local HTTP requests
  exercised all seven routes across both routers, checking liveness, caller
  rejection, and readiness error handling against an unavailable database.
  Whitespace checks passed. Financial transaction code was unchanged.
- Author review: Pending.

## 2026-10-19: Name the outbox publisher folder explicitly

- Tool: Codex (GPT-6). Mode: Refactoring.
- User instruction: `yeah outbox publisher`.
- Key response: Renamed `src/messaging/` to `src/outbox-publisher/` and updated
  package scripts, Compose/development entrypoints, Pub/Sub test import, and README.
- Verification: Build, architecture test, and both Compose configuration checks
  passed. Publisher behavior was unchanged.
- Author review: Pending.

## 2026-10-19: Clarify Credit database handle names

- Tool: Codex (GPT-6). Mode: Naming refactor.
- User instruction: `ok use the clearer name`.
- Key response: Renamed transaction parameters and callbacks to `tx`, handles
  accepting Database or Transaction to `db`, and the publisher's checked-out
  PostgreSQL client to `connection`. No transaction behavior changed.
- Verification: Build, architecture test, and whitespace checks passed.
- Author review: Pending.

## 2026-10-19: Prepare the Credit refactor pull request

- Tool: Codex (GPT-6). Mode: Verification and PR preparation.
- User instruction: Create a PR in the team repository, not its upstream template.
- Destination: `Y2627S1-CS3219-P32/Y2627S1-CS3219-P32`, base `main`, branch
  `lucius/refactor-credit-service`.
- Verification: Reran all 41 PostgreSQL/HTTP/architecture tests on the final
  source. Real Pub/Sub checks passed provisioning, CLI command delivery,
  reserve/release/transfer, replay, rejection, authentication, dependency retries,
  cancellation, broker outage, and publish-before-mark recovery. Both Compose
  configurations and whitespace checks passed. Independent final review found no
  concrete behavioral regressions; comment review found no actionable additions.
  These checks cover Credit service integration, not a full registration-to-order
  flow across all services. No database migration or deployment.
- Scope: Credit refactor, runtime entrypoint changes, tests, README, and this log.
  The separate untracked demo runbook is excluded.
- Author review: Pending.

## 2026-10-19: Remove Credit operation double dispatch

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- User instruction: Simplify the reserve/release/transfer wrappers that dispatch
  back to private operation functions; consider clearer invariants.
- Key response: Each public credit operation contains its business decision body.
  One private transaction helper owns normalization, replay, lock ordering, fact
  loading, and atomic balance/ledger/result/outbox persistence. Removed the second
  operation switch and three private operation functions. Capture business inputs
  before database waits to preserve the original input snapshot. Existing
  history source, guard precedence, schema, and wire outcomes remain unchanged.
- Design: Compared inline operation callbacks with duplicated explicit transaction
  setup. Selected the shared concrete helper to keep the concurrency protocol in
  one place. Deferred saved-result-based fact reads pending historical consistency
  verification. Preserved the user's concurrent constants/type consolidation.
- Verification: All 41 tests passed before and after the change on disposable
  PostgreSQL. Actual Pub/Sub checks passed provisioning, operations, replay,
  rejection, dependency retries, cancellation, authentication, broker outage, and
  publish-before-mark recovery. Independent review identified the snapshot edge
  case, fixed before final verification. Disposable containers removed afterwards.
- Author review: Pending.

## 2026-10-19: Give Credit operations their own saved-record lookups

- Tool: Codex (GPT-6). Mode: Refactoring and verification.
- User instruction: Remove shared order-history loading from the operation flow
  and fold `outcomes.ts` into an existing module.
- Key response: Added specific applied/successful operation queries returning
  saved outcomes. Reserve, release, and transfer own their lookups and stop when
  terminal records make further reads unnecessary. Successful release lookups
  include cancellation without movement. The transaction helper no longer knows
  the history shape; history reconstruction is private to the read endpoint.
  Moved outcome data constructors beside Outcome/OutcomeEvent in `common/types.ts`
  and deleted `services/outcomes.ts`. Preserved lock ordering, request replay,
  guard precedence, saved result fields, and atomic financial/outbox persistence.
- Invariants: Applied transfer is terminal; successful releases preserve the same
  requester/amount and cancellation or release snapshot. Existing service locking
  enforces these rules. The read endpoint retains contradictory-history detection;
  command lookups rely on the terminal invariant instead of rebuilding all facts.
- Verification: All 41 PostgreSQL/HTTP/architecture tests and real Pub/Sub checks
  passed. Built the previous committed implementation separately, used it to write
  12 saved outcomes including duplicate no-ops and cancellations, then verified
  exact replay and continuation from held/released/cancelled/transferred orders
  with the revised implementation. Applied flags matched ledger presence in this
  compatibility fixture. Independent review found no valid-history regressions.
  Disposable verification containers were removed. No schema migration.
- Author review: Pending.

## 2026-10-19: Remove Credit's diagnostic order and reservation read APIs

- Tool: Codex (GPT-6). Mode: Removal and verification.
- User instruction: Remove GET /internal/v1/credit-orders/:requestId and
  GET /internal/v1/credit-reservations/:orderId because they are outside main flows.
- Key response: Removed both routes, handlers, read-model queries, unused read
  result type, error mappings, and diagnostic-caller authentication/allowlist.
  Deleted services/reads.ts and moved its remaining balance function into accounts.
  Retained transaction-only request lookup for account initialization and
  operation-owned saved-result lookups. Simplified Pub/Sub authentication to its
  sole remaining caller policy. Removed the Credit-only deployment allowlist
  setting and updated README/technical design. No runtime callers outside Credit
  were found. Command completion is observed through correlated credit-events.
- Verification: All 41 PostgreSQL/HTTP/architecture tests passed. Removed routes
  return 404 for existing/missing/malformed IDs with and without former auth
  headers. Financial assertions use actual saved rows, balances, ledger, and
  outbox. Real Pub/Sub proof passed account provisioning, commands, replay,
  rejection, dependency retries, cancellation, authentication, JWT balance,
  removed routes, broker outage, and publish-before-mark recovery. Independent
  review found no regressions in remaining interfaces. Compose configurations,
  deployment shell syntax, and whitespace checks passed. Disposable containers
  were removed. No schema migration or deployment.

- Author review: Pending.

# AI usage log (Postman)

## 2026-10-18: Postman collection for the user, order and credit services

- Tool: Claude Code (Opus 5.5). Mode: Boilerplate generation and verification.
- Exact prompt: `can u make a postman collection for me for the order service and the credit
  service, and the user service`
- Key response: a Postman collection (40 requests: user auth and admin routes; order creation,
  browsing, history, editing and state actions; credit balance; internal Pub/Sub push and
  scheduler routes with the push format built in a pre-request script) and a local environment.
  Logging in saves tokens and creating an order saves its id for later requests.
- Affected files: `postman/foc.postman_collection.json`, `postman/foc-local.postman_environment.json`,
  and this log.
- Verification: ran the main flow and the internal push requests with Newman against the local
  stack on the Pub/Sub emulator; fixed a variable-scope bug this found.

- Author review: Pending.
