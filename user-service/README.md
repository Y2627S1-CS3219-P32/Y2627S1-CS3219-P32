<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
Scope: User-service setup, demo credentials, and registration requirements. Author review: Done. -->
# Local Development

Run the following commands:
```bash
npm i
npx drizzle-kit push
npm test
npm start
```

Set `JWT_SECRET` to a random value of at least 32 bytes before starting the service. For example:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The service listens on port `3333` by default (override with `PORT`). It serves `GET /health`,
`POST /login`, and the JWT-protected `GET /me`. All `/users` routes require an administrator JWT:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/users` | List users |
| `GET` | `/users/:id` | Get a user |
| `POST` | `/users` | Create a user (name, email, password, optional display name; role defaults to `student`) |
| `PUT` / `PATCH` | `/users/:id` | Update user fields; password may also be changed |
| `DELETE` | `/users/:id` | Delete a user |

Passwords must be between 8 and 256 bytes. User responses never include password hashes.
An admin cannot delete their own account or demote/delete the last administrator.
Set `JWT_ACCESS_TOKEN_TTL` to the desired access-token lifetime in seconds (defaults to `900`).

The development seed users both use `Password123!`:

| Email | Role |
| --- | --- |
| `admin@foc.com` | admin |
| `john@u.nus.edu` | student |

Passwords are stored as salted scrypt hashes. The `/login` endpoint returns a short-lived
HS256 bearer token, which the login page can verify against `/me`.

Public registration (`POST /register`) accepts a name, display name, university email,
matching email confirmation, and password. Display names must be unique (case-insensitive),
2–50 characters, and contain only letters and hyphens with a letter at each end. Registration
emails must use `u.nus.edu`, `nus.edu.sg`, or `foc.com`. Passwords must contain at least 8
characters, an uppercase letter, a lowercase letter, and a number, and be no more than 256 bytes.
Existing SQLite accounts are assigned a unique display name from their existing name when valid,
or a generated fallback, when the service starts after upgrade.