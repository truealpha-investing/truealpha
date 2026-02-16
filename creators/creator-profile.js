/**
 * creator-profile.js — Shared rendering module for individual creator profile pages.
 *
 * Reads window.CREATOR_DATA, renders all profile sections, fetches live data
 * from SheetData, and initializes CreatorInsights for insight sections.
 *
 * Usage (in each individual page):
 *   <script>window.CREATOR_DATA = { creatorId: "C01", name: "Tom Nash", slug: "tom-nash", totalPicks: 49, accuracy: 51.02 };</script>
 *   <script src="/js/sheet-data.js"></script>
 *   <script src="/js/creator-insights.js"></script>
 *   <script src="/creators/creator-profile.js"></script>
 */
window.CreatorProfile = (function () {
  "use strict";

  // ─── Formatting helpers ───────────────────────────────────────

  function fmtPct(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }

  function fmtRate(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toFixed(2) + "%";
  }

  function alphaClass(n) {
    if (!Number.isFinite(n)) return "neutral";
    return n >= 0 ? "green" : "red";
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Section renderers ────────────────────────────────────────

  function renderVerdict(c) {
    var el = document.querySelector(".creator-verdict");
    if (!el) return;
    if (!Number.isFinite(c.avgAlpha)) {
      el.innerHTML = '<span class="neutral">Loading performance data\u2026</span>';
      return;
    }
    var cls = c.avgAlpha >= 0 ? "positive" : "negative";
    var txt = c.avgAlpha >= 0
      ? "Beats the S&P 500 by " + fmtPct(c.avgAlpha) + " on average"
      : "Underperforms the S&P 500 by " + fmtPct(c.avgAlpha);
    el.innerHTML = '<span class="' + cls + '">' + escHtml(txt) + '</span>';
  }

  function renderPills(c) {
    var el = document.querySelector(".creator-pills");
    if (!el) return;
    el.innerHTML =
      '<div class="creator-pill"><span class="label">Total Picks:</span> <span class="value">' +
        (Number.isFinite(c.totalPicks) ? Math.round(c.totalPicks) : "\u2014") + '</span></div>' +
      '<div class="creator-pill"><span class="label">Avg Alpha:</span> <span class="value ' +
        alphaClass(c.avgAlpha) + '">' + fmtPct(c.avgAlpha) + '</span></div>' +
      '<div class="creator-pill"><span class="label">Accuracy:</span> <span class="value">' +
        fmtRate(c.accuracy) + '</span></div>' +
      '<div class="creator-pill"><span class="label">Last Updated:</span> <span class="value">Jan 2026</span></div>';
  }

  function statCard(label, value, cls) {
    return '<div class="stat-card"><div class="stat-label">' + label +
      '</div><div class="stat-value ' + cls + '">' + value + '</div></div>';
  }

  function renderPerfOverview(c) {
    var el = document.getElementById("perfOverview");
    if (!el) return;
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Performance Overview</h2>' +
        '<div class="panel-badge">Stats</div>' +
      '</div>' +
      '<div class="stats-grid">' +
        statCard("Total Picks", Number.isFinite(c.totalPicks) ? Math.round(c.totalPicks) : "\u2014", "neutral") +
        statCard("Overall Accuracy", fmtRate(c.accuracy), "neutral") +
        statCard("Avg Alpha vs S&amp;P 500", fmtPct(c.avgAlpha), alphaClass(c.avgAlpha)) +
        statCard("Short Term Accuracy", fmtRate(c.shortTermAccuracy), "neutral") +
        statCard("Long Term Accuracy", fmtRate(c.longTermAccuracy), "neutral") +
        statCard("Bullish Accuracy", fmtRate(c.bullishAccuracy), "neutral") +
        statCard("Bearish Accuracy", fmtRate(c.bearishAccuracy), "neutral") +
      '</div>';
  }

  function renderTimeHorizon(c) {
    var el = document.getElementById("timeHorizon");
    if (!el) return;
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Alpha by Time Horizon</h2>' +
        '<div class="panel-badge">90 / 180 / 365</div>' +
      '</div>' +
      '<div class="inner-grid-3">' +
        '<div class="inner-panel"><div class="inner-panel-label">Short Term (90D)</div>' +
          '<div class="inner-panel-value ' + alphaClass(c.shortTermAlpha) + '">' + fmtPct(c.shortTermAlpha) + '</div></div>' +
        '<div class="inner-panel"><div class="inner-panel-label">Average (180D)</div>' +
          '<div class="inner-panel-value ' + alphaClass(c.avgAlpha) + '">' + fmtPct(c.avgAlpha) + '</div></div>' +
        '<div class="inner-panel"><div class="inner-panel-label">Long Term (365D)</div>' +
          '<div class="inner-panel-value ' + alphaClass(c.longTermAlpha) + '">' + fmtPct(c.longTermAlpha) + '</div></div>' +
      '</div>';
  }

  function renderBestWorstCalls(c) {
    var el = document.getElementById("bestWorstCalls");
    if (!el) return;
    if (!Number.isFinite(c.bestCall) && !Number.isFinite(c.worstCall)) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Best &amp; Worst Calls</h2>' +
        '<div class="panel-badge">Extremes</div>' +
      '</div>' +
      '<div class="calls-grid">' +
        '<div class="call-card">' +
          '<div class="call-label green">BEST CALL</div>' +
          '<div class="call-ticker">' + escHtml(c.bestCallTicker || "\u2014") + '</div>' +
          '<div class="call-return green">' + fmtPct(c.bestCall) + '</div>' +
        '</div>' +
        '<div class="call-card">' +
          '<div class="call-label red">WORST CALL</div>' +
          '<div class="call-ticker">' + escHtml(c.worstCallTicker || "\u2014") + '</div>' +
          '<div class="call-return red">' + fmtPct(c.worstCall) + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderRecAssets(c) {
    var el = document.getElementById("recAssets");
    if (!el) return;
    if (!c.recommendedAssets) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    var assets = c.recommendedAssets.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    if (!assets.length) { el.style.display = "none"; return; }
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Frequently Recommended Assets</h2>' +
        '<div class="panel-badge">Assets</div>' +
      '</div>' +
      '<div class="asset-pills">' +
        assets.map(function (t) { return '<span class="asset-pill">' + escHtml(t) + '</span>'; }).join("") +
      '</div>';
  }

  // ─── Email signup tracking ────────────────────────────────────

  function setupEmailTracking(slug) {
    var form = document.querySelector('form[action*="app.kit.com/forms/8848906"]');
    if (form) {
      form.addEventListener("submit", function () {
        window.dataLayer = window.dataLayer || [];
        dataLayer.push({
          event: "email_signup",
          signup_location: "creator_" + slug
        });
      });
    }
  }

  // ─── Main init ────────────────────────────────────────────────

  function init() {
    var data = window.CREATOR_DATA;
    if (!data) { console.warn("[CreatorProfile] No CREATOR_DATA found"); return; }

    // Render initial loading state
    renderPills(data);
    renderVerdict(data);
    setupEmailTracking(data.slug);

    // Show loading in dynamic sections
    var loadingSections = ["perfOverview", "timeHorizon", "bestWorstCalls", "recAssets"];
    loadingSections.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="profile-loading">Loading live data\u2026</div>';
    });

    // Fetch live data from Google Sheets
    if (!window.SheetData) {
      console.warn("[CreatorProfile] SheetData not available");
      return;
    }

    SheetData.fetchCreators().then(function (creators) {
      var c = SheetData.getCreatorByName(creators, data.name);
      if (!c) { console.warn("[CreatorProfile] Creator not found in CSV:", data.name); return; }
      console.log("[CreatorProfile] Loaded live data for", data.name, c);

      // Merge live data with static fallback
      var merged = {
        creatorId: data.creatorId,
        name: data.name,
        slug: data.slug,
        totalPicks: Number.isFinite(c.totalPicks) ? c.totalPicks : data.totalPicks,
        accuracy: Number.isFinite(c.accuracy) ? c.accuracy : data.accuracy,
        avgAlpha: c.avgAlpha,
        shortTermAlpha: c.shortTermAlpha,
        longTermAlpha: c.longTermAlpha,
        shortTermAccuracy: c.shortTermAccuracy,
        longTermAccuracy: c.longTermAccuracy,
        bestCall: c.bestCall,
        worstCall: c.worstCall,
        bestCallTicker: c.bestCallTicker || "",
        worstCallTicker: c.worstCallTicker || "",
        bullishAccuracy: c.bullishAccuracy,
        bearishAccuracy: c.bearishAccuracy,
        recommendedAssets: c.recommendedAssets || "",
        pValue: c.pValue,
        sig: c.sig
      };

      // Render all sections
      renderVerdict(merged);
      renderPills(merged);
      renderPerfOverview(merged);
      renderTimeHorizon(merged);
      renderBestWorstCalls(merged);
      renderRecAssets(merged);

      // Initialize CreatorInsights for insight sections
      if (window.CreatorInsights) {
        CreatorInsights.init({
          creatorId: data.creatorId,
          name: data.name,
          totalPicks: merged.totalPicks,
          accuracy: merged.accuracy,
          avgAlpha: Number.isFinite(merged.avgAlpha) ? merged.avgAlpha : 0,
          shortTermAlpha: Number.isFinite(merged.shortTermAlpha) ? merged.shortTermAlpha : 0,
          longTermAlpha: Number.isFinite(merged.longTermAlpha) ? merged.longTermAlpha : 0,
          bestCall: Number.isFinite(merged.bestCall) ? merged.bestCall : 0,
          worstCall: Number.isFinite(merged.worstCall) ? merged.worstCall : 0,
          bullishAccuracy: Number.isFinite(merged.bullishAccuracy) ? merged.bullishAccuracy : 0,
          bearishAccuracy: Number.isFinite(merged.bearishAccuracy) ? merged.bearishAccuracy : 0,
          bestCallTicker: merged.bestCallTicker,
          worstCallTicker: merged.worstCallTicker,
          alphaStdDev: 0
        });
      }
    }).catch(function (err) {
      console.warn("[CreatorProfile] CSV fetch failed, showing static data:", err);
      // Render what we can from static data
      renderPerfOverview(data);
      renderVerdict(data);
      renderPills(data);
    });
  }

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init: init };
})();
