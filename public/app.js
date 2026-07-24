const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const notice = document.querySelector("#notice");
const findButton = document.querySelector("#find-jobs");
const resetJobsButton = document.querySelector("#reset-jobs");
let state = {
  jobs: [],
  profile: null,
  sourceClaims: [],
  dashboard: null,
  sources: null,
  companyPage: null,
  jobFilters: {},
  companyFilters: {
    country: "",
    status: "",
    search: "",
    atsProvider: "",
    sponsorshipEvidence: "",
    engineeringRelevance: "",
    boardState: "",
    hiringSourceClassification: "",
  },
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
  const [jobs, profile, dashboard, sources, settings, companyPage] =
    await Promise.all([
      api(
        "/api/jobs?includeDismissed=true&includeClosed=true&includeSkipped=true",
      ),
      api("/api/profile"),
      api("/api/dashboard"),
      api("/api/sources"),
      api("/api/settings"),
      api("/api/companies?page=1&pageSize=25"),
    ]);
  state = {
    jobs,
    profile: profile.profile,
    sourceClaims: profile.sourceClaims,
    dashboard,
    sources,
    settings,
    companyPage,
    jobFilters: state.jobFilters,
    companyFilters: state.companyFilters,
  };
  updateDiscoveryControls(dashboard);
  render();
}

function updateDiscoveryControls(dashboard) {
  findButton.disabled = dashboard.discoveryRunning;
  resetJobsButton.disabled = dashboard.discoveryRunning;
  findButton.textContent = dashboard.discoveryRunning
    ? "Discovery running…"
    : "Find New Jobs";
}

async function refreshDashboard() {
  const dashboard = await api("/api/dashboard");
  const wasRunning = state.dashboard?.discoveryRunning;
  state = { ...state, dashboard };
  updateDiscoveryControls(dashboard);
  if (wasRunning && !dashboard.discoveryRunning) return refresh();
  if (currentRoute() === "dashboard") render();
}

function currentRoute() {
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/" || pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/jobs/")) return "job";
  return pathname.slice(1);
}

function currentJobId() {
  try {
    return decodeURIComponent(location.pathname.slice("/jobs/".length));
  } catch {
    return "";
  }
}

function routePath(route) {
  return route === "dashboard" ? "/" : `/${route}`;
}

