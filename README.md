# OpsDesk

OpsDesk is a small support-ticket dashboard built with React and Vite, backed by a Node.js and Express API. Tickets are saved on the server as JSON, so changes remain after a restart.

## Requirements

- Node.js 18 or newer
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

Open [http://localhost:5173](http://localhost:5173). The API listens at [http://localhost:3001](http://localhost:3001). On its first run, it creates `server/data/tickets.json` and fills it with the sample tickets. The data file is ignored by Git so your local ticket changes stay local.

You can also run either part by itself:

```bash
npm run dev:server
npm run dev:client
```

## Google sign-in (optional)

OpsDesk starts in a local demo workspace by default. To use Google OAuth:

1. Create an OAuth client in Google Cloud with application type **Web application**.
2. Add `http://localhost:3001/api/auth/google/callback` as an authorized redirect URI.
3. Copy `server/.env.example` to `server/.env` and fill in the client ID, client secret, and a long random `OAUTH_SESSION_SECRET`.
4. Restart the API and reload the app.

The app uses Google's server-side authorization-code flow and requests only the OpenID, email, and profile scopes. The client secret stays in the server environment file. Once configured, Google sign-in is required to open the ticket API; signing out returns to the Google sign-in screen. Without credentials, the demo workspace and its sign-in option remain available. [Google OAuth web-server flow documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

The profile menu shows a personal ID. In demo mode it is a fixed sample ID; after Google sign-in it is based on Google's account subject identifier.

## API

All responses use JSON. Invalid inputs return HTTP 400 with an `error` and, when useful, field-level `details`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
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
    ├── data/tickets.json   # Created at runtime on first API request
    └── src/
        ├── index.js        # Express routes and input validation
        ├── seedTickets.js  # Starter tickets
        └── ticketStore.js  # JSON file read/write helpers
```

## How the pieces fit together

1. Express reads the local JSON file and seeds it if it does not exist yet.
2. The React page requests tickets from the API. Search and filters become query parameters, so the server returns the matching list.
3. Creating or updating a ticket validates the request, saves the updated list, and returns the changed ticket data.
4. The client shows loading, empty, and error states while requests are in flight or fail.
