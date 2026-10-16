import { useEffect, useState } from "react";
import { Activity, ArrowDown, ArrowUpRight, Bell, BookOpen, Building2, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Command, Copy, FileText, Filter, LayoutDashboard, LifeBuoy, LogOut, Mail, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";

const API_URL = "http://localhost:3001/api/tickets";
const API_ORIGIN = "http://localhost:3001";
const WORKSPACE_URL = `${API_ORIGIN}/api/workspaces`;
const statuses = ["Open", "In Progress", "Resolved"];
const priorities = ["Low", "Medium", "High"];
const articles = [
  { title: "Getting started with OpsDesk", category: "Workspace basics", read: "4 min read", summary: "Set up your workspace, invite teammates, and learn where the essentials live.", icon: Sparkles },
  { title: "Ticket statuses and when to use them", category: "Ticket management", read: "3 min read", summary: "A simple guide to Open, In Progress, and Resolved tickets.", icon: LifeBuoy },
  { title: "Writing a helpful support request", category: "For customers", read: "5 min read", summary: "What to include so the support team can resolve your issue faster.", icon: FileText },
  { title: "Prioritizing incoming requests", category: "Ticket management", read: "4 min read", summary: "Use Low, Medium, and High priority consistently across your queue.", icon: Activity },
  { title: "Managing customer information", category: "Workspace basics", read: "3 min read", summary: "Keep requester details accurate and easy for the team to find.", icon: Users },
  { title: "Troubleshooting login issues", category: "For customers", read: "6 min read", summary: "Steps to try when you cannot sign in to a company tool.", icon: ShieldCheck }
];

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function initials(name = "?") {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceNotice, setWorkspaceNotice] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceInviteCode, setWorkspaceInviteCode] = useState("");
  const [joiningWorkspace, setJoiningWorkspace] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] = useState(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceFormError, setWorkspaceFormError] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationError, setNotificationError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [summary, setSummary] = useState({ total: 0, open: 0, inProgress: 0, resolved: 0 });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [priorityFilter, setPriorityFilter] = useState("All priorities");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [activeNav, setActiveNav] = useState("Tickets");
  const [articleSearch, setArticleSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error") === "google_not_configured") setAuthError("Google sign-in is not configured yet. Add the Google OAuth values to server/.env and restart the API.");
    else if (params.has("auth_error")) setAuthError("Google sign-in could not be completed. Please try again.");
    if (params.has("auth") || params.has("auth_error")) window.history.replaceState({}, "", window.location.pathname);
    fetch(`${API_ORIGIN}/api/auth/session`, { credentials: "include" })
      .then((response) => response.json())
      .then((data) => { setAuthConfigured(data.googleConfigured); setUser(data.user); setWorkspaces(data.workspaces || []); })
      .catch(() => { setAuthConfigured(false); setUser(null); setAuthError("Could not connect to the OpsDesk server. Start the backend, then reload this page."); })
      .finally(() => setAuthLoading(false));
  }, []);

  async function submitAuthentication(event) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError("");
    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(`${API_ORIGIN}/api/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(Object.values(data.details || {})[0] || data.error || "Could not sign in.");
      setUser(data.user);
      setWorkspaces(data.workspaces || []);
    } catch (requestError) { setAuthError(requestError.message); }
    finally { setAuthSubmitting(false); }
  }

  async function signOut() {
    try { await fetch(`${API_ORIGIN}/api/auth/logout`, { method: "POST", credentials: "include" }); }
    finally { setUser(null); setProfileMenuOpen(false); }
  }

  async function toggleWorkspaceMenu() {
    const shouldOpen = !workspaceMenuOpen;
    setWorkspaceMenuOpen(shouldOpen);
    setProfileMenuOpen(false);
    setWorkspaceError("");
    if (shouldOpen) {
      try {
        const response = await fetch(WORKSPACE_URL, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load workspaces.");
        setWorkspaces(data.workspaces);
      } catch (requestError) { setWorkspaceError(requestError.message); }
    }
  }

  async function switchWorkspace(workspaceId) {
    setWorkspaceError("");
    try {
      const response = await fetch(`${WORKSPACE_URL}/switch`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ workspaceId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not switch workspaces.");
      setUser(data.user);
      setWorkspaceMenuOpen(false);
      setNotificationItems([]);
    } catch (requestError) { setWorkspaceError(requestError.message); }
  }

  async function joinWorkspace(event) {
    event.preventDefault();
    setJoiningWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${WORKSPACE_URL}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ inviteCode: workspaceInviteCode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not join that workspace.");
      setUser(data.user);
      setWorkspaces(data.workspaces);
      setWorkspaceInviteCode("");
      setWorkspaceMenuOpen(false);
      setNotificationItems([]);
    } catch (requestError) { setWorkspaceError(requestError.message); }
    finally { setJoiningWorkspace(false); }
  }

  async function createWorkspace(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreatingWorkspace(true);
    setWorkspaceFormError("");
    try {
      const response = await fetch(WORKSPACE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: form.get("workspaceName") }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create that workspace.");
      setUser(data.user);
      setWorkspaces(data.workspaces);
      setCreatedWorkspace(data.workspace);
      setWorkspaceModalOpen(false);
      setWorkspaceMenuOpen(false);
      setNotificationItems([]);
    } catch (requestError) { setWorkspaceFormError(requestError.message); }
    finally { setCreatingWorkspace(false); }
  }

  async function toggleNotifications() {
    const shouldOpen = !notificationOpen;
    setNotificationOpen(shouldOpen);
    setProfileMenuOpen(false);
    setWorkspaceMenuOpen(false);
    if (!shouldOpen) return;
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const response = await fetch(`${API_URL}?status=All`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load pending tickets.");
      const rank = { High: 0, Medium: 1, Low: 2 };
      const pending = data.tickets.filter((ticket) => ticket.status !== "Resolved");
      pending.sort((a, b) => rank[a.priority] - rank[b.priority] || new Date(a.createdAt) - new Date(b.createdAt));
      setNotificationItems(pending);
    } catch (requestError) { setNotificationError(requestError.message); }
    finally { setNotificationLoading(false); }
  }

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    setWorkspaceNotice(true);
    const timeout = setTimeout(() => setWorkspaceNotice(false), 5000);
    return () => clearTimeout(timeout);
  }, [workspaceMenuOpen]);

  async function copyPersonalId() {
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch { setAuthError("Could not copy the personal ID. Select and copy it from the profile menu."); }
  }

  function beginGoogleSignIn() {
    if (!authConfigured) {
      setAuthError("Google sign-in is not configured yet. Add the Google OAuth values to server/.env and restart the API.");
      return;
    }
    window.location.assign(`${API_ORIGIN}/api/auth/google`);
  }

  // Ask the API for the visible slice whenever a search or filter changes.
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (activeNav === "Tickets") {
        if (query.trim()) params.set("search", query.trim());
        if (statusFilter !== "All statuses") params.set("status", statusFilter);
        if (priorityFilter !== "All priorities") params.set("priority", priorityFilter);
      }
      try {
        const response = await fetch(`${API_URL}?${params}`, { signal: controller.signal, credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load tickets.");
        setTickets(data.tickets);
        setSummary(data.summary);
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message || "Could not connect to the API. Is the server running?");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, statusFilter, priorityFilter, activeNav, user?.id, user?.workspaceId]);

  async function refreshTickets() {
    const params = new URLSearchParams();
    if (activeNav === "Tickets") {
      if (query.trim()) params.set("search", query.trim());
      if (statusFilter !== "All statuses") params.set("status", statusFilter);
      if (priorityFilter !== "All priorities") params.set("priority", priorityFilter);
    }
    const response = await fetch(`${API_URL}?${params}`, { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not refresh tickets.");
    setTickets(data.tickets);
    setSummary(data.summary);
  }

  async function updateTicket(id, change) {
    setError("");
    try {
      const response = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change), credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update ticket.");
      await refreshTickets();
    } catch (requestError) { setError(requestError.message); }
  }

  async function createTicket(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setFormError("");
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || Object.values(data.details || {})[0] || "Could not create ticket.");
      setModalOpen(false);
      await refreshTickets();
      form.reset();
    } catch (requestError) { setFormError(requestError.message); }
    finally { setSaving(false); }
  }

  const customers = Object.values(tickets.reduce((grouped, ticket) => {
    const key = ticket.email.toLowerCase();
    if (!grouped[key]) grouped[key] = { name: ticket.requester, email: ticket.email, tickets: [], lastSeen: ticket.createdAt };
    grouped[key].tickets.push(ticket);
    if (new Date(ticket.createdAt) > new Date(grouped[key].lastSeen)) grouped[key].lastSeen = ticket.createdAt;
    return grouped;
  }, {})).sort((a, b) => b.tickets.length - a.tickets.length);

  const pageCopy = {
    Overview: ["Your support overview", "A live snapshot of the work moving through your support team."],
    Tickets: ["Ticket queue", "Manage and track incoming support requests."],
    Customers: ["Customers", "People who have contacted your support team."],
    "Knowledge base": ["Knowledge base", "Helpful guides for your team and customers."],
    Activity: ["Activity", "A timeline of the latest changes in your support queue."],
    Settings: ["Workspace settings", "Manage your team’s support workspace preferences."],
    "Help & resources": ["Help & resources", "Quick ways to get help using OpsDesk."],
    Plans: ["Plans for your team", "Explore the tools available as your support team grows."]
  }[activeNav] || [activeNav, "Your OpsDesk workspace."];

  if (authLoading) return <div className="auth-loading"><span className="spinner" /> Loading your workspace…</div>;
  if (!user) return <main className="sign-in-screen"><section className="sign-in-card"><div className="brand sign-in-brand"><div className="brand-mark"><Command size={19} strokeWidth={2.6} /></div><span>opsdesk<span className="brand-period">.</span></span></div><div className="sign-in-emblem"><LifeBuoy size={22} /></div><div className="eyebrow">STUDIO NORTH WORKSPACE</div><h1>{authMode === "register" ? "Create your account" : "Welcome back"}</h1><p className="sign-in-description">{authMode === "register" ? "Set up your OpsDesk account to manage your support queue." : "Sign in to pick up where your support team left off."}</p><div className="auth-mode-switch"><button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Sign in</button><button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>Create account</button></div><form className="auth-form" onSubmit={submitAuthentication}>{authMode === "register" && <label>Your name<input name="name" autoComplete="name" required maxLength="80" placeholder="Jordan Davis" /></label>}<label>Email address<input name="email" type="email" autoComplete="email" required maxLength="254" placeholder="you@company.com" /></label><label>Password<input name="password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} required minLength={authMode === "register" ? 10 : undefined} maxLength="128" placeholder={authMode === "register" ? "At least 10 characters" : "Enter your password"} /></label><label>Organisation invite code <span className="optional-label">(optional)</span><input name="inviteCode" autoComplete="organization" placeholder="Blank joins Studio North" /></label><p className="auth-hint">Studio North is the default workplace. Enter another organisation’s invite code to join it.</p>{authError && <div className="auth-message">{authError}</div>}<button className="primary-button auth-submit" type="submit" disabled={authSubmitting}>{authSubmitting ? <><span className="button-spinner" /> Please wait…</> : authMode === "register" ? "Create account" : "Sign in"}</button></form><div className="auth-separator"><span />or<span /></div><button className="google-button" onClick={beginGoogleSignIn} disabled={!authConfigured}><span className="google-g">G</span> Continue with Google</button>{authConfigured ? <p className="sign-in-footnote">Google sign-in uses the workspace’s configured OAuth client.</p> : <p className="sign-in-footnote">Google sign-in is optional. Configure OAuth in <code>server/.env</code> to enable it.</p>}</section><span className="sign-in-copyright">OpsDesk · Support workspace</span></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Command size={19} strokeWidth={2.6} /></div><span>opsdesk<span className="brand-period">.</span></span></div>
      <div className="workspace-menu-anchor"><button className="workspace-card" aria-expanded={workspaceMenuOpen} onClick={toggleWorkspaceMenu}><div className="workspace-avatar">{initials(user.workspaceName || "Studio North")[0]}</div><div className="workspace-copy"><strong>{user.workspaceName || "Studio North"}</strong><span>{user.role === "superuser" ? "Superuser" : "Free workspace"}</span></div><ChevronDown size={15} /></button>{workspaceMenuOpen && <div className="workspace-popover"><span className="popover-label">YOUR WORKSPACES</span>{workspaces.map((workspace) => <button key={workspace.id} className="workspace-option selectable" onClick={() => switchWorkspace(workspace.id)}><span className="workspace-avatar small">{initials(workspace.name)[0]}</span><span><strong>{workspace.name}</strong><small>{workspace.id === user.workspaceId ? "Active workspace" : "Switch workspace"}</small></span>{workspace.id === user.workspaceId && <Check size={15} />}</button>)}<div className="workspace-id"><span>Workspace ID</span><code>{user.workspaceId}</code></div><button className="popover-action" onClick={() => { setActiveNav("Settings"); setWorkspaceMenuOpen(false); }}>Manage workspace <ChevronRight size={14} /></button>{workspaceNotice && <div className="workspace-popover-note">Studio North is the default workspace.</div>}<form className="workspace-join-form" onSubmit={joinWorkspace}><label>Join an organisation<input value={workspaceInviteCode} onChange={(event) => setWorkspaceInviteCode(event.target.value)} placeholder="Invite code" /></label><button className="secondary-button" disabled={joiningWorkspace}>{joiningWorkspace ? "Joining…" : "Join"}</button></form>{workspaceError && <div className="form-error">{workspaceError}</div>}{["admin", "superuser"].includes(user.role) && <button className="popover-action" onClick={() => { setWorkspaceModalOpen(true); setWorkspaceFormError(""); }}>Create a workplace <Plus size={14} /></button>}</div>}</div>
      <div className="side-label">WORKSPACE</div>
      <nav className="main-nav">
        {[ [LayoutDashboard, "Overview"], [LifeBuoy, "Tickets"], [Users, "Customers"], [FileText, "Knowledge base"] ].map(([Icon, label]) => <button key={label} className={`nav-item ${activeNav === label ? "selected" : ""}`} onClick={() => setActiveNav(label)}><Icon size={17} /><span>{label}</span>{label === "Tickets" && <span className="nav-count">{summary.open}</span>}</button>)}
      </nav>
      <div className="side-label tools-label">TOOLS</div>
      <nav className="main-nav">{[[Activity, "Activity"], [Settings2, "Settings"]].map(([Icon, label]) => <button key={label} className={`nav-item ${activeNav === label ? "selected" : ""}`} onClick={() => setActiveNav(label)}><Icon size={17} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={16} /></div><strong>Make support<br />feel effortless.</strong><p>See what OpsDesk Pro can do for your team.</p><button onClick={() => setActiveNav("Plans")}>Explore Pro <ArrowUpRight size={14} /></button></div><button className={`help-link ${activeNav === "Help & resources" ? "selected" : ""}`} onClick={() => setActiveNav("Help & resources")}><CircleHelp size={16} /> Help & resources <ArrowUpRight size={13} /></button><div className="profile-menu-anchor"><button className="profile" aria-expanded={profileMenuOpen} onClick={() => { setProfileMenuOpen(!profileMenuOpen); setWorkspaceMenuOpen(false); }}><div className="profile-avatar">{initials(user.name)}</div><div className="profile-copy"><strong>{user.name}</strong><span>{user.provider === "Google" ? "Google account" : "Email account"}</span></div><ChevronDown size={15} /></button>{profileMenuOpen && <AccountPopover user={user} copied={copiedId} onCopy={copyPersonalId} onSignOut={signOut} />}</div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div><div className="topbar-actions"><div className="status-live"><span /> All systems operational</div><div className="notification-anchor"><button className="icon-button" aria-label="Notifications" aria-expanded={notificationOpen} onClick={toggleNotifications}><Bell size={18} />{notificationItems.length > 0 && <i />}</button>{notificationOpen && <div className="notification-popover"><div className="notification-heading"><span><strong>Needs attention</strong><small>{notificationItems.length} unresolved tickets</small></span><span className="notification-count">{notificationItems.filter((ticket) => ticket.priority === "High").length} high</span></div>{notificationLoading ? <div className="notification-empty">Loading pending tickets…</div> : notificationError ? <div className="notification-empty error-text">{notificationError}</div> : notificationItems.length ? notificationItems.map((ticket) => <button className="notification-item" key={ticket.id} onClick={() => { setNotificationOpen(false); setQuery(ticket.id); setActiveNav("Tickets"); }}><span className={`notification-priority ${ticket.priority.toLowerCase()}`} /><span><strong>{ticket.title}</strong><small>{ticket.priority} priority · {ticket.id} · {formatDate(ticket.createdAt)}</small></span></button>) : <div className="notification-empty">You’re all caught up.</div>}</div>}</div><div className="top-divider" /><div className="profile-menu-anchor top-profile-anchor"><button className="top-avatar" aria-label="Open account menu" aria-expanded={profileMenuOpen} onClick={() => { setProfileMenuOpen(!profileMenuOpen); setWorkspaceMenuOpen(false); setNotificationOpen(false); }}>{initials(user.name)}</button>{profileMenuOpen && <AccountPopover user={user} copied={copiedId} onCopy={copyPersonalId} onSignOut={signOut} />}</div></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> SUPPORT OPERATIONS</div><h1>{pageCopy[0]}{activeNav === "Overview" && <span className="wave"> ✳</span>}</h1><p>{pageCopy[1]}</p></div>{["Tickets", "Overview"].includes(activeNav) && <button className="primary-button" onClick={() => { setFormError(""); setModalOpen(true); }}><Plus size={17} strokeWidth={2.5} /> New ticket</button>}</div>

        {loading && <div className="page-loading"><span className="spinner" /> Loading workspace data…</div>}
        {!loading && error && <div className="page-error"><strong>Could not load workspace data</strong><span>{error}</span><button className="secondary-button" onClick={() => setActiveNav((current) => current)}>Try again</button></div>}
        {!loading && !error && activeNav === "Overview" && <OverviewPage tickets={tickets} summary={summary} onOpenTickets={() => setActiveNav("Tickets")} onUpdate={updateTicket} />}
        {!loading && !error && activeNav === "Tickets" && <>
        <section className="ticket-panel">
          <div className="panel-heading"><div><h2>Ticket queue</h2><p>Manage and track incoming support requests</p></div><button className="view-options" onClick={() => { setStatusFilter("All statuses"); setPriorityFilter("All priorities"); }}><SlidersHorizontal size={15} /> Clear filters</button></div>
          <div className="toolbar"><div className="search-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tickets..." aria-label="Search tickets" /><kbd>⌘ K</kbd></div><div className="filter-group"><div className="filter-select-wrap"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option>All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={13} /></div><div className="filter-select-wrap priority-filter"><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filter by priority"><option>All priorities</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select><ChevronDown size={13} /></div></div></div>
          <div className="table-scroll"><table><thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all tickets" /></th><th>TICKET</th><th>REQUESTER</th><th>STATUS</th><th>PRIORITY</th><th>CREATED</th><th className="more-col"></th></tr></thead>
            <tbody>{loading ? <tr><td colSpan="7"><div className="loading-state"><span className="spinner" /> Loading tickets…</div></td></tr> : error ? <tr><td colSpan="7"><div className="empty-state error-state"><span>{error}</span><button onClick={() => { setStatusFilter("All statuses"); setPriorityFilter("All priorities"); setQuery(""); }}>Try again</button></div></td></tr> : tickets.length === 0 ? <tr><td colSpan="7"><div className="empty-state"><div className="empty-icon"><Search size={19} /></div><strong>No tickets found</strong><span>Try changing your search or filters.</span></div></td></tr> : tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} onUpdate={updateTicket} />)}</tbody>
          </table></div>
          <div className="table-footer"><span>Showing <strong>{tickets.length ? 1 : 0}–{tickets.length}</strong> of <strong>{tickets.length}</strong> tickets</span><div className="pagination"><button disabled><ArrowDown className="flip-arrow" size={13} /> Previous</button><button className="next-page">Next <ArrowDown className="up-arrow" size={13} /></button></div></div>
        </section></>}
        {!loading && !error && activeNav === "Customers" && <CustomersPage customers={customers} onOpenTickets={(email) => { setQuery(email || ""); setStatusFilter("All statuses"); setPriorityFilter("All priorities"); setActiveNav("Tickets"); }} />}
        {!loading && !error && activeNav === "Knowledge base" && <KnowledgePage search={articleSearch} setSearch={setArticleSearch} onSelect={setSelectedArticle} />}
        {!loading && !error && activeNav === "Activity" && <ActivityPage tickets={tickets} />}
        {!loading && !error && activeNav === "Settings" && <SettingsPage saved={settingsSaved} onSave={(values) => { localStorage.setItem("opsdesk-settings", JSON.stringify(values)); setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2500); }} />}
        {!loading && !error && activeNav === "Help & resources" && <HelpPage onOpenKnowledge={() => setActiveNav("Knowledge base")} />}
        {!loading && !error && activeNav === "Plans" && <PlansPage onOpenSettings={() => setActiveNav("Settings")} onContact={() => setContactOpen(true)} />}
        <footer className="page-footer"><span>© 2026 OpsDesk, Inc.</span><div><span><i className="footer-dot" /> API connected</span><a href="http://localhost:3001/api/tickets" target="_blank" rel="noreferrer">API docs <ArrowUpRight size={12} /></a><button className="footer-link" onClick={() => setActiveNav("Help & resources")}>Help center</button></div></footer>
      </div>
    </main>

    {workspaceModalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceModalOpen(false); }}><section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title"><div className="modal-heading"><div><div className="eyebrow">ADMIN WORKSPACE SETUP</div><h2 id="workspace-modal-title">Create a workplace</h2><p>A separate support workspace will be created and selected.</p></div><button className="modal-close" onClick={() => setWorkspaceModalOpen(false)} aria-label="Close dialog"><X size={19} /></button></div><form onSubmit={createWorkspace}><label>Workplace name<input name="workspaceName" required minLength="2" maxLength="60" placeholder="e.g. Northwind Support" /></label>{workspaceFormError && <div className="form-error">{workspaceFormError}</div>}<div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setWorkspaceModalOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={creatingWorkspace}>{creatingWorkspace ? "Creating…" : "Create workplace"}</button></div></form></section></div>}
    {createdWorkspace && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatedWorkspace(null); }}><section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="created-workspace-title"><div className="modal-heading"><div><div className="eyebrow">WORKSPACE CREATED</div><h2 id="created-workspace-title">{createdWorkspace.name}</h2><p>Share this invite code with people who should join this workplace.</p></div><button className="modal-close" onClick={() => setCreatedWorkspace(null)} aria-label="Close dialog"><X size={19} /></button></div><div className="created-invite-code">{createdWorkspace.inviteCode}</div><div className="modal-actions"><button className="primary-button" onClick={() => setCreatedWorkspace(null)}>Done</button></div></section></div>}
    {contactOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setContactOpen(false); }}><section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title"><div className="modal-heading"><div><div className="eyebrow">OPS DESK PRO</div><h2 id="contact-modal-title">Talk to our team</h2><p>Tell us a little about your team and we’ll follow up.</p></div><button className="modal-close" onClick={() => setContactOpen(false)} aria-label="Close dialog"><X size={19} /></button></div><form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const subject = encodeURIComponent(`OpsDesk Pro enquiry from ${values.get("contactName")}`); const body = encodeURIComponent(`Name: ${values.get("contactName")}\nEmail: ${values.get("contactEmail")}\nOrganisation: ${values.get("organisation")}\nTeam size: ${values.get("teamSize")}\n\n${values.get("message")}`); window.location.href = `mailto:Sales@opsdesk.com?subject=${subject}&body=${body}`; setContactOpen(false); }}><div className="form-row"><label>Your name<input name="contactName" required maxLength="80" defaultValue={user.name} /></label><label>Work email<input name="contactEmail" type="email" required maxLength="254" defaultValue={user.email} /></label></div><label>Organisation<input name="organisation" required maxLength="100" defaultValue={user.workspaceName} /></label><label>Team size<select name="teamSize" defaultValue="2–10"><option>1</option><option>2–10</option><option>11–50</option><option>51–200</option><option>201+</option></select></label><label>What would help your team?<textarea name="message" rows="3" maxLength="1000" placeholder="Share your needs or questions…" /></label><p className="auth-hint">This opens your email app addressed to Sales@opsdesk.com.</p><div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setContactOpen(false)}>Cancel</button><button className="primary-button" type="submit"><Mail size={15} /> Contact sales</button></div></form></section></div>}
    {selectedArticle && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedArticle(null); }}><section className="ticket-modal article-modal" role="dialog" aria-modal="true" aria-labelledby="article-title"><div className="modal-heading"><div><div className="eyebrow">{selectedArticle.category.toUpperCase()} · {selectedArticle.read.toUpperCase()}</div><h2 id="article-title">{selectedArticle.title}</h2><p>{selectedArticle.summary}</p></div><button className="modal-close" onClick={() => setSelectedArticle(null)} aria-label="Close article"><X size={19} /></button></div><div className="article-body"><p>{selectedArticle.summary} This guide is part of your OpsDesk starter library.</p><h3>Recommended steps</h3><ol><li>Start with the details provided in the request.</li><li>Confirm the requester and any relevant account information.</li><li>Update the ticket status as work progresses so your team can follow along.</li></ol><p>If you still need help, contact your workspace administrator or create a support ticket.</p></div><div className="modal-actions"><button className="primary-button" onClick={() => setSelectedArticle(null)}>Done</button></div></section></div>}
    {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><div className="eyebrow">SUPPORT REQUEST</div><h2 id="modal-title">Create a ticket</h2><p>Add a request to your support queue.</p></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close dialog"><X size={19} /></button></div><form onSubmit={createTicket}><label>Ticket title<input name="title" required maxLength="120" placeholder="e.g. Can't access shared drive" /></label><label>Description<textarea name="description" required maxLength="1000" rows="4" placeholder="Tell us a little more about the issue..." /></label><div className="form-row"><label>Requester<input name="requester" required maxLength="80" placeholder="Full name" /></label><label>Email<input name="email" type="email" required placeholder="name@company.com" /></label></div><label>Priority<select name="priority" defaultValue="Medium">{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>{formError && <div className="form-error">{formError}</div>}<div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <><span className="button-spinner" /> Creating…</> : <><Plus size={16} /> Create ticket</>}</button></div></form></section></div>}
  </div>;
}

function Metric({ label, number, icon: Icon, iconColor, helper }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${iconColor}`}><Icon size={17} /></span></div><div className="metric-number">{number.toString().padStart(2, "0")}</div><div className="metric-bottom"><span className={`metric-status ${iconColor}`}><i /> {helper}</span></div></article>;
}

