const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const notice = document.querySelector("#notice");
const findButton = document.querySelector("#find-jobs");
let state = {
  jobs: [],
  profile: null,
  sourceClaims: [],
  dashboard: null,
  sources: null,
  settings: null,
};

const pageNames = {
  dashboard: "Dashboard",
  discover: "Discover Jobs",
  saved: "Saved Jobs",
  applications: "Applications",
  profile: "Profile",
  sources: "Sources",
  settings: "Settings",
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function refresh() {
  const [jobs, profile, dashboard, sources, settings] = await Promise.all([
    api("/api/jobs?includeDismissed=true&includeClosed=true"),
    api("/api/profile"),
    api("/api/dashboard"),
    api("/api/sources"),
    api("/api/settings"),
  ]);
  state = {
    jobs,
    profile: profile.profile,
    sourceClaims: profile.sourceClaims,
    dashboard,
    sources,
    settings,
  };
  findButton.disabled = dashboard.discoveryRunning;
  findButton.textContent = dashboard.discoveryRunning
    ? "Discovery running…"
    : "Find New Jobs";
  render();
}

function currentRoute() {
  return (location.hash.slice(1) || "dashboard").split(":")[0];
}
function render() {
  const route = currentRoute();
  title.textContent = pageNames[route] || "Job Analysis";
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.hash === `#${route}`));
  if (location.hash.startsWith("#job:"))
    return renderJobDetail(location.hash.slice(5));
  (
    ({
      dashboard: renderDashboard,
      discover: () => renderJobs(activeJobs(state.jobs)),
      saved: () => renderJobs(activeJobs(state.jobs).filter((x) => x.saved)),
      applications: renderApplications,
      profile: renderProfile,
      sources: renderSources,
      settings: renderSettings,
    })[route] || renderDashboard
  )();
}

function renderDashboard() {
  const d = state.dashboard,
    c = d.recommendationCounts || {};
  app.innerHTML = `<div class="grid stats">${stat("Jobs found today", d.jobsFoundToday)}${stat("Strong Apply", c["strong-apply"] || 0)}${stat("Apply", c.apply || 0)}${stat("Stretch", c.stretch || 0)}${stat("Eligibility unclear", c["eligibility-unclear"] || 0)}${stat("Needs AI analysis", d.jobsNeedingAnalysis)}${stat("Source failures", d.sourceFailures)}${stat("Total ranked", state.jobs.length)}</div>
  <div class="panel"><div class="panel-head"><div><div class="eyebrow">LATEST RUN</div><h2>${e(d.lastRun?.status || "No discovery run yet")}</h2></div><button class="secondary" data-demo>Load fictional demo</button></div>
  ${d.lastRun ? `<div class="job-meta"><span>${d.lastRun.jobsDiscovered} discovered</span><span>${d.lastRun.jobsImported} imported</span><span>${d.lastRun.duplicatesFound} duplicates</span><span>${d.lastRun.jobsAnalysed} AI-analysed</span></div>${d.lastRun.errors.length ? `<ul class="evidence-list">${d.lastRun.errors.map((x) => `<li>${e(x.source)}: ${e(x.message)}</li>`).join("")}</ul>` : ""}` : `<p class="muted">Configure a company source or load the fictional demo, then press Find New Jobs.</p>`}</div>
  <div class="panel"><div class="panel-head"><h2>Top opportunities</h2><a class="muted small" href="#discover">View all</a></div>${jobCards(activeJobs(state.jobs).slice(0, 5))}</div>`;
  bindCommon();
  document.querySelector("[data-demo]")?.addEventListener("click", seedDemo);
}

