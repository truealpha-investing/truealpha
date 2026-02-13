/**
 * creator-insights.js — Renders insight sections on creator profile pages.
 *
 * Sections:
 *   1. Investor Risk Match
 *   2. Creator Style Summary
 *   3. Bullish vs Bearish Breakdown
 *   4. Open Predictions (live from Google Sheets CSV)
 *
 * Usage:
 *   <script src="/js/creator-insights.js"></script>
 *   <script>
 *     CreatorInsights.init({
 *       creatorId: "C01",
 *       name: "Tom Nash",
 *       totalPicks: 49,
 *       accuracy: 51.02,
 *       avgAlpha: 57.32,
 *       shortTermAlpha: -17.56,
 *       longTermAlpha: 335.63,
 *       bestCall: 531.37,
 *       worstCall: -46.50,
 *       bullishAccuracy: 64.71,
 *       bearishAccuracy: 0.00,
 *       bestCallTicker: "PLTR",
 *       worstCallTicker: "ETH",
 *       alphaStdDev: 181.42
 *     });
 *   </script>
 */
window.CreatorInsights = (function () {
  "use strict";

  var PREDICTIONS_CSV =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRKqLL2jTM-NNTXbMQNJgFQEpyX8jnE0jE6z8UCDbP_QGoK2RArS5jHKI7lqBs3gJ7DMOlWq3glr0Vh/pub?gid=890061946&single=true&output=csv";

  var SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1JFZaZ_jC9PR7EKucweHkkO-vdCPXiWSk_6-ey02T2RE/edit?gid=890061946#gid=890061946";

  // ─── CSV parser (reuse from sheet-data.js pattern) ────────────────
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    while (i < len) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          field += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === ",") {
          row.push(field);
          field = "";
          i++;
        } else if (ch === "\r") {
          row.push(field);
          field = "";
          rows.push(row);
          row = [];
          i++;
          if (i < len && text[i] === "\n") i++;
        } else if (ch === "\n") {
          row.push(field);
          field = "";
          rows.push(row);
          row = [];
          i++;
        } else {
          field += ch;
          i++;
        }
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Section 1: Investor Risk Match ────────────────────────────────

  function getRiskLevel(c) {
    var spread = Math.abs(c.bestCall) + Math.abs(c.worstCall);
    if (spread > 300) return { label: "High Risk / High Reward", cls: "risk-high" };
    if (spread >= 100) return { label: "Moderate Risk", cls: "risk-moderate" };
    return { label: "Low Risk / Conservative", cls: "risk-low" };
  }

  function getInvestorType(c) {
    if (c.avgAlpha > 10 && c.accuracy > 45)
      return "Suitable for growth-oriented investors looking for alpha";
    if (c.avgAlpha > 0 && c.accuracy > 45)
      return "Suitable for investors seeking modest market outperformance";
    if (c.avgAlpha > 0 && c.accuracy <= 45)
      return "Mixed results \u2014 occasional big wins offset frequent misses";
    if (c.avgAlpha <= 0 && c.accuracy > 40)
      return "Directionally right often, but picks underperform the index";
    return "Track record suggests following these picks would underperform the S&P 500";
  }

  function getTimeHorizonMatch(c) {
    if (c.longTermAlpha > c.shortTermAlpha && c.longTermAlpha > 0)
      return "Better suited for long-term investors (365D+ holding)";
    if (c.shortTermAlpha > c.longTermAlpha && c.shortTermAlpha > 0)
      return "Better suited for short-term traders";
    if (c.longTermAlpha > 0 && c.shortTermAlpha < 0)
      return "Picks need patience \u2014 short-term pain, long-term gain";
    if (c.longTermAlpha <= 0 && c.shortTermAlpha <= 0)
      return "Historically underperforms across all time horizons";
    return "Performance varies across time horizons";
  }

  function renderRiskMatch(el, c) {
    var risk = getRiskLevel(c);
    var investor = getInvestorType(c);
    var horizon = getTimeHorizonMatch(c);

    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Investor Risk Match</h2>' +
        '<div class="panel-badge">Profile</div>' +
      '</div>' +
      '<div class="risk-match-body">' +
        '<div class="risk-badge ' + risk.cls + '">' + risk.label + '</div>' +
        '<div class="risk-insights">' +
          '<div class="risk-line"><span class="risk-icon">\u{1F3AF}</span> ' + escHtml(investor) + '</div>' +
          '<div class="risk-line"><span class="risk-icon">\u{1F552}</span> ' + escHtml(horizon) + '</div>' +
        '</div>' +
      '</div>';
  }

  // ─── Section 2: Creator Style Summary ──────────────────────────────

  function generateCreatorSummary(c) {
    var s = [];

    // Sentence 1: Volume and selectivity
    if (c.totalPicks > 100)
      s.push(c.name + " is a high-volume caller with " + Math.round(c.totalPicks) + " tracked predictions, suggesting a content-first approach where stock calls are frequent.");
    else if (c.totalPicks > 50)
      s.push(c.name + " makes a moderate number of calls (" + Math.round(c.totalPicks) + " tracked), balancing content output with selectivity.");
    else
      s.push(c.name + " is relatively selective with " + Math.round(c.totalPicks) + " tracked predictions, focusing on fewer, more convicted calls.");

    // Sentence 2: Track record verdict
    if (c.avgAlpha > 20)
      s.push("Their track record is notably strong \u2014 averaging +" + c.avgAlpha.toFixed(1) + "% alpha over the S&P 500, though with significant variance.");
    else if (c.avgAlpha > 0)
      s.push("They marginally outperform the S&P 500 with +" + c.avgAlpha.toFixed(1) + "% average alpha \u2014 a slim but positive edge.");
    else if (c.avgAlpha > -10)
      s.push("Their picks slightly underperform the S&P 500 by " + Math.abs(c.avgAlpha).toFixed(1) + "% on average \u2014 close to index performance.");
    else
      s.push("Their picks materially underperform the S&P 500 by " + Math.abs(c.avgAlpha).toFixed(1) + "% on average, suggesting index funds would have been a better bet.");

    // Sentence 3: Bullish vs bearish insight
    if (c.bullishAccuracy > 50 && c.bearishAccuracy < 20)
      s.push("Stronger on bullish calls (" + c.bullishAccuracy.toFixed(0) + "% accuracy) with limited bearish track record.");
    else if (c.bearishAccuracy > c.bullishAccuracy)
      s.push("Notably more accurate on bearish calls (" + c.bearishAccuracy.toFixed(0) + "%) than bullish ones (" + c.bullishAccuracy.toFixed(0) + "%), suggesting better skill at spotting downside.");
    else
      s.push("Bullish accuracy sits at " + c.bullishAccuracy.toFixed(0) + "% with bearish at " + c.bearishAccuracy.toFixed(0) + "%.");

    return s.join(" ");
  }

  function renderStyleSummary(el, c) {
    var summary = generateCreatorSummary(c);
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Creator Style Summary</h2>' +
        '<div class="panel-badge">Analysis</div>' +
      '</div>' +
      '<div class="style-summary-body">' +
        '<p class="style-summary-text">' + escHtml(summary) + '</p>' +
        '<p class="style-summary-disclaimer">Auto-generated from tracked prediction data \u00B7 Not financial advice</p>' +
      '</div>';
  }

  // ─── Section 3: Bullish vs Bearish Breakdown ───────────────────────

  function getBullBearInsight(c) {
    var bull = c.bullishAccuracy;
    var bear = c.bearishAccuracy;
    if (bull > 40 && bear > 40) return "Balanced accuracy across bull and bear calls";
    if (bull > bear + 20) return "Primarily a bullish caller \u2014 " + bear.toFixed(0) + "% bearish accuracy suggests limited short-selling skill";
    if (bear > bull) return "Unusually strong on bearish calls \u2014 consider following their downside alerts more closely";
    if (bull < 30 && bear < 30) return "Low accuracy on both sides of the trade";
    return "Bullish accuracy at " + bull.toFixed(0) + "%, bearish at " + bear.toFixed(0) + "%";
  }

  function renderBullBear(el, c) {
    var insight = getBullBearInsight(c);
    var bullW = Math.max(2, Math.min(100, c.bullishAccuracy));
    var bearW = Math.max(2, Math.min(100, c.bearishAccuracy));

    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Bullish vs Bearish Breakdown</h2>' +
        '<div class="panel-badge">Directional</div>' +
      '</div>' +
      '<div class="bullbear-body">' +
        '<div class="bullbear-row">' +
          '<div class="bullbear-label">Bullish Accuracy</div>' +
          '<div class="bullbear-bar-wrap">' +
            '<div class="bullbear-track">' +
              '<div class="bullbear-fill green" style="width:' + bullW + '%"></div>' +
            '</div>' +
            '<div class="bullbear-value green">' + c.bullishAccuracy.toFixed(2) + '%</div>' +
          '</div>' +
        '</div>' +
        '<div class="bullbear-row">' +
          '<div class="bullbear-label">Bearish Accuracy</div>' +
          '<div class="bullbear-bar-wrap">' +
            '<div class="bullbear-track">' +
              '<div class="bullbear-fill red" style="width:' + bearW + '%"></div>' +
            '</div>' +
            '<div class="bullbear-value red">' + c.bearishAccuracy.toFixed(2) + '%</div>' +
          '</div>' +
        '</div>' +
        '<div class="bullbear-insight">' + escHtml(insight) + '</div>' +
      '</div>';
  }

  // ─── Section 4: Open Predictions ──────────────────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return "\u2014";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function truncate(s, max) {
    if (!s) return "";
    if (s.length <= max) return s;
    return s.substring(0, max) + "\u2026";
  }

  function renderOpenPredictions(el, predictions) {
    var count = predictions.length;

    var headerHtml =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Open Predictions</h2>' +
        '<div class="panel-badge op-live-badge">LIVE</div>' +
      '</div>';

    if (count === 0) {
      el.innerHTML = headerHtml +
        '<div class="op-empty">No open predictions currently tracked for this creator.</div>';
      return;
    }

    var tableRows = predictions.map(function (p) {
      var dirCls = /bull/i.test(p.direction) ? "green" : "red";
      var dirLabel = /bull/i.test(p.direction) ? "BULL" : "BEAR";
      var confCls = /high/i.test(p.confidence) ? "conf-high" : "conf-med";
      var confLabel = p.confidence || "—";
      var quoteShort = truncate(p.quote, 80);
      var quoteFull = escHtml(p.quote || "");

      return '<tr>' +
        '<td class="op-ticker">' + escHtml(p.ticker || "—") + '</td>' +
        '<td>' + escHtml(p.target || "—") + '</td>' +
        '<td><span class="op-dir-pill ' + dirCls + '">' + dirLabel + '</span></td>' +
        '<td><span class="op-conf ' + confCls + '">' + escHtml(confLabel) + '</span></td>' +
        '<td class="op-price">' + escHtml(p.startPrice || "—") + '</td>' +
        '<td>' + formatDate(p.predDate) + '</td>' +
        '<td>' + formatDate(p.evalDate) + '</td>' +
        '<td class="op-quote" title="' + quoteFull + '">' + escHtml(quoteShort) + '</td>' +
      '</tr>';
    }).join("");

    el.innerHTML = headerHtml +
      '<div class="op-count">Showing ' + count + ' open prediction' + (count !== 1 ? 's' : '') + '</div>' +
      '<div class="op-table-wrap">' +
        '<table class="op-table">' +
          '<thead><tr>' +
            '<th>Ticker</th><th>Target</th><th>Dir</th><th>Conf</th>' +
            '<th>Entry</th><th>Date</th><th>Eval</th><th>Quote</th>' +
          '</tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="op-disclaimer">Open predictions are unscored calls where the evaluation date has not yet passed. Data refreshes from our live dataset.</div>';
  }

  async function fetchOpenPredictions(creatorId) {
    var res = await fetch(PREDICTIONS_CSV, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var csvText = await res.text();
    var rawRows = parseCSV(csvText);
    if (rawRows.length < 2) return [];

    var headers = rawRows[0].map(function (h) { return h.trim().toLowerCase(); });
    console.log("[OpenPredictions] CSV headers:", headers);

    function col(names) {
      if (!Array.isArray(names)) names = [names];
      for (var i = 0; i < names.length; i++) {
        var idx = headers.indexOf(names[i].toLowerCase());
        if (idx !== -1) return idx;
      }
      return -1;
    }

    var COL = {
      creatorId:  col(["creator id", "creator_id"]),
      ticker:     col(["ticker"]),
      target:     col(["target"]),
      direction:  col(["direction"]),
      confidence: col(["confidence"]),
      startPrice: col(["start price", "start_price"]),
      endPrice:   col(["end price", "end_price"]),
      predDate:   col(["prediction date", "prediction_date"]),
      evalDate:   col(["evaluation date", "evaluation_date"]),
      quote:      col(["evidence / quote", "evidence/quote", "evidence", "quote"])
    };

    var open = [];
    for (var r = 1; r < rawRows.length; r++) {
      var row = rawRows[r];
      var rowCreator = COL.creatorId >= 0 ? (row[COL.creatorId] || "").trim() : "";
      if (rowCreator !== creatorId) continue;

      var endPrice = COL.endPrice >= 0 ? (row[COL.endPrice] || "").trim() : "";
      // Open prediction = no end price
      if (endPrice && endPrice !== "$0.00" && endPrice !== "0") continue;

      open.push({
        ticker:     COL.ticker >= 0 ? (row[COL.ticker] || "").trim() : "",
        target:     COL.target >= 0 ? (row[COL.target] || "").trim() : "",
        direction:  COL.direction >= 0 ? (row[COL.direction] || "").trim() : "",
        confidence: COL.confidence >= 0 ? (row[COL.confidence] || "").trim() : "",
        startPrice: COL.startPrice >= 0 ? (row[COL.startPrice] || "").trim() : "",
        predDate:   COL.predDate >= 0 ? (row[COL.predDate] || "").trim() : "",
        evalDate:   COL.evalDate >= 0 ? (row[COL.evalDate] || "").trim() : "",
        quote:      COL.quote >= 0 ? (row[COL.quote] || "").trim() : ""
      });
    }

    // Sort by prediction date descending
    open.sort(function (a, b) {
      var da = new Date(a.predDate);
      var db = new Date(b.predDate);
      if (isNaN(da.getTime())) return 1;
      if (isNaN(db.getTime())) return -1;
      return db - da;
    });

    return open;
  }

  // ─── Init ─────────────────────────────────────────────────────────

  function init(config) {
    var c = config;

    // Section 1: Risk Match
    var riskEl = document.getElementById("insightRiskMatch");
    if (riskEl) renderRiskMatch(riskEl, c);

    // Section 2: Style Summary
    var styleEl = document.getElementById("insightStyleSummary");
    if (styleEl) renderStyleSummary(styleEl, c);

    // Section 3: Bull/Bear
    var bbEl = document.getElementById("insightBullBear");
    if (bbEl) renderBullBear(bbEl, c);

    // Section 4: Open Predictions
    var opEl = document.getElementById("insightOpenPredictions");
    if (opEl && c.creatorId) {
      opEl.innerHTML =
        '<div class="panel-header">' +
          '<h2 class="panel-title">Open Predictions</h2>' +
          '<div class="panel-badge op-live-badge">LIVE</div>' +
        '</div>' +
        '<div class="op-loading">Loading live predictions\u2026</div>';

      fetchOpenPredictions(c.creatorId).then(function (predictions) {
        renderOpenPredictions(opEl, predictions);
      }).catch(function (err) {
        console.error("[OpenPredictions] Failed to load:", err);
        opEl.innerHTML =
          '<div class="panel-header">' +
            '<h2 class="panel-title">Open Predictions</h2>' +
            '<div class="panel-badge op-live-badge">LIVE</div>' +
          '</div>' +
          '<div class="op-error">' +
            'Unable to load live predictions. ' +
            '<a href="' + SHEET_URL + '" target="_blank" rel="noopener">View the full dataset \u2192</a>' +
          '</div>';
      });
    }

    // Also update from live CSV data if SheetData is available
    if (window.SheetData) {
      SheetData.fetchCreators().then(function (creators) {
        var live = SheetData.getCreatorByName(creators, c.name);
        if (!live) return;

        // Merge live data and re-render the insight sections
        var updated = {
          creatorId: c.creatorId,
          name: c.name,
          totalPicks: Number.isFinite(live.totalPicks) ? live.totalPicks : c.totalPicks,
          accuracy: Number.isFinite(live.accuracy) ? live.accuracy : c.accuracy,
          avgAlpha: Number.isFinite(live.avgAlpha) ? live.avgAlpha : c.avgAlpha,
          shortTermAlpha: Number.isFinite(live.shortTermAlpha) ? live.shortTermAlpha : c.shortTermAlpha,
          longTermAlpha: Number.isFinite(live.longTermAlpha) ? live.longTermAlpha : c.longTermAlpha,
          bestCall: Number.isFinite(live.bestCall) ? live.bestCall : c.bestCall,
          worstCall: Number.isFinite(live.worstCall) ? live.worstCall : c.worstCall,
          bullishAccuracy: Number.isFinite(live.bullishAccuracy) ? live.bullishAccuracy : c.bullishAccuracy,
          bearishAccuracy: Number.isFinite(live.bearishAccuracy) ? live.bearishAccuracy : c.bearishAccuracy,
          alphaStdDev: c.alphaStdDev
        };

        if (riskEl) renderRiskMatch(riskEl, updated);
        if (styleEl) renderStyleSummary(styleEl, updated);
        if (bbEl) renderBullBear(bbEl, updated);
      }).catch(function () {
        // Keep static-data rendering, already done above
      });
    }
  }

  return { init: init };
})();
