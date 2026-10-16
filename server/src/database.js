import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seedTickets } from "./seedTickets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(here, "../data");
const databaseFile = path.join(dataDirectory, "opsdesk.sqlite");
const legacyTicketsFile = path.join(dataDirectory, "tickets.json");

mkdirSync(dataDirectory, { recursive: true });
export const database = new DatabaseSync(databaseFile);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requester TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT UNIQUE,
    created_at TEXT NOT NULL
  );
`);

const ticketCount = database.prepare("SELECT COUNT(*) AS count FROM tickets").get().count;
if (ticketCount === 0) {
  let starterTickets = seedTickets;
  try {
    starterTickets = JSON.parse(readFileSync(legacyTicketsFile, "utf8"));
    console.log("Migrating existing ticket data into SQLite…");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const insertTicket = database.prepare(`INSERT OR IGNORE INTO tickets
    (id, title, description, requester, email, status, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  database.exec("BEGIN");
  try {
    for (const ticket of starterTickets) insertTicket.run(ticket.id, ticket.title, ticket.description, ticket.requester, ticket.email, ticket.status, ticket.priority, ticket.createdAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listTickets() {
  return database.prepare(`SELECT id, title, description, requester, email, status, priority, created_at AS createdAt
    FROM tickets ORDER BY created_at DESC, id DESC`).all();
}

export function insertTicket(ticket) {
  database.prepare(`INSERT INTO tickets (id, title, description, requester, email, status, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ticket.id, ticket.title, ticket.description, ticket.requester, ticket.email, ticket.status, ticket.priority, ticket.createdAt);
  return ticket;
}

export function updateTicket(id, change) {
  const current = database.prepare(`SELECT id, title, description, requester, email, status, priority, created_at AS createdAt
    FROM tickets WHERE id = ?`).get(id);
  if (!current) return null;
  const updated = { ...current, ...change };
  database.prepare("UPDATE tickets SET status = ?, priority = ? WHERE id = ?").run(updated.status, updated.priority, id);
  return updated;
}

export function findUserByEmail(email) {
  return database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
}

export function findUserByProviderId(providerId) {
  return database.prepare("SELECT * FROM users WHERE provider_id = ?").get(providerId);
}

export function createUser(user) {
  database.prepare(`INSERT INTO users (id, name, email, password_hash, provider, provider_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(user.id, user.name, user.email, user.passwordHash, user.provider, user.providerId || null, user.createdAt);
  return user;
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, provider: user.provider === "google" ? "Google" : "Email and password" };
}
