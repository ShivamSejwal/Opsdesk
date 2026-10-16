import express from "express";
import cors from "cors";
import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { addUserToWorkspace, createUser, createWorkspaceForUser, findUserByEmail, findUserById, findUserByProviderId, getDefaultWorkspace, getHighestTicketNumber, getUserInWorkspace, getWorkspaceByInviteCode, insertTicket, listTickets, listWorkspacesForUser, publicUser, updateTicket } from "./database.js";

loadLocalEnvironment();

const app = express();
const port = process.env.PORT || 3001;
const frontendUrl = process.env.APP_URL || "http://localhost:5173";
const cookieName = "opsdesk_session";
const stateCookieName = "opsdesk_oauth_state";
const statuses = ["Open", "In Progress", "Resolved"];
const priorities = ["Low", "Medium", "High"];
const derivePasswordKey = promisify(pbkdf2);
const passwordHashIterations = 600_000;
const sessionSecret = getSessionSecret();

function loadLocalEnvironment() {
  try {
    const file = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getSessionSecret() {
  if (process.env.OAUTH_SESSION_SECRET) return process.env.OAUTH_SESSION_SECRET;
  const secretFile = new URL("../data/session.secret", import.meta.url);
  try { return readFileSync(secretFile, "utf8").trim(); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const secret = randomBytes(32).toString("hex");
    try { writeFileSync(secretFile, secret, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (writeError) { if (writeError.code !== "EEXIST") throw writeError; }
    return readFileSync(secretFile, "utf8").trim();
  }
}

app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json({ limit: "20kb" }));

function googleOAuthIsConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.OAUTH_SESSION_SECRET);
}

function cookieOptions(maxAge) {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSessionUser(request) {
  const [encoded, signature] = getCookie(request, cookieName).split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", sessionSecret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.expiresAt < Date.now()) return null;
    return payload.user;
  } catch { return null; }
}

function currentUser(request) {
  const sessionUser = readSessionUser(request);
  return sessionUser ? publicUser(findUserById(sessionUser.id), sessionUser.workspaceId) : null;
}

function setUserSession(response, user) {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  response.cookie(cookieName, signSession({ user, expiresAt: Date.now() + maxAge }), cookieOptions(maxAge));
}

function visibleWorkspaces(user) {
  if (!user) return [];
  return listWorkspacesForUser(user.id).map((workspace) => {
    const { accountRole, ...details } = workspace;
    if (user.role === "admin" || user.role === "superuser") return details;
    const { inviteCode, ...memberDetails } = details;
    return memberDetails;
  });
}

function requireSignedIn(request, response, next) {
  const user = currentUser(request);
  if (!user) return response.status(401).json({ error: "Please sign in to access this workspace." });
  request.user = user;
  next();
}

app.get("/api/auth/session", (request, response) => {
  const user = currentUser(request);
  response.json({ googleConfigured: googleOAuthIsConfigured(), user, workspaces: visibleWorkspaces(user) });
});

app.post("/api/auth/logout", (request, response) => {
  response.clearCookie(cookieName, cookieOptions(0));
  response.json({ signedOut: true });
});

app.post("/api/auth/register", async (request, response, next) => {
  try {
    const { name, email, password, inviteCode } = request.body || {};
    const errors = {};
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) errors.name = "Enter your name (up to 80 characters).";
    if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (typeof password !== "string" || password.length < 10 || password.length > 128) errors.password = "Choose a password between 10 and 128 characters.";
    if (inviteCode !== undefined && typeof inviteCode !== "string") errors.inviteCode = "Enter a valid organisation invite code.";
    if (Object.keys(errors).length) return response.status(400).json({ error: "Please check your account details.", details: errors });

    const normalizedEmail = email.trim().toLowerCase();
    if (findUserByEmail(normalizedEmail)) return response.status(409).json({ error: "An account already uses that email. Sign in instead." });
    const workspace = inviteCode?.trim() ? getWorkspaceByInviteCode(inviteCode.trim()) : getDefaultWorkspace();
    if (!workspace) return response.status(400).json({ error: "That organisation invite code was not found." });
    const salt = randomBytes(16).toString("hex");
    const derivedKey = await derivePasswordKey(password, salt, passwordHashIterations, 32, "sha256");
    const user = createUser({
      id: `usr_${randomBytes(8).toString("hex")}`,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: `pbkdf2_sha256$${passwordHashIterations}$${salt}$${derivedKey.toString("hex")}`,
      provider: "local",
      createdAt: new Date().toISOString()
    });
    addUserToWorkspace(user.id, workspace.id);
    const safeUser = publicUser(user, workspace.id);
    setUserSession(response, safeUser);
    response.status(201).json({ user: safeUser, workspaces: visibleWorkspaces(safeUser) });
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) return response.status(409).json({ error: "An account already uses that email. Sign in instead." });
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const { email, password, inviteCode } = request.body || {};
    if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 128) {
      return response.status(400).json({ error: "Enter your email and password." });
    }
    if (inviteCode !== undefined && typeof inviteCode !== "string") return response.status(400).json({ error: "Enter a valid organisation invite code." });
    const user = findUserByEmail(email.trim().toLowerCase());
    const validPassword = user?.provider === "local" && user.password_hash
      ? await verifyPassword(password, user.password_hash)
      : false;
    if (!validPassword) return response.status(401).json({ error: "Email or password is incorrect." });
    let workspace;
    if (inviteCode?.trim()) {
      workspace = getWorkspaceByInviteCode(inviteCode.trim());
      if (!workspace) return response.status(400).json({ error: "That organisation invite code was not found." });
      addUserToWorkspace(user.id, workspace.id);
    } else {
      workspace = listWorkspacesForUser(user.id)[0] || getDefaultWorkspace();
      addUserToWorkspace(user.id, workspace.id);
    }
    const safeUser = publicUser(user, workspace.id);
    setUserSession(response, safeUser);
    response.json({ user: safeUser, workspaces: visibleWorkspaces(safeUser) });
  } catch (error) { next(error); }
});

