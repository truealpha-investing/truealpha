#!/usr/bin/env python3
"""Fetch YouTube transcripts for pending rows in a Google Sheet.

Converted from the working Google Colab version for GitHub Actions.
Reads credentials from GOOGLE_CREDENTIALS and SHEET_KEY env vars.

Processing order:
  1. "Pending" rows first (new videos, never tried)
  2. "Transcript Failed" rows second (retries, only if budget remains)
  3. Videos that fail 3+ times are marked "Permanently Failed" and skipped
  4. Videos with permanent errors (age-restricted, deleted) are skipped immediately
"""

import json
import logging
import os
import re
import subprocess
import sys
import time

import gspread
from oauth2client.service_account import ServiceAccountCredentials

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

MAX_ROWS_PER_RUN = 50
MAX_RETRIES = 3
WORKSHEET_NAME = "Ingest_Queue"


def get_gspread_client():
    """Authenticate with Google Sheets using service-account credentials."""
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    if not creds_json:
        sys.exit("GOOGLE_CREDENTIALS environment variable is not set")

    try:
        creds_dict = json.loads(creds_json)
        log.info(
            "Credentials loaded. Project: %s, Email: %s",
            creds_dict.get("project_id"),
            creds_dict.get("client_email"),
        )
    except Exception as e:
        log.error("Failed to parse GOOGLE_CREDENTIALS JSON: %s", e)
        sys.exit(1)

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    credentials = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    return gspread.authorize(credentials)


def open_sheet(client):
    """Open the Google Sheet and return the Ingest_Queue worksheet."""
    sheet_key = os.environ.get("SHEET_KEY", "").strip()
    if not sheet_key:
        sys.exit("SHEET_KEY environment variable is not set")

    spreadsheet = client.open_by_key(sheet_key)
    return spreadsheet.worksheet(WORKSHEET_NAME)


