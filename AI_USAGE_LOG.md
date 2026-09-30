<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Record this session's AI assistance. 
Author review: Checked for correctness. -->

# AI usage log (User Service)

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
