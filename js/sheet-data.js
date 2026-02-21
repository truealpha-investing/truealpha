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

  // ─── Header normalisation ────────────────────────────────────────────
  // Collapse whitespace, strip non-alphanumeric (keep digits), lowercase.
  // "Creator Name" → "creatorname", "P-Value" → "pvalue", "2023 Alpha" → "2023alpha"
  function normalize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // ─── Fetch + parse ───────────────────────────────────────────────────

  /**
   * Fetch the published CSV and return an array of creator objects.
   * Column mapping is determined dynamically from the header row.
   * Uses fuzzy matching so minor header renames don't break parsing.
   */
  async function fetchCreators() {
    var csvText;
    var source = "";

    // Try primary URL first, then alternate
    try {
      var res = await fetch(CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      csvText = await res.text();
      source = "primary";
    } catch (e1) {
      console.warn("[SheetData] Primary CSV URL failed, trying alternate:", e1.message);
      try {
        var res2 = await fetch(CSV_URL_ALT, { cache: "no-store" });
        if (!res2.ok) throw new Error("HTTP " + res2.status);
        csvText = await res2.text();
        source = "alternate";
      } catch (e2) {
        console.error("[SheetData] CSV failed, falling back to JSON. Primary: " + e1.message + ", Alternate: " + e2.message);
        throw new Error("Both CSV endpoints failed (" + e1.message + " / " + e2.message + ")");
      }
    }

    // Guard against HTML login pages returned as 200
    if (csvText.trim().charAt(0) === "<") {
      console.error("[SheetData] CSV failed, falling back to JSON — received HTML instead of CSV (likely auth/redirect issue)");
      throw new Error("CSV endpoint returned HTML instead of CSV data");
    }

    var rows = parseCSV(csvText);
    if (rows.length < 2) {
      console.error("[SheetData] CSV failed, falling back to JSON — no data rows");
      throw new Error("CSV has no data rows");
    }

    // Build header maps for matching
    var rawHeaders = rows[0].map(function (h) { return h.trim(); });
    var lcHeaders = rawHeaders.map(function (h) { return h.toLowerCase(); });
    var normHeaders = rawHeaders.map(function (h) { return normalize(h); });

    console.log("[SheetData] CSV headers (" + source + "):", rawHeaders);

    // Resilient column finder: tries exact (lowercase), then normalised, then substring
    function col(aliases) {
      if (!Array.isArray(aliases)) aliases = [aliases];
      var i, j, alias, normAlias;

      // Pass 1: exact lowercase match
      for (i = 0; i < aliases.length; i++) {
        alias = aliases[i].toLowerCase();
        j = lcHeaders.indexOf(alias);
        if (j !== -1) return j;
      }

      // Pass 2: normalised match (strips all punctuation/spaces)
      for (i = 0; i < aliases.length; i++) {
        normAlias = normalize(aliases[i]);
        for (j = 0; j < normHeaders.length; j++) {
          if (normHeaders[j] === normAlias) return j;
        }
      }

      // Pass 3: substring — header contains the alias or alias contains the header
      for (i = 0; i < aliases.length; i++) {
        normAlias = normalize(aliases[i]);
        if (normAlias.length < 3) continue; // skip very short aliases for substring
        for (j = 0; j < normHeaders.length; j++) {
          if (normHeaders[j].length < 3) continue;
          if (normHeaders[j].indexOf(normAlias) !== -1 || normAlias.indexOf(normHeaders[j]) !== -1) return j;
        }
      }

      return -1;
    }

    var COL = {
      creator:          col(["creator name", "creator", "channel", "channel name", "name"]),
      totalPicks:       col(["total scorable predictions", "total predictions", "total picks", "scorable predictions", "n", "predictions", "num predictions", "total scored predictions"]),
      accuracy:         col(["accuracy", "win rate", "winrate", "accuracy rate", "directional accuracy", "overall accuracy"]),
      shortTermAcc:     col(["short term accuracy", "short-term accuracy", "st accuracy", "90d accuracy"]),
      longTermAcc:      col(["long term accuracy", "long-term accuracy", "lt accuracy", "365d accuracy"]),
      avgAlpha:         col(["average alpha", "avg alpha", "alpha", "avg. alpha", "mean alpha", "alpha avg", "overall alpha"]),
      alpha2023:        col(["2023 alpha", "alpha 2023", "alpha2023"]),
      alpha2024:        col(["2024 alpha", "alpha 2024", "alpha2024"]),
      alpha2025:        col(["2025 alpha", "alpha 2025", "alpha2025"]),
      alpha2026:        col(["2026 alpha", "alpha 2026", "alpha2026"]),
      alphaStdDev:      col(["alpha std dev", "alpha std. dev", "alpha stddev", "std dev", "standard deviation", "alpha standard deviation", "stdev"]),
      stdError:         col(["std error", "standard error", "se", "std. error"]),
      tStat:            col(["t-statistic", "t-stat", "tstat", "t statistic", "t stat"]),
      pValue:           col(["p-value", "p value", "pvalue", "p-val", "pval"]),
      sigFlag:          col(["significance flag", "sig flag", "significance", "significant", "stat sig", "statistical significance"]),
      shortTermAlpha:   col(["short term alpha", "short-term alpha", "st alpha", "90d alpha", "short alpha"]),
      longTermAlpha:    col(["long term alpha", "long-term alpha", "lt alpha", "365d alpha", "long alpha"]),
      bestCall:         col(["best call", "best call alpha", "best pick", "top call", "best call return"]),
      worstCall:        col(["worst call", "worst call alpha", "worst pick", "bottom call", "worst call return"]),
      bullishAcc:       col(["bullish accuracy", "bullish acc", "bull accuracy", "bullish win rate"]),
      bearishAcc:       col(["bearish accuracy", "bearish acc", "bear accuracy", "bearish win rate"]),
      sampleSizeMet:    col(["sample size met?", "sample size met", "sample size", "n >= 20", "n>=20", "meets sample size"]),
      bestCallTicker:   col(["best call ticker", "best ticker", "best call stock", "best call asset"]),
      worstCallTicker:  col(["worst call ticker", "worst ticker", "worst call stock", "worst call asset"]),
      recommendedAssets:col(["recommended assets", "rec assets", "assets", "tickers", "recommended tickers", "rec tickers", "recommended stocks"])
    };

    // Log which columns matched and which didn't
    var matched = [];
    var unmatched = [];
    for (var colName in COL) {
      if (COL[colName] >= 0) {
        matched.push(colName + "→" + COL[colName] + '("' + rawHeaders[COL[colName]] + '")');
      } else {
        unmatched.push(colName);
      }
    }
    console.log("[SheetData] Matched columns: " + matched.join(", "));
    if (unmatched.length) {
      console.warn("[SheetData] Unmatched columns: " + unmatched.join(", "));
    }

    // Critical: if we can't find the creator name column, data is useless
    if (COL.creator < 0) {
      console.error("[SheetData] CSV failed, falling back to JSON — could not find creator name column. Headers: " + rawHeaders.join(", "));
      throw new Error("CSV missing creator name column");
    }

    var creators = [];

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var name = (row[COL.creator] || "").trim();
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
        recommendedAssets:COL.recommendedAssets >= 0 ? (row[COL.recommendedAssets] || "").trim() : "",
        alphaStdDev:      COL.alphaStdDev >= 0 ? pct(row[COL.alphaStdDev]) : NaN,
        alpha2023:        COL.alpha2023 >= 0 ? pct(row[COL.alpha2023]) : NaN,
        alpha2024:        COL.alpha2024 >= 0 ? pct(row[COL.alpha2024]) : NaN,
        alpha2025:        COL.alpha2025 >= 0 ? pct(row[COL.alpha2025]) : NaN,
        alpha2026:        COL.alpha2026 >= 0 ? pct(row[COL.alpha2026]) : NaN
      });
    }

    // Validate: check how many creators have real numeric data
    var withAlpha = 0, withAccuracy = 0, withPicks = 0;
    creators.forEach(function (c) {
      if (Number.isFinite(c.avgAlpha)) withAlpha++;
      if (Number.isFinite(c.accuracy)) withAccuracy++;
      if (Number.isFinite(c.totalPicks)) withPicks++;
    });

    console.log("[SheetData] CSV loaded: " + creators.length + " creators" +
      " (alpha: " + withAlpha + ", accuracy: " + withAccuracy + ", picks: " + withPicks + ")");

    // If we parsed creators but none have any real data, the headers are wrong
    if (creators.length > 0 && withAlpha === 0 && withAccuracy === 0 && withPicks === 0) {
      console.error("[SheetData] CSV failed, falling back to JSON — parsed " + creators.length +
        " creators but ALL numeric fields are NaN. Headers likely changed. Raw headers: " + rawHeaders.join(", "));
      throw new Error("CSV parsed " + creators.length + " rows but no numeric data — column headers likely changed");
    }

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
