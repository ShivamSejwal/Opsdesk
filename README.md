# OpsDesk

OpsDesk is a support ticket dashboard for keeping a team's requests in one place. The app has a React and Vite frontend, an Express API, and a local SQLite database.

## Get started

You’ll need Node.js 24 or later and npm. From the project folder, install the dependencies and start both the API and website:

```bash
npm install
npm install --prefix server
npm install --prefix client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:3001](http://localhost:3001).

On first start, OpsDesk creates `server/data/opsdesk.sqlite` and adds the Studio North workspace, a starter ticket queue, and a local superuser account. Your database stays on your computer and is excluded from Git.

## Sign in and workspaces

Use this account to explore the app:

| Email | Password |
| --- | --- |
| `shiv@gmail.com` | `12345` |

This is a local demo account. Change the password before using the app in any shared or hosted environment. New accounts require a password of at least 10 characters; passwords are stored as salted PBKDF2-SHA-256 hashes.

Studio North is the default workspace. Leave the invite code blank to join it, or enter another workspace’s code when signing in or registering. The superuser can create workspaces from the workspace menu and share their invite codes with teammates. Each workspace has its own ticket queue.

To run just one part of the app, use `npm run dev:server` or `npm run dev:client`.

## Google sign-in (optional)

Email and password sign-in works without any extra setup. To enable Google sign-in:

1. Create a **Web application** OAuth client in Google Cloud.
2. Add `http://localhost:3001/api/auth/google/callback` as an authorized redirect URI.
3. Copy `server/.env.example` to `server/.env` and add your Google client ID, client secret, and a long random `OAUTH_SESSION_SECRET`.
4. Restart the server.

OpsDesk uses Google’s authorization-code flow and requests the OpenID, email, and profile scopes. The client secret stays on the server. See [Google’s web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) for details.

## API reference

All endpoints return JSON. Sign in first to use the workspace and ticket endpoints. Invalid input returns HTTP 400 with an error message and, where useful, field details.

| Method | Endpoint | What it does |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account with `name`, `email`, `password`, and an optional `inviteCode`. |
| `POST` | `/api/auth/login` | Sign in with `email`, `password`, and an optional `inviteCode`. |
| `GET` | `/api/auth/session` | Get the current account and Google sign-in availability. |
| `POST` | `/api/auth/logout` | End the current session. |
| `GET` | `/api/workspaces` | List workspaces available to the signed-in account. |
| `POST` | `/api/workspaces` | Create a workspace (admin or superuser only); send `{ "name": "Support" }`. |
| `POST` | `/api/workspaces/join` | Join a workspace with `{ "inviteCode": "..." }`. |
| `POST` | `/api/workspaces/switch` | Switch to a workspace with `{ "workspaceId": "..." }`. |
| `GET` | `/api/tickets` | List tickets. Optional query parameters: `search`, `status`, and `priority`. Returns `{ tickets, summary }`. |
| `POST` | `/api/tickets` | Create a ticket with `title`, `description`, `requester`, `email`, and `priority`. |
| `PATCH` | `/api/tickets/:id` | Update a ticket’s `status`, `priority`, or both. |

Ticket statuses are `Open`, `In Progress`, and `Resolved`. Priorities are `Low`, `Medium`, and `High`.

For example, this moves a ticket into progress and marks it high priority:

```bash
curl -X PATCH http://localhost:3001/api/tickets/OPS-1042 \
  -H 'Content-Type: application/json' \
  -d '{"status":"In Progress","priority":"High"}'
```

## Project files

```text
client/                 React app and Vite configuration
server/src/index.js      Express routes and request validation
server/src/database.js   SQLite setup and data helpers
server/src/seedTickets.js Starter ticket data
server/data/             Local database and session key (created at runtime)
```

The server creates the SQLite tables when it starts. If `server/data/tickets.json` is present, its tickets are imported the first time the database is initialized. The dashboard loads tickets from the API, so search, filters, ticket creation, and status or priority changes all use the same saved data.