function renderJobs(items, options = {}) {
  const dismissedCount = state.jobs.filter((x) => x.dismissed).length;
  app.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>${options.showDismissed ? "Dismissed jobs" : "Job opportunities"}</h2><p class="muted small">${options.showDismissed ? "Restore a role to return it to discovery." : "Dismissed and closed roles are hidden from this view."}</p></div>${!options.showDismissed && dismissedCount ? `<button class="secondary" data-show-dismissed>Show dismissed (${dismissedCount})</button>` : ""}</div><div class="filters"><label>Recommendation<select id="f-rec"><option value="">All</option>${["strong-apply", "apply", "stretch", "eligibility-unclear", "low-priority", "skip"].map((x) => `<option>${x}</option>`).join("")}</select></label><label>Minimum score<input id="f-score" type="number" min="0" max="100" value="0"></label><label>Country<select id="f-country"><option value="">All</option>${uniq(
    items.map((x) => x.job.country).filter(Boolean),
  )
    .map((x) => `<option>${e(x)}</option>`)
    .join(
      "",
    )}</select></label><label>Workplace<select id="f-work"><option value="">All</option><option>remote</option><option>hybrid</option><option>onsite</option><option>unknown</option></select></label><label>Trust<select id="f-trust"><option value="">All</option><option>verified</option><option>likely-legitimate</option><option>unverified</option><option>suspicious</option></select></label></div><div id="filtered">${jobCards(items)}</div></div>`;
  ["f-rec", "f-score", "f-country", "f-work", "f-trust"].forEach((id) =>
    document
      .querySelector(`#${id}`)
      .addEventListener("input", () => filterJobs(items)),
  );
  bindCommon();
}

function renderDismissedJobs() {
  renderJobs(
    state.jobs.filter((x) => x.dismissed),
    { showDismissed: true },
  );
}

function filterJobs(items) {
  const v = (id) => document.querySelector(`#${id}`).value;
  const filtered = items.filter(
    (x) =>
      (!v("f-rec") || x.match?.recommendation === v("f-rec")) &&
      (!v("f-country") || x.job.country === v("f-country")) &&
      (!v("f-work") || x.job.workplaceType === v("f-work")) &&
      (!v("f-trust") || x.trust?.level === v("f-trust")) &&
      (x.match?.score || 0) >= Number(v("f-score")),
  );
  document.querySelector("#filtered").innerHTML = jobCards(filtered);
  bindCommon();
}

function jobCards(items) {
  if (!items.length)
    return `<div class="empty">No jobs match this view yet.</div>`;
  return `<div class="job-list">${items.map((x) => `<article class="job-card"><div><h3><a href="#job:${encodeURIComponent(x.job.id)}">${e(x.job.title)}</a></h3><div class="company">${e(x.job.company)}${x.job.company.includes("Fictional") ? ` · <span class="fictional">FICTIONAL DEMO</span>` : ""}</div><div class="job-meta"><span>${e(x.job.locationText || "Location not stated")}</span><span>${e(x.job.workplaceType)}</span><span>${e(x.job.sourceType)}</span><span>${date(x.job.publishedAt || x.job.firstSeenAt)}</span></div><div class="badges"><span class="badge ${x.match?.recommendation || ""}">${e(x.match?.recommendation || "unanalysed")}</span><span class="badge ${x.trust?.level || ""}">${e(x.trust?.level || "unverified")}</span><span class="badge ${x.workAuthorization?.status || ""}">${e(x.workAuthorization?.status || "unknown eligibility")}</span><span class="badge">${x.salary?.advertisedSalary ? money(x.salary.advertisedSalary) : x.salary?.estimatedMarketRange ? `estimate ${money(x.salary.estimatedMarketRange)}` : "salary evidence unavailable"}</span></div><div class="actions"><button class="ghost" data-save="${e(x.job.id)}">${x.saved ? "Unsave" : "Save"}</button><button class="ghost" data-apply="${e(x.job.id)}">Mark applied</button><button class="ghost" data-dismiss="${e(x.job.id)}">${x.dismissed ? "Restore" : "Dismiss"}</button><a class="secondary" target="_blank" rel="noopener noreferrer" href="${e(x.job.canonicalUrl)}">Open official application</a></div></div><div class="score">${Math.round(x.match?.score || 0)}</div></article>`).join("")}</div>`;
}