function OverviewPage({ tickets, summary, onOpenTickets, onUpdate }) {
  const recentTickets = [...tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  const highPriority = tickets.filter((ticket) => ticket.priority === "High" && ticket.status !== "Resolved");
  const statusRows = [["Open", summary.open, "amber"], ["In Progress", summary.inProgress, "blue"], ["Resolved", summary.resolved, "green"]];
  return <div className="page-stack">
    <section className="metrics-grid overview-metrics" aria-label="Ticket summary">
      <Metric label="Total tickets" number={summary.total} icon={LifeBuoy} iconColor="violet" helper="Across all requests" />
      <Metric label="Open" number={summary.open} icon={Clock3} iconColor="amber" helper="Needs attention" />
      <Metric label="In progress" number={summary.inProgress} icon={Activity} iconColor="blue" helper="Being worked on" />
      <Metric label="Resolved" number={summary.resolved} icon={ShieldCheck} iconColor="green" helper="Successfully closed" />
    </section>
    <div className="overview-columns">
      <section className="content-card"><div className="content-card-heading"><div><h2>Recent tickets</h2><p>Newest requests in your queue</p></div><button className="text-button" onClick={onOpenTickets}>View all <ChevronRight size={14} /></button></div>
        {recentTickets.length ? <div className="recent-list">{recentTickets.map((ticket) => <div className="recent-item" key={ticket.id}><span className={`recent-priority priority-dot-${ticket.priority.toLowerCase()}`} /><div className="recent-main"><strong>{ticket.title}</strong><span>{ticket.id} · {ticket.requester}</span></div><StatusBadge status={ticket.status} /></div>)}</div> : <BlankState text="Your new tickets will show up here." />}
      </section>
      <section className="content-card"><div className="content-card-heading"><div><h2>Queue health</h2><p>Current ticket distribution</p></div><span className="health-icon"><Activity size={17} /></span></div>
        <div className="queue-total"><strong>{summary.total}</strong><span>tickets in your workspace</span></div><div className="queue-bar">{summary.total > 0 && <><i className="bar-open" style={{ width: `${summary.open / summary.total * 100}%` }} /><i className="bar-progress" style={{ width: `${summary.inProgress / summary.total * 100}%` }} /><i className="bar-resolved" style={{ width: `${summary.resolved / summary.total * 100}%` }} /></>}</div><div className="queue-legend">{statusRows.map(([label, count, tone]) => <div key={label}><span className={`legend-dot ${tone}`} /><span>{label}</span><strong>{count}</strong></div>)}</div>
      </section>
    </div>
    <section className="content-card priority-card"><div className="content-card-heading"><div><h2>High priority attention</h2><p>Unresolved tickets marked High priority</p></div><span className="priority-total">{highPriority.length} open</span></div>{highPriority.length ? <div className="priority-list">{highPriority.slice(0, 3).map((ticket) => <div className="priority-row" key={ticket.id}><div><span className="ticket-id">{ticket.id}</span><strong>{ticket.title}</strong><span className="priority-requester">Requested by {ticket.requester}</span></div><select className={`status-pill status-${ticket.status.toLowerCase().replaceAll(" ", "-")}`} value={ticket.status} onChange={(event) => onUpdate(ticket.id, { status: event.target.value })} aria-label={`Status for ${ticket.id}`}><option>Open</option><option>In Progress</option><option>Resolved</option></select></div>)}</div> : <BlankState text="No unresolved high priority tickets." />}</section>
  </div>;
}

function CustomersPage({ customers, onOpenTickets }) {
  const [search, setSearch] = useState("");
  const visible = customers.filter((customer) => `${customer.name} ${customer.email}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="content-card customers-card"><div className="content-card-heading"><div><h2>Customer directory</h2><p>{customers.length} people have submitted support requests</p></div><div className="search-wrap customer-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers..." aria-label="Search customers" /></div></div>
    {visible.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>CUSTOMER</th><th>EMAIL</th><th>TICKETS</th><th>LATEST REQUEST</th><th></th></tr></thead><tbody>{visible.map((customer) => <tr key={customer.email}><td><div className="requester"><span className={`requester-avatar avatar-${customer.name.charCodeAt(0) % 5}`}>{initials(customer.name)}</span><strong>{customer.name}</strong></div></td><td>{customer.email}</td><td><span className="customer-ticket-count">{customer.tickets.length}</span></td><td>{formatDate(customer.lastSeen)}</td><td><button className="text-button" onClick={() => onOpenTickets(customer.email)}>View tickets <ChevronRight size={13} /></button></td></tr>)}</tbody></table></div> : <BlankState text="No customers match your search." />}
  </section>;
}

function KnowledgePage({ search, setSearch, onSelect }) {
  const visibleArticles = articles.filter((article) => `${article.title} ${article.category} ${article.summary}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack"><section className="knowledge-hero"><div className="knowledge-copy"><span className="hero-icon"><BookOpen size={19} /></span><div><span className="eyebrow">THE OPSDESK LIBRARY</span><h2>Answers, all in one place.</h2><p>Browse practical guides for your support team and customers.</p></div></div><div className="search-wrap knowledge-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search articles..." aria-label="Search knowledge base" /></div></section>
    <div className="article-heading"><div><h2>Browse all articles</h2><p>{visibleArticles.length} guides to help you get things done</p></div></div><div className="article-grid">{visibleArticles.map((article) => <button className="article-card" key={article.title} onClick={() => onSelect(article)}><span className="article-icon"><article.icon size={17} /></span><span className="article-category">{article.category}</span><strong>{article.title}</strong><span className="article-summary">{article.summary}</span><span className="article-read">{article.read}<ArrowUpRight size={13} /></span></button>)}</div>{!visibleArticles.length && <BlankState text="No guides match that search." />}
  </div>;
}

function ActivityPage({ tickets }) {
  const activity = [...tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return <section className="content-card activity-card"><div className="content-card-heading"><div><h2>Recent activity</h2><p>Latest ticket events from your workspace</p></div><span className="activity-count">{activity.length} events</span></div>{activity.length ? <div className="timeline">{activity.map((ticket) => <div className="timeline-item" key={ticket.id}><span className="timeline-icon"><Plus size={14} /></span><div className="timeline-copy"><strong>Ticket created <span>{ticket.id}</span></strong><p><b>{ticket.requester}</b> submitted “{ticket.title}”</p><div className="timeline-meta"><span>{formatDate(ticket.createdAt)}</span><StatusBadge status={ticket.status} /></div></div></div>)}</div> : <BlankState text="Ticket events will appear here." />}</section>;
}

function SettingsPage({ saved, onSave }) {
  const [tab, setTab] = useState("General");
  const [preferences, setPreferences] = useState(() => {
    try { return JSON.parse(localStorage.getItem("opsdesk-settings")) || {}; }
    catch { return {}; }
  });
  function savePreferences(values) { setPreferences(values); onSave(values); }
  const tabs = [["General", Building2], ["Team", Users], ["Notifications", Bell]];
  const stored = { name: "Studio North", email: "support@studionorth.example", priority: "Medium", emailNotifications: true, weeklySummary: true, ...preferences };
  return <div className="settings-layout"><div className="settings-nav">{tabs.map(([label, Icon]) => <button key={label} className={`settings-tab ${tab === label ? "active" : ""}`} onClick={() => setTab(label)}><Icon size={16} /> {label}</button>)}</div><section className="content-card settings-card">
    {tab === "General" && <><div className="content-card-heading"><div><h2>Workspace details</h2><p>Basic information about your support workspace.</p></div></div><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); savePreferences({ ...stored, name: form.get("name"), email: form.get("email"), priority: form.get("priority") }); }}><label className="settings-label">Workspace name<span>Shown to your team in OpsDesk.</span><input name="name" defaultValue={stored.name} /></label><label className="settings-label">Support email<span>Where customers can reach your support team.</span><input name="email" type="email" defaultValue={stored.email} /></label><label className="settings-label">Default ticket priority<span>Used for new requests when no priority is selected.</span><select name="priority" defaultValue={stored.priority}><option>Low</option><option>Medium</option><option>High</option></select></label><SaveSettings saved={saved} /></form></>}
    {tab === "Team" && <><div className="content-card-heading"><div><h2>Team members</h2><p>People who can access this support workspace.</p></div><span className="activity-count">1 member</span></div><div className="team-member"><span className="profile-avatar">JD</span><div><strong>Jordan Davis</strong><span>jordan@studionorth.example</span></div><span className="role-pill">Admin</span></div><div className="settings-note">Team invitations are not enabled in this local MVP.</div></>}
    {tab === "Notifications" && <><div className="content-card-heading"><div><h2>Notification preferences</h2><p>Choose which workspace updates you receive.</p></div></div><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); savePreferences({ ...stored, emailNotifications: form.has("emailNotifications"), weeklySummary: form.has("weeklySummary") }); }}><label className="toggle-setting"><span><strong>Email notifications</strong><small>Get notified when a ticket is created or updated.</small></span><input name="emailNotifications" type="checkbox" defaultChecked={stored.emailNotifications} /></label><label className="toggle-setting"><span><strong>Weekly queue summary</strong><small>Receive a weekly snapshot of your ticket queue.</small></span><input name="weeklySummary" type="checkbox" defaultChecked={stored.weeklySummary} /></label><SaveSettings saved={saved} /></form></>}
  </section></div>;
}