async function verifyPassword(password, storedHash) {
  const [algorithm, iterationsText, salt, expectedHex] = storedHash.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2_sha256" || iterations !== passwordHashIterations || !salt || !/^[a-f0-9]{64}$/i.test(expectedHex || "")) return false;
  const actual = await derivePasswordKey(password, salt, iterations, 32, "sha256");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

app.get("/api/auth/google", (request, response) => {
  if (!googleOAuthIsConfigured()) return response.redirect(`${frontendUrl}/?auth_error=google_not_configured`);
  const state = randomBytes(24).toString("base64url");
  response.cookie(stateCookieName, state, cookieOptions(5 * 60 * 1000));
  const callbackUrl = `http://localhost:${port}/api/auth/google/callback`;
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  }).toString();
  response.redirect(authorization.toString());
});

app.get("/api/auth/google/callback", async (request, response) => {
  const stateCookie = getCookie(request, stateCookieName);
  response.clearCookie(stateCookieName, cookieOptions(0));
  if (!googleOAuthIsConfigured() || !stateCookie || stateCookie !== request.query.state || !request.query.code) {
    return response.redirect(`${frontendUrl}/?auth_error=oauth_failed`);
  }
  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/auth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: request.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error("Google did not return an access token.");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) throw new Error("Google did not return a verified profile.");

    let account = findUserByProviderId(profile.sub);
    if (!account) {
      if (findUserByEmail(profile.email)) throw new Error("An account already exists for that email. Sign in with its original method.");
      account = createUser({ id: `google_${profile.sub}`, name: profile.name || profile.email, email: profile.email.toLowerCase(), passwordHash: null, provider: "google", providerId: profile.sub, createdAt: new Date().toISOString() });
    }
    const defaultWorkspace = getDefaultWorkspace();
    addUserToWorkspace(account.id, defaultWorkspace.id);
    const user = publicUser(account, defaultWorkspace.id);
    setUserSession(response, user);
    response.redirect(`${frontendUrl}/?auth=success`);
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    response.redirect(`${frontendUrl}/?auth_error=oauth_failed`);
  }
});

app.use("/api/workspaces", requireSignedIn);
app.get("/api/workspaces", (request, response) => response.json({ workspaces: visibleWorkspaces(request.user) }));

app.post("/api/workspaces", (request, response, next) => {
  try {
    if (!["admin", "superuser"].includes(request.user.role)) return response.status(403).json({ error: "Only an admin or superuser can create a workspace." });
    const { name } = request.body || {};
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) return response.status(400).json({ error: "Enter a workspace name between 2 and 60 characters." });
    const workspace = createWorkspaceForUser(request.user, name);
    const user = publicUser(findUserById(request.user.id), workspace.id);
    setUserSession(response, user);
    response.status(201).json({ workspace, user, workspaces: visibleWorkspaces(user) });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed: workspaces.name")) return response.status(409).json({ error: "A workspace with that name already exists." });
    next(error);
  }
});

