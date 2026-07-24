(function (root, factory) {
  const view = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = view;
  root.JobDetailView = view;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COMPONENT_LABELS = {
    requiredSkills: "Required skills",
    relevantExperience: "Relevant experience",
    seniority: "Seniority",
    roleAlignment: "Role alignment",
    domainExperience: "Domain experience",
    relocationFeasibility: "Relocation feasibility",
    languageCompatibility: "Language compatibility",
    preferences: "Preferences",
  };

  const RECOMMENDATION_LABELS = {
    "strong-apply": "Strong Apply",
    apply: "Apply",
    stretch: "Stretch",
    "low-priority": "Low Priority",
    skip: "Skip",
    "eligibility-unclear": "Eligibility Unclear",
  };

  const STATUS_LABELS = {
    active: "Active",
    "possibly-closed": "Possibly closed",
    closed: "Closed",
    "verification-failed": "Verification unavailable",
    verified: "Verified official source",
    "likely-legitimate": "Likely legitimate",
    unverified: "Unverified",
    suspicious: "Suspicious",
    "likely-compatible": "Likely compatible",
    "possibly-compatible": "Possibly compatible",
    unknown: "Eligibility unclear",
    "likely-incompatible": "Likely incompatible",
    incompatible: "Incompatible",
  };

  const SEVERITY_LABELS = {
    low: "Low concern",
    medium: "Medium concern",
    high: "High concern",
    blocker: "Blocker",
  };

  function renderJobDetail(item) {
    const job = item.job;
    const match = item.match || {};
    const trust = item.trust || {};
    const authorization = item.workAuthorization || {};
    const salary = item.salary || {};
    const applicationStatus = item.application?.status;
    return `<section class="job-detail-page" aria-labelledby="job-detail-title">
      <article class="job-summary-card">
        <div class="job-summary-topline">
          <div class="badges">
            ${badge(trust.level || "unverified", labelFor(trust.level || "unverified"))}
            ${badge(job.status || "active", labelFor(job.status || "active"))}
          </div>
          <div class="job-score-inline" aria-label="Match score ${round(match.score)} percent"><strong>${round(match.score)}%</strong><span>Match</span></div>
        </div>
        <h2 id="job-detail-title">${escape(job.title)}</h2>
        <p class="job-company">${escape(job.company)}</p>
        <div class="job-summary-meta">${summaryMetadata(job)
          .map((value) => `<span>${escape(value)}</span>`)
          .join("")}</div>
        <div class="job-summary-footer">
          ${badge(match.recommendation || "skip", recommendationLabel(match.recommendation || "skip"))}
          <div class="actions job-detail-actions">
            <a class="primary" target="_blank" rel="noopener noreferrer" href="${escape(job.canonicalUrl)}">Open official application</a>
            <button class="secondary" data-save="${escape(job.id)}">${item.saved ? "Saved" : "Save"}</button>
            <button class="secondary" data-apply="${escape(job.id)}">${applicationStatus === "applied" ? "Applied" : "Mark applied"}</button>
          </div>
        </div>
      </article>
      <div class="job-detail-grid">
        <div class="job-detail-main">
          ${renderMatchSummary(match, authorization)}
          ${renderBreakdown(match.components || {})}
          ${renderGaps(match.gaps || [])}
          ${renderDetailedAnalysis(match)}
          ${renderDescription(job.description)}
        </div>
        <aside class="job-detail-sidebar" aria-label="Job context">
          ${renderWorkAuthorization(authorization)}
          ${renderSalary(salary)}
          ${renderTrust(trust)}
          ${renderSource(job)}
        </aside>
      </div>
    </section>`;
  }

  function renderMatchSummary(match, authorization) {
    const positives = [];
    if ((match.matchedSkills || []).length)
      positives.push(`Required skills: ${match.matchedSkills.join(", ")}.`);
    if ((match.transferableSkills || []).length)
      positives.push(
        `Transferable experience: ${match.transferableSkills.join(", ")}.`,
      );
    const language = match.components?.languageCompatibility;
    if (language?.score >= 80 && language.evidence?.[0])
      positives.push(language.evidence[0]);
    const concerns = [];
    for (const gap of match.gaps || []) concerns.push(gap.explanation);
    if (authorization.status === "unknown" && authorization.explanation)
      concerns.push(authorization.explanation);
    if (!positives.length && !concerns.length) return "";
    return `<section class="panel match-summary-panel"><div class="section-heading"><div><p class="eyebrow">MATCH SUMMARY</p><h2>Why this is a match</h2></div><span class="muted small">Deterministic score</span></div><div class="match-summary-grid">
      ${summaryColumn("Strengths", positives, "positive")}
      ${summaryColumn("Main concerns", unique(concerns), "concern")}
    </div></section>`;
  }

  function summaryColumn(title, items, tone) {
    if (!items.length) return "";
    return `<div class="match-summary-column ${tone}"><h3>${title}</h3><ul>${items
      .slice(0, 3)
      .map((item) => `<li>${escape(item)}</li>`)
      .join("")}</ul></div>`;
  }

  function renderBreakdown(components) {
    const rows = Object.entries(components).map(([name, component]) => {
      const score = round(component.score);
      const state = scoreState(score);
      const evidence = component.evidence?.[0];
      return `<article class="match-component ${state}"><div class="match-component-head"><div><h3>${escape(COMPONENT_LABELS[name] || humanize(name))}</h3>${evidence ? `<p>${escape(evidence)}</p>` : ""}</div><strong>${score}</strong></div><div class="progress-track" role="progressbar" aria-label="${escape(COMPONENT_LABELS[name] || humanize(name))}: ${score} out of 100" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span style="width:${score}%"></span></div><span class="score-state">${scoreStateLabel(state)}</span></article>`;
    });
    return `<section class="panel match-breakdown-panel"><div class="section-heading"><div><p class="eyebrow">SCORE BREAKDOWN</p><h2>Match breakdown</h2></div></div><div class="match-component-list">${rows.join("") || `<p class="muted">No component scores are available yet.</p>`}</div></section>`;
  }

  function renderGaps(gaps) {
    const content = gaps.length
      ? `<div class="gap-list">${gaps
          .map(
            (gap) =>
              `<article class="gap-item severity-${escape(gap.severity)}"><div class="gap-item-head"><div><span class="gap-type">${escape(humanize(gap.type))}</span><h3>${escape(gap.requirement)}</h3></div><span class="severity-badge">${escape(SEVERITY_LABELS[gap.severity] || humanize(gap.severity))}</span></div><p>${escape(gap.explanation)}</p>${gap.candidateEvidence?.length ? `<p class="candidate-evidence"><strong>Candidate evidence:</strong> ${escape(gap.candidateEvidence.join(" · "))}</p>` : ""}<div class="next-step"><strong>Next step</strong><span>${escape(gap.recommendation)}</span></div></article>`,
          )
          .join("")}</div>`
      : `<p class="muted">No material gaps were identified from the structured analysis.</p>`;
    return `<section class="panel gaps-panel"><div class="section-heading"><div><p class="eyebrow">CANDIDATE CONTEXT</p><h2>Evidence and gaps</h2></div></div>${content}</section>`;
  }

  function renderDetailedAnalysis(match) {
    const analysis = match.detailedAnalysis;
    if (!analysis) {
      const pending = match.needsDetailedAnalysis;
      return `<section class="panel ai-analysis-panel"><div class="section-heading"><div><p class="eyebrow">LOCAL AI</p><h2>${pending ? "Detailed analysis is pending" : "Detailed analysis unavailable"}</h2></div></div><p class="muted">${pending ? "The deterministic score is available now. Local-AI analysis will appear after the configured Ollama model finishes." : "This role was not selected for detailed local-AI analysis. The deterministic score remains available."}</p></section>`;
    }
    const sections = [
      ["Why this role fits", [analysis.summary]],
      ["Experience to emphasise", analysis.experiencesToEmphasise],
      ["Main concerns", analysis.recruiterConcerns],
      ["Recruiter questions to expect", analysis.transferableSkillReasoning],
      ["Application strategy", analysis.applicationStrategy],
      ["Salary context", [analysis.salaryEvidenceInterpretation]],
    ].filter(
      ([, values]) => Array.isArray(values) && values.filter(Boolean).length,
    );
    return `<section class="panel ai-analysis-panel"><div class="section-heading"><div><p class="eyebrow">LOCAL AI</p><h2>Detailed analysis</h2></div></div><div class="ai-analysis-grid">${sections.map(([title, values]) => `<section><h3>${escape(title)}</h3>${renderSimpleList(values)}</section>`).join("")}</div></section>`;
  }

  function renderDescription(description) {
    const paragraphs = normaliseDescription(description);
    const preview = paragraphs.slice(0, 3);
    const remaining = paragraphs.slice(3);
    return `<section class="panel description-panel"><div class="section-heading"><div><p class="eyebrow">SOURCE CONTENT</p><h2>Original job description</h2></div></div><div class="job-description">${renderParagraphs(preview)}${remaining.length ? `<details><summary>Show full description</summary>${renderParagraphs(remaining)}</details>` : ""}</div></section>`;
  }

  function renderWorkAuthorization(authorization) {
    const status = authorization.status || "unknown";
    return `<section class="panel sidebar-panel"><h2>Work authorisation</h2>${badge(status, labelFor(status))}<dl class="fact-list"><div><dt>Sponsorship required</dt><dd>${yesNo(authorization.sponsorshipRequired)}</dd></div><div><dt>Sponsorship mentioned</dt><dd>${yesNo(authorization.sponsorshipMentioned)}</dd></div></dl><p class="muted">${escape(authorization.explanation || "No work-authorisation assessment is available.")}</p>${namedList("Positive evidence", authorization.positiveEvidence)}${namedList("Restrictions", authorization.explicitRestrictions)}${namedList("Missing information", authorization.missingInformation)}${authorization.disclaimer ? `<p class="disclaimer">${escape(authorization.disclaimer)}</p>` : ""}</section>`;
  }

  function renderSalary(salary) {
    const hasEstimate =
      salary.advertisedSalary ||
      salary.estimatedMarketRange ||
      salary.recommendedExpectation;
    const body = hasEstimate
      ? `<dl class="fact-list salary-facts">${salary.advertisedSalary ? `<div><dt>Advertised range</dt><dd>${escape(money(salary.advertisedSalary))}</dd></div>` : ""}${salary.estimatedMarketRange ? `<div><dt>Estimated market range</dt><dd>${escape(money(salary.estimatedMarketRange))}</dd></div>` : ""}${salary.recommendedExpectation ? `<div><dt>Recommended expectation</dt><dd>${escape(money(salary.recommendedExpectation))}</dd></div>` : ""}<div><dt>Evidence</dt><dd>${Number(salary.evidenceCount || 0)} source${Number(salary.evidenceCount || 0) === 1 ? "" : "s"} · ${escape(humanize(salary.confidence || "low"))} confidence</dd></div></dl><p class="muted">${escape(salary.explanation || "")}</p>${salary.evidence?.length ? `<div class="salary-evidence">${salary.evidence.map((item) => (item.sourceUrl ? `<a target="_blank" rel="noopener noreferrer" href="${escape(item.sourceUrl)}">${escape(item.sourceName)} · ${escape(money(item))}</a>` : `<span>${escape(item.sourceName)} · ${escape(money(item))}</span>`)).join("")}</div>` : ""}`
      : `<p class="salary-empty-title">No reliable estimate yet</p><p class="muted">${escape(salary.explanation || "The posting does not disclose compensation, and no comparable salary records have been collected for this role and location.")}</p><p class="salary-baseline">Current baseline: ${escape(money(salary.currentSalary || { amount: 22000, currency: "AED", period: "monthly" }))} in the UAE</p><p class="disclaimer">Salary comparisons require tax, currency and cost-of-living context.</p>`;
    return `<section class="panel sidebar-panel"><h2>Salary</h2>${body}</section>`;
  }

  function renderTrust(trust) {
    const evidence = [
      ...(trust.evidence || []),
      ...(trust.suspiciousSignals || []),
    ];
    if (trust.canonicalCompanyPageFound)
      evidence.push("Canonical application URL is available.");
    return `<section class="panel sidebar-panel"><h2>Trust assessment</h2>${badge(trust.level || "unverified", labelFor(trust.level || "unverified"))}${renderSimpleList(unique(evidence))}</section>`;
  }

  function renderSource(job) {
    return `<section class="panel sidebar-panel source-panel"><h2>Source information</h2><dl class="fact-list"><div><dt>Source</dt><dd>${escape(job.sourceName || humanize(job.sourceType))}</dd></div><div><dt>Source type</dt><dd>${escape(humanize(job.sourceType))}</dd></div><div><dt>First seen</dt><dd>${escape(date(job.firstSeenAt))}</dd></div><div><dt>Last verified</dt><dd>${escape(date(job.lastVerifiedAt))}</dd></div><div><dt>Current status</dt><dd>${escape(labelFor(job.status || "active"))}</dd></div></dl><a class="source-link" target="_blank" rel="noopener noreferrer" href="${escape(job.canonicalUrl)}">Open canonical application</a></section>`;
  }

  function summaryMetadata(job) {
    return [
      compactLocation(job.locationText),
      job.employmentType,
      workplaceLabel(job.workplaceType),
      date(job.publishedAt || job.firstSeenAt),
    ].filter(Boolean);
  }

  function compactLocation(location) {
    if (!location) return "Location not stated";
    const parts = location
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 2 ? parts.slice(-2).join(", ") : parts.join(", ");
  }

  function workplaceLabel(value) {
    return value && value !== "unknown" ? humanize(value) : "";
  }

  function normaliseDescription(value) {
    const text = String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*(?=(?:[-•*]|\d+[.)])\s+)/g, "\n\n")
      .replace(
        /\s*(Responsibilities|Requirements|Nice to have|Benefits|What you will do|What we are looking for)\s*/gi,
        "\n\n$1\n",
      )
      .trim();
    return text
      .split(/\n\s*\n+/)
      .map((part) => part.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
  }

  function renderParagraphs(paragraphs) {
    return paragraphs
      .map((paragraph) => `<p>${escape(paragraph)}</p>`)
      .join("");
  }

  function renderSimpleList(items) {
    const values = (items || []).filter(Boolean);
    return values.length
      ? `<ul class="detail-list">${values.map((item) => `<li>${escape(String(item))}</li>`).join("")}</ul>`
      : "";
  }

  function namedList(title, items) {
    return items?.length
      ? `<div class="named-list"><h3>${escape(title)}</h3>${renderSimpleList(items)}</div>`
      : "";
  }

  function badge(value, label) {
    return `<span class="badge ${escape(value)}">${escape(label)}</span>`;
  }

  function labelFor(value) {
    return STATUS_LABELS[value] || humanize(value || "unknown");
  }

  function recommendationLabel(value) {
    return RECOMMENDATION_LABELS[value] || humanize(value || "skip");
  }

  function scoreState(score) {
    if (score >= 80) return "strong";
    if (score >= 55) return "moderate";
    if (score >= 35) return "weak";
    return "blocker";
  }

  function scoreStateLabel(value) {
    return {
      strong: "Strong",
      moderate: "Moderate",
      weak: "Weak",
      blocker: "Blocker",
    }[value];
  }

  function money(range) {
    const minimum = range.minimum ?? range.amount;
    const maximum = range.maximum;
    const amount =
      minimum !== undefined && maximum !== undefined
        ? `${formatNumber(minimum)}–${formatNumber(maximum)}`
        : formatNumber(minimum ?? maximum);
    return `${range.currency} ${amount} / ${range.period}`;
  }

  function formatNumber(value) {
    return value === undefined ? "?" : new Intl.NumberFormat().format(value);
  }

  function humanize(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function date(value) {
    return value ? new Date(value).toLocaleDateString() : "Not available";
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function round(value) {
    return Math.round(Number(value || 0));
  }

  function escape(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  }

  return {
    renderJobDetail,
    normaliseDescription,
    recommendationLabel,
    COMPONENT_LABELS,
  };
});
