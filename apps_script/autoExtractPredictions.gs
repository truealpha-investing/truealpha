/**
 * autoExtractPredictions — Trigger-safe version
 *
 * Fixes applied:
 *   1. Batch size reduced from (previous) to 2 rows per run
 *   2. 4-minute timeout check — stops before Apps Script kills the run
 *   3. SpreadsheetApp.getUi() replaced with Logger — safe for time-driven triggers
 *
 * SETUP:
 *   1. Open your Google Sheet → Extensions → Apps Script
 *   2. Replace your existing autoExtractPredictions function with this code
 *   3. Set up a time-driven trigger:
 *      - Edit → Current project's triggers → Add Trigger
 *      - Function: autoExtractPredictions
 *      - Event source: Time-driven
 *      - Type: Minutes timer → Every 5 minutes (or 10 minutes)
 *
 *   The function processes 2 rows per run. With a 5-minute trigger,
 *   that's ~576 rows/day — enough to clear any backlog.
 */

// ============================================================
// CONFIGURATION — edit these to match your sheet
// ============================================================
var CONFIG = {
  QUEUE_TAB: "Ingest_Queue",
  STATUS_COL_NAME: "Status",
  TRANSCRIPT_COL_NAME: "Transcript",
  PREDICTIONS_COL_NAME: "Predictions",      // column where AI output goes
  VIDEO_ID_COL_NAME: "Video ID",
  CREATOR_COL_NAME: "Creator",

  // Status values
  READY_STATUS: "Ready for AI",             // rows to process (matches partial)
  DONE_STATUS: "Analyzed",                  // set after successful extraction
  DONE_EMPTY_STATUS: "Analyzed (Empty)",    // set when AI finds no predictions
  ERROR_STATUS: "AI Error",                 // set on failure

  // Safety limits
  BATCH_SIZE: 2,                            // rows per execution (was higher, reduced to avoid timeout)
  TIMEOUT_MS: 4 * 60 * 1000,               // 4 minutes — stop before the 6-min Apps Script limit
};

// ============================================================
// MAIN FUNCTION — safe for time-driven triggers
// ============================================================
function autoExtractPredictions() {
  var startTime = new Date().getTime();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.QUEUE_TAB);
  if (!sheet) {
    Logger.log("ERROR: Tab '" + CONFIG.QUEUE_TAB + "' not found.");
    return;
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find column indices
  var statusCol = headers.indexOf(CONFIG.STATUS_COL_NAME);
  var transcriptCol = headers.indexOf(CONFIG.TRANSCRIPT_COL_NAME);
  var predictionsCol = headers.indexOf(CONFIG.PREDICTIONS_COL_NAME);
  var videoIdCol = headers.indexOf(CONFIG.VIDEO_ID_COL_NAME);
  var creatorCol = headers.indexOf(CONFIG.CREATOR_COL_NAME);

  if (statusCol === -1 || transcriptCol === -1 || predictionsCol === -1) {
    Logger.log("ERROR: Missing required columns. Found: Status=" + statusCol +
               " Transcript=" + transcriptCol + " Predictions=" + predictionsCol);
    return;
  }

  var processed = 0;

  for (var i = 1; i < data.length; i++) {
    // --- TIMEOUT CHECK: stop before Apps Script kills us ---
    var elapsed = new Date().getTime() - startTime;
    if (elapsed > CONFIG.TIMEOUT_MS) {
      Logger.log("TIMEOUT: Stopping after " + processed + " rows (" +
                 Math.round(elapsed / 1000) + "s elapsed). Will resume on next trigger.");
      return;
    }

    // --- BATCH LIMIT CHECK ---
    if (processed >= CONFIG.BATCH_SIZE) {
      Logger.log("BATCH COMPLETE: Processed " + processed + " rows. Will resume on next trigger.");
      return;
    }

    var row = data[i];
    var status = String(row[statusCol]).trim();

    // Only process "Ready for AI" rows (partial match handles "Ready for AI (en)", etc.)
    if (status.indexOf("Ready for AI") === -1) {
      continue;
    }

    var rowNum = i + 1; // 1-indexed for Sheets
    var transcript = String(row[transcriptCol]).trim();
    var videoId = videoIdCol !== -1 ? String(row[videoIdCol]).trim() : "";
    var creator = creatorCol !== -1 ? String(row[creatorCol]).trim() : "";

    if (!transcript || transcript.length < 50) {
      Logger.log("Row " + rowNum + ": Transcript too short (" + transcript.length + " chars), marking empty.");
      sheet.getRange(rowNum, statusCol + 1).setValue(CONFIG.DONE_EMPTY_STATUS);
      processed++;
      continue;
    }

    Logger.log("Row " + rowNum + " (" + videoId + "): Extracting predictions...");

    try {
      var predictions = callAIForPredictions_(transcript, creator, videoId);

      if (predictions && predictions.trim().length > 10) {
        sheet.getRange(rowNum, predictionsCol + 1).setValue(predictions);
        sheet.getRange(rowNum, statusCol + 1).setValue(CONFIG.DONE_STATUS);
        Logger.log("Row " + rowNum + ": Analyzed (" + predictions.length + " chars)");
      } else {
        sheet.getRange(rowNum, statusCol + 1).setValue(CONFIG.DONE_EMPTY_STATUS);
        Logger.log("Row " + rowNum + ": No predictions found in transcript.");
      }
    } catch (e) {
      Logger.log("Row " + rowNum + " ERROR: " + e.message);
      sheet.getRange(rowNum, statusCol + 1).setValue(CONFIG.ERROR_STATUS);
    }

    processed++;

    // Brief pause between API calls to avoid rate limits
    if (processed < CONFIG.BATCH_SIZE) {
      Utilities.sleep(2000);
    }
  }

  Logger.log("DONE: Processed " + processed + " rows. No more 'Ready for AI' rows found.");
}


// ============================================================
// AI CALL — replace the body with your actual AI prompt/API
// ============================================================
/**
 * Calls your AI service to extract predictions from a transcript.
 *
 * Replace the contents of this function with your actual implementation
 * (e.g., Gemini API, OpenAI API, or UrlFetchApp call).
 *
 * @param {string} transcript - The full transcript text
 * @param {string} creator - The creator/channel name
 * @param {string} videoId - The YouTube video ID
 * @return {string} Extracted predictions text, or empty string
 */
function callAIForPredictions_(transcript, creator, videoId) {
  // -------------------------------------------------------
  // IMPORTANT: Paste your existing AI call logic here.
  // Below is a PLACEHOLDER showing the expected structure.
  // -------------------------------------------------------

  // Example using Gemini via UrlFetchApp:
  //
  // var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  // var url = "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=" + apiKey;
  //
  // var prompt = "Extract all stock/crypto predictions from this transcript by " + creator + ".\n\n" +
  //              "For each prediction, include: Asset, Direction (Bullish/Bearish), " +
  //              "Confidence (High/Medium/Low), Quote, and Time Horizon.\n\n" +
  //              "Transcript:\n" + transcript.substring(0, 30000);
  //
  // var payload = {
  //   contents: [{ parts: [{ text: prompt }] }]
  // };
  //
  // var options = {
  //   method: "post",
  //   contentType: "application/json",
  //   payload: JSON.stringify(payload),
  //   muteHttpExceptions: true,
  // };
  //
  // var response = UrlFetchApp.fetch(url, options);
  // var json = JSON.parse(response.getContentText());
  // return json.candidates[0].content.parts[0].text;

  throw new Error(
    "callAIForPredictions_ is a placeholder. " +
    "Replace it with your actual AI extraction logic from your existing autoExtractPredictions function."
  );
}