app.post("/api/workspaces/join", (request, response) => {
  const { inviteCode } = request.body || {};
  if (typeof inviteCode !== "string" || !inviteCode.trim()) return response.status(400).json({ error: "Enter an organisation invite code." });
  const workspace = getWorkspaceByInviteCode(inviteCode.trim());
  if (!workspace) return response.status(404).json({ error: "That organisation invite code was not found." });
  addUserToWorkspace(request.user.id, workspace.id);
  const user = publicUser(findUserById(request.user.id), workspace.id);
  setUserSession(response, user);
  response.json({ user, workspaces: visibleWorkspaces(user), joined: workspace.name });
});

app.post("/api/workspaces/switch", (request, response) => {
  const { workspaceId } = request.body || {};
  const user = typeof workspaceId === "string" ? publicUser(findUserById(request.user.id), workspaceId) : null;
  if (!user) return response.status(404).json({ error: "That workspace is not available to this account." });
  setUserSession(response, user);
  response.json({ user });
});

app.use("/api/tickets", requireSignedIn);

app.get("/api/tickets", async (request, response, next) => {
  try {
    const tickets = listTickets(request.user.workspaceId);
    const summary = {
      total: tickets.length,
      open: tickets.filter((ticket) => ticket.status === "Open").length,
      inProgress: tickets.filter((ticket) => ticket.status === "In Progress").length,
      resolved: tickets.filter((ticket) => ticket.status === "Resolved").length
    };
    const { status, priority, search } = request.query;
    const filtered = tickets.filter((ticket) => {
      const matchesStatus = !status || status === "All" || ticket.status === status;
      const matchesPriority = !priority || priority === "All" || ticket.priority === priority;
      const searchable = `${ticket.id} ${ticket.title} ${ticket.description} ${ticket.requester} ${ticket.email}`.toLowerCase();
      return matchesStatus && matchesPriority && searchable.includes((search || "").trim().toLowerCase());
    });
    response.json({ tickets: filtered, summary });
  } catch (error) { next(error); }
});

app.post("/api/tickets", async (request, response, next) => {
  try {
    const { title, description, requester, email, priority } = request.body || {};
    const errors = {};
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120) errors.title = "Enter a title (up to 120 characters).";
    if (typeof description !== "string" || !description.trim() || description.trim().length > 1000) errors.description = "Enter a description (up to 1,000 characters).";
    if (typeof requester !== "string" || !requester.trim() || requester.trim().length > 80) errors.requester = "Enter a requester name (up to 80 characters).";
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (!priorities.includes(priority)) errors.priority = "Choose Low, Medium, or High.";
    if (Object.keys(errors).length) return response.status(400).json({ error: "Please check the ticket details.", details: errors });

    const ticket = {
      id: `OPS-${getHighestTicketNumber() + 1}`,
      title: title.trim(), description: description.trim(), requester: requester.trim(), email: email.trim(),
      status: "Open", priority, createdAt: new Date().toISOString()
    };
    insertTicket(ticket, request.user.workspaceId);
    response.status(201).json({ ticket });
  } catch (error) { next(error); }
});

app.patch("/api/tickets/:id", async (request, response, next) => {
  try {
    const { status, priority } = request.body || {};
    const errors = {};
    if (status === undefined && priority === undefined) errors.update = "Provide a status or priority to update.";
    if (status !== undefined && !statuses.includes(status)) errors.status = "Choose Open, In Progress, or Resolved.";
    if (priority !== undefined && !priorities.includes(priority)) errors.priority = "Choose Low, Medium, or High.";
    if (Object.keys(errors).length) return response.status(400).json({ error: "Invalid ticket update.", details: errors });

    const ticket = updateTicket(request.params.id, request.user.workspaceId, { ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
    if (!ticket) return response.status(404).json({ error: "Ticket not found." });
    response.json({ ticket });
  } catch (error) { next(error); }
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).json({ error: "The server could not complete that request." });
});

app.listen(port, () => console.log(`OpsDesk API listening on http://localhost:${port}`));