function renderJobDetail(id) {
  const x = state.jobs.find((item) => item.job.id === decodeURIComponent(id));
  if (!x) {
    app.innerHTML = `<div class="empty">Job not found.</div>`;
    return;
  }
  const breakdown = Object.entries(x.match?.components || {})
    .map(
      ([name, c]) =>
        `<div class="bar"><span>${e(name)}</span><i><span style="width:${Math.max(0, Math.min(100, c.score))}%"></span></i><b>${Math.round(c.score)}</b></div>`,
    )
    .join("");
  app.innerHTML = `<div class="panel"><div class="panel-head"><div><div class="eyebrow">${e(x.job.sourceType)} · ${e(x.job.status)}</div><h2>${e(x.job.title)}</h2><p class="muted">${e(x.job.company)} · ${e(x.job.locationText || "Location not stated")}</p></div><div class="score">${Math.round(x.match?.score || 0)}</div></div><div class="actions"><a class="primary" target="_blank" rel="noopener noreferrer" href="${e(x.job.canonicalUrl)}">Open official application</a><button class="secondary" data-save="${e(x.job.id)}">${x.saved ? "Unsave" : "Save"}</button><button class="secondary" data-apply="${e(x.job.id)}">Mark applied</button></div></div>
  <div class="detail-grid"><div><div class="panel"><h2>Match breakdown</h2><div class="breakdown">${breakdown}</div></div><div class="panel"><h2>Original job information</h2><p class="muted">${e(x.job.description)}</p></div><div class="panel"><h2>Gaps and candidate evidence</h2>${list(x.match?.gaps.map((g) => `${g.severity}: ${g.requirement} — ${g.explanation}`) || [])}</div><div class="panel"><h2>Detailed local-AI analysis</h2>${x.match?.detailedAnalysis ? `<pre class="code">${e(JSON.stringify(x.match.detailedAnalysis, null, 2))}</pre>` : `<p class="muted">Pending or unavailable. The deterministic score remains usable.</p>`}</div></div>
  <div><div class="panel"><h2>Trust assessment</h2><p><span class="badge ${x.trust?.level || ""}">${e(x.trust?.level || "unverified")}</span></p>${list([...(x.trust?.evidence || []), ...(x.trust?.suspiciousSignals || [])])}</div><div class="panel"><h2>Work authorisation</h2><p><span class="badge ${x.workAuthorization?.status || ""}">${e(x.workAuthorization?.status || "unknown")}</span></p><p class="muted">${e(x.workAuthorization?.explanation || "")}</p><p class="small muted">${e(x.workAuthorization?.disclaimer || "")}</p></div><div class="panel"><h2>Salary evidence</h2><p>${x.salary?.advertisedSalary ? money(x.salary.advertisedSalary) : x.salary?.estimatedMarketRange ? money(x.salary.estimatedMarketRange) : "Insufficient evidence"}</p><p class="muted">${e(x.salary?.explanation || "")}</p><p class="small muted">${x.salary?.evidenceCount || 0} evidence item(s). Current baseline: AED 22,000 monthly. ${e(x.salary?.comparisonStatus || "")}</p>${list((x.salary?.evidence || []).map((item) => `${item.sourceName} · ${money(item)} · collected ${date(item.collectedAt)}`))}</div><div class="panel"><h2>Source history</h2><p class="small muted">${e(x.job.sourceName || x.job.sourceType)}<br>Last verified: ${date(x.job.lastVerifiedAt)}</p></div></div></div>`;
  bindCommon();
}