function migrateLegacyHashRoute() {
  const legacyRoute = location.hash.slice(1);
  if (!legacyRoute) return;
  const route = legacyRoute.startsWith("job:")
    ? `/jobs/${legacyRoute.slice("job:".length)}`
    : routePath(legacyRoute);
  if (
    [
      "dashboard",
      "discover",
      "saved",
      "applications",
      "profile",
      "sources",
      "settings",
    ].includes(legacyRoute) ||
    legacyRoute.startsWith("job:")
  )
    history.replaceState(null, "", route);
}
function render() {
  const route = currentRoute();
  title.textContent =
    pageNames[route] || (route === "job" ? "Job Analysis" : "Dashboard");
  const detailBack = document.querySelector("#detail-back");
  detailBack.hidden = route !== "job";
  detailBack.onclick =
    route === "job"
      ? () => {
          history.pushState(null, "", "/discover");
          render();
        }
      : null;
  resetJobsButton.hidden = route === "job";
  document
    .querySelectorAll("nav a")
    .forEach((a) =>
      a.classList.toggle("active", a.pathname === routePath(route)),
    );
  if (route === "job") return renderJobDetail(currentJobId());
  (
    ({
      dashboard: renderDashboard,
      discover: () => renderJobs(activeJobs(state.jobs)),
      saved: () =>
        renderJobs(
          activeJobs(state.jobs).filter((x) => x.saved),
          {
            defaultMinimumScore: 0,
          },
        ),
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
  <div class="panel"><div class="panel-head"><div><div class="eyebrow">LATEST RUN</div><h2>${e(d.lastRun?.status || "No discovery run yet")}</h2></div></div>
  ${d.lastRun ? `<div class="job-meta"><span>${d.lastRun.jobsDiscovered} discovered</span><span>${d.lastRun.jobsImported} imported</span><span>${d.lastRun.duplicatesFound} duplicates</span><span>${d.lastRun.jobsAnalysed} AI-analysed</span></div>${d.lastRun.errors.length ? `<ul class="evidence-list">${d.lastRun.errors.map((x) => `<li>${e(x.source)}: ${e(x.message)}</li>`).join("")}</ul>` : ""}` : `<p class="muted">Configure and enable a verified company source, then press Find New Jobs.</p>`}</div>
  <div class="panel"><div class="panel-head"><h2>Top opportunities</h2><a class="muted small" href="/discover">View all</a></div>${jobCards(sortJobs(relevantJobs(activeJobs(state.jobs)), "confidence-desc").slice(0, 5))}</div>`;
  bindCommon();
}

function renderJobs(items, options = {}) {
  const dismissedCount = state.jobs.filter((x) => x.dismissed).length;
  const defaultMinimumScore =
    options.defaultMinimumScore ?? (options.showDismissed ? 0 : 70);
  const filterKey = options.showDismissed ? "dismissed" : currentRoute();
  const filters = getJobFilters(
    filterKey,
    defaultMinimumScore,
    options.showDismissed ? "all" : "worthwhile",
  );
  const defaultItems = filterJobItems(items, filters);
  const itemLabel = options.showDismissed ? "dismissed job" : "job";
  app.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>${options.showDismissed ? "Dismissed jobs" : "Job opportunities"}</h2><p class="muted small">${options.showDismissed ? "Restore a role to return it to discovery." : "Smart shortlist is the default: trusted, relevant roles scoring at least 70%, with no explicit visa blocker. Use broader views only when you want to explore."}</p></div>${!options.showDismissed && dismissedCount ? `<button class="secondary" data-show-dismissed>Show dismissed (${dismissedCount})</button>` : ""}</div><form id="job-filters" class="filters"><label>Show<select id="f-quality"><option value="worthwhile">Smart shortlist</option><option value="potential">Potential matches</option><option value="real">All real matches</option><option value="all">Everything, including filtered out</option></select></label><label>Sort by<select id="f-sort"><option value="confidence-desc">Match confidence: high to low</option><option value="confidence-asc">Match confidence: low to high</option><option value="newest">Newest first</option><option value="trust">Trust: highest first</option></select></label><label>Match category<select id="f-rec"><option value="">Any category</option>${["strong-apply", "apply", "stretch", "eligibility-unclear", "low-priority"].map((x) => `<option>${x}</option>`).join("")}<option value="skip">not recommended</option></select></label><label>Match confidence (%)<input id="f-score" type="number" min="0" max="100" value="${defaultMinimumScore}"></label><label>Visa status<select id="f-visa"><option value="not-incompatible">No explicit blocker</option><option value="positive">Positive evidence</option><option value="unknown">Eligibility unknown</option><option value="">Any</option></select></label><label>Country<select id="f-country"><option value="">All</option>${uniq(
    items.map((x) => x.job.country).filter(Boolean),
  )
    .map((x) => `<option>${e(x)}</option>`)
    .join(
      "",
    )}</select></label><label>Workplace<select id="f-work"><option value="">All</option><option>remote</option><option>hybrid</option><option>onsite</option><option>unknown</option></select></label><label>Trust<select id="f-trust"><option value="">All</option><option>verified</option><option>likely-legitimate</option><option>unverified</option><option>suspicious</option></select></label><div class="filter-actions"><button class="primary" type="submit">Apply filters</button></div></form><p id="filter-summary" class="muted small">Showing ${defaultItems.length} of ${items.length} ${itemLabel}${items.length === 1 ? "" : "s"}.</p><div id="filtered">${jobCards(
    sortJobs(defaultItems, filters.sort),
  )}</div></div>`;
  setJobFilterInputs(filters);
  document.querySelector("#job-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    filterJobs(items, itemLabel, filterKey);
  });
  bindCommon();
}

function renderDismissedJobs() {
  renderJobs(
    state.jobs.filter((x) => x.dismissed),
    { showDismissed: true },
  );
}

function getJobFilters(key, defaultMinimumScore, defaultQuality) {
  if (!state.jobFilters[key])
    state.jobFilters[key] = {
      sort: "confidence-desc",
      quality: defaultQuality,
      recommendation: "",
      minimumScore: defaultMinimumScore,
      visa: defaultQuality === "all" ? "" : "not-incompatible",
      country: "",
      workplace: "",
      trust: "",
    };
  return state.jobFilters[key];
}

function setJobFilterInputs(filters) {
  document.querySelector("#f-sort").value = filters.sort;
  document.querySelector("#f-quality").value = filters.quality;
  document.querySelector("#f-rec").value = filters.recommendation;
  document.querySelector("#f-score").value = String(filters.minimumScore);
  document.querySelector("#f-visa").value = filters.visa;
  document.querySelector("#f-country").value = filters.country;
  document.querySelector("#f-work").value = filters.workplace;
  document.querySelector("#f-trust").value = filters.trust;
}

function filterJobItems(items, filters) {
  return items.filter(
    (x) =>
      passesQualityFilter(x, filters.quality) &&
      (!filters.recommendation ||
        x.match?.recommendation === filters.recommendation) &&
      matchesVisaFilter(x, filters.visa) &&
      (!filters.country || x.job.country === filters.country) &&
      (!filters.workplace || x.job.workplaceType === filters.workplace) &&
      (!filters.trust || x.trust?.level === filters.trust) &&
      (x.match?.score || 0) >= filters.minimumScore,
  );
}

function passesQualityFilter(item, quality) {
  const score = item.match?.score || 0;
  const recommendation = item.match?.recommendation || "unanalysed";
  const trust = item.trust?.level || "unverified";
  const authorization = item.workAuthorization?.status || "unknown";
  if (quality === "all") return true;
  if (authorization === "incompatible" || trust === "suspicious") return false;
  if (quality === "real") return recommendation !== "skip";
  if (quality === "potential") return recommendation !== "skip" && score >= 50;
  return (
    recommendation !== "skip" &&
    score >= 70 &&
    ["verified", "likely-legitimate"].includes(trust)
  );
}

function matchesVisaFilter(item, visa) {
  const status = item.workAuthorization?.status || "unknown";
  if (visa === "positive")
    return ["likely-compatible", "possibly-compatible"].includes(status);
  if (visa === "unknown") return status === "unknown";
  return visa !== "not-incompatible" || status !== "incompatible";
}

function filterJobs(items, itemLabel = "job", filterKey = currentRoute()) {
  const v = (id) => document.querySelector(`#${id}`).value;
  const filters = {
    sort: v("f-sort"),
    quality: v("f-quality"),
    recommendation: v("f-rec"),
    minimumScore: Number(v("f-score")) || 0,
    visa: v("f-visa"),
    country: v("f-country"),
    workplace: v("f-work"),
    trust: v("f-trust"),
  };
  state.jobFilters[filterKey] = filters;
  const filtered = filterJobItems(items, filters);
  document.querySelector("#filtered").innerHTML = jobCards(
    sortJobs(filtered, filters.sort),
  );
  document.querySelector("#filter-summary").textContent =
    `Showing ${filtered.length} of ${items.length} ${itemLabel}${items.length === 1 ? "" : "s"}.`;
  bindCommon();
}

function jobCards(items) {
  if (!items.length)
    return `<div class="empty">No jobs match this view yet.</div>`;
  return `<div class="job-list">${items.map((x) => `<article class="job-card"><div><h3><a data-job-link href="/jobs/${encodeURIComponent(x.job.id)}">${e(x.job.title)}</a></h3><div class="company">${e(x.job.company)}</div><div class="job-meta"><span>${e(x.job.locationText || "Location not stated")}</span><span>${e(x.job.workplaceType)}</span><span>${e(x.job.sourceType)}</span><span>${date(x.job.publishedAt || x.job.firstSeenAt)}</span></div><div class="badges"><span class="badge ${x.match?.recommendation || ""}">${e(x.match?.recommendation || "unanalysed")}</span><span class="badge ${x.trust?.level || ""}">${e(x.trust?.level || "unverified")}</span><span class="badge ${x.workAuthorization?.status || ""}">${e(x.workAuthorization?.status || "unknown eligibility")}</span><span class="badge">${x.salary?.advertisedSalary ? money(x.salary.advertisedSalary) : x.salary?.estimatedMarketRange ? `estimate ${money(x.salary.estimatedMarketRange)}` : "salary evidence unavailable"}</span></div><div class="actions"><button class="ghost" data-save="${e(x.job.id)}">${x.saved ? "Unsave" : "Save"}</button><button class="ghost" data-apply="${e(x.job.id)}">Mark applied</button><button class="ghost" data-dismiss="${e(x.job.id)}">${x.dismissed ? "Restore" : "Dismiss"}</button><a class="secondary" target="_blank" rel="noopener noreferrer" href="${e(x.job.canonicalUrl)}">Open official application</a></div></div><div class="score" title="Match confidence">${Math.round(x.match?.score || 0)}%</div></article>`).join("")}</div>`;
}

function renderJobDetail(id) {
  const x = state.jobs.find((item) => item.job.id === decodeURIComponent(id));
  if (!x) {
    app.innerHTML = `<div class="empty">Job not found.</div>`;
    return;
  }
  app.innerHTML = JobDetailView.renderJobDetail(x);
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
  const stats = s.registryStats || {};
  const page = state.companyPage || {
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  };
  app.innerHTML = `<div class="grid stats">${stat("Unique companies", stats.totalCompanies)}${stat("Candidates", stats.candidateCompanies || 0)}${stat("Domain resolved", stats.domainResolved || 0)}${stat("Careers page found", stats.careersPageFound || 0)}${stat("Verified with jobs", stats.sourceVerifiedWithJobs || 0)}${stat("Verified empty", stats.sourceVerifiedEmpty || 0)}${stat("Monitored", stats.monitored || 0)}${stat("Temporarily unavailable", stats.temporarilyUnavailable || 0)}${stat("Blocked / unsupported", stats.blockedOrUnsupported || 0)}${stat("Invalid", stats.invalidSources || 0)}${stat("Unresolved", stats.unresolved)}${stat("Rejected", stats.rejected || 0)}${stat("Source records", stats.totalSourceRecords)}</div>
  <div class="panel"><div class="panel-head"><div><h2>Free company-registry discovery</h2><p class="muted">Verified public career pages and ATS feeds can be monitored even when they currently have no jobs.</p></div><div class="actions"><button class="primary" data-enable-verified>Enable verified</button><a class="secondary" href="/api/companies/unresolved.csv">Export unresolved CSV</a><label class="secondary">Import reviewed CSV<input id="resolution-csv" type="file" accept=".csv,text/csv" hidden></label></div></div><p class="small muted">Sponsor-register or permit history is positive company evidence, not a guarantee for a specific vacancy.</p></div>
  <div class="panel"><div class="panel-head"><h2>Companies</h2><span class="muted small">${page.total} total · page ${page.page}</span></div><div class="filters"><label>Search<input id="company-search" value="${e(state.companyFilters.search)}" placeholder="Company or domain"></label><label>Country<input id="company-country" value="${e(state.companyFilters.country)}" placeholder="Germany"></label><label>Status<select id="company-status"><option value="">All</option>${["candidate", "domain-resolved", "careers-page-found", "source-verified", "monitored", "temporarily-failing", "inactive", "rejected"].map((status) => `<option value="${status}" ${state.companyFilters.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>Board state<select id="company-board-state"><option value="">All</option>${["active-with-jobs", "active-empty", "temporarily-unavailable", "blocked", "unsupported", "invalid", "wrong-company"].map((value) => `<option value="${value}" ${state.companyFilters.boardState === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>ATS<select id="company-ats"><option value="">All</option>${["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "personio", "recruitee", "successfactors", "oracle", "custom"].map((value) => `<option value="${value}" ${state.companyFilters.atsProvider === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Source type<select id="company-classification"><option value="">All</option>${["direct-employer", "recruitment-agency", "staffing-consultancy", "job-platform", "government-portal", "ecosystem-directory", "unknown"].map((value) => `<option value="${value}" ${state.companyFilters.hiringSourceClassification === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Sponsorship<select id="company-sponsorship"><option value="">All</option>${["confirmed", "historical", "possible", "unknown", "unlikely"].map((value) => `<option value="${value}" ${state.companyFilters.sponsorshipEvidence === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Engineering<select id="company-engineering"><option value="">All</option>${["high", "medium", "low", "unknown"].map((value) => `<option value="${value}" ${state.companyFilters.engineeringRelevance === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><button class="secondary" data-company-filter>Filter</button></div><div class="actions"><button class="ghost" data-bulk-verify>Verify selected</button><button class="ghost" data-bulk-retry>Retry temporarily unavailable</button><button class="ghost" data-bulk-enable>Enable selected verified</button><button class="ghost" data-bulk-disable>Disable selected</button></div>${companyTable(page.items)}<div class="actions"><button class="ghost" data-company-page="${Math.max(1, page.page - 1)}" ${page.page <= 1 ? "disabled" : ""}>Previous</button><button class="ghost" data-company-page="${page.page + 1}" ${page.page * page.pageSize >= page.total ? "disabled" : ""}>Next</button></div></div>
  <div class="two-col"><div class="panel"><h2>Recent imports</h2>${runList(s.importRuns, (run) => `${run.sourceName}: ${run.recordsCreated} created, ${run.recordsUpdated} updated`)}</div><div class="panel"><h2>Recent verifications</h2>${runList(s.verificationRuns, (run) => `${run.detectedProvider || "custom"}: ${run.companyId}`)}</div></div>
  <form id="company-form" class="panel"><h2>Add candidate company</h2><div class="form-grid"><label>Name<input name="name" required></label><label>Official domain<input name="domain" placeholder="example.com"></label><label>Careers URL<input name="careersUrl" type="url"></label><label>ATS<select name="ats"><option value="">Detect from careers URL</option>${["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "personio", "recruitee", "successfactors", "oracle", "custom"].map((value) => `<option>${value}</option>`).join("")}</select></label><label>ATS identifier<input name="identifier"></label><label>Country<input name="countries"></label><label>Industries<input name="industries" placeholder="fintech, product"></label><label class="wide">Evidence URL<input name="evidenceUrl" type="url" required></label><label class="wide">Notes<textarea name="notes"></textarea></label></div><div class="actions"><button class="primary">Add candidate</button></div><p class="small muted">New records remain disabled until their official source verifies successfully.</p></form>`;
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
  document
    .querySelectorAll("[data-source-verify]")
    .forEach((b) =>
      b.addEventListener("click", () => verifySource(b.dataset.sourceVerify)),
    );
  document
    .querySelectorAll("[data-source-detect]")
    .forEach((b) =>
      b.addEventListener("click", () => detectSource(b.dataset.sourceDetect)),
    );
  document
    .querySelector("[data-enable-verified]")
    .addEventListener("click", enableVerifiedSources);
  document
    .querySelector("[data-bulk-verify]")
    .addEventListener("click", () => bulkVerifySources(false));
  document
    .querySelector("[data-bulk-retry]")
    .addEventListener("click", () => bulkVerifySources(true));
  document
    .querySelector("[data-bulk-enable]")
    .addEventListener("click", enableSelectedVerifiedSources);
  document
    .querySelector("[data-bulk-disable]")
    .addEventListener("click", disableSelectedSources);
  document
    .querySelectorAll("[data-source-reject]")
    .forEach((b) =>
      b.addEventListener("click", () => rejectSource(b.dataset.sourceReject)),
    );
  document
    .querySelectorAll("[data-source-merge]")
    .forEach((b) =>
      b.addEventListener("click", () => mergeSource(b.dataset.sourceMerge)),
    );
  document
    .querySelectorAll("[data-resolve-form]")
    .forEach((form) => form.addEventListener("submit", resolveSource));
  document
    .querySelector("[data-company-filter]")
    .addEventListener("click", () => loadCompanyPage(1));
  document
    .querySelectorAll("[data-company-page]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        loadCompanyPage(Number(button.dataset.companyPage)),
      ),
    );
  document
    .querySelector("#resolution-csv")
    .addEventListener("change", importResolutionCsv);
}

function runList(runs, summary) {
  if (!runs?.length) return `<div class="empty">No runs recorded yet.</div>`;
  return `<ul class="evidence-list">${runs
    .slice(0, 5)
    .map(
      (run) =>
        `<li><strong>${e(run.status)}</strong> · ${e(summary(run))}<br><span class="small muted">${date(run.completedAt || run.startedAt)}${run.error ? ` · ${e(run.error)}` : ""}</span></li>`,
    )
    .join("")}</ul>`;
}

function companyCareersLinks(company) {
  const urls = [
    company.corporateCareersUrl || company.careersUrl,
    ...(company.additionalCareersUrls || []),
  ].filter((url, index, all) => url && all.indexOf(url) === index);
  return urls
    .map(
      (url, index) =>
        `<a target="_blank" rel="noopener noreferrer" href="${e(url)}">${index ? "Additional careers" : "Corporate careers"}</a>`,
    )
    .join("<br>");
}

function companyTable(companies) {
  if (!companies.length)
    return `<div class="empty">No companies match these filters.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Select</th><th>Company</th><th>Country / cities</th><th>Industry</th><th>Official source</th><th>ATS</th><th>Evidence</th><th>Status</th><th>Last sync</th><th>Actions</th></tr></thead><tbody>${companies.map((c) => `<tr><td><input type="checkbox" data-company-select value="${e(c.id)}" aria-label="Select ${e(c.displayName)}"></td><td><strong>${e(c.displayName)}</strong><br><span class="small muted">${e(c.legalName)}</span><br><span class="small muted">${e(c.hiringSourceClassification)}</span></td><td>${e(c.headquartersCountry || c.operatingCountries.join(", "))}<br><span class="small muted">${e(c.knownCities.join(", "))}</span></td><td>${e(c.industries.join(", ") || "unknown")}<br><span class="small muted">engineering ${e(c.engineeringRelevance)}</span></td><td>${c.companyDomain ? `<a target="_blank" rel="noopener noreferrer" href="https://${e(c.companyDomain)}">${e(c.companyDomain)}</a>` : "unresolved"}<br>${companyCareersLinks(c)}<br>${c.atsBoardUrl ? `<a target="_blank" rel="noopener noreferrer" href="${e(c.atsBoardUrl)}">ATS board</a>` : ""}<br><span class="small muted">${e(c.sourceRecords?.map((s) => s.sourceName).join(", ") || "No provenance")}</span></td><td>${e(c.atsProvider || "unresolved")}<br><span class="small muted">${e(c.atsIdentifier || "")}</span></td><td>sponsor ${e(c.sponsorshipEvidence)}<br>relocation ${e(c.relocationEvidence)}${c.lastVerification?.evidence?.length ? `<details><summary class="small">View evidence</summary>${list(c.lastVerification.evidence)}</details>` : ""}</td><td><span class="badge ${e(c.verificationStatus)}">${e(c.verificationStatus)}</span><br><span class="small muted">${e(c.boardState || "not checked")} · ${c.enabled ? "enabled" : "disabled"}</span>${c.verificationError ? `<br><span class="small muted">${e(c.verificationError)}</span>` : ""}</td><td>${date(c.lastSuccessfulSyncAt)}<br><span class="small muted">checked ${date(c.lastCheckedAt)}</span></td><td><div class="actions"><button class="ghost" data-source-detect="${e(c.id)}">Detect source</button><button class="ghost" data-source-verify="${e(c.id)}">${c.boardState === "temporarily-unavailable" ? "Retry" : "Verify"}</button><button class="ghost" data-source-sync="${e(c.id)}">Sync now</button><button class="ghost" data-source-toggle="${e(c.id)}">${c.enabled ? "Disable" : "Enable"}</button><button class="ghost" data-source-merge="${e(c.id)}">Merge duplicate</button><button class="ghost" data-source-reject="${e(c.id)}">Reject</button></div><details><summary class="small">Edit source</summary><form data-resolve-form="${e(c.id)}"><label>Official domain<input name="officialDomain" value="${e(c.companyDomain || "")}"></label><label>Careers URL<input name="careersUrl" value="${e(c.corporateCareersUrl || c.careersUrl || "")}"></label><label>ATS provider<input name="atsProvider" value="${e(c.atsProvider || "")}"></label><label>ATS identifier<input name="atsIdentifier" value="${e(c.atsIdentifier || "")}"></label><label>Evidence URL<input name="evidenceUrl" type="url" required></label><label>Notes<textarea name="notes">${e(c.notes || "")}</textarea></label><button class="secondary">Save resolution</button></form></details></td></tr>`).join("")}</tbody></table></div>`;
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
          companyDomain: f.get("domain") || undefined,
          careersUrl: f.get("careersUrl") || undefined,
          atsProvider: f.get("ats") || undefined,
          atsIdentifier: f.get("identifier") || undefined,
          countries: String(f.get("countries") || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          industries: String(f.get("industries") || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          evidenceUrl: f.get("evidenceUrl"),
          notes: f.get("notes") || undefined,
        }),
      }),
    "Company source added.",
  );
}
async function toggleSource(id) {
  const c = state.companyPage.items.find((x) => x.id === id);
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...c, enabled: !c.enabled }),
      }),
    "Source updated.",
  );
}
async function verifySource(id) {
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}/verify`, {
        method: "POST",
        body: "{}",
      }),
    "Company source verified.",
  );
}
async function detectSource(id) {
  await action(async () => {
    const result = await api(
      `/api/companies/${encodeURIComponent(id)}/detect`,
      {
        method: "POST",
        body: "{}",
      },
    );
    const message = result.detection
      ? `${result.detection.provider} · ${result.detection.identifier || "manual review"} · ${result.detection.confidence} confidence`
      : "No recognised ATS handoff found.";
    window.alert(message);
    return result;
  }, "Source detection completed.");
}
async function enableVerifiedSources() {
  await action(
    () =>
      api("/api/companies/enable-verified", {
        method: "POST",
        body: JSON.stringify({
          country: state.companyFilters.country || undefined,
          provider: state.companyFilters.atsProvider || undefined,
        }),
      }),
    "Verified sources enabled.",
  );
}
function selectedCompanyIds() {
  return [...document.querySelectorAll("[data-company-select]:checked")].map(
    (input) => input.value,
  );
}
async function bulkVerifySources(temporaryOnly) {
  const selected = selectedCompanyIds().filter((id) => {
    const company = state.companyPage.items.find((item) => item.id === id);
    return !temporaryOnly || company?.boardState === "temporarily-unavailable";
  });
  await action(
    () =>
      Promise.all(
        selected.map((id) =>
          api(`/api/companies/${encodeURIComponent(id)}/verify`, {
            method: "POST",
            body: "{}",
          }),
        ),
      ),
    `${selected.length} source(s) verified.`,
  );
}
async function enableSelectedVerifiedSources() {
  const companyIds = selectedCompanyIds();
  await action(
    () =>
      api("/api/companies/enable-verified", {
        method: "POST",
        body: JSON.stringify({ companyIds }),
      }),
    `${companyIds.length} selected source(s) reviewed for enablement.`,
  );
}
async function disableSelectedSources() {
  const selected = selectedCompanyIds();
  await action(
    () =>
      Promise.all(
        selected.map((id) => {
          const company = state.companyPage.items.find(
            (item) => item.id === id,
          );
          return api(`/api/companies/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ ...company, enabled: false }),
          });
        }),
      ),
    `${selected.length} source(s) disabled.`,
  );
}
async function rejectSource(id) {
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: "{}",
      }),
    "Company rejected.",
  );
}
async function mergeSource(id) {
  const targetCompanyId = window.prompt("Target company ID to preserve");
  if (!targetCompanyId) return;
  await action(
    () =>
      api(`/api/companies/${encodeURIComponent(id)}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetCompanyId }),
      }),
    "Duplicate company merged.",
  );
}
async function resolveSource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const value = (name) => String(fields.get(name) || "").trim() || undefined;
  await action(
    () =>
      api(
        `/api/companies/${encodeURIComponent(form.dataset.resolveForm)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            officialDomain: value("officialDomain"),
            careersUrl: value("careersUrl"),
            atsProvider: value("atsProvider"),
            atsIdentifier: value("atsIdentifier"),
            evidenceUrl: value("evidenceUrl"),
            notes: value("notes"),
          }),
        },
      ),
    "Company resolution saved; verify it before enabling.",
  );
}
async function loadCompanyPage(page) {
  state.companyFilters = {
    search: document.querySelector("#company-search")?.value || "",
    country: document.querySelector("#company-country")?.value || "",
    status: document.querySelector("#company-status")?.value || "",
    atsProvider: document.querySelector("#company-ats")?.value || "",
    sponsorshipEvidence:
      document.querySelector("#company-sponsorship")?.value || "",
    engineeringRelevance:
      document.querySelector("#company-engineering")?.value || "",
    boardState: document.querySelector("#company-board-state")?.value || "",
    hiringSourceClassification:
      document.querySelector("#company-classification")?.value || "",
  };
  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  for (const [key, value] of Object.entries(state.companyFilters))
    if (value) query.set(key, value);
  state.companyPage = await api(`/api/companies?${query}`);
  renderSources();
}
async function importResolutionCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const csv = await file.text();
  await action(
    () =>
      api("/api/companies/resolutions", {
        method: "POST",
        body: JSON.stringify({ csv }),
      }),
    "Reviewed resolutions imported.",
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
  app.innerHTML = `<div class="panel"><div class="panel-head"><h2>Application tracking</h2><span class="muted small">Manual submission only</span></div>${apps.length ? `<div class="job-list">${apps.map((x) => `<form class="source-card" data-application-form="${e(x.job.id)}"><div class="wide"><strong>${e(x.job.title)}</strong><p class="muted small">${e(x.job.company)} · updated ${date(x.application.updatedAt)}</p><div class="form-grid"><label>Status<select name="status">${statuses.map((status) => `<option value="${status}" ${x.application.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>CV version<input name="cvVersion" value="${e(x.application.cvVersion || "")}"></label><label>Follow up<input name="followUpAt" type="date" value="${e(x.application.followUpAt || "")}"></label><label>Next action<input name="nextAction" value="${e(x.application.nextAction || "")}"></label><label class="wide">Recruiter details<textarea name="recruiterDetails">${e(x.application.recruiterDetails || "")}</textarea></label><label class="wide">Notes<textarea name="notes">${e(x.application.notes || "")}</textarea></label><label class="wide">Interview dates (one per line)<textarea name="interviewDates">${e(x.application.interviewDates.join("\n"))}</textarea></label></div></div><div class="actions"><a class="secondary" href="/jobs/${encodeURIComponent(x.job.id)}">Open</a><button class="primary" type="submit">Save tracking</button></div></form>`).join("")}</div>` : `<div class="empty">Mark a job as applied to start tracking it.</div>`}</div>`;
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
    ["Mode", s.discoveryMode],
    ["Sources", "Official company pages and public ATS feeds"],
  ])}</div></div><div class="panel"><h2>Privacy and limitations</h2><p class="muted">${e(s.privacy)}</p><p class="muted">Version 1 does not search the entire internet. It checks enabled, verified employers from the maintained registry.</p><p class="muted">Work-authorisation is preliminary evidence, not legal advice. Salary does not include tax or cost-of-living normalisation.</p></div>`;
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
  document.querySelectorAll("[data-job-link]").forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState(null, "", link.href);
      render();
    }),
  );
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
async function runDiscovery() {
  await action(
    () => api("/api/discovery", { method: "POST", body: "{}" }),
    "Discovery started. Progress will refresh automatically.",
  );
}
async function resetJobs() {
  if (
    !window.confirm(
      "Reset all discovered jobs, saved jobs, applications, and discovery history? Your profile and company sources will be kept.",
    )
  )
    return;
  await action(
    () => api("/api/jobs/reset", { method: "POST", body: "{}" }),
    "Jobs and discovery history reset. Your profile and sources were kept.",
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
function relevantJobs(items) {
  return items.filter((x) => passesQualityFilter(x, "worthwhile"));
}
function sortJobs(items, sort) {
  const trustRank = {
    verified: 3,
    "likely-legitimate": 2,
    unverified: 1,
    suspicious: 0,
  };
  return [...items].sort((left, right) => {
    if (sort === "confidence-asc")
      return (left.match?.score || 0) - (right.match?.score || 0);
    if (sort === "newest")
      return (
        new Date(right.job.firstSeenAt).getTime() -
        new Date(left.job.firstSeenAt).getTime()
      );
    if (sort === "trust")
      return (
        (trustRank[right.trust?.level] ?? -1) -
          (trustRank[left.trust?.level] ?? -1) ||
        (right.match?.score || 0) - (left.match?.score || 0)
      );
    return (right.match?.score || 0) - (left.match?.score || 0);
  });
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
resetJobsButton.addEventListener("click", resetJobs);
migrateLegacyHashRoute();
window.addEventListener("popstate", render);
refresh().catch((error) => {
  app.innerHTML = `<div class="empty">${e(error.message)}</div>`;
});
setInterval(() => {
  if (state.dashboard?.discoveryRunning) refreshDashboard().catch(() => {});
}, 3000);
