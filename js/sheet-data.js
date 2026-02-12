/**
 * sheet-data.js — Shared module for fetching and parsing TrueAlpha leaderboard
 * data from a published Google Sheets CSV endpoint.
 *
 * Usage:
 *   <script src="/js/sheet-data.js"></script>
 *   const creators = await SheetData.fetchCreators();
 *   const leaderboard = SheetData.transformToLeaderboardData(creators);
 */
window.SheetData = (function () {
  "use strict";

  var CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRKqLL2jTM-NNTXbMQNJgFQEpyX8jnE0jE6z8UCDbP_QGoK2RArS5jHKI7lqBs3gJ7DMOlWq3glr0Vh/pub?gid=1723289430&single=true&output=csv";

  var CSV_URL_ALT =
    "https://docs.google.com/spreadsheets/d/1JFZaZ_jC9PR7EKucweHkkO-vdCPXiWSk_6-ey02T2RE/gviz/tq?tqx=out:csv&gid=1723289430";

  var DATABASE_URL =
    "https://docs.google.com/spreadsheets/d/1JFZaZ_jC9PR7EKucweHkkO-vdCPXiWSk_6-ey02T2RE/edit?gid=1723289430#gid=1723289430";

  // ─── CSV parser ──────────────────────────────────────────────────────
  // Handles quoted fields, embedded commas, and newlines inside quotes.
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

    // last field / row
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /** Strip "%" and convert to a number. Handles "51.02%", "-3.65%", "0.0064", "" */
  function pct(val) {
    if (val === null || val === undefined) return NaN;
    var s = String(val).trim();
    if (!s) return NaN;
    s = s.replace(/%$/, "").trim();
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Parse p-value: could be "3.18%" (meaning 0.0318) or "0.0064" (already decimal). */
  function parsePValue(val) {
    if (val === null || val === undefined) return NaN;
    var s = String(val).trim();
    if (!s) return NaN;
    if (s.endsWith("%")) {
      // e.g. "3.18%" → 0.0318
      var n = Number(s.replace(/%$/, "").trim());
      return Number.isFinite(n) ? n / 100 : NaN;
    }
    var n2 = Number(s);
    return Number.isFinite(n2) ? n2 : NaN;
  }

  // ─── Fetch + parse ───────────────────────────────────────────────────

  /**
   * Fetch the published CSV and return an array of creator objects.
   * Column mapping is determined dynamically from the header row.
   */
  async function fetchCreators() {
    var csvText;

    // Try primary URL first, then alternate
    try {
      var res = await fetch(CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      csvText = await res.text();
    } catch (e1) {
      console.warn("Primary CSV URL failed, trying alternate:", e1);
      var res2 = await fetch(CSV_URL_ALT, { cache: "no-store" });
      if (!res2.ok) throw new Error("HTTP " + res2.status);
      csvText = await res2.text();
    }

    var rows = parseCSV(csvText);
    if (rows.length < 2) throw new Error("CSV has no data rows");

    // Build header map — normalise to lowercase, trim whitespace
    var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    console.log("[SheetData] CSV headers:", headers);

    // Map known header names to column indices
    function col(names) {
      if (!Array.isArray(names)) names = [names];
      for (var i = 0; i < names.length; i++) {
        var idx = headers.indexOf(names[i].toLowerCase());
        if (idx !== -1) return idx;
      }
      return -1;
    }

    var COL = {
      creator:          col(["creator name", "creator"]),
      totalPicks:       col(["total scorable predictions", "total predictions"]),
      accuracy:         col(["accuracy"]),
      shortTermAcc:     col(["short term accuracy"]),
      longTermAcc:      col(["long term accuracy"]),
      avgAlpha:         col(["average alpha", "avg alpha"]),
      alpha2023:        col(["2023 alpha"]),
      alpha2024:        col(["2024 alpha"]),
      alpha2025:        col(["2025 alpha"]),
      alphaStdDev:      col(["alpha std dev"]),
      stdError:         col(["std error"]),
      tStat:            col(["t-statistic", "t-stat"]),
      pValue:           col(["p-value", "p value"]),
      sigFlag:          col(["significance flag", "sig flag"]),
      shortTermAlpha:   col(["short term alpha"]),
      longTermAlpha:    col(["long term alpha"]),
      bestCall:         col(["best call"]),
      worstCall:        col(["worst call"]),
      bullishAcc:       col(["bullish accuracy"]),
      bearishAcc:       col(["bearish accuracy"]),
      sampleSizeMet:    col(["sample size met?", "sample size met"]),
      bestCallTicker:   col(["best call ticker"]),
      worstCallTicker:  col(["worst call ticker"]),
      recommendedAssets:col(["recommended assets"])
    };

    var creators = [];

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var name = COL.creator >= 0 ? (row[COL.creator] || "").trim() : "";
      if (!name) continue; // skip empty rows

      creators.push({
        creator:          name,
        totalPicks:       COL.totalPicks >= 0 ? pct(row[COL.totalPicks]) : NaN,
        accuracy:         COL.accuracy >= 0 ? pct(row[COL.accuracy]) : NaN,
        shortTermAccuracy:COL.shortTermAcc >= 0 ? pct(row[COL.shortTermAcc]) : NaN,
        longTermAccuracy: COL.longTermAcc >= 0 ? pct(row[COL.longTermAcc]) : NaN,
        avgAlpha:         COL.avgAlpha >= 0 ? pct(row[COL.avgAlpha]) : NaN,
        shortTermAlpha:   COL.shortTermAlpha >= 0 ? pct(row[COL.shortTermAlpha]) : NaN,
        longTermAlpha:    COL.longTermAlpha >= 0 ? pct(row[COL.longTermAlpha]) : NaN,
        pValue:           COL.pValue >= 0 ? parsePValue(row[COL.pValue]) : NaN,
        sig:              COL.sigFlag >= 0 ? /significant/i.test(row[COL.sigFlag]) && !/not\s+significant/i.test(row[COL.sigFlag]) : false,
        bestCall:         COL.bestCall >= 0 ? pct(row[COL.bestCall]) : NaN,
        worstCall:        COL.worstCall >= 0 ? pct(row[COL.worstCall]) : NaN,
        bullishAccuracy:  COL.bullishAcc >= 0 ? pct(row[COL.bullishAcc]) : NaN,
        bearishAccuracy:  COL.bearishAcc >= 0 ? pct(row[COL.bearishAcc]) : NaN,
        sampleSizeMet:    COL.sampleSizeMet >= 0 ? /^y/i.test((row[COL.sampleSizeMet] || "").trim()) : true,
        bestCallTicker:   COL.bestCallTicker >= 0 ? (row[COL.bestCallTicker] || "").trim() : "",
        worstCallTicker:  COL.worstCallTicker >= 0 ? (row[COL.worstCallTicker] || "").trim() : "",
        recommendedAssets:COL.recommendedAssets >= 0 ? (row[COL.recommendedAssets] || "").trim() : ""
      });
    }

    console.log("[SheetData] Parsed " + creators.length + " creators from CSV");
    return creators;
  }

  // ─── Get a single creator by name ────────────────────────────────────

  function getCreatorByName(creators, name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < creators.length; i++) {
      if (creators[i].creator.toLowerCase() === lower) return creators[i];
    }
    return null;
  }

  // ─── Top N / Bottom N by metric ──────────────────────────────────────

  function topN(creators, metric, n) {
    var valid = creators.filter(function (c) { return Number.isFinite(c[metric]); });
    valid.sort(function (a, b) { return b[metric] - a[metric]; });
    return valid.slice(0, n);
  }

  function bottomN(creators, metric, n) {
    var valid = creators.filter(function (c) { return Number.isFinite(c[metric]); });
    valid.sort(function (a, b) { return a[metric] - b[metric]; });
    return valid.slice(0, n);
  }

  // ─── Aggregate recommended assets across all creators ────────────────

  function aggregateAssets(creators) {
    var counts = {};
    creators.forEach(function (c) {
      if (!c.recommendedAssets) return;
      c.recommendedAssets.split(",").forEach(function (t) {
        var ticker = t.trim().toUpperCase();
        if (!ticker) return;
        counts[ticker] = (counts[ticker] || 0) + 1;
      });
    });

    var items = [];
    for (var ticker in counts) {
      items.push({ ticker: ticker, mentions: counts[ticker] });
    }
    items.sort(function (a, b) { return b.mentions - a.mentions; });
    return items;
  }

  // ─── Transform CSV creators into leaderboard.json-compatible format ──

  function transformToLeaderboardData(allCreators) {
    // Filter to sample-size-met creators
    var creators = allCreators.filter(function (c) { return c.sampleSizeMet; });

    function makeEntry(c, rank, alphaField) {
      return {
        rank: rank,
        creator: c.creator,
        n: Number.isFinite(c.totalPicks) ? Math.round(c.totalPicks) : undefined,
        avgAlpha: c[alphaField || "avgAlpha"],
        alpha: c[alphaField || "avgAlpha"],
        winRate: c.accuracy,
        pValue: c.pValue,
        sig: c.sig
      };
    }

    function rankedList(arr, field) {
      return arr.map(function (c, i) { return makeEntry(c, i + 1, field); });
    }

    var alphaT = rankedList(topN(creators, "avgAlpha", 4), "avgAlpha");
    var alphaB = rankedList(bottomN(creators, "avgAlpha", 4), "avgAlpha");

    var accT = rankedList(topN(creators, "accuracy", 4));
    var accB = rankedList(bottomN(creators, "accuracy", 4));

    var stockItems = aggregateAssets(creators).slice(0, 8);

    var d90T = rankedList(topN(creators, "shortTermAlpha", 3), "shortTermAlpha");
    var d90B = rankedList(bottomN(creators, "shortTermAlpha", 3), "shortTermAlpha");
    var d180T = rankedList(topN(creators, "avgAlpha", 3), "avgAlpha");
    var d180B = rankedList(bottomN(creators, "avgAlpha", 3), "avgAlpha");
    var d365T = rankedList(topN(creators, "longTermAlpha", 3), "longTermAlpha");
    var d365B = rankedList(bottomN(creators, "longTermAlpha", 3), "longTermAlpha");

    return {
      meta: {
        lastUpdated: "Jan 2026",
        filter: "Verified (N \u2265 20) + Stat Sig badge (p < 0.05)",
        metricAlpha: "Alpha vs S&P 500 (avg hold)",
        metricAccuracy: "Accuracy (directional win rate)",
        entry: "Close price on publish date",
        significanceRule: "Significant if p < 0.05",
        databaseUrl: DATABASE_URL
      },
      alpha: { top: alphaT, bottom: alphaB },
      accuracy: { top: accT, bottom: accB },
      stocksRecommended: {
        note: "Mentions across creators (Recommended Assets column).",
        items: stockItems
      },
      intervals: {
        d90: { label: "90D (short)", top: d90T, bottom: d90B },
        d180: { label: "180D (mid)", top: d180T, bottom: d180B },
        d365: { label: "365D (long)", top: d365T, bottom: d365B }
      }
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────

  return {
    fetchCreators: fetchCreators,
    getCreatorByName: getCreatorByName,
    topN: topN,
    bottomN: bottomN,
    aggregateAssets: aggregateAssets,
    transformToLeaderboardData: transformToLeaderboardData,
    DATABASE_URL: DATABASE_URL
  };
})();