function renderProfile() {
  const p = state.profile;
  app.innerHTML = `<form id="profile-form"><div class="panel"><div class="panel-head"><div><h2>CV and extracted claims</h2><p class="muted small">${state.sourceClaims.length} fields are marked as CV-derived.</p></div><label class="secondary">Upload / re-extract CV<input id="cv-file" type="file" accept=".pdf,.txt,.md" hidden></label></div><p class="muted">Extraction uses the configured local Ollama model. Files are limited to 5 MB and stored privately under data/uploads.</p></div><div class="panel"><h2>Personal context</h2><div class="form-grid"><label>Current city<input name="city" value="${e(p.personal.currentCity || "")}"></label><label>Current country<input name="country" value="${e(p.personal.currentCountry || "")}"></label><label>Citizenship<input name="citizenship" value="${e(p.personal.citizenship || "")}"></label><label>Requires work permit<select name="permit"><option value="true" ${p.personal.requiresWorkPermit ? "selected" : ""}>Yes</option><option value="false" ${!p.personal.requiresWorkPermit ? "selected" : ""}>No</option></select></label><label class="wide">Profile summary<textarea name="summary">${e(p.summary || "")}</textarea></label></div></div><div class="panel"><h2>Discovery preferences</h2><div class="form-grid"><label class="wide">Target roles (one per line)<textarea name="roles">${e(p.targetRoles.join("\n"))}</textarea></label><label>Target countries (one per line)<textarea name="countries">${e(p.targetCountries.join("\n"))}</textarea></label><label>Excluded companies (one per line)<textarea name="excluded">${e(p.preferences.excludedCompanies.join("\n"))}</textarea></label><label>Maximum job age (days)<input name="age" type="number" min="1" max="365" value="${p.preferences.maximumJobAgeDays}"></label><label>Relocation<select name="relocation"><option value="true" ${p.preferences.relocationAllowed ? "selected" : ""}>Allowed</option><option value="false" ${!p.preferences.relocationAllowed ? "selected" : ""}>Not allowed</option></select></label></div><div class="actions"><button class="primary" type="submit">Save profile</button></div></div><div class="panel"><h2>Skills and evidence</h2>${list(p.skills.map((s) => `${s.name} · ${s.proficiency} · ${Math.round(s.confidence * 100)}% confidence${s.evidence.length ? ` · ${s.evidence[0]}` : ""}`))}</div></form>`;
  document
    .querySelector("#profile-form")
    .addEventListener("submit", saveProfile);
  document.querySelector("#cv-file").addEventListener("change", uploadCv);
}

async function saveProfile(event) {
  event.preventDefault();
  const f = new FormData(event.currentTarget),
    lines = (n) =>
      String(f.get(n) || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
  const p = {
    ...state.profile,
    personal: {
      ...state.profile.personal,
      currentCity: String(f.get("city")),
      currentCountry: String(f.get("country")),
      citizenship: String(f.get("citizenship")),
      requiresWorkPermit: f.get("permit") === "true",
    },
    summary: String(f.get("summary")),
    targetRoles: lines("roles"),
    targetCountries: lines("countries"),
    preferences: {
      ...state.profile.preferences,
      excludedCompanies: lines("excluded"),
      maximumJobAgeDays: Number(f.get("age")),
      relocationAllowed: f.get("relocation") === "true",
    },
  };
  await action(
    () => api("/api/profile", { method: "PUT", body: JSON.stringify(p) }),
    "Profile saved.",
  );
}
async function uploadCv(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return show("CV exceeds 5 MB.");
  const dataBase64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  await action(
    () =>
      api("/api/profile/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, dataBase64 }),
      }),
    "CV extracted and profile updated.",
  );
}

function renderSources() {
  const s = state.sources;
  app.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Internet discovery</h2><p class="muted">${s.webSearchConfigured ? `${e(s.webSearchProvider)} is configured.` : "Broad internet discovery needs WEB_SEARCH_PROVIDER and WEB_SEARCH_API_KEY. ATS feeds still work without a key."}</p></div></div></div><div class="panel"><h2>Company registry</h2>${
    s.companies.length
      ? s.companies
          .map((c) => {
            const status = (s.sourceStatuses || []).find(
              (item) => item.companyId === c.id,
            );
            return `<div class="source-card"><div><strong>${e(c.name)}</strong><div class="job-meta"><span>${e(c.atsProvider || "unsupported/custom")}</span><span>${e(c.atsIdentifier || "identifier missing")}</span><span>checked ${e(c.lastCheckedAt || "never")}</span><span>last success ${e(status?.lastSuccessAt || "never")}</span></div>${status?.lastError ? `<p class="small fictional">${e(status.lastError)}</p>` : ""}</div><div class="actions"><button class="ghost" data-source-toggle="${e(c.id)}">${c.enabled ? "Disable" : "Enable"}</button><button class="secondary" data-source-sync="${e(c.id)}">Sync</button></div></div>`;
          })
          .join("")
      : `<div class="empty">No companies configured. Add a verified public ATS board below.</div>`
  }</div><form id="company-form" class="panel"><h2>Add company source</h2><div class="form-grid"><label>Name<input name="name" required></label><label>Company domain<input name="domain" placeholder="example.com" required></label><label>ATS<select name="ats"><option>greenhouse</option><option>lever</option><option>ashby</option></select></label><label>Public ATS identifier<input name="identifier" required></label><label class="wide">Countries (comma-separated)<input name="countries"></label></div><div class="actions"><button class="primary">Add source</button></div><p class="small muted">Identifiers are user-provided and are only treated as working after a successful sync.</p></form>`;
  document
    .querySelector("#company-form")
    .addEventListener("submit", addCompany);
  document
    .querySelectorAll("[data-source-toggle]")
    .forEach((b) =>
      b.addEventListener("click", () => toggleSource(b.dataset.sourceToggle)),
    );
  document
    .querySelectorAll("[data-source-sync]")
    .forEach((b) =>
      b.addEventListener("click", () => syncSource(b.dataset.sourceSync)),
    );
}
async function addCompany(event) {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  await action(
    () =>
      api("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          companyDomain: f.get("domain"),
          atsProvider: f.get("ats"),
          atsIdentifier: f.get("identifier"),
          countries: String(f.get("countries") || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          enabled: true,
        }),
      }),
    "Company source added.",
  );
}
async function toggleSource(id) {
  const c = state.sources.companies.find((x) => x.id === id);
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...c, enabled: !c.enabled }),
      }),
    "Source updated.",
  );
}
async function syncSource(id) {
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}/sync`, {
        method: "POST",
        body: "{}",
      }),
    "Source sync started.",
  );
}

