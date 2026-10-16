import express from "express";
import cors from "cors";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { readTickets, saveTickets } from "./ticketStore.js";

loadLocalEnvironment();

const app = express();
const port = process.env.PORT || 3001;
const frontendUrl = process.env.APP_URL || "http://localhost:5173";
const cookieName = "opsdesk_session";
const stateCookieName = "opsdesk_oauth_state";
const demoUser = { id: "usr_demo_7f2a9c", name: "Jordan Davis", email: "jordan@studionorth.example", picture: null, provider: "Demo workspace" };
const statuses = ["Open", "In Progress", "Resolved"];
const priorities = ["Low", "Medium", "High"];

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
  const signature = createHmac("sha256", process.env.OAUTH_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSessionUser(request) {
  if (!googleOAuthIsConfigured()) return null;
  const [encoded, signature] = getCookie(request, cookieName).split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", process.env.OAUTH_SESSION_SECRET).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.expiresAt < Date.now()) return null;
    return payload.user;
  } catch { return null; }
}

app.get("/api/auth/session", (request, response) => {
  const configured = googleOAuthIsConfigured();
  response.json({ configured, user: configured ? readSessionUser(request) : demoUser });
});

app.post("/api/auth/logout", (request, response) => {
  response.clearCookie(cookieName, cookieOptions(0));
  response.json({ signedOut: true });
});

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

    const user = { id: `google_${profile.sub}`, name: profile.name || profile.email, email: profile.email, picture: profile.picture || null, provider: "Google" };
    const session = signSession({ user, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    response.cookie(cookieName, session, cookieOptions(7 * 24 * 60 * 60 * 1000));
    response.redirect(`${frontendUrl}/?auth=success`);
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    response.redirect(`${frontendUrl}/?auth_error=oauth_failed`);
  }
});

app.use("/api/tickets", (request, response, next) => {
  if (!googleOAuthIsConfigured() || readSessionUser(request)) return next();
  response.status(401).json({ error: "Sign in with Google to access this workspace." });
});

app.get("/api/tickets", async (request, response, next) => {
  try {
    const tickets = await readTickets();
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

    const tickets = await readTickets();
    const highestNumber = tickets.reduce((highest, ticket) => Math.max(highest, Number(ticket.id.split("-")[1]) || 0), 1000);
    const ticket = {
      id: `OPS-${highestNumber + 1}`,
      title: title.trim(), description: description.trim(), requester: requester.trim(), email: email.trim(),
      status: "Open", priority, createdAt: new Date().toISOString()
    };
    tickets.unshift(ticket);
    await saveTickets(tickets);
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

    const tickets = await readTickets();
    const index = tickets.findIndex((ticket) => ticket.id === request.params.id);
    if (index === -1) return response.status(404).json({ error: "Ticket not found." });
    tickets[index] = { ...tickets[index], ...(status ? { status } : {}), ...(priority ? { priority } : {}) };
    await saveTickets(tickets);
    response.json({ ticket: tickets[index] });
  } catch (error) { next(error); }
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).json({ error: "The server could not complete that request." });
});

app.listen(port, () => console.log(`OpsDesk API listening on http://localhost:${port}`));
