#!/usr/bin/env python3
"""Fetch YouTube transcripts for pending rows in a Google Sheet.

Converted from the working Google Colab version for GitHub Actions.
Reads credentials from GOOGLE_CREDENTIALS and SHEET_KEY env vars.
"""

import json
import logging
import os
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
WORKSHEET_NAME = "Ingest_Queue"

# Only process rows with these statuses (matches Colab behavior)
PROCESS_STATUSES = {"Pending", "Pending Transcript", "Transcript Failed"}


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
    """
    url = f"https://www.youtube.com/watch?v={video_id}"

    # Use explicit language codes matching the working Colab version
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
            # Log the actual error so it shows in GitHub Actions
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
                    # Extract language code from filename (e.g. temp_xxx.en.vtt -> en)
                    lang_found = filename.split(".")[-2]

                os.remove(filename)
                break

        # Clean up any other temp files that yt-dlp may have created
        for filename in os.listdir("."):
            if filename.startswith(f"temp_{video_id}"):
                try:
                    os.remove(filename)
                except OSError:
                    pass

        if len(found_text) > 50:
            return "OK", found_text[:49000], lang_found

        # Log why it failed so we can debug from Actions logs
        if result.returncode != 0:
            stderr_short = result.stderr.strip()[:100]
            if "Sign in" in result.stderr:
                return "FAILED", "Age Restricted / Sign-in Required", "xx"
            if "Video unavailable" in result.stderr:
                return "FAILED", "Video Deleted or Private", "xx"
            return "FAILED", f"yt-dlp error: {stderr_short}", "xx"

        return "FAILED", "No transcript data found", "xx"

    except subprocess.TimeoutExpired:
        return "ERROR", "yt-dlp timed out after 45s", "xx"
    except Exception as e:
        return "ERROR", str(e), "xx"


def process_rows(worksheet):
    """Find actionable rows, fetch transcripts, and update the sheet."""
    rows = worksheet.get_all_values()
    headers = rows[0]

    try:
        id_col = headers.index("Video ID")
        transcript_col = headers.index("Transcript")
        status_col = headers.index("Status")
    except ValueError as exc:
        sys.exit(f"Required column not found in sheet headers: {exc}")

    log.info("Found %d rows (including header). Scanning...", len(rows))

    # Count statuses for visibility in logs
    status_counts = {}
    for row in rows[1:]:
        if len(row) > status_col:
            s = row[status_col].strip()
            status_counts[s] = status_counts.get(s, 0) + 1
    log.info("Status counts: %s", json.dumps(status_counts, indent=2))

    processed = 0
    for i in range(1, len(rows)):
        if processed >= MAX_ROWS_PER_RUN:
            log.info("Reached max rows per run (%d). Stopping.", MAX_ROWS_PER_RUN)
            break

        row = rows[i]
        if len(row) <= status_col:
            continue

        video_id = row[id_col].strip()
        status = row[status_col].strip()
        row_num = i + 1  # 1-indexed for Google Sheets

        # Only process rows with explicit pending/failed statuses
        if status not in PROCESS_STATUSES:
            continue

        # Skip rows with no video ID
        if not video_id:
            log.warning("Row %d: status is '%s' but Video ID is empty", row_num, status)
            continue

        log.info("Row %d (%s): status='%s', fetching transcript...", row_num, video_id, status)

        try:
            code, text, lang = fetch_transcript(video_id)
        except Exception:
            log.exception("Row %d: unexpected error", row_num)
            code, text, lang = "ERROR", "Unexpected Python exception", "xx"

        if code == "OK":
            log.info("Row %d: SUCCESS (%s, %d chars)", row_num, lang, len(text))
            worksheet.update_cell(row_num, transcript_col + 1, text)
            worksheet.update_cell(row_num, status_col + 1, f"Ready for AI ({lang})")
            processed += 1
            time.sleep(3)  # Rate-limit to avoid YouTube throttling
        else:
            log.warning("Row %d: %s — %s", row_num, code, text[:200])
            worksheet.update_cell(row_num, status_col + 1, "Transcript Failed")
            processed += 1
            time.sleep(2)

    log.info("Done. Processed %d rows.", processed)


def main():
    log.info("--- TRANSCRIPT FETCHER STARTED ---")
    client = get_gspread_client()
    worksheet = open_sheet(client)
    process_rows(worksheet)
    log.info("--- TRANSCRIPT FETCHER FINISHED ---")


if __name__ == "__main__":
    main()
