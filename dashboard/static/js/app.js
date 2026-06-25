(function () {
  "use strict";
  const COLORS = {
    blue: "#0A66C2", cyan: "#06B6D4", purple: "#7C3AED", teal: "#0D9488",
    green: "#10B981", amber: "#F59E0B", red: "#EF4444", indigo: "#4F46E5",
    pink: "#EC4899", slate: "#445069",
  };
  const PALETTE = [
    "#0A66C2", "#06B6D4", "#7C3AED", "#0D9488", "#10B981",
    "#F59E0B", "#EF4444", "#4F46E5", "#EC4899", "#445069",
    "#2563EB", "#059669", "#D97706", "#DC2626", "#9333EA",
  ];
  let _theme = "light";
  let _data = null;
  let _scanResult = null;
  let _scanId = null;
  let _pollTimer = null;
  let _activeScan = false;
  let _jobsAll = [];
  let _jobsFiltered = [];
  let _jobsPage = 1;
  let _jobsPageSize = 25;
  let _jobsSortCol = "";
  let _jobsSortDir = 1;
  let _mySkills = [];
  let _remoteFilter = "all";
  let _salaryData = null;
  const LS_SCAN_KEY = "kos_scan_v2";
  const LS_SKILLS_KEY = "kos_myskills_v1";
  const TYPING_PHRASES = [
    "Menganalisis pasar kerja Indonesia secara real-time...",
    "Tracking the most in-demand skills on LinkedIn...",
    "Connecting job market data with content strategy...",
    "Monitoring Data & Technology job trends...",
    "Mengidentifikasi peluang konten yang belum terlayani...",
    "Powered by LinkedIn Scraping + Instagram Analytics.",
  ];
  function plotLayout(overrides) {
    const dark = _theme === "dark";
    const gridColor = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
    const tickColor = dark ? "#8B949E" : "#64748B";
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "'Inter', system-ui, sans-serif", color: dark ? "#E6EDF3" : "#0F172A", size: 12 },
      xaxis: {
        gridcolor: gridColor,
        zerolinecolor: gridColor,
        tickfont: { size: 11, color: tickColor },
        linecolor: gridColor,
        automargin: true,
      },
      yaxis: {
        gridcolor: gridColor,
        zerolinecolor: gridColor,
        tickfont: { size: 11, color: tickColor },
        linecolor: gridColor,
        automargin: true,
      },
      margin: { t: 16, r: 20, b: 56, l: 20 },
      colorway: PALETTE,
      showlegend: false,
      hoverlabel: {
        bgcolor: dark ? "#1C2128" : "#FFFFFF",
        bordercolor: dark ? "#30363D" : "#E2E8F0",
        font: { family: "'Inter', system-ui, sans-serif", size: 12, color: dark ? "#E6EDF3" : "#0F172A" },
      },
    }, overrides || {});
  }
  const PLOTLY_CONFIG = { displaylogo: false, responsive: true, displayModeBar: false };
  function fmt(n) {
    if (n === null || n === undefined || n === "") return "-";
    if (typeof n === "number") {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 1000) return (n / 1000).toFixed(1) + "K";
      return n.toLocaleString();
    }
    return String(n);
  }
  function fmtNum(n, d) {
    if (n === null || n === undefined) return "-";
    return Number(n).toFixed(d !== undefined ? d : 2);
  }
  function safePct(val) {
    const v = parseFloat(val);
    if (isNaN(v)) return "-";
    if (v > 1) return v.toFixed(2) + "%";
    return (v * 100).toFixed(2) + "%";
  }
  function truncate(str, max) {
    if (!str) return "";
    return str.length > max ? str.slice(0, max) + "..." : str;
  }
  function el(id) { return document.getElementById(id); }
  function renderChart(id, traces, layout, config) {
    const e = el(id);
    if (!e) return;
    const full = plotLayout(layout);
    full.autosize = true;
    Plotly.react(e, traces, full, Object.assign({}, PLOTLY_CONFIG, config || {}));
    setTimeout(() => {
      if (e && e.offsetParent !== null) Plotly.relayout(e, { autosize: true });
    }, 80);
  }
  function animateCounter(element, finalVal, duration) {
    if (!element) return;
    element.classList.add("animating");
    const rawNum = parseFloat(String(finalVal).replace(/[^\d.]/g, ""));
    if (isNaN(rawNum) || finalVal === "-") {
      element.textContent = finalVal;
      setTimeout(() => element.classList.remove("animating"), 500);
      return;
    }
    const suffix = String(finalVal).replace(/[\d.,]/g, "").trim();
    const start = performance.now();
    const step = (ts) => {
      const p = Math.min((ts - start) / (duration || 900), 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(rawNum * eased);
      element.textContent = cur.toLocaleString() + (suffix || "");
      if (p < 1) requestAnimationFrame(step);
      else { element.textContent = finalVal; element.classList.remove("animating"); }
    };
    requestAnimationFrame(step);
  }
  function initTheme() {
    const saved = localStorage.getItem("kos_theme") || "light";
    applyTheme(saved, false);
  }
  function applyTheme(theme, rerender) {
    _theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kos_theme", theme);
    if (rerender) {
      const d = _scanResult ? buildMerged(_scanResult) : _data;
      if (d) renderAllCharts(d);
    }
  }
  function buildMerged(result) {
    if (!_data) return result;
    const mergedKpis = Object.assign({}, _data.kpis || {}, result.kpis || {}, {
      ig_followers: (_data.kpis || {}).ig_followers,
      ig_avg_er: (_data.kpis || {}).ig_avg_er,
      ig_total_likes: (_data.kpis || {}).ig_total_likes,
      total_ig_posts: (_data.kpis || {}).total_ig_posts,
      ig_username: (_data.kpis || {}).ig_username,
    });
    return Object.assign({}, _data, {
      kpis: mergedKpis,
      skills: (result.skills || []).length ? result.skills : (_data.skills || []),
      categories: (result.categories || []).length ? result.categories : (_data.categories || []),
      companies: (result.companies || []).length ? result.companies : (_data.companies || []),
      trend: (result.trend || []).length ? result.trend : (_data.trend || []),
      locations: (result.locations || []).length ? result.locations : (_data.locations || []),
      instagram: _data.instagram,
      gap_analysis: (result.gap_analysis || []).length ? result.gap_analysis : (_data.gap_analysis || []),
      recommendations: (result.recommendations || []).length ? result.recommendations : (_data.recommendations || []),
      data_status: Object.assign({}, _data.data_status || {}, {
        has_data: true,
        instagram: (_data.data_status || {}).instagram,
        gap: (result.gap_analysis || []).length > 0 || (_data.data_status || {}).gap,
        recommendations: (result.recommendations || []).length > 0 || (_data.data_status || {}).recommendations,
      }),
    });
  }
  function applyLiveScan(result) {
    const merged = buildMerged(result);
    renderJobCharts(merged);
    renderKpis(merged.kpis, "kpiRow");
    renderBanner(merged.kpis, true);
    updateSidebarMeta(merged);
    const badge = el("topbarScanBadge");
    const resetBtn = el("btnResetScan");
    if (badge) badge.style.display = "inline-flex";
    if (resetBtn) resetBtn.style.display = "flex";
  }
  function chartOverviewRemote(data) {
    const remote = data.remote_stats || {};
    if (remote.remote !== undefined) {
      const rLabels = ["Remote", "Onsite", "Unknown"];
      const rValues = [remote.remote || 0, remote.onsite || 0, remote.unknown || 0];
      renderChart("chart-overview-remote", [{
        labels: rLabels, values: rValues, type: "pie", hole: 0.52,
        marker: { colors: [COLORS.teal, COLORS.blue, COLORS.muted || "#94A3B8"] },
        textinfo: "percent",
        textfont: { size: 11 },
        hovertemplate: "<b>%{label}</b><br>%{value} jobs (%{percent})<extra></extra>",
      }], {
        showlegend: true,
        legend: { orientation: "v", x: 1.02, y: 0.5, xanchor: "left", font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
        margin: { t: 16, r: 100, b: 16, l: 16 },
      });
    }
  }
  function chartOverviewFreshness(data) {
    const freshness = data.freshness || {};
    if (Object.values(freshness).some((v) => v > 0)) {
      const fColors = [COLORS.red, COLORS.amber, COLORS.green, "#94A3B8", "#CBD5E1"];
      const fLabels = ["Hot (<7d)", "Fresh (7-14d)", "Active (14-30d)", "Aging (>30d)", "Unknown"];
      const fVals = [freshness.hot || 0, freshness.fresh || 0, freshness.active || 0, freshness.aging || 0, freshness.unknown || 0];
      renderChart("chart-overview-freshness", [{
        x: fLabels, y: fVals, type: "bar",
        marker: { color: fColors },
        text: fVals.map(String),
        textposition: "outside",
        textfont: { size: 11 },
        hovertemplate: "<b>%{x}</b><br>%{y} jobs<extra></extra>",
        cliponaxis: false,
      }], {
        xaxis: { tickfont: { size: 10 }, automargin: true },
        yaxis: { title: { text: "Jobs" }, automargin: true },
        bargap: 0.35,
        margin: { t: 16, r: 20, b: 60, l: 50 },
      });
    }
  }
  function chartOverviewSalary(data) {
    const salary = data.salary_by_category || [];
    const salaryStats = data.salary_stats || {};
    const osCard = el("overviewSalaryCard");
    const osMeta = el("overviewSalaryMeta");
    const ca = el("chart-overview-salary");
    if (osCard && salaryStats.count > 0) {
      osCard.style.display = "block";
      if (osMeta) osMeta.innerHTML = `Salary Info: <strong>${salaryStats.count} jobs</strong> (${salaryStats.pct_disclosed}%) | Avg: <strong>${salaryStats.currency || 'USD'} ${(salaryStats.avg/1000000).toFixed(1)}M</strong>`;
      if (salary.length >= 1) {
        const cur = salaryStats.currency || "USD";
        const sorted = [...salary].sort((a, b) => b.avg_salary - a.avg_salary);
        const maxSal = Math.max(...sorted.map((r) => r.avg_salary));
        renderChart("chart-overview-salary", [{
          y: sorted.map((r) => r.job_category),
          x: sorted.map((r) => r.avg_salary),
          type: "bar", orientation: "h",
          marker: { color: sorted.map((r) => r.avg_salary), colorscale: [[0, COLORS.cyan + "88"], [1, COLORS.purple]], showscale: false },
          text: sorted.map((r) => cur + " " + Math.round(r.avg_salary).toLocaleString()),
          textposition: "outside",
          textfont: { size: 10 },
          hovertemplate: "<b>%{y}</b><br>Avg: %{text}<br>%{count} sample<extra></extra>",
          cliponaxis: false,
        }], {
          xaxis: { title: { text: `Avg Salary (${cur})` }, range: [0, maxSal * 1.25], automargin: true },
          yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
          margin: { t: 10, r: 100, b: 50, l: 24 },
          bargap: 0.3,
        });
      } else {
        if (ca) ca.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:12px">Insufficient salary data to show category breakdown.</div>';
      }
    }
  }
  function renderJobCharts(data) {
    chartTrend(data);
    chartCategories(data);
    chartLocations(data);
    chartSkillsBar(data);
    chartCatSkills(data);
    chartOverviewRemote(data);
    chartOverviewFreshness(data);
    chartOverviewSalary(data);
    chartCompanies(data);
    chartTrendsLine(data);
    renderWordcloudChart(data.skills || []);
  }
  function navigate(section) {
    localStorage.setItem("kos_active_menu", section);
    document.querySelectorAll(".page-section").forEach((s) => s.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    const sec = el("section-" + section);
    if (sec) {
      sec.classList.add("active");
      let delay = 0.04;
      sec.querySelectorAll(".kpi-card, .chart-card, .rec-card, .section-banner, .scanner-form-card, .job-table-card").forEach((elem, i) => {
        elem.style.animation = "none";
        elem.offsetHeight;
        elem.style.animation = "";
        elem.style.animationDelay = (delay + i * 0.05) + "s";
      });
      setTimeout(() => {
        sec.querySelectorAll("[id^='chart-']").forEach((div) => {
          if (div && div.data && div.data.length) Plotly.Plots.resize(div);
        });
      }, 200);
    }
    const nav = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (nav) nav.classList.add("active");
    const labels = {
      overview: "Overview", skills: "Skills Analysis", companies: "Top Companies",
      instagram: "Instagram Insights", gap: "Gap Analysis",
      recommendations: "Recommendations", scanner: "Live Scanner",
    };
    const lbl = el("topbarSectionLabel");
    if (lbl) lbl.textContent = labels[section] || section;
    el("mainScroll").scrollTo({ top: 0, behavior: "smooth" });
    if (window.innerWidth <= 900) el("sidebar").classList.remove("mobile-open");
  }
  function updateSidebarMeta(data) {
    const kpis = data.kpis || {};
    const meta = data.metadata || {};
    const set = (id, v) => { const e = el(id); if (e) e.textContent = v || "-"; };
    set("meta-query", kpis.job_query || meta.job_query);
    set("meta-location", kpis.location_query || meta.location_query);
    set("meta-range", kpis.date_range || meta.date_range);
    const ts = kpis.run_timestamp || meta.run_timestamp || "";
    set("meta-ts", ts ? String(ts).split("T")[0].split(" ")[0] : "-");
    set("meta-jobs", fmt(kpis.total_jobs));
    set("meta-companies", fmt(kpis.unique_companies));
    set("meta-ig", fmt(kpis.total_ig_posts));
    set("meta-er", kpis.ig_avg_er !== undefined ? safePct(kpis.ig_avg_er) : "-");
    const statusRow = el("dataStatusRow");
    if (statusRow) {
      const st = data.data_status || {};
      statusRow.innerHTML = [
        { k: "jobs", l: "Jobs" }, { k: "skills", l: "Skills" },
        { k: "instagram", l: "IG" }, { k: "gap", l: "Gap" },
      ].map((i) => `<div class="status-dot ${st[i.k] ? "" : "missing"}">${i.l}</div>`).join("");
    }
  }
  function renderKpis(kpis, containerId) {
    const container = el(containerId);
    if (!container) return;
    const cards = [
      { icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 13V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14l4-4h12a2 2 0 002-2z"/></svg>`, value: fmt(kpis.total_jobs), label: "Total Job Postings", sub: kpis.location_query ? "in " + kpis.location_query : "", c: COLORS.blue, c2: COLORS.cyan },
      { icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M9 8h1m-1 4h1m-1 4h1M14 8h1m-1 4h1m-1 4h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/></svg>`, value: fmt(kpis.unique_companies), label: "Unique Companies", sub: "actively hiring", c: COLORS.purple, c2: COLORS.indigo },
      { icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`, value: kpis.top_category ? truncate(kpis.top_category, 16) : "-", label: "Top Job Category", noAnim: true, sub: kpis.top_category_count ? fmt(kpis.top_category_count) + " postings" : "", c: COLORS.teal, c2: COLORS.green },
      { icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`, value: kpis.date_range || "-", label: "Date Range", noAnim: true, sub: kpis.run_timestamp ? "Updated " + String(kpis.run_timestamp).split("T")[0].split(" ")[0] : "", c: COLORS.amber, c2: COLORS.red },
    ];
    container.innerHTML = cards.map((c, i) => `
      <div class="kpi-card" style="--kpi-color:${c.c};--kpi-color2:${c.c2};animation-delay:${0.05 + i * 0.08}s">
        <div class="kpi-icon">${c.icon}</div>
        <div class="kpi-value ${c.noAnim ? 'no-anim' : ''}" data-target="${c.value}">${c.value}</div>
        <div class="kpi-label">${c.label}</div>
        ${c.sub ? `<div class="kpi-sub">${c.sub}</div>` : ""}
      </div>`).join("");
    setTimeout(() => {
      container.querySelectorAll(".kpi-value:not(.no-anim)").forEach((e, i) => {
        setTimeout(() => animateCounter(e, e.dataset.target, 900), i * 90);
      });
    }, 200);
  }
  function renderIgKpis(kpis) {
    const container = el("igKpiRow");
    if (!container) return;
    const cards = [
      { icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`, value: fmt(kpis.ig_followers), label: "Followers", c: COLORS.purple, c2: COLORS.indigo },
      { icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`, value: fmt(kpis.total_ig_posts), label: "Total Posts", c: COLORS.pink, c2: COLORS.red },
      { icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`, value: fmt(kpis.ig_total_likes), label: "Total Likes", c: COLORS.red, c2: COLORS.amber },
      { icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`, value: kpis.ig_avg_er !== undefined ? safePct(kpis.ig_avg_er) : "-", label: "Avg Engagement Rate", c: COLORS.teal, c2: COLORS.green },
    ];
    container.innerHTML = cards.map((c, i) => `
      <div class="kpi-card" style="--kpi-color:${c.c};--kpi-color2:${c.c2};animation-delay:${0.05 + i * 0.08}s">
        <div class="kpi-icon">${c.icon}</div>
        <div class="kpi-value ${c.noAnim ? 'no-anim' : ''}" data-target="${c.value}">${c.value}</div>
        <div class="kpi-label">${c.label}</div>
      </div>`).join("");
    setTimeout(() => {
      container.querySelectorAll(".kpi-value:not(.no-anim)").forEach((e, i) => {
        setTimeout(() => animateCounter(e, e.dataset.target, 900), i * 90);
      });
    }, 200);
  }
  function renderBanner(kpis, isLive) {
    const tag = el("bannerTag");
    const title = el("bannerTitle");
    const stats = el("bannerStats");
    if (tag) { tag.textContent = isLive ? "Live Scan Active" : "Notebook Dataset"; tag.className = "banner-tag" + (isLive ? " live" : ""); }
    if (title) {
      const q = kpis.job_query || "Job Search";
      const loc = kpis.location_query || "Indonesia";
      title.innerHTML = `KarirOScope - <span>${q}</span> in ${loc}`;
    }
    if (stats) {
      const items = [
        { val: fmt(kpis.total_jobs), label: "Jobs" },
        { val: fmt(kpis.unique_companies), label: "Companies" },
        { val: kpis.date_range || "-", label: "Period" },
      ];
      stats.innerHTML = items.map((i) => `<div class="banner-stat"><div class="banner-stat-val">${i.val}</div><div class="banner-stat-label">${i.label}</div></div>`).join("");
    }
  }
  function noDataHtml() {
    return `<div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>No data available</span></div>`;
  }
  function chartTrend(data) {
    const trend = data.trend || [];
    const e = el("chart-trend");
    if (!trend.length) { if (e) e.innerHTML = noDataHtml(); return; }
    const x = trend.map((r) => r.year_month || r.month || "");
    const y = trend.map((r) => r.posting_count || r.count || 0);
    renderChart("chart-trend", [{
      x, y, type: "scatter", mode: "lines+markers",
      fill: "tozeroy",
      fillcolor: _theme === "dark" ? "rgba(10,102,194,0.14)" : "rgba(10,102,194,0.08)",
      line: { color: COLORS.blue, width: 2.5, shape: "spline" },
      marker: { color: COLORS.blue, size: 5, line: { color: "#fff", width: 1.5 } },
      hovertemplate: "<b>%{x}</b><br>%{y} postings<extra></extra>",
    }], {
      xaxis: { tickangle: -30, automargin: true },
      yaxis: { title: { text: "Postings", standoff: 10 }, automargin: true },
      margin: { t: 16, r: 20, b: 70, l: 55 },
    });
  }
  function chartCategories(data) {
    const cats = data.categories || [];
    if (!cats.length) { if (el("chart-categories")) el("chart-categories").innerHTML = noDataHtml(); return; }
    renderChart("chart-categories", [{
      labels: cats.map((r) => r.job_category || "Other"),
      values: cats.map((r) => r.count || 0),
      type: "pie", hole: 0.48,
      marker: { colors: PALETTE },
      textinfo: "percent",
      textfont: { size: 11 },
      hovertemplate: "<b>%{label}</b><br>%{value} jobs (%{percent})<extra></extra>",
      direction: "clockwise",
    }], {
      showlegend: true,
      legend: {
        orientation: "v",
        x: 1.02, y: 0.5,
        xanchor: "left",
        font: { size: 10 },
        bgcolor: "rgba(0,0,0,0)",
      },
      margin: { t: 16, r: 110, b: 16, l: 16 },
    });
  }
  function chartLocations(data) {
    const locs = data.locations || [];
    if (!locs.length) { if (el("chart-locations")) el("chart-locations").innerHTML = noDataHtml(); return; }
    const x = locs.map((r) => r.city || r.location || "");
    const y = locs.map((r) => r.count || 0);
    renderChart("chart-locations", [{
      x, y, type: "bar",
      marker: { color: y, colorscale: [[0, COLORS.cyan + "99"], [1, COLORS.blue]], showscale: false },
      hovertemplate: "<b>%{x}</b><br>%{y} jobs<extra></extra>",
    }], {
      xaxis: { tickangle: -30, automargin: true, tickfont: { size: 10 } },
      yaxis: { title: { text: "Jobs", standoff: 8 }, automargin: true },
      bargap: 0.38,
      margin: { t: 16, r: 16, b: 80, l: 50 },
    });
  }
  function chartTrendsLine(data) {
    const trend = data.trend || [];
    if (!trend.length) { if (el("chart-trends-line")) el("chart-trends-line").innerHTML = noDataHtml(); return; }
    const x = trend.map((r) => r.year_month || r.month || "");
    const y = trend.map((r) => r.posting_count || r.count || 0);
    renderChart("chart-trends-line", [{
      x, y, type: "bar",
      marker: { color: y, colorscale: [[0, COLORS.cyan + "77"], [1, COLORS.blue]], showscale: false },
      hovertemplate: "<b>%{x}</b><br>%{y} postings<extra></extra>",
    }], {
      xaxis: { tickangle: -30, automargin: true, tickfont: { size: 10 } },
      yaxis: { title: { text: "Postings", standoff: 8 }, automargin: true },
      bargap: 0.3,
      margin: { t: 16, r: 16, b: 80, l: 50 },
    });
  }
  function chartSkillsBar(data) {
    const skills = data.skills || [];
    if (!skills.length) { if (el("chart-skills-bar")) el("chart-skills-bar").innerHTML = noDataHtml(); return; }
    const top = skills.slice(0, 20);
    const y = top.map((r) => r.skill || "");
    const x = top.map((r) => r.frequency || 0);
    const maxX = Math.max(...x);
    renderChart("chart-skills-bar", [{
      y, x, type: "bar", orientation: "h",
      marker: { color: x, colorscale: [[0, COLORS.cyan + "99"], [1, COLORS.blue]], showscale: false },
      text: x.map(String),
      textposition: "outside",
      textfont: { size: 11 },
      hovertemplate: "<b>%{y}</b><br>%{x} mentions<extra></extra>",
      cliponaxis: false,
    }], {
      xaxis: { title: { text: "Job Posting Mentions", standoff: 8 }, range: [0, maxX * 1.22], automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 11 }, automargin: true },
      margin: { t: 14, r: 55, b: 55, l: 24 },
      bargap: 0.3,
    });
  }
  function chartCatSkills(data) {
    const rows = data.category_skills || [];
    if (!rows.length) { if (el("chart-cat-skills")) el("chart-cat-skills").innerHTML = noDataHtml(); return; }
    const cats = [...new Set(rows.map((r) => r.job_category || ""))].slice(0, 8);
    const allSkills = [...new Set(rows.map((r) => r.skill || ""))];
    const map = {};
    rows.forEach((r) => { map[(r.job_category || "") + "||" + (r.skill || "")] = r.frequency || 0; });
    const topSkills = allSkills
      .sort((a, b) => cats.reduce((s, c) => s + (map[c + "||" + b] || 0), 0) - cats.reduce((s, c) => s + (map[c + "||" + a] || 0), 0))
      .slice(0, 15);
    const z = topSkills.map((sk) => cats.map((cat) => map[cat + "||" + sk] || 0));
    renderChart("chart-cat-skills", [{
      z, x: cats, y: topSkills, type: "heatmap",
      colorscale: [[0, "rgba(10,102,194,0.05)"], [0.5, COLORS.cyan + "bb"], [1, COLORS.blue]],
      hovertemplate: "<b>%{y}</b> in %{x}<br>Frequency: %{z}<extra></extra>",
      showscale: true,
      colorbar: { thickness: 12, len: 0.85, tickfont: { size: 10 } },
    }], {
      xaxis: { tickangle: -20, tickfont: { size: 10 }, automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 11 }, automargin: true },
      margin: { t: 14, r: 65, b: 90, l: 24 },
    });
  }
  function chartCompanies(data) {
    const companies = data.companies || [];
    if (!companies.length) { if (el("chart-companies")) el("chart-companies").innerHTML = noDataHtml(); return; }
    const top = companies.slice(0, 20);
    const y = top.map((r) => r.company_name || "");
    const x = top.map((r) => r.job_count || 0);
    const maxX = Math.max(...x);
    renderChart("chart-companies", [{
      y, x, type: "bar", orientation: "h",
      marker: { color: x, colorscale: [[0, COLORS.purple + "88"], [1, COLORS.blue]], showscale: false },
      text: x.map(String),
      textposition: "outside",
      textfont: { size: 11 },
      hovertemplate: "<b>%{y}</b><br>%{x} postings<extra></extra>",
      cliponaxis: false,
    }], {
      xaxis: { title: { text: "Job Postings", standoff: 8 }, range: [0, maxX * 1.22], automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 11 }, automargin: true },
      margin: { t: 14, r: 55, b: 55, l: 24 },
      bargap: 0.28,
    });
  }
  function chartIgType(ig) {
    const rows = ig.type_performance || [];
    if (!rows.length) return;
    const erCol = rows[0].avg_engagement_rate !== undefined ? "avg_engagement_rate" : "engagement_rate";
    const sorted = [...rows].sort((a, b) => (b[erCol] || 0) - (a[erCol] || 0));
    const x = sorted.map((r) => r.post_type || "");
    const y = sorted.map((r) => r[erCol] || 0);
    const isRaw = y.some((v) => v > 1);
    renderChart("chart-ig-type", [{
      x, y, type: "bar",
      marker: { color: PALETTE.slice(0, x.length) },
      text: y.map((v) => safePct(v)),
      textposition: "outside",
      textfont: { size: 11 },
      hovertemplate: "<b>%{x}</b><br>Avg ER: %{text}<extra></extra>",
      cliponaxis: false,
    }], {
      xaxis: { title: { text: "Content Type" }, automargin: true },
      yaxis: { title: { text: "Avg Engagement Rate" }, tickformat: isRaw ? ".2f" : ".2%", automargin: true },
      margin: { t: 16, r: 16, b: 60, l: 75 },
      bargap: 0.4,
    });
  }
  function chartIgTopic(ig) {
    const rows = ig.topic_performance || [];
    if (!rows.length) return;
    const erCol = rows[0].avg_engagement_rate !== undefined ? "avg_engagement_rate" : "engagement_rate";
    const sorted = [...rows].sort((a, b) => (b[erCol] || 0) - (a[erCol] || 0)).slice(0, 15);
    const y = sorted.map((r) => r.post_topic || "");
    const x = sorted.map((r) => r[erCol] || 0);
    const isRaw = x.some((v) => v > 1);
    renderChart("chart-ig-topic", [{
      y, x, type: "bar", orientation: "h",
      marker: { color: x, colorscale: [[0, COLORS.pink + "88"], [1, COLORS.purple]], showscale: false },
      hovertemplate: "<b>%{y}</b><br>ER: %{x:.4f}<extra></extra>",
    }], {
      xaxis: { title: { text: "Avg Engagement Rate" }, tickformat: isRaw ? ".2f" : ".2%", automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
      margin: { t: 14, r: 20, b: 70, l: 24 },
      bargap: 0.3,
    });
  }
  function chartIgDay(ig) {
    const rows = ig.day_pattern || [];
    if (!rows.length) return;
    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const dayMap = {};
    rows.forEach((r) => { dayMap[r.day_of_week] = r.engagement_rate || 0; });
    const ordered = dayOrder.filter((d) => dayMap[d] !== undefined);
    const x = ordered.length ? ordered : rows.map((r) => r.day_of_week);
    const y = x.map((d) => dayMap[d] || 0);
    const isRaw = y.some((v) => v > 1);
    renderChart("chart-ig-day", [{
      x, y, type: "bar",
      marker: { color: y, colorscale: [[0, COLORS.amber + "66"], [1, COLORS.teal]], showscale: false },
      hovertemplate: "<b>%{x}</b><br>ER: %{y:.4f}<extra></extra>",
    }], {
      xaxis: { automargin: true },
      yaxis: { title: { text: "Avg Engagement Rate" }, tickformat: isRaw ? ".2f" : ".2%", automargin: true },
      margin: { t: 16, r: 16, b: 60, l: 75 },
      bargap: 0.35,
    });
  }
  function chartIgMonthly(ig) {
    const rows = ig.monthly_trend || [];
    if (!rows.length) return;
    const sortKey = rows[0].month_year !== undefined ? "month_year" : "year_month";
    const sorted = [...rows].sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")));
    const x = sorted.map((r) => r[sortKey] || "");
    const y = sorted.map((r) => r.engagement_rate || 0);
    const isRaw = y.some((v) => v > 1);
    renderChart("chart-ig-monthly", [{
      x, y, type: "scatter", mode: "lines+markers",
      fill: "tozeroy",
      fillcolor: _theme === "dark" ? "rgba(124,58,237,0.12)" : "rgba(124,58,237,0.07)",
      line: { color: COLORS.purple, width: 2.5, shape: "spline" },
      marker: { color: COLORS.purple, size: 5 },
      hovertemplate: "<b>%{x}</b><br>ER: %{y:.4f}<extra></extra>",
    }], {
      xaxis: { tickangle: -30, automargin: true },
      yaxis: { title: { text: "Engagement Rate" }, tickformat: isRaw ? ".2f" : ".2%", automargin: true },
      margin: { t: 16, r: 16, b: 80, l: 80 },
    });
  }
  function chartIgHashtags(ig) {
    const rows = ig.hashtags || [];
    if (!rows.length) return;
    const topH = rows.slice(0, 20);
    const x = topH.map((r) => "#" + (r.hashtag || ""));
    const y = topH.map((r) => r.frequency || 0);
    renderChart("chart-ig-hashtags", [{
      x, y, type: "bar",
      marker: { color: y, colorscale: [[0, COLORS.cyan + "77"], [1, COLORS.blue]], showscale: false },
      hovertemplate: "<b>%{x}</b><br>%{y} uses<extra></extra>",
    }], {
      xaxis: { tickangle: -35, tickfont: { size: 10 }, automargin: true },
      yaxis: { title: { text: "Usage Count", standoff: 8 }, automargin: true },
      margin: { t: 16, r: 16, b: 90, l: 55 },
      bargap: 0.3,
    });
  }
  function chartGapScatter(data) {
    const rows = data.gap_analysis || [];
    if (!rows.length) return;
    const freqCol = rows[0].market_frequency_pct !== undefined ? "market_frequency_pct" : "market_frequency";
    const covCol = rows[0].coverage_rate !== undefined ? "coverage_rate" : "posts_count";
    const x = rows.map((r) => parseFloat(r[freqCol]) || 0);
    const y = rows.map((r) => parseFloat(r[covCol]) || 0);
    const labels = rows.map((r) => r.content_topic || "");
    const scores = rows.map((r) => r.opportunity_score || 0);
    renderChart("chart-gap-scatter", [{
      x, y, type: "scatter", mode: "markers+text",
      text: labels, textposition: "top center", textfont: { size: 9 },
      marker: {
        color: scores,
        colorscale: [[0, COLORS.teal + "88"], [1, COLORS.red]],
        size: scores.map((s) => 8 + s * 0.4),
        showscale: true,
        colorbar: { title: { text: "Score", font: { size: 10 } }, thickness: 12, tickfont: { size: 9 } },
        line: { color: _theme === "dark" ? "#30363D" : "#E2E8F0", width: 1 },
      },
      hovertemplate: "<b>%{text}</b><br>Market: %{x:.2f}<br>Coverage: %{y:.2f}<extra></extra>",
    }], {
      xaxis: { title: { text: "Market Demand" }, automargin: true },
      yaxis: { title: { text: "Content Coverage" }, automargin: true },
      margin: { t: 20, r: 80, b: 60, l: 60 },
    });
  }
  function chartGapBar(data) {
    const rows = data.gap_analysis || [];
    if (!rows.length) return;
    const sorted = [...rows].sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0)).slice(0, 15);
    const y = sorted.map((r) => r.content_topic || "");
    const x = sorted.map((r) => r.opportunity_score || 0);
    const maxX = Math.max(...x);
    renderChart("chart-gap-bar", [{
      y, x, type: "bar", orientation: "h",
      marker: { color: x, colorscale: [[0, COLORS.teal + "77"], [1, COLORS.red]], showscale: false },
      text: x.map((v) => fmtNum(v, 1)),
      textposition: "outside",
      textfont: { size: 10 },
      hovertemplate: "<b>%{y}</b><br>Score: %{x:.2f}<extra></extra>",
      cliponaxis: false,
    }], {
      xaxis: { title: { text: "Opportunity Score" }, range: [0, maxX * 1.22], automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
      margin: { t: 14, r: 55, b: 55, l: 24 },
      bargap: 0.3,
    });
  }
  function renderWordcloudChart(skills) {
    const card = el("wordcloudCard");
    const container = el("chart-wordcloud");
    if (!container) return;
    if (!skills || !skills.length) { if (card) card.style.display = "none"; return; }
    if (card) card.style.display = "block";
    const top = skills.slice(0, 50);
    const maxF = Math.max(...top.map((s) => s.frequency || 1));
    const minF = Math.min(...top.map((s) => s.frequency || 1));
    const rng = maxF - minF || 1;
    const golden = 2.399963;
    const xs = [], ys = [];
    top.forEach((_, i) => {
      const r = Math.sqrt(i + 0.5) * 0.22;
      const theta = i * golden;
      xs.push(+(r * Math.cos(theta)).toFixed(4));
      ys.push(+(r * Math.sin(theta)).toFixed(4));
    });
    Plotly.react(container, [{
      x: xs, y: ys, mode: "text",
      text: top.map((s) => s.skill || ""),
      textfont: {
        size: top.map((s) => Math.round(10 + ((s.frequency || 1) - minF) / rng * 28)),
        color: top.map((_, i) => PALETTE[i % PALETTE.length]),
        family: "'Inter', system-ui, sans-serif",
      },
      hovertext: top.map((s) => `${s.skill}: ${s.frequency} mentions`),
      hoverinfo: "text",
      type: "scatter",
    }], plotLayout({
      xaxis: { showgrid: false, zeroline: false, showticklabels: false, fixedrange: true },
      yaxis: { showgrid: false, zeroline: false, showticklabels: false, fixedrange: true, scaleanchor: "x" },
      margin: { t: 10, r: 10, b: 10, l: 10 },
      hovermode: "closest",
      autosize: true,
    }), PLOTLY_CONFIG);
  }
  function renderRecommendations(data) {
    const rows = data.recommendations || [];
    const container = el("recs-cards");
    const noData = el("recs-no-data");
    if (!rows.length) { if (noData) noData.style.display = "flex"; if (container) container.style.display = "none"; return; }
    if (noData) noData.style.display = "none";
    if (!container) return;
    const sorted = [...rows].sort((a, b) => (a.rank || 0) - (b.rank || 0));
    container.innerHTML = sorted.map((r, i) => {
      const rank = r.rank || i + 1;
      const score = r.opportunity_score !== undefined ? fmtNum(r.opportunity_score, 1) : "-";
      const keywords = ((r.top_keywords || r.top_keywords_in_jobs || "").split(",")).slice(0, 4).map((k) => k.trim()).filter(Boolean);
      return `<div class="rec-card" style="animation-delay:${0.04 + i * 0.06}s">
        <div class="rec-rank">#${rank}</div>
        <div class="rec-body">
          <div class="rec-topic">${r.content_topic || "-"}</div>
          <div class="rec-reasoning">${r.reasoning || "-"}</div>
        </div>
        <div class="rec-meta">
          <div class="rec-score">${score}</div>
          <div class="rec-score-label">Opp. Score</div>
          <div class="rec-tags">
            ${keywords.map((k) => `<span class="rec-tag">${k}</span>`).join("")}
            ${r.recommended_format ? `<span class="rec-tag format">${r.recommended_format}</span>` : ""}
            ${r.recommended_frequency ? `<span class="rec-tag freq">${r.recommended_frequency}</span>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");
  }
  function renderAllCharts(data) {
    const kpis = data.kpis || {};
    renderBanner(kpis, !!kpis.is_live_scan);
    renderKpis(kpis, "kpiRow");
    renderJobCharts(data);
    const ig = data.instagram || {};
    const hasIg = data.data_status && data.data_status.instagram;
    if (hasIg && (ig.type_performance || []).length) {
      if (el("instagram-no-data")) el("instagram-no-data").style.display = "none";
      if (el("instagram-content")) el("instagram-content").style.display = "block";
      renderIgKpis(kpis);
      const igUser = el("igUsernameBadge");
      if (igUser && kpis.ig_username) igUser.textContent = "@" + kpis.ig_username;
      chartIgType(ig);
      chartIgTopic(ig);
      chartIgDay(ig);
      chartIgMonthly(ig);
      chartIgHashtags(ig);
    } else {
      if (el("instagram-no-data")) el("instagram-no-data").style.display = "flex";
      if (el("instagram-content")) el("instagram-content").style.display = "none";
    }
    const hasGap = data.data_status && data.data_status.gap;
    if (hasGap && (data.gap_analysis || []).length) {
      if (el("gap-no-data")) el("gap-no-data").style.display = "none";
      if (el("gap-content")) el("gap-content").style.display = "block";
      chartGapScatter(data);
      chartGapBar(data);
    } else {
      if (el("gap-no-data")) el("gap-no-data").style.display = "flex";
      if (el("gap-content")) el("gap-content").style.display = "none";
    }
    renderRecommendations(data);
    updateSidebarMeta(data);
  }
  function setSpinner(visible) {
    const sp = el("scanSpinnerInline");
    if (sp) sp.style.display = visible ? "flex" : "none";
  }
  function setProgress(pct, msg) {
    const fill = el("progressFill");
    const pctEl = el("progressPct");
    const msgEl = el("progressMessage");
    if (fill) fill.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
    if (msgEl) msgEl.textContent = msg || "";
  }
  function addLog(msg, type) {
    const log = el("scanLog");
    if (!log) return;
    const now = new Date().toLocaleTimeString("en-US", { hour12: false });
    const cls = type ? "log-" + type : "";
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = `<span class="log-time">${now}</span><span class="${cls}">${msg}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  function renderJobTable(jobs) {
    _jobsAll = jobs || [];
    _jobsFiltered = [..._jobsAll];
    _jobsPage = 1;
    const card = el("jobTableCard");
    if (!card) return;
    if (!_jobsAll.length) { card.style.display = "none"; return; }
    card.style.display = "block";
    const badge = el("jobCountBadge");
    if (badge) badge.textContent = _jobsAll.length + " jobs";
    drawJobTable();
  }
  function drawJobTable() {
    const tbody = el("jobTableBody");
    if (!tbody) return;
    const pageSize = parseInt(el("jobPageSize").value) || 25;
    _jobsPageSize = pageSize;
    const total = _jobsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    _jobsPage = Math.min(_jobsPage, totalPages);
    const start = (_jobsPage - 1) * pageSize;
    const rows = _jobsFiltered.slice(start, start + pageSize);
    tbody.innerHTML = rows.map((job, i) => {
      const rowNum = start + i + 1;
      const url = job.job_url || "";
      const linkHtml = url
        ? `<a href="${url}" target="_blank" rel="noopener noreferrer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Apply
          </a>`
        : `<span class="no-link">N/A</span>`;
      const cat = job.job_category || "";
      const catColor = { "Data and Technology": "#0A66C2", "Software Engineering": "#7C3AED", "Marketing and Content": "#EC4899", "Sales and Business Development": "#F59E0B", "People and HR": "#0D9488", "Finance and Operations": "#10B981", "Product and Design": "#EF4444" };
      const catStyle = catColor[cat] ? `background:${catColor[cat]}18;border-color:${catColor[cat]}30;color:${catColor[cat]}` : "";
      const posted = job.posted_date ? String(job.posted_date).split("T")[0].split(" ")[0] : "";
      return `<tr>
        <td class="td-no">${rowNum}</td>
        <td class="td-title" title="${job.job_title || ""}">${job.job_title || "-"}</td>
        <td class="td-company" title="${job.company_name || ""}">${job.company_name || "-"}</td>
        <td class="td-location" title="${job.location || ""}">${job.location || "-"}</td>
        <td class="td-category"><span class="cat-badge" style="${catStyle}">${cat || "General"}</span></td>
        <td class="td-date">${posted || "-"}</td>
        <td class="td-link">${linkHtml}</td>
      </tr>`;
    }).join("");
    drawPagination(totalPages);
    const info = el("jobPagination");
    if (info) {
      const existing = info.querySelector(".pagination-info");
      if (existing) existing.textContent = `Menampilkan ${start + 1} - ${Math.min(start + pageSize, total)} dari ${total} jobs`;
    }
  }
  function drawPagination(totalPages) {
    const container = el("jobPagination");
    if (!container) return;
    const p = _jobsPage;
    let html = `<div class="pagination-info">Menampilkan - dari ${_jobsFiltered.length} jobs</div><div class="pagination-controls">`;
    html += `<button class="page-btn page-arrow" onclick="_goPage(${p - 1})" ${p <= 1 ? "disabled" : ""}>&lsaquo;</button>`;
    const range = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) range.push(i);
    } else {
      range.push(1);
      if (p > 3) range.push("...");
      for (let i = Math.max(2, p - 1); i <= Math.min(totalPages - 1, p + 1); i++) range.push(i);
      if (p < totalPages - 2) range.push("...");
      range.push(totalPages);
    }
    range.forEach((r) => {
      if (r === "...") {
        html += `<span style="padding:0 4px;color:var(--muted)">...</span>`;
      } else {
        html += `<button class="page-btn ${r === p ? "active" : ""}" onclick="_goPage(${r})">${r}</button>`;
      }
    });
    html += `<button class="page-btn page-arrow" onclick="_goPage(${p + 1})" ${p >= totalPages ? "disabled" : ""}>&rsaquo;</button>`;
    html += `</div>`;
    container.innerHTML = html;
  }
  window._goPage = function (page) {
    const totalPages = Math.ceil(_jobsFiltered.length / _jobsPageSize);
    if (page < 1 || page > totalPages) return;
    _jobsPage = page;
    drawJobTable();
    const card = el("jobTableCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  function filterJobs(query) {
    const q = query.toLowerCase().trim();
    let base = _jobsAll;
    if (_remoteFilter === "remote") base = _jobsAll.filter((j) => (j.is_remote || "").toLowerCase() === "true");
    else if (_remoteFilter === "onsite") base = _jobsAll.filter((j) => (j.is_remote || "").toLowerCase() === "false");
    if (!q) {
      _jobsFiltered = [...base];
    } else {
      _jobsFiltered = base.filter((j) =>
        (j.job_title || "").toLowerCase().includes(q) ||
        (j.company_name || "").toLowerCase().includes(q) ||
        (j.job_category || "").toLowerCase().includes(q) ||
        (j.location || "").toLowerCase().includes(q)
      );
    }
    if (_jobsSortCol) sortJobs(_jobsSortCol, false);
    _jobsPage = 1;
    drawJobTable();
  }
  function sortJobs(col, toggleDir) {
    if (_jobsSortCol === col && toggleDir) {
      _jobsSortDir *= -1;
    } else if (toggleDir) {
      _jobsSortCol = col;
      _jobsSortDir = 1;
    }
    _jobsFiltered.sort((a, b) => {
      const va = String(a[col] || "").toLowerCase();
      const vb = String(b[col] || "").toLowerCase();
      return va < vb ? -_jobsSortDir : va > vb ? _jobsSortDir : 0;
    });
    _jobsPage = 1;
    drawJobTable();
    document.querySelectorAll(".th-sortable").forEach((th) => {
      th.classList.remove("asc", "desc");
      if (th.dataset.col === _jobsSortCol) th.classList.add(_jobsSortDir === 1 ? "asc" : "desc");
    });
  }
  function onScanDone(result) {
    _activeScan = false;
    const startBtn = el("btnStartScan");
    if (startBtn) startBtn.disabled = false;
    setSpinner(false);
    const titleEl = el("progressTitle");
    if (titleEl) titleEl.textContent = "Scan Complete";
    _scanResult = result;
    try { localStorage.setItem(LS_SCAN_KEY, JSON.stringify(result)); } catch (e) {}
    applyLiveScan(result);
    const resultsCard = el("scanResultsCard");
    if (resultsCard) resultsCard.style.display = "block";
    renderKpis(result.kpis, "scanKpiRow");
    if (result.skills && result.skills.length) {
      const top = result.skills.slice(0, 15);
      const maxX = Math.max(...top.map((r) => r.frequency || 0));
      renderChart("chart-scan-skills", [{
        y: top.map((r) => r.skill || ""), x: top.map((r) => r.frequency || 0),
        type: "bar", orientation: "h",
        marker: { color: top.map((r) => r.frequency || 0), colorscale: [[0, COLORS.cyan + "88"], [1, COLORS.blue]], showscale: false },
        text: top.map((r) => String(r.frequency || 0)),
        textposition: "outside",
        textfont: { size: 10 },
        hovertemplate: "<b>%{y}</b><br>%{x} mentions<extra></extra>",
        cliponaxis: false,
      }], {
        xaxis: { title: { text: "Mentions" }, range: [0, maxX * 1.25], automargin: true },
        yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
        margin: { t: 14, r: 45, b: 55, l: 24 },
        bargap: 0.3,
      });
    }
    if (result.categories && result.categories.length) {
      renderChart("chart-scan-cats", [{
        labels: result.categories.map((r) => r.job_category),
        values: result.categories.map((r) => r.count),
        type: "pie", hole: 0.46,
        marker: { colors: PALETTE },
        textinfo: "percent",
        textfont: { size: 10 },
        hovertemplate: "<b>%{label}</b><br>%{value} jobs<extra></extra>",
      }], {
        showlegend: true,
        legend: { orientation: "v", x: 1.02, y: 0.5, xanchor: "left", font: { size: 9 }, bgcolor: "rgba(0,0,0,0)" },
        margin: { t: 16, r: 110, b: 16, l: 16 },
      });
    }
    if (result.companies && result.companies.length) {
      const top = result.companies.slice(0, 15);
      const maxX = Math.max(...top.map((r) => r.job_count || 0));
      renderChart("chart-scan-companies", [{
        y: top.map((r) => r.company_name), x: top.map((r) => r.job_count),
        type: "bar", orientation: "h",
        marker: { color: COLORS.purple },
        text: top.map((r) => String(r.job_count)),
        textposition: "outside",
        textfont: { size: 10 },
        hovertemplate: "<b>%{y}</b><br>%{x} postings<extra></extra>",
        cliponaxis: false,
      }], {
        xaxis: { title: { text: "Postings" }, range: [0, maxX * 1.25], automargin: true },
        yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
        margin: { t: 14, r: 45, b: 55, l: 24 },
        bargap: 0.35,
      });
    }
    if (result.trend && result.trend.length) {
      renderChart("chart-scan-trend", [{
        x: result.trend.map((r) => r.year_month || ""),
        y: result.trend.map((r) => r.posting_count || 0),
        type: "bar",
        marker: { color: COLORS.green },
        hovertemplate: "<b>%{x}</b><br>%{y} postings<extra></extra>",
      }], {
        xaxis: { tickangle: -30, automargin: true, tickfont: { size: 10 } },
        yaxis: { title: { text: "Postings" }, automargin: true },
        margin: { t: 16, r: 16, b: 80, l: 50 },
        bargap: 0.3,
      });
    }
    renderScanExtras(result);
    renderJobTable(result.jobs_list || []);
    checkAlertThreshold(result.kpis, result.skills || []);
    if (_mySkills.length) analyzeSkillGap(result.skills || _data && _data.skills || []);
  }
  function pollScan(scanId) {
    if (_pollTimer) clearInterval(_pollTimer);
    let lastMsg = "";
    _pollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/scan/status/" + scanId);
        const data = await res.json();
        setProgress(data.progress || 0, data.message || "");
        if (data.message && data.message !== lastMsg) {
          addLog(data.message, data.status === "error" ? "error" : "info");
          lastMsg = data.message;
        }
        if (data.status === "done") {
          clearInterval(_pollTimer); _pollTimer = null;
          addLog("Scan complete. Dashboard updated.", "success");
          onScanDone(data.result);
        } else if (data.status === "error") {
          clearInterval(_pollTimer); _pollTimer = null;
          setSpinner(false);
          const errBox = el("scanErrorBox");
          if (errBox) { errBox.textContent = "Error: " + data.error; errBox.style.display = "block"; }
          const startBtn = el("btnStartScan");
          if (startBtn) startBtn.disabled = false;
          _activeScan = false;
        }
      } catch (e) {
        clearInterval(_pollTimer); _pollTimer = null;
        setSpinner(false);
        addLog("Connection error: " + e.message, "error");
        const startBtn = el("btnStartScan");
        if (startBtn) startBtn.disabled = false;
        _activeScan = false;
      }
    }, 1500);
  }
  function startScan() {
    const keyword = (el("scanKeyword").value || "").trim();
    const location = (el("scanLocation").value || "Indonesia").trim();
    const limit = el("scanLimit").value || 100;
    const useKeybert = el("skillMethodSelect").value === "keybert";
    if (!keyword) {
      const inp = el("scanKeyword");
      inp.focus();
      inp.style.borderColor = "var(--danger)";
      setTimeout(() => { inp.style.borderColor = ""; }, 2000);
      return;
    }
    _activeScan = true;
    el("btnStartScan").disabled = true;
    if (el("scanProgressCard")) el("scanProgressCard").style.display = "block";
    if (el("scanResultsCard")) el("scanResultsCard").style.display = "none";
    if (el("scanErrorBox")) el("scanErrorBox").style.display = "none";
    if (el("jobTableCard")) el("jobTableCard").style.display = "none";
    el("scanLog").innerHTML = "";
    setProgress(0, "Connecting to LinkedIn...");
    el("progressTitle").textContent = "Scanning...";
    setSpinner(true);
    addLog(`Starting: "${keyword}" in ${location} (${limit} results${useKeybert ? " + KeyBERT" : ""})`, "info");
    fetch("/api/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, location, limit, use_keybert: useKeybert }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          addLog("Error: " + d.error, "error");
          el("btnStartScan").disabled = false; _activeScan = false; setSpinner(false);
          return;
        }
        _scanId = d.scan_id;
        addLog("Scan ID: " + d.scan_id, "info");
        pollScan(d.scan_id);
      })
      .catch((e) => {
        addLog("Failed to start: " + e.message, "error");
        el("btnStartScan").disabled = false; _activeScan = false; setSpinner(false);
      });
  }
  function resetToDefault() {
    _scanResult = null; _scanId = null;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    try { localStorage.removeItem(LS_SCAN_KEY); } catch (e) {}
    if (el("topbarScanBadge")) el("topbarScanBadge").style.display = "none";
    if (el("btnResetScan")) el("btnResetScan").style.display = "none";
    if (_data) renderAllCharts(_data);
  }
  function loadSavedScan() {
    try {
      const raw = localStorage.getItem(LS_SCAN_KEY);
      if (!raw) return;
      const result = JSON.parse(raw);
      if (!result || !result.kpis) return;
      _scanResult = result;
      applyLiveScan(result);
      if (el("scanResultsCard")) {
        el("scanResultsCard").style.display = "block";
        renderKpis(result.kpis, "scanKpiRow");
        if (result.jobs_list) renderJobTable(result.jobs_list);
        renderScanCharts(result);
        renderScanExtras(result);
      }
    } catch (e) {}
  }
  function loadCapabilities() {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((d) => {
        const select = el("skillMethodSelect");
        if (select && d.keybert === false) {
          const kbOpt = select.querySelector('option[value="keybert"]');
          if (kbOpt) kbOpt.textContent = "KeyBERT - AI powered (not installed)";
        }
      })
      .catch(() => {});
  }
  function initTypingAnimation() {
    const target = el("typingText");
    if (!target) return;
    let phraseIdx = 0;
    let charIdx = 0;
    let isDeleting = false;
    let pauseTimer = null;
    function type() {
      const phrase = TYPING_PHRASES[phraseIdx];
      if (!isDeleting) {
        target.textContent = phrase.slice(0, charIdx + 1);
        charIdx++;
        if (charIdx === phrase.length) {
          isDeleting = false;
          pauseTimer = setTimeout(() => { isDeleting = true; tick(); }, 2200);
          return;
        }
      } else {
        target.textContent = phrase.slice(0, charIdx - 1);
        charIdx--;
        if (charIdx === 0) {
          isDeleting = false;
          phraseIdx = (phraseIdx + 1) % TYPING_PHRASES.length;
          pauseTimer = setTimeout(tick, 400);
          return;
        }
      }
      tick();
    }
    function tick() { pauseTimer = setTimeout(type, isDeleting ? 30 : 52); }
    tick();
  }
  function initParticles() {
    const canvas = el("particleCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    const particles = Array.from({ length: 42 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.6 + 0.5,
      dx: (Math.random() - 0.5) * 0.28,
      dy: (Math.random() - 0.5) * 0.28,
      o: Math.random() * 0.38 + 0.08,
    }));
    function getColor() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "rgba(6,182,212," : "rgba(10,102,194,";
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const col = getColor();
      particles.forEach((p) => {
        p.x = (p.x + p.dx + W) % W;
        p.y = (p.y + p.dy + H) % H;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = col + p.o + ")";
        ctx.fill();
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = dx * dx + dy * dy;
          if (dist < 14400) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = col + (0.07 * (1 - Math.sqrt(dist) / 120)) + ")";
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
    window.addEventListener("resize", () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    });
  }
  let _easterClicks = 0;
  let _easterTimer = null;
  const KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  let _konamiIdx = 0;
  function triggerEasterEgg() {
    const brand = el("brandIcon");
    if (brand) { brand.classList.remove("easter-active"); brand.offsetHeight; brand.classList.add("easter-active"); setTimeout(() => brand.classList.remove("easter-active"), 800); }
    const toast = el("easterEggToast");
    if (toast) {
      toast.classList.remove("hide", "show"); toast.offsetHeight; toast.classList.add("show");
      setTimeout(() => { toast.classList.remove("show"); toast.classList.add("hide"); setTimeout(() => toast.classList.remove("hide"), 400); }, 2800);
    }
  }
  function renderScanExtras(result) {
    const remote = result.remote_stats || {};
    const freshness = result.freshness || {};
    const salary = result.salary_by_category || [];
    const salaryStats = result.salary_stats || {};
    if (remote.remote !== undefined) {
      const rLabels = ["Remote", "Onsite", "Unknown"];
      const rValues = [remote.remote || 0, remote.onsite || 0, remote.unknown || 0];
      renderChart("chart-scan-remote", [{
        labels: rLabels, values: rValues, type: "pie", hole: 0.52,
        marker: { colors: [COLORS.teal, COLORS.blue, COLORS.muted || "#94A3B8"] },
        textinfo: "percent",
        textfont: { size: 11 },
        hovertemplate: "<b>%{label}</b><br>%{value} jobs (%{percent})<extra></extra>",
      }], {
        showlegend: true,
        legend: { orientation: "v", x: 1.02, y: 0.5, xanchor: "left", font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
        margin: { t: 16, r: 100, b: 16, l: 16 },
      });
    }
    if (Object.values(freshness).some((v) => v > 0)) {
      const fColors = [COLORS.red, COLORS.amber, COLORS.green, "#94A3B8", "#CBD5E1"];
      const fLabels = ["Hot (<7d)", "Fresh (7-14d)", "Active (14-30d)", "Aging (>30d)", "Unknown"];
      const fVals = [freshness.hot || 0, freshness.fresh || 0, freshness.active || 0, freshness.aging || 0, freshness.unknown || 0];
      renderChart("chart-scan-freshness", [{
        x: fLabels, y: fVals, type: "bar",
        marker: { color: fColors },
        text: fVals.map(String),
        textposition: "outside",
        textfont: { size: 11 },
        hovertemplate: "<b>%{x}</b><br>%{y} jobs<extra></extra>",
        cliponaxis: false,
      }], {
        xaxis: { tickfont: { size: 10 }, automargin: true },
        yaxis: { title: { text: "Jobs" }, automargin: true },
        bargap: 0.35,
        margin: { t: 16, r: 20, b: 60, l: 50 },
      });
    }
    const salaryCard = el("salaryChartCard");
    if (salary.length >= 1 && salaryCard) {
      salaryCard.style.display = "block";
      _salaryData = salary;
      const cur = salaryStats.currency || "USD";
      const avg = salaryStats.avg ? Math.round(salaryStats.avg).toLocaleString() : "";
      const salaryMeta = el("salaryMeta");
      if (salaryMeta) salaryMeta.textContent = `Avg ${cur} ${avg} | ${salaryStats.pct_disclosed || 0}% jobs disclosed`;
      const sorted = [...salary].sort((a, b) => b.avg_salary - a.avg_salary);
      const maxSal = Math.max(...sorted.map((r) => r.avg_salary));
      renderChart("chart-scan-salary", [{
        y: sorted.map((r) => r.job_category),
        x: sorted.map((r) => r.avg_salary),
        type: "bar", orientation: "h",
        marker: { color: sorted.map((r) => r.avg_salary), colorscale: [[0, COLORS.cyan + "88"], [1, COLORS.purple]], showscale: false },
        text: sorted.map((r) => cur + " " + Math.round(r.avg_salary).toLocaleString()),
        textposition: "outside",
        textfont: { size: 10 },
        hovertemplate: "<b>%{y}</b><br>Avg: %{text}<br>%{x} sample<extra></extra>",
        cliponaxis: false,
      }], {
        xaxis: { title: { text: `Avg Salary (${cur})` }, range: [0, maxSal * 1.25], automargin: true },
        yaxis: { autorange: "reversed", tickfont: { size: 10 }, automargin: true },
        margin: { t: 10, r: 100, b: 50, l: 24 },
        bargap: 0.3,
      });
    }
  }
  function showNotification(msg, type, duration) {
    const container = el("notifStack");
    if (!container) return;
    const id = "notif_" + Date.now();
    const colorMap = { success: "#10B981", warning: "#F59E0B", danger: "#EF4444", info: "#0A66C2" };
    const color = colorMap[type] || colorMap.info;
    const iconMap = {
      success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      danger: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    };
    const icon = iconMap[type] || iconMap.info;
    const div = document.createElement("div");
    div.id = id;
    div.className = "notif-item";
    div.style.setProperty("--notif-color", color);
    div.innerHTML = `<span class="notif-icon">${icon}</span><span class="notif-msg">${msg}</span><button class="notif-close" onclick="(function(e){e.currentTarget.closest('.notif-item').remove()})(event)">x</button>`;
    container.appendChild(div);
    const dur = duration || 5000;
    setTimeout(() => {
      const d = document.getElementById(id);
      if (d) { d.classList.add("notif-exit"); setTimeout(() => d.remove(), 350); }
    }, dur);
  }
  function checkAlertThreshold(kpis, skills) {
    const condition = (el("alertCondition") || {}).value || "";
    const rawVal = (el("alertValue") || {}).value || "";
    if (!condition || !rawVal) return;
    const totalJobs = kpis.total_jobs || 0;
    if (condition === "gt" && totalJobs > parseInt(rawVal)) {
      showNotification(`Alert: ${totalJobs} jobs ditemukan, melebihi threshold ${rawVal}`, "success", 8000);
    } else if (condition === "lt" && totalJobs < parseInt(rawVal)) {
      showNotification(`Alert: Hanya ${totalJobs} jobs ditemukan, di bawah threshold ${rawVal}`, "warning", 8000);
    } else if (condition === "skill") {
      const q = rawVal.toLowerCase().trim();
      const top10 = skills.slice(0, 10);
      const found = top10.find((s) => (s.skill || "").toLowerCase().includes(q));
      if (found) {
        showNotification(`Alert: Skill "${found.skill}" is in the Top 10 scan results (${found.frequency} mentions)`, "success", 8000);
      } else {
        showNotification(`Alert: Skill "${rawVal}" was not found in the Top 10 scan results`, "warning", 8000);
      }
    }
  }
  function exportToCSV(data, filename) {
    if (!data || !data.length) { showNotification("Tidak ada data untuk di-export", "warning"); return; }
    const keys = Object.keys(data[0]);
    const csvRows = [
      keys.join(","),
      ...data.map((row) => keys.map((k) => `"${String(row[k] || "").replace(/"/g, '""')}"`).join(",")),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showNotification(`Exported: ${filename}`, "success", 3500);
  }
  function loadMySkills() {
    try { _mySkills = JSON.parse(localStorage.getItem(LS_SKILLS_KEY) || "[]"); } catch (e) { _mySkills = []; }
    renderMySkills();
  }
  function saveMySkills() { try { localStorage.setItem(LS_SKILLS_KEY, JSON.stringify(_mySkills)); } catch (e) {} }
  function addMySkill(skill) {
    const s = skill.toLowerCase().trim();
    if (!s || _mySkills.includes(s)) return;
    _mySkills.push(s);
    saveMySkills();
    renderMySkills();
  }
  function removeMySkill(skill) {
    _mySkills = _mySkills.filter((s) => s !== skill);
    saveMySkills();
    renderMySkills();
    const gapResult = el("gapResult");
    if (gapResult) gapResult.style.display = "none";
  }
  function renderMySkills() {
    const container = el("mySkillsChips");
    const countEl = el("skillGapCount");
    const actions = el("gapActions");
    if (countEl) countEl.textContent = _mySkills.length + " skill" + (_mySkills.length !== 1 ? "s" : "") + " added";
    if (actions) actions.style.display = _mySkills.length ? "flex" : "none";
    if (!container) return;
    container.innerHTML = _mySkills.map((s) => `
      <span class="skill-chip neutral">
        ${s}
        <button class="chip-remove" onclick="_removeSkill('${s.replace(/'/g, "\\'")}')">x</button>
      </span>`).join("");
  }
  window._removeSkill = function (skill) { removeMySkill(skill); };
  function analyzeSkillGap(marketSkills) {
    if (!_mySkills.length || !marketSkills.length) return;
    const gapResult = el("gapResult");
    if (!gapResult) return;
    const top20 = marketSkills.slice(0, 20);
    const maxFreq = Math.max(...top20.map((s) => s.frequency || 1));
    const owned = [];
    const missing = [];
    top20.forEach((ms) => {
      const sk = (ms.skill || "").toLowerCase();
      if (_mySkills.some((my) => sk.includes(my) || my.includes(sk))) {
        owned.push(ms);
      } else {
        missing.push(ms);
      }
    });
    const pct = Math.round((owned.length / top20.length) * 100);
    const container = el("mySkillsChips");
    if (container) {
      container.innerHTML = top20.map((ms) => {
        const sk = (ms.skill || "").toLowerCase();
        const isOwned = _mySkills.some((my) => sk.includes(my) || my.includes(sk));
        return `<span class="skill-chip ${isOwned ? "owned" : "gap"}">${ms.skill}${isOwned ? " <span style='opacity:.6;font-size:10px'>x</span>" : " <span style='font-size:9px;opacity:.7'>needed</span>"}</span>`;
      }).join("");
    }
    gapResult.style.display = "block";
    gapResult.innerHTML = `
      <div class="gap-result-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        Skill Match: ${owned.length}/${top20.length} of top skills
      </div>
      <div class="gap-score-bar">
        <div class="gap-score-label"><span>Coverage Score</span><span>${pct}%</span></div>
        <div class="gap-score-track"><div class="gap-score-fill" style="width:${pct}%"></div></div>
      </div>
      ${
        missing.length
          ? `<div class="gap-missing-title">Top skills you need to learn</div>
             <div class="gap-missing-list">
               ${missing.slice(0, 8).map((ms, i) => {
                 const barW = Math.round((ms.frequency || 1) / maxFreq * 100);
                 return `<div class="gap-miss-item">
                   <div class="gap-miss-rank">${i + 1}</div>
                   <div style="flex:1">
                     <div style="display:flex;justify-content:space-between;align-items:center">
                       <span class="gap-miss-name">${ms.skill}</span>
                       <span class="gap-miss-freq">${ms.frequency} jobs</span>
                     </div>
                     <div class="gap-miss-bar"><div class="gap-miss-fill" style="width:${barW}%"></div></div>
                   </div>
                 </div>`;
               }).join("")}
             </div>`
          : `<div style="color:var(--success);font-size:12px;font-weight:600">Excellent! You already have all the top skills required by the market.</div>`
      }
    `;
    showNotification(`Skill Gap Analysis completed. Coverage: ${pct}%`, pct >= 70 ? "success" : pct >= 40 ? "warning" : "danger", 5000);
  }
  function initEventListeners() {
    el("themeToggle").addEventListener("click", () => applyTheme(_theme === "light" ? "dark" : "light", true));
    el("sidebarToggle").addEventListener("click", () => el("sidebar").classList.toggle("collapsed"));
    el("brandIcon").addEventListener("click", () => {
      el("sidebar").classList.toggle("collapsed");
      _easterClicks++;
      clearTimeout(_easterTimer);
      _easterTimer = setTimeout(() => { _easterClicks = 0; }, 1200);
      if (_easterClicks >= 5) { _easterClicks = 0; triggerEasterEgg(); }
    });
    el("mobileMenuBtn").addEventListener("click", () => el("sidebar").classList.toggle("mobile-open"));
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", (e) => { e.preventDefault(); navigate(item.dataset.section); });
    });
    el("btnStartScan").addEventListener("click", startScan);
    el("btnResetScan").addEventListener("click", resetToDefault);
    el("scanKeyword").addEventListener("keydown", (e) => { if (e.key === "Enter") startScan(); });
    const skillSelect = el("skillMethodSelect");
    const kbHint = el("keyBertHint");
    if (skillSelect && kbHint) {
      skillSelect.addEventListener("change", () => {
        kbHint.style.display = skillSelect.value === "keybert" ? "flex" : "none";
      });
    }
    const jobSearch = el("jobSearch");
    if (jobSearch) {
      let searchTimer = null;
      jobSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => filterJobs(jobSearch.value), 280);
      });
    }
    const jobPageSize = el("jobPageSize");
    if (jobPageSize) jobPageSize.addEventListener("change", () => { _jobsPage = 1; drawJobTable(); });
    document.querySelectorAll(".th-sortable").forEach((th) => {
      th.addEventListener("click", () => sortJobs(th.dataset.col, true));
    });
    const alertToggle = el("alertToggle");
    const alertBody = el("alertBody");
    const alertChevron = alertToggle ? alertToggle.querySelector(".alert-chevron") : null;
    if (alertToggle && alertBody) {
      alertToggle.addEventListener("click", () => {
        const open = alertBody.style.display !== "none";
        alertBody.style.display = open ? "none" : "block";
        if (alertChevron) alertChevron.classList.toggle("open", !open);
      });
    }
    const alertCond = el("alertCondition");
    const alertBadge = el("alertBadge");
    if (alertCond && alertBadge) {
      alertCond.addEventListener("change", () => {
        const hasAlert = alertCond.value !== "";
        alertBadge.textContent = hasAlert ? "On" : "Off";
        alertBadge.className = hasAlert ? "alert-badge-on" : "alert-badge-off";
      });
    }
    const skillGapToggle = el("skillGapToggle");
    const skillGapBody = el("skillGapBody");
    const gapChevron = el("gapChevron");
    if (skillGapToggle && skillGapBody) {
      skillGapToggle.addEventListener("click", () => {
        const open = skillGapBody.style.display !== "none";
        skillGapBody.style.display = open ? "none" : "block";
        if (gapChevron) gapChevron.classList.toggle("open", !open);
      });
    }
    const skillGapInput = el("skillGapInput");
    const btnAddSkill = el("btnAddSkill");
    if (skillGapInput && btnAddSkill) {
      skillGapInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addMySkill(skillGapInput.value); skillGapInput.value = ""; }
      });
      btnAddSkill.addEventListener("click", () => { addMySkill(skillGapInput.value); skillGapInput.value = ""; });
    }
    const btnAnalyzeGap = el("btnAnalyzeGap");
    if (btnAnalyzeGap) {
      btnAnalyzeGap.addEventListener("click", () => {
        const marketSkills = (_scanResult && _scanResult.skills) || (_data && _data.skills) || [];
        analyzeSkillGap(marketSkills);
      });
    }
    const btnClearSkills = el("btnClearSkills");
    if (btnClearSkills) {
      btnClearSkills.addEventListener("click", () => {
        _mySkills = []; saveMySkills(); renderMySkills();
        const gapResult = el("gapResult"); if (gapResult) gapResult.style.display = "none";
      });
    }
    const btnExportJobs = el("btnExportJobs");
    if (btnExportJobs) {
      btnExportJobs.addEventListener("click", () => {
        const ts = new Date().toISOString().slice(0, 10);
        exportToCSV(_jobsFiltered, `jobs_${ts}.csv`);
      });
    }
    const btnExportSalary = el("btnExportSalary");
    if (btnExportSalary) {
      btnExportSalary.addEventListener("click", () => {
        if (_salaryData && _salaryData.length) exportToCSV(_salaryData, `salary_by_category.csv`);
      });
    }
    document.querySelectorAll(".remote-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".remote-filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        _remoteFilter = btn.dataset.filter;
        _jobsPage = 1;
        filterJobs((el("jobSearch") || {}).value || "");
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.keyCode === KONAMI[_konamiIdx]) { _konamiIdx++; if (_konamiIdx === KONAMI.length) { _konamiIdx = 0; triggerEasterEgg(); } }
      else { _konamiIdx = 0; }
    });
    document.addEventListener("click", (e) => {
      if (window.innerWidth <= 900) {
        const sidebar = el("sidebar");
        const btn = el("mobileMenuBtn");
        if (sidebar.classList.contains("mobile-open") && !sidebar.contains(e.target) && e.target !== btn) sidebar.classList.remove("mobile-open");
      }
    });
    window.addEventListener("resize", () => {
      const active = document.querySelector(".page-section.active");
      if (active) {
        active.querySelectorAll("[id^='chart-']").forEach((div) => {
          if (div && div.data && div.data.length) Plotly.Plots.resize(div);
        });
      }
    });
  }
  async function init() {
    initTheme();
    initEventListeners();
    initTypingAnimation();
    loadCapabilities();
    loadMySkills();
    try {
      const res = await fetch("/api/data");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      _data = data;
      const status = data.data_status || {};
      const noBanner = el("no-data-banner");
      if (!status.has_data) {
        if (noBanner) noBanner.style.display = "flex";
      } else {
        if (noBanner) noBanner.style.display = "none";
        await new Promise((resolve) => {
          if (window.Plotly) { resolve(); return; }
          let waited = 0;
          const t = setInterval(() => { waited += 100; if (window.Plotly || waited > 9000) { clearInterval(t); resolve(); } }, 100);
        });
        document.querySelectorAll(".page-section").forEach(s => s.style.display = 'block');
        renderAllCharts(data);
        loadSavedScan();
        document.querySelectorAll(".page-section").forEach(s => s.style.display = '');
        navigate(localStorage.getItem("kos_active_menu") || "overview");
      }
    } catch (e) {
      console.error("Failed to load data:", e);
      const noBanner = el("no-data-banner");
      if (noBanner) {
        noBanner.style.display = "flex";
        noBanner.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><strong>Failed to load data.</strong> ${e.message}. Pastikan Flask server berjalan dan file data tersedia di <code>data/processed/</code>.</div>`;
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();