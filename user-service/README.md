<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: PostgreSQL setup, demo credentials, and registration requirements. Author review: Done.
ChatGPT (GPT-6), 2026-11-04: document verification-gated access and verified-user welcome email. Author review: Pending. -->
# Local Development

Run the following commands:
```bash
npm i
npm run db:migrate
npm test
npm start
```

Set `DATABASE_URL` to the PostgreSQL connection string before running database commands
or starting the service. For the local Compose database, use
`postgres://user:user@localhost:5434/users`. Compose provisions PostgreSQL and applies
the schema automatically with `user-db-migrate`. The credentials in Compose are for local
development only. Existing SQLite data is not imported; the PostgreSQL database starts fresh.
No user accounts are created automatically.

The root Compose configuration also starts a Pub/Sub emulator and the
`user-event-worker`. Registration, administrator bootstrap, admin CRUD, and
self-service profile/password changes publish `user.created`, `user.updated`,
`user.verified`, or `user.deleted` events. The worker applies these events to PostgreSQL; a
successful mutation response means Pub/Sub accepted the event, and the database
read model may briefly lag. Events contain password hashes only, never plaintext
passwords. Start the local stack with `docker compose up --build` from the
repository root.

Set `JWT_SECRET` to a random value of at least 32 bytes before starting the service. For example:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

To create the first administrator, set `BOOTSTRAP_SECRET` to a different random value of at
least 32 bytes in the environment used by Compose. Visit `/setup/admin`, provide this secret,
and enter the administrator's account details. The server creates the administrator only if
there is no administrator already, and serializes concurrent setup attempts. An unset secret
disables setup and `/setup/admin` returns 404. After the first administrator is created,
`/setup/admin` returns 404; remove `BOOTSTRAP_SECRET` from the runtime environment and restart
the user service to disable the bootstrap endpoint as well.

The service listens on port `3333` by default (override with `PORT`). It serves `GET /health`,
`POST /login`, and the JWT-protected `GET /me`. All `/users` routes require an administrator JWT:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/users` | List users |
| `GET` | `/users/:id` | Get a user |
| `POST` | `/users` | Create a user (name, email, password, optional display name; role defaults to `student`) |
| `POST` | `/verify` | Verify an account using its email and verification code |
| `PUT` / `PATCH` | `/users/:id` | Update user fields; password may also be changed |
| `DELETE` | `/users/:id` | Delete a user |
| `GET` / `PATCH` | `/me` | View or update the authenticated user's own account |

Passwords must be between 8 and 256 bytes. User responses never include password hashes.
An admin cannot delete their own account or demote/delete the last administrator.
Set `JWT_ACCESS_TOKEN_TTL` to the desired access-token lifetime in seconds (defaults to `900`).

Passwords are stored as salted scrypt hashes. The `/login` endpoint returns a short-lived
HS256 bearer token, which the login page can verify against `/me`.

Public registration (`POST /register`) accepts a name, display name, university email,
matching email confirmation, and password. Display names must be unique (case-insensitive),
2–50 characters, and contain only letters and hyphens with a letter at each end. Registration
emails must use `u.nus.edu`, `nus.edu.sg`, or `foc.com`. Passwords must contain at least 8
characters, an uppercase letter, a lowercase letter, and a number, and be no more than 256 bytes.
Authenticated users can update their display name or email through `PATCH /me`, with the same
validation and uniqueness rules. Email updates require a matching `confirmEmail`. Password
updates require matching `newPassword` and `confirmNewPassword` fields and enforce the
registration password rules.

Public registration publishes `user.created`; the independent `mail-service` sends the
welcome email after the account is verified, in response to `user.verified`. Email changes
also require verification and send an email-updated notice after verification instead of a
welcome email. Registration does not depend on email delivery.
`POST /password-reset/request` sends a one-time password-reset link to a verified account
email without disclosing whether the email is registered. Links expire after one hour.
Complete a reset with `POST /password-reset/complete` and
`{ "token": "...", "password": "..." }`.
Every new account starts with `verificationStatus: "pending_verification"` and a generated
six-digit `verificationCode`, both persisted when the user event is projected. Pending users
cannot log in or use authenticated endpoints. Submit
`POST /verify` with `{ "email": "...", "verificationCode": "012345" }` to mark the account
verified; this publishes `user.verified` and clears the code after verification. Changing an
account email issues a new code and returns the account to pending verification. The mail-service emails the
verification code after account creation or an email change. The administrator user list
also exposes the current code for pending accounts to support testing.

The service publishes to `PUBSUB_TOPIC` (default `user-events`) in
`PUBSUB_PROJECT_ID` (default `foc-local`). Set `PUBSUB_EMULATOR_HOST` for local
development. The worker exposes `POST /pubsub/user-events` for Pub/Sub push
delivery and `GET /health` for readiness checks; GCP push requests use Cloud Run
IAM authentication. The separate [mail-service](../mail-service/README.md) consumes
the same topic and sends a welcome email for account creation and an email-updated notice
after a verified email change.