function renderApplications() {
  const apps = state.jobs.filter((x) => x.application);
  const statuses = [
    "saved",
    "preparing",
    "applied",
    "recruiter-contact",
    "interview",
    "assessment",
    "offer",
    "rejected",
    "withdrawn",
  ];
  app.innerHTML = `<div class="panel"><div class="panel-head"><h2>Application tracking</h2><span class="muted small">Manual submission only</span></div>${apps.length ? `<div class="job-list">${apps.map((x) => `<form class="source-card" data-application-form="${e(x.job.id)}"><div class="wide"><strong>${e(x.job.title)}</strong><p class="muted small">${e(x.job.company)} · updated ${date(x.application.updatedAt)}</p><div class="form-grid"><label>Status<select name="status">${statuses.map((status) => `<option value="${status}" ${x.application.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>CV version<input name="cvVersion" value="${e(x.application.cvVersion || "")}"></label><label>Follow up<input name="followUpAt" type="date" value="${e(x.application.followUpAt || "")}"></label><label>Next action<input name="nextAction" value="${e(x.application.nextAction || "")}"></label><label class="wide">Recruiter details<textarea name="recruiterDetails">${e(x.application.recruiterDetails || "")}</textarea></label><label class="wide">Notes<textarea name="notes">${e(x.application.notes || "")}</textarea></label><label class="wide">Interview dates (one per line)<textarea name="interviewDates">${e(x.application.interviewDates.join("\n"))}</textarea></label></div></div><div class="actions"><a class="secondary" href="#job:${encodeURIComponent(x.job.id)}">Open</a><button class="primary" type="submit">Save tracking</button></div></form>`).join("")}</div>` : `<div class="empty">Mark a job as applied to start tracking it.</div>`}</div>`;
  document
    .querySelectorAll("[data-application-form]")
    .forEach((form) => form.addEventListener("submit", saveApplicationDetails));
}

async function saveApplicationDetails(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const text = (name) => String(fields.get(name) || "").trim();
  await action(
    () =>
      api(
        `/api/jobs/${encodeURIComponent(form.dataset.applicationForm)}/application`,
        {
          method: "POST",
          body: JSON.stringify({
            status: text("status"),
            cvVersion: text("cvVersion"),
            followUpAt: text("followUpAt") || undefined,
            nextAction: text("nextAction"),
            recruiterDetails: text("recruiterDetails"),
            notes: text("notes"),
            interviewDates: text("interviewDates")
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
          }),
        },
      ),
    "Application tracking saved.",
  );
}

function renderSettings() {
  const s = state.settings;
  app.innerHTML = `<div class="two-col"><div class="panel"><h2>Local AI</h2>${settingsRows(
    [
      ["Provider", s.aiProvider],
      ["Ollama", s.ollamaBaseUrl],
      ["Extraction", s.extractionModel],
      ["Reasoning", s.reasoningModel],
      ["Embeddings", s.embeddingModel],
      ["Detailed limit", s.detailedAnalysisLimit],
    ],
  )}</div><div class="panel"><h2>Discovery</h2>${settingsRows([
    ["Database", s.database],
    ["Web search", s.webSearchProvider || "Not configured"],
    [
      "Search key",
      s.webSearchApiKeyConfigured ? "Configured (hidden)" : "Not configured",
    ],
  ])}</div></div><div class="panel"><h2>Privacy and limitations</h2><p class="muted">${e(s.privacy)}</p><p class="muted">A local language model does not independently browse the internet. Configure company/ATS sources or an internet-search provider to discover new job URLs.</p><p class="muted">Work-authorisation is preliminary evidence, not legal advice. Salary does not include tax or cost-of-living normalisation.</p></div>`;
}

function bindCommon() {
  document.querySelectorAll("[data-save]").forEach((b) =>
    b.addEventListener("click", () =>
      jobAction(b.dataset.save, "save", {
        saved: !state.jobs.find((x) => x.job.id === b.dataset.save).saved,
      }),
    ),
  );
  document.querySelectorAll("[data-dismiss]").forEach((b) =>
    b.addEventListener("click", () =>
      jobAction(b.dataset.dismiss, "dismiss", {
        dismissed: !state.jobs.find((x) => x.job.id === b.dataset.dismiss)
          .dismissed,
      }),
    ),
  );
  document
    .querySelectorAll("[data-apply]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        jobAction(b.dataset.apply, "application", { status: "applied" }),
      ),
    );
  document
    .querySelector("[data-show-dismissed]")
    ?.addEventListener("click", renderDismissedJobs);
}
async function jobAction(id, kind, body) {
  await action(
    () =>
      api(`/api/jobs/${encodeURIComponent(id)}/${kind}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    kind === "application" ? "Application marked as applied." : "Job updated.",
  );
}
async function seedDemo() {
  await action(
    () => api("/api/demo", { method: "POST", body: "{}" }),
    "Fictional demo discovery started.",
  );
}
async function runDiscovery() {
  await action(
    () => api("/api/discovery", { method: "POST", body: "{}" }),
    "Discovery started. Progress will refresh automatically.",
  );
}
async function action(work, message) {
  try {
    await work();
    show(message);
    await refresh();
  } catch (error) {
    show(error.message, true);
  }
}
function show(message, bad = false) {
  notice.textContent = message;
  notice.style.borderColor = bad ? "#713640" : "";
  setTimeout(() => {
    notice.textContent = "";
  }, 6000);
}
function stat(label, value) {
  return `<div class="stat"><span>${e(label)}</span><strong>${e(String(value ?? 0))}</strong></div>`;
}
function list(items) {
  return items.length
    ? `<ul class="evidence-list">${items.map((x) => `<li>${e(x)}</li>`).join("")}</ul>`
    : `<p class="muted">No evidence recorded.</p>`;
}
function settingsRows(rows) {
  return rows
    .map(
      ([a, b]) =>
        `<p><span class="muted small">${e(String(a))}</span><br>${e(String(b))}</p>`,
    )
    .join("");
}
function money(r) {
  const range =
    r.minimum !== undefined && r.maximum !== undefined
      ? `${num(r.minimum)}–${num(r.maximum)}`
      : num(r.minimum ?? r.maximum);
  return `${e(r.currency)} ${range} / ${e(r.period)}`;
}
function num(v) {
  return v === undefined ? "?" : new Intl.NumberFormat().format(v);
}
function date(v) {
  return v ? new Date(v).toLocaleDateString() : "Not available";
}
function uniq(a) {
  return [...new Set(a)];
}
function activeJobs(items) {
  return items.filter((x) => !x.dismissed && x.job.status !== "closed");
}
function e(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

findButton.addEventListener("click", runDiscovery);
window.addEventListener("hashchange", render);
refresh().catch((error) => {
  app.innerHTML = `<div class="empty">${e(error.message)}</div>`;
});
setInterval(() => {
  if (state.dashboard?.discoveryRunning) refresh().catch(() => {});
}, 3000);
