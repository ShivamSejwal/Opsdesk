# OpsDesk

OpsDesk is a small support-ticket dashboard built with React and Vite, backed by a Node.js and Express API. Accounts and tickets are stored in a local SQLite database.

## Requirements

- Node.js 24 or newer (uses Node's built-in `node:sqlite` module)
- npm

## Setup

From this folder, install the dependencies for the root scripts, API, and client:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

## Run the app

Start both the API and the Vite development server in one terminal:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), then create an account or sign in. The API listens at [http://localhost:3001](http://localhost:3001). On first run, it creates `server/data/opsdesk.sqlite` and seeds the ticket table. The local database is ignored by Git so account and ticket data stay on your machine.

You can also run either part by itself:

```bash
npm run dev:server
npm run dev:client
```

## Google sign-in (optional)

Create an account from the sign-in page, or sign in with an account you already registered. Account details are saved in `server/data/opsdesk.sqlite`. The database stores passwords as salted PBKDF2-HMAC-SHA-256 hashes (600,000 iterations), never as plain text. If a previous `server/data/tickets.json` exists, the server copies its tickets into the SQLite database the first time it opens it. The server creates and protects a local session signing key automatically when no key is set in `server/.env`.

OpsDesk can also use Google OAuth. To enable it:

1. Create an OAuth client in Google Cloud with application type **Web application**.
2. Add `http://localhost:3001/api/auth/google/callback` as an authorized redirect URI.
3. Copy `server/.env.example` to `server/.env` and fill in the client ID, client secret, and a long random `OAUTH_SESSION_SECRET`.
4. Restart the API and reload the app.

The app uses Google's server-side authorization-code flow and requests only the OpenID, email, and profile scopes. The client secret stays in the server environment file. The local email/password sign-in remains available with or without Google OAuth configured. [Google OAuth web-server flow documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

The profile menu shows a personal ID from the local account database. Google sign-in can create a linked Google identity record the first time that account signs in.

## API

All responses use JSON. Invalid inputs return HTTP 400 with an `error` and, when useful, field-level `details`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account with `name`, `email`, and `password`. |
| `POST` | `/api/auth/login` | Sign in with `email` and `password`. |
| `GET` | `/api/auth/session` | Return the current signed-in account and whether Google OAuth is configured. |
| `POST` | `/api/auth/logout` | Sign out and clear the session cookie. |
| `GET` | `/api/tickets` | List tickets; accepts optional `search`, `status`, and `priority` query parameters. Returns `{ tickets, summary }`. |
| `POST` | `/api/tickets` | Create an open ticket. Required fields: `title`, `description`, `requester`, `email`, and `priority`. |
| `PATCH` | `/api/tickets/:id` | Update `status`, `priority`, or both. |

Allowed statuses are `Open`, `In Progress`, and `Resolved`. Allowed priorities are `Low`, `Medium`, and `High`.

Example update:

```bash
curl -X PATCH http://localhost:3001/api/tickets/OPS-1042 \
  -H 'Content-Type: application/json' \
  -d '{"status":"In Progress","priority":"High"}'
```

## Project layout

```text
OpsDesk/
├── client/                 # React UI and Vite config
└── server/
    ├── data/opsdesk.sqlite # Created automatically; stores accounts and tickets
    └── src/
        ├── index.js        # Express routes and input validation
        ├── database.js     # SQLite schema, migration, and data helpers
        └── seedTickets.js  # Starter tickets
```

## How the pieces fit together

1. Express opens the local SQLite database, creates its tables, and imports an existing `tickets.json` file once if present.
2. Registration and login validate inputs and store salted PBKDF2-HMAC-SHA-256 password hashes in the users table.
3. The React page requests tickets from the API. Search and filters become query parameters, so the server returns the matching list.
4. Creating or updating a ticket validates the request, saves the change in SQLite, and returns the changed ticket data.
5. The client shows loading, empty, and error states while requests are in flight or fail.