function SaveSettings({ saved }) {
  return <div className="settings-actions">{saved && <span className="saved-message"><CheckCircle2 size={15} /> Preferences saved</span>}<button className="primary-button" type="submit"><Check size={15} /> Save changes</button></div>;
}

function HelpPage({ onOpenKnowledge }) {
  return <div className="help-grid"><section className="content-card help-card"><span className="help-card-icon"><BookOpen size={20} /></span><h2>Browse the knowledge base</h2><p>Step-by-step guides for tickets, customer requests, and workspace basics.</p><button className="secondary-button" onClick={onOpenKnowledge}>Explore articles <ArrowUpRight size={14} /></button></section><section className="content-card help-card"><span className="help-card-icon"><Mail size={20} /></span><h2>Talk to our team</h2><p>Need a hand with OpsDesk? Send a note and we’ll help you get sorted.</p><a className="secondary-button" href="mailto:help@opsdesk.example">Email support <ArrowUpRight size={14} /></a></section><section className="content-card help-card"><span className="help-card-icon"><LifeBuoy size={20} /></span><h2>Ticket workflow guide</h2><p>Learn how your team can use statuses and priorities to keep work moving.</p><button className="secondary-button" onClick={onOpenKnowledge}>See ticket guides <ArrowUpRight size={14} /></button></section></div>;
}

