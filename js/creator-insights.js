/**
 * creator-insights.js — Renders insight sections on creator profile pages.
 *
 * Sections:
 *   1. Investor Risk Match
 *   2. Creator Style Summary (5-6 sentences)
 *   3. Bullish vs Bearish Breakdown
 *   4. Open Predictions (live from Google Sheets CSV) — enhanced with
 *      summary stats, expandable quotes, days-until countdown
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
 *       alphaStdDev: 181.42,
 *       alpha2023: 12.5,
 *       alpha2024: 45.3,
 *       alpha2025: 80.1,
 *       pValue: 0.032
 *     });
 *   </script>
 */
window.CreatorInsights = (function () {
  "use strict";

  // ─── NOTE: Predictions live in the MVP Data Sheet, NOT the public sheet ───
  var PREDICTIONS_CSV =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRz3NLuwn_AtolxNrjS3ep5p3tldv6kOUHezyF2MPdShk38RXMqhwpAMwvJNQsgTotxf45T5YI6aJUk/pub?gid=890061946&single=true&output=csv";

  var SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1VOSiF48EhsFYupdIHfA48CgEtdE5x9HaQXhr4BskGeU/edit?gid=890061946#gid=890061946";

  // ─── CSV parser ─────────────────────────────────────────────────
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

  // ─── Section 1: Investor Risk Match ──────────────────────────────

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

  // ─── Section 2: Creator Style Summary (Enhanced — 5-6 sentences) ─

  function generateCreatorSummary(c) {
    var s = [];

    // Sentence 1: Volume, selectivity, and what that implies
    if (c.totalPicks > 150) {
      s.push("With " + Math.round(c.totalPicks) + " tracked predictions, " + c.name + " is one of the most prolific callers in our dataset \u2014 making stock picks a core part of their content strategy rather than occasional conviction bets.");
    } else if (c.totalPicks > 80) {
      s.push(c.name + " has accumulated " + Math.round(c.totalPicks) + " tracked predictions, placing them in the upper tier of content creators by volume \u2014 enough data to draw meaningful statistical conclusions about their skill.");
    } else if (c.totalPicks > 50) {
      s.push(c.name + " makes a moderate number of calls (" + Math.round(c.totalPicks) + " tracked), striking a balance between regular content output and selectivity in their stock recommendations.");
    } else {
      s.push(c.name + " is relatively selective with " + Math.round(c.totalPicks) + " tracked predictions, suggesting they reserve stock calls for higher-conviction ideas rather than making picks a content staple.");
    }

    // Sentence 2: Overall track record with context
    if (c.avgAlpha > 30) {
      s.push("Their average alpha of +" + c.avgAlpha.toFixed(1) + "% over the S&P 500 is exceptional \u2014 ranking among the top performers across all 80+ creators we track. However, this level of outperformance often comes with significant variance between individual picks.");
    } else if (c.avgAlpha > 10) {
      s.push("Averaging +" + c.avgAlpha.toFixed(1) + "% alpha over the S&P 500, their track record shows meaningful outperformance \u2014 though investors should note that alpha figures can be heavily influenced by a small number of outsized winners.");
    } else if (c.avgAlpha > 0) {
      s.push("With +" + c.avgAlpha.toFixed(1) + "% average alpha, they marginally outperform the S&P 500 \u2014 a slim but positive edge that puts them ahead of the majority of tracked creators, most of whom trail the index.");
    } else if (c.avgAlpha > -10) {
      s.push("Their picks slightly underperform the S&P 500 by " + Math.abs(c.avgAlpha).toFixed(1) + "% on average. While close to index performance, this means a simple S&P 500 ETF would have delivered better returns than following their recommendations.");
    } else {
      s.push("Their picks materially underperform the S&P 500 by " + Math.abs(c.avgAlpha).toFixed(1) + "% on average \u2014 a significant drag that suggests their stock selection approach has consistently destroyed value relative to passive indexing.");
    }

    // Sentence 3: Consistency and risk (alpha std dev)
    var stdDev = parseFloat(c.alphaStdDev);
    if (!isNaN(stdDev) && stdDev > 0) {
      if (stdDev > 100) {
        s.push("Consistency is a major concern: with an alpha standard deviation of " + stdDev.toFixed(0) + "%, individual pick outcomes are wildly unpredictable. Expect a wide range between their best and worst calls \u2014 this is a high-variance creator.");
      } else if (stdDev > 40) {
        s.push("Their alpha standard deviation of " + stdDev.toFixed(0) + "% indicates moderate-to-high variance in pick quality. Some calls significantly outperform while others significantly lag, making any single recommendation a gamble.");
      } else if (stdDev > 15) {
        s.push("With an alpha standard deviation of " + stdDev.toFixed(0) + "%, their picks show moderate consistency \u2014 there's meaningful variation between winners and losers, but outcomes aren't wildly unpredictable.");
      } else {
        s.push("Their alpha standard deviation of just " + stdDev.toFixed(0) + "% suggests relatively consistent picks \u2014 outcomes don't swing dramatically, which means their average alpha figure is a more reliable indicator of what to expect.");
      }
    }

    // Sentence 4: Year-over-year trend
    var a23 = parseFloat(c.alpha2023);
    var a24 = parseFloat(c.alpha2024);
    var a25 = parseFloat(c.alpha2025);
    var a26 = parseFloat(c.alpha2026);
    var years = [];
    if (!isNaN(a23) && a23 !== 0) years.push({ year: 2023, alpha: a23 });
    if (!isNaN(a24) && a24 !== 0) years.push({ year: 2024, alpha: a24 });
    if (!isNaN(a25) && a25 !== 0) years.push({ year: 2025, alpha: a25 });
    if (!isNaN(a26) && a26 !== 0) years.push({ year: 2026, alpha: a26 });

    if (years.length >= 2) {
      var first = years[0];
      var last = years[years.length - 1];
      var trend = last.alpha - first.alpha;
      var fmtY = function(v) { return (v > 0 ? "+" : "") + v.toFixed(1) + "%"; };

      if (trend > 15) {
        s.push("Their performance trend is encouraging \u2014 alpha improved from " + fmtY(first.alpha) + " in " + first.year + " to " + fmtY(last.alpha) + " in " + last.year + ", suggesting improving stock-picking skill or better market conditions for their style.");
      } else if (trend < -15) {
        s.push("Concerning trend: alpha declined from " + fmtY(first.alpha) + " in " + first.year + " to " + fmtY(last.alpha) + " in " + last.year + ". Their earlier outperformance may have been market-driven rather than skill-based.");
      } else {
        s.push("Year-over-year performance has been relatively stable, ranging from " + fmtY(first.alpha) + " in " + first.year + " to " + fmtY(last.alpha) + " in " + last.year + " \u2014 suggesting their results aren't a fluke of any single market environment.");
      }
    }

    // Sentence 5: Bullish vs bearish skill
    var bullAcc = parseFloat(c.bullishAccuracy);
    var bearAcc = parseFloat(c.bearishAccuracy);

    if (!isNaN(bullAcc) && !isNaN(bearAcc)) {
      if (bullAcc > 55 && bearAcc < 25) {
        s.push("They're primarily a bullish caller \u2014 " + bullAcc.toFixed(0) + "% accuracy on buy recommendations but just " + bearAcc.toFixed(0) + "% on bearish calls. Their value lies in identifying upside, not downside.");
      } else if (bearAcc > bullAcc && bearAcc > 35) {
        s.push("Unusually, they're more accurate on bearish calls (" + bearAcc.toFixed(0) + "%) than bullish ones (" + bullAcc.toFixed(0) + "%). This is rare among YouTube creators and suggests genuine skill at identifying overvalued or risky stocks.");
      } else if (bullAcc > 45 && bearAcc > 35) {
        s.push("Balanced across both sides of the trade: " + bullAcc.toFixed(0) + "% accuracy on bullish calls and " + bearAcc.toFixed(0) + "% on bearish. This dual competence is uncommon \u2014 most creators heavily skew toward one direction.");
      } else if (bullAcc < 35 && bearAcc < 35) {
        s.push("Accuracy is weak on both bullish (" + bullAcc.toFixed(0) + "%) and bearish (" + bearAcc.toFixed(0) + "%) calls, indicating persistent difficulty in predicting stock direction regardless of the trade thesis.");
      } else {
        s.push("Bullish accuracy sits at " + bullAcc.toFixed(0) + "% with bearish at " + bearAcc.toFixed(0) + "%. " + (bullAcc > bearAcc ? "Slightly better at picking winners than identifying losers." : "Slightly better at spotting downside risk."));
      }
    }

    // Sentence 6: Statistical significance disclaimer
    var pVal = parseFloat(c.pValue);
    if (!isNaN(pVal)) {
      if (pVal < 0.05) {
        s.push("Their results are statistically significant (p-value: " + pVal.toFixed(3) + "), meaning the observed alpha is unlikely to be explained by chance alone.");
      } else if (pVal < 0.10) {
        s.push("Their results approach statistical significance (p-value: " + pVal.toFixed(3) + ") \u2014 suggestive but not conclusive evidence of genuine stock-picking skill.");
      } else {
        s.push("Their results are not statistically significant (p-value: " + pVal.toFixed(3) + "), meaning the observed performance could reasonably be attributed to chance rather than skill. A larger sample of predictions would help clarify.");
      }
    }

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

  // ─── Section 3: Bullish vs Bearish Breakdown ─────────────────────

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

  // ─── Section 4: Open Predictions (Enhanced) ──────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return "\u2014";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function daysUntil(dateStr) {
    if (!dateStr) return "\u2014";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return "\u2014";
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    var diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diff < 0) return "Overdue";
    if (diff === 0) return "Today";
    return diff + " day" + (diff !== 1 ? "s" : "");
  }

  function daysUntilClass(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    var diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diff < 0) return "op-overdue";
    if (diff <= 30) return "op-soon";
    return "";
  }

  // Global toggle function for expandable quote rows
  window.toggleQuote = function (rowEl) {
    var quoteRow = rowEl.nextElementSibling;
    if (!quoteRow || !quoteRow.classList.contains("op-quote-row")) return;
    var isHidden = quoteRow.classList.contains("op-hidden");
    quoteRow.classList.toggle("op-hidden");
    var icon = rowEl.querySelector(".op-expand-icon");
    if (icon) icon.textContent = isHidden ? "\u25BC" : "\u25B6";
  };

  function renderOpenPredictions(el, predictions, creatorName) {
    var count = predictions.length;

    var headerHtml =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Open Predictions</h2>' +
        '<div class="panel-badge op-live-badge">LIVE</div>' +
      '</div>';

    // Empty state
    if (count === 0) {
      el.innerHTML = headerHtml +
        '<div class="op-empty-state">' +
          '<p class="op-empty-title">No open predictions currently tracked</p>' +
          '<p class="op-empty-detail">' +
            'This means all of ' + escHtml(creatorName) + '\u2019s tracked predictions have been scored. ' +
            'New predictions are added as they appear in their YouTube content. ' +
            'Check back after their next video drops.' +
          '</p>' +
          '<a href="/methodology.html" class="op-empty-link">Learn how we track predictions \u2192</a>' +
        '</div>';
      return;
    }

    // Summary stats
    var bullishCount = 0;
    var highConvCount = 0;
    for (var i = 0; i < predictions.length; i++) {
      if (/bull/i.test(predictions[i].direction)) bullishCount++;
      if (/high/i.test(predictions[i].confidence)) highConvCount++;
    }
    var bearishCount = count - bullishCount;

    var summaryHtml =
      '<div class="op-summary">' +
        '<div class="op-summary-stat">' +
          '<span class="op-summary-value">' + count + '</span>' +
          '<span class="op-summary-label">Open Calls</span>' +
        '</div>' +
        '<div class="op-summary-stat">' +
          '<span class="op-summary-value op-bull">' + bullishCount + ' Bullish</span>' +
          '<span class="op-summary-divider">/</span>' +
          '<span class="op-summary-value op-bear">' + bearishCount + ' Bearish</span>' +
        '</div>' +
        (highConvCount > 0
          ? '<div class="op-summary-stat">' +
              '<span class="op-summary-value op-high-conv">\u{1F525} ' + highConvCount + ' High Conviction</span>' +
            '</div>'
          : '') +
      '</div>';

    // Table rows with expandable quotes
    var tableRows = "";
    for (var j = 0; j < predictions.length; j++) {
      var p = predictions[j];
      var dirCls = /bull/i.test(p.direction) ? "green" : "red";
      var dirLabel = /bull/i.test(p.direction) ? "BULLISH" : "BEARISH";
      var confCls = /high/i.test(p.confidence) ? "conf-high" : "conf-med";
      var confLabel = /high/i.test(p.confidence) ? "\u{1F525} High" : (p.confidence || "\u2014");
      var duCls = daysUntilClass(p.evalDate);
      var duText = daysUntil(p.evalDate);
      var hasQuote = p.quote && p.quote.trim().length > 0;

      tableRows +=
        '<tr class="op-data-row' + (hasQuote ? ' op-clickable' : '') + '"' +
          (hasQuote ? ' onclick="toggleQuote(this)"' : '') + '>' +
          '<td class="op-ticker">' + escHtml(p.ticker || "\u2014") + '</td>' +
          '<td>' + escHtml(p.target || "\u2014") + '</td>' +
          '<td><span class="op-dir-pill ' + dirCls + '">' + dirLabel + '</span></td>' +
          '<td><span class="op-conf ' + confCls + '">' + escHtml(confLabel) + '</span></td>' +
          '<td class="op-price">' + escHtml(p.startPrice || "\u2014") + '</td>' +
          '<td>' + formatDate(p.predDate) + '</td>' +
          '<td>' + formatDate(p.evalDate) + '</td>' +
          '<td class="op-days-until ' + duCls + '">' + duText + '</td>' +
          (hasQuote ? '<td class="op-expand-cell"><span class="op-expand-icon">\u25B6</span></td>' : '<td></td>') +
        '</tr>';

      // Quote expansion row
      if (hasQuote) {
        tableRows +=
          '<tr class="op-quote-row op-hidden">' +
            '<td colspan="9">' +
              '<blockquote class="creator-quote">' +
                '<p>\u201C' + escHtml(p.quote) + '\u201D</p>' +
                '<cite>\u2014 ' + escHtml(creatorName) + ', ' + formatDate(p.predDate) + '</cite>' +
              '</blockquote>' +
            '</td>' +
          '</tr>';
      }
    }

    el.innerHTML = headerHtml + summaryHtml +
      '<div class="op-table-wrap">' +
        '<table class="op-table">' +
          '<thead><tr>' +
            '<th>Ticker</th><th>Company</th><th>Direction</th><th>Conviction</th>' +
            '<th>Entry</th><th>Called On</th><th>Evaluates</th><th>Days Until</th><th></th>' +
          '</tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="op-disclaimer">Open predictions are unscored calls where the evaluation date has not yet passed. Data refreshes from our live dataset.</div>';
  }

  function renderOpenPredictionsError(el) {
    el.innerHTML =
      '<div class="panel-header">' +
        '<h2 class="panel-title">Open Predictions</h2>' +
        '<div class="panel-badge op-live-badge">LIVE</div>' +
      '</div>' +
      '<div class="op-error-state">' +
        '<p>Unable to load live predictions from our dataset.</p>' +
        '<p>This could be a temporary issue \u2014 try refreshing the page.</p>' +
        '<a href="' + SHEET_URL + '" target="_blank" rel="noopener" class="op-error-link">' +
          'View the full prediction dataset \u2192' +
        '</a>' +
      '</div>';
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
      target:     col(["target", "company"]),
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
      var startPrice = COL.startPrice >= 0 ? (row[COL.startPrice] || "").trim() : "";

      // Open prediction = has start price but no end price
      var hasStartPrice = startPrice && startPrice !== "" && startPrice !== "$0.00";
      var noEndPrice = !endPrice || endPrice === "" || endPrice === "$0.00" || endPrice === "$-" || endPrice === "0";

      if (!hasStartPrice || !noEndPrice) continue;

      open.push({
        ticker:     COL.ticker >= 0 ? (row[COL.ticker] || "").trim() : "",
        target:     COL.target >= 0 ? (row[COL.target] || "").trim() : "",
        direction:  COL.direction >= 0 ? (row[COL.direction] || "").trim() : "",
        confidence: COL.confidence >= 0 ? (row[COL.confidence] || "").trim() : "",
        startPrice: startPrice,
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
        renderOpenPredictions(opEl, predictions, c.name);
      }).catch(function (err) {
        console.error("[OpenPredictions] Failed to load:", err);
        renderOpenPredictionsError(opEl);
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
          alphaStdDev: Number.isFinite(live.alphaStdDev) ? live.alphaStdDev : c.alphaStdDev,
          alpha2023: Number.isFinite(live.alpha2023) ? live.alpha2023 : c.alpha2023,
          alpha2024: Number.isFinite(live.alpha2024) ? live.alpha2024 : c.alpha2024,
          alpha2025: Number.isFinite(live.alpha2025) ? live.alpha2025 : c.alpha2025,
          alpha2026: Number.isFinite(live.alpha2026) ? live.alpha2026 : c.alpha2026,
          pValue: Number.isFinite(live.pValue) ? live.pValue : c.pValue
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