def fetch_transcript(video_id):
    """Use yt-dlp to download the transcript for a YouTube video.

    Returns (status, text, lang):
      - ("OK", transcript_text, "en")   on success
      - ("FAILED", reason, "xx")        on failure
      - ("PERMANENT", reason, "xx")     on permanent failure (don't retry)
    """
    url = f"https://www.youtube.com/watch?v={video_id}"

    cmd = [
        "yt-dlp",
        "--no-warnings",
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang", "en,en-US,en-orig,ko,ko-KR",
        "--output", f"temp_{video_id}",
        "--no-check-certificate",
        url,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=45,
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()
            log.warning("yt-dlp exit code %d for %s: %s", result.returncode, video_id, stderr[:200])

        found_text = ""
        lang_found = "xx"

        for filename in os.listdir("."):
            if filename.startswith(f"temp_{video_id}") and (
                filename.endswith(".vtt")
                or filename.endswith(".srv3")
                or filename.endswith(".ttml")
            ):
                with open(filename, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    lines = []
                    for line in content.splitlines():
                        stripped = line.strip()
                        if (
                            stripped
                            and "-->" not in line
                            and "WEBVTT" not in line
                            and "<c>" not in line
                            and not stripped.isdigit()
                        ):
                            lines.append(stripped.replace("&nbsp;", " "))
                    found_text = " ".join(lines)
                    lang_found = filename.split(".")[-2]

                os.remove(filename)
                break

        # Clean up any other temp files
        for filename in os.listdir("."):
            if filename.startswith(f"temp_{video_id}"):
                try:
                    os.remove(filename)
                except OSError:
                    pass

        if len(found_text) > 50:
            return "OK", found_text[:49000], lang_found

        # Classify the failure
        if result.returncode != 0:
            stderr_text = result.stderr
            if "Sign in" in stderr_text:
                return "PERMANENT", "Age Restricted / Sign-in Required", "xx"
            if "Video unavailable" in stderr_text:
                return "PERMANENT", "Video Deleted or Private", "xx"
            if "Private video" in stderr_text:
                return "PERMANENT", "Video is Private", "xx"
            return "FAILED", f"yt-dlp error: {result.stderr.strip()[:100]}", "xx"

        return "FAILED", "No transcript data found", "xx"

    except subprocess.TimeoutExpired:
        return "FAILED", "yt-dlp timed out after 45s", "xx"
    except Exception as e:
        return "FAILED", str(e), "xx"


def parse_retry_count(status):
    """Extract retry count from status like 'Transcript Failed x2'.

    'Transcript Failed'    -> 1
    'Transcript Failed x2' -> 2
    'Transcript Failed x3' -> 3
    """
    match = re.search(r"x(\d+)$", status)
    if match:
        return int(match.group(1))
    return 1


def process_rows(worksheet):
    """Process rows in priority order: Pending first, then retries."""
    rows = worksheet.get_all_values()
    headers = rows[0]

    try:
        id_col = headers.index("Video ID")
        transcript_col = headers.index("Transcript")
        status_col = headers.index("Status")
    except ValueError as exc:
        sys.exit(f"Required column not found in sheet headers: {exc}")

    log.info("Found %d rows (including header). Scanning...", len(rows))

    # Categorize rows into priority buckets
    pending_rows = []       # Priority 1: never tried
    retry_rows = []         # Priority 2: failed but retryable
    skip_count = 0

    for i in range(1, len(rows)):
        row = rows[i]
        if len(row) <= status_col:
            continue

        video_id = row[id_col].strip()
        status = row[status_col].strip()
        row_num = i + 1

        if not video_id:
            continue

        if status == "Pending" or status == "Pending Transcript":
            pending_rows.append((row_num, video_id, status))

        elif status.startswith("Transcript Failed"):
            retries = parse_retry_count(status)
            if retries >= MAX_RETRIES:
                skip_count += 1
            else:
                retry_rows.append((row_num, video_id, status, retries))

    # Log the breakdown
    status_counts = {}
    for row in rows[1:]:
        if len(row) > status_col:
            s = row[status_col].strip()
            status_counts[s] = status_counts.get(s, 0) + 1
    log.info("Status counts: %s", json.dumps(status_counts, indent=2))
    log.info(
        "Work queue: %d Pending, %d retryable failures, %d maxed-out (skipped)",
        len(pending_rows), len(retry_rows), skip_count,
    )

    processed = 0

    # --- PASS 1: Process "Pending" rows (new videos) ---
    for row_num, video_id, status in pending_rows:
        if processed >= MAX_ROWS_PER_RUN:
            break

        log.info("Row %d (%s): NEW — fetching transcript...", row_num, video_id)
        processed += _process_one_row(
            worksheet, row_num, video_id, transcript_col, status_col, retry_count=0,
        )
        time.sleep(3)

    # --- PASS 2: Retry "Transcript Failed" rows (if budget remains) ---
    if processed < MAX_ROWS_PER_RUN and retry_rows:
        remaining = MAX_ROWS_PER_RUN - processed
        log.info("Budget remaining: %d slots. Retrying %d failed rows...", remaining, min(remaining, len(retry_rows)))

        for row_num, video_id, status, retries in retry_rows:
            if processed >= MAX_ROWS_PER_RUN:
                break

            log.info("Row %d (%s): RETRY #%d — fetching transcript...", row_num, video_id, retries + 1)
            processed += _process_one_row(
                worksheet, row_num, video_id, transcript_col, status_col, retry_count=retries,
            )
            time.sleep(3)

    log.info("Done. Processed %d rows total.", processed)


def _process_one_row(worksheet, row_num, video_id, transcript_col, status_col, retry_count):
    """Fetch transcript for one video and update the sheet. Returns 1."""
    try:
        code, text, lang = fetch_transcript(video_id)
    except Exception:
        log.exception("Row %d: unexpected error", row_num)
        code, text, lang = "FAILED", "Unexpected Python exception", "xx"

    if code == "OK":
        log.info("Row %d: SUCCESS (%s, %d chars)", row_num, lang, len(text))
        worksheet.update_cell(row_num, transcript_col + 1, text)
        worksheet.update_cell(row_num, status_col + 1, f"Ready for AI ({lang})")

    elif code == "PERMANENT":
        log.warning("Row %d: PERMANENT failure — %s", row_num, text)
        worksheet.update_cell(row_num, status_col + 1, "Permanently Failed")
        worksheet.update_cell(row_num, transcript_col + 1, text)

    else:
        new_count = retry_count + 1
        if new_count >= MAX_RETRIES:
            new_status = "Permanently Failed"
            log.warning("Row %d: FAILED x%d (max retries reached) — %s", row_num, new_count, text[:100])
        elif new_count == 1:
            new_status = "Transcript Failed"
            log.warning("Row %d: FAILED — %s", row_num, text[:100])
        else:
            new_status = f"Transcript Failed x{new_count}"
            log.warning("Row %d: FAILED x%d — %s", row_num, new_count, text[:100])

        worksheet.update_cell(row_num, status_col + 1, new_status)

    return 1


def main():
    log.info("--- TRANSCRIPT FETCHER STARTED ---")
    client = get_gspread_client()
    worksheet = open_sheet(client)
    process_rows(worksheet)
    log.info("--- TRANSCRIPT FETCHER FINISHED ---")


if __name__ == "__main__":
    main()