function PlansPage({ onOpenSettings, onContact }) {
  return <section className="plan-card"><span className="plan-sparkle"><Sparkles size={21} /></span><span className="eyebrow">OPS DESK PRO</span><h2>Support that grows<br />with your team.</h2><p>This MVP workspace is ready for your first support queue. Keep using the core ticket tools while you explore what a larger team could need.</p><div className="plan-features"><span><CheckCircle2 size={16} /> Shared ticket workspace</span><span><CheckCircle2 size={16} /> Customer directory</span><span><CheckCircle2 size={16} /> Team preferences</span></div><div className="plan-actions"><button className="primary-button" onClick={onOpenSettings}>Review workspace settings <ChevronRight size={15} /></button><button className="secondary-button" onClick={onContact}><Mail size={15} /> Contact about Pro</button></div><small>Plan information is a preview for this local demo.</small></section>;
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}><i />{status}</span>;
}

function BlankState({ text }) {
  return <div className="blank-state"><span className="empty-icon"><Search size={18} /></span><span>{text}</span></div>;
}

function TicketRow({ ticket, onUpdate }) {
  return <tr><td className="check-col"><input type="checkbox" aria-label={`Select ${ticket.id}`} /></td><td><div className="ticket-info"><span className="ticket-id">{ticket.id}</span><strong>{ticket.title}</strong><span className="ticket-desc">{ticket.description}</span></div></td><td><div className="requester"><span className={`requester-avatar avatar-${ticket.requester.charCodeAt(0) % 5}`}>{initials(ticket.requester)}</span><div><strong>{ticket.requester}</strong><span>{ticket.email}</span></div></div></td><td><select className={`status-pill status-${ticket.status.toLowerCase().replaceAll(" ", "-")}`} value={ticket.status} onChange={(event) => onUpdate(ticket.id, { status: event.target.value })} aria-label={`Status for ${ticket.id}`}><option value="Open">● &nbsp;Open</option><option value="In Progress">● &nbsp;In progress</option><option value="Resolved">● &nbsp;Resolved</option></select></td><td><select className={`priority-pill priority-${ticket.priority.toLowerCase()}`} value={ticket.priority} onChange={(event) => onUpdate(ticket.id, { priority: event.target.value })} aria-label={`Priority for ${ticket.id}`}><option value="High">↑ &nbsp;High</option><option value="Medium">— &nbsp;Medium</option><option value="Low">↓ &nbsp;Low</option></select></td><td className="date-cell">{formatDate(ticket.createdAt)}</td><td className="more-col"><button className="row-more" aria-label={`More actions for ${ticket.id}`}><MoreDots /></button></td></tr>;
}

function MoreDots() { return <span className="more-dots">•••</span>; }

function AccountPopover({ user, copied, onCopy, onSignOut }) {
  return <div className="account-popover"><div className="account-popover-head"><span className="profile-avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div><div className="personal-id-row"><span><small>PERSONAL ID</small><code>{user.id}</code></span><button aria-label="Copy personal ID" title="Copy personal ID" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><div className="provider-row"><span className="google-g small-g">{user.provider === "Google" ? "G" : "@"}</span><span><strong>{user.provider === "Google" ? "Google account" : "Email and password"}</strong><small>{user.provider === "Google" ? "Connected with OAuth" : "Local account"}</small></span></div><button className="sign-out-button" onClick={onSignOut}><LogOut size={15} /> Sign out</button></div>;
}
