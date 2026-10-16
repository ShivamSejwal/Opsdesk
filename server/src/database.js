import { mkdirSync, readFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
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
    workspace_id TEXT,
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
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    invite_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
  );
`);

// Add the role field when upgrading a database made by an earlier OpsDesk version.
const userColumns = database.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("role")) database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
const ticketColumns = database.prepare("PRAGMA table_info(tickets)").all().map((column) => column.name);
if (!ticketColumns.includes("workspace_id")) database.exec("ALTER TABLE tickets ADD COLUMN workspace_id TEXT");

const now = new Date().toISOString();
database.prepare(`INSERT OR IGNORE INTO workspaces (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)`)
  .run("ws_studionorth_01", "Studio North", "STUDIONORTH", now);

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

// Bootstrap the requested local superuser. The database stores only its salted password hash.
const adminEmail = "shiv@gmail.com";
let admin = database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(adminEmail);
if (!admin) {
  const salt = randomBytes(16).toString("hex");
  const key = pbkdf2Sync("12345", salt, 600_000, 32, "sha256").toString("hex");
  database.prepare(`INSERT INTO users (id, name, email, password_hash, provider, role, created_at)
    VALUES (?, ?, ?, ?, 'local', 'superuser', ?)`)
    .run("usr_superuser_shiv", "Shiv", adminEmail, `pbkdf2_sha256$600000$${salt}$${key}`, now);
  admin = database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(adminEmail);
} else if (admin.role !== "superuser") {
  database.prepare("UPDATE users SET role = 'superuser' WHERE id = ?").run(admin.id);
  admin.role = "superuser";
}

const defaultWorkspace = database.prepare("SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE").get("Studio North");
database.prepare("UPDATE tickets SET workspace_id = ? WHERE workspace_id IS NULL").run(defaultWorkspace.id);
database.prepare("INSERT OR IGNORE INTO workspace_memberships (user_id, workspace_id, joined_at) SELECT id, ?, ? FROM users")
  .run(defaultWorkspace.id, now);
database.prepare("INSERT OR IGNORE INTO workspace_memberships (user_id, workspace_id, joined_at) VALUES (?, ?, ?)")
  .run(admin.id, defaultWorkspace.id, now);

export function listTickets(workspaceId) {
  return database.prepare(`SELECT id, title, description, requester, email, status, priority, created_at AS createdAt
    FROM tickets WHERE workspace_id = ? ORDER BY created_at DESC, id DESC`).all(workspaceId);
}

export function getHighestTicketNumber() {
  const ids = database.prepare("SELECT id FROM tickets WHERE id LIKE 'OPS-%'").all();
  return ids.reduce((highest, row) => Math.max(highest, Number(row.id.slice(4)) || 0), 1000);
}

export function insertTicket(ticket, workspaceId) {
  database.prepare(`INSERT INTO tickets (id, workspace_id, title, description, requester, email, status, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ticket.id, workspaceId, ticket.title, ticket.description, ticket.requester, ticket.email, ticket.status, ticket.priority, ticket.createdAt);
  return ticket;
}

export function updateTicket(id, workspaceId, change) {
  const current = database.prepare(`SELECT id, title, description, requester, email, status, priority, created_at AS createdAt
    FROM tickets WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
  if (!current) return null;
  const updated = { ...current, ...change };
  database.prepare("UPDATE tickets SET status = ?, priority = ? WHERE id = ? AND workspace_id = ?").run(updated.status, updated.priority, id, workspaceId);
  return updated;
}

export function findUserByEmail(email) {
  return database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
}

export function findUserByProviderId(providerId) {
  return database.prepare("SELECT * FROM users WHERE provider_id = ?").get(providerId);
}

export function findUserById(id) {
  return database.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function createUser(user) {
  database.prepare(`INSERT INTO users (id, name, email, password_hash, provider, provider_id, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, user.name, user.email, user.passwordHash, user.provider, user.providerId || null, user.role || "member", user.createdAt);
  return user;
}

export function getWorkspaceByInviteCode(code) {
  return database.prepare("SELECT * FROM workspaces WHERE invite_code = ? COLLATE NOCASE").get(code.trim());
}

export function getWorkspaceById(id) {
  return database.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
}

export function getDefaultWorkspace() {
  return getWorkspaceById("ws_studionorth_01");
}

export function addUserToWorkspace(userId, workspaceId) {
  database.prepare("INSERT OR IGNORE INTO workspace_memberships (user_id, workspace_id, joined_at) VALUES (?, ?, ?)")
    .run(userId, workspaceId, new Date().toISOString());
}

export function listWorkspacesForUser(userId) {
  return database.prepare(`SELECT w.id, w.name, w.invite_code AS inviteCode, m.joined_at AS joinedAt, u.role AS accountRole
    FROM workspaces w
    JOIN workspace_memberships m ON m.workspace_id = w.id
    JOIN users u ON u.id = m.user_id
    WHERE u.id = ? ORDER BY w.created_at ASC`).all(userId);
}

export function createWorkspaceForUser(user, name) {
  const workspace = { id: `ws_${randomBytes(8).toString("hex")}`, name: name.trim(), inviteCode: `OPS-${randomBytes(4).toString("hex").toUpperCase()}`, createdAt: new Date().toISOString() };
  database.exec("BEGIN");
  try {
    database.prepare("INSERT INTO workspaces (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.inviteCode, workspace.createdAt);
    addUserToWorkspace(user.id, workspace.id);
    database.exec("COMMIT");
    return workspace;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getUserInWorkspace(userId, workspaceId) {
  const user = findUserById(userId);
  if (!user) return null;
  const workspace = workspaceId
    ? database.prepare(`SELECT w.* FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id WHERE m.user_id = ? AND w.id = ?`).get(userId, workspaceId)
    : listWorkspacesForUser(userId)[0];
  if (!workspace) return null;
  return { ...user, workspaceId: workspace.id, workspaceName: workspace.name };
}

export function publicUser(user, workspaceId = user.workspaceId) {
  const current = getUserInWorkspace(user.id, workspaceId);
  if (!current) return null;
  return {
    id: current.id,
    name: current.name,
    email: current.email,
    provider: current.provider === "google" ? "Google" : "Email and password",
    role: current.role,
    workspaceId: current.workspaceId,
    workspaceName: current.workspaceName
  };
}
