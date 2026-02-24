#!/usr/bin/env python3
"""Fetch YouTube transcripts for pending rows in a Google Sheet.

Converted from the Google Colab version for GitHub Actions.
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

# Statuses that should never be touched — these rows are already processed
SKIP_STATUSES = {"Analyzed", "Analyzed (Empty)"}


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

    # Match Colab: request all subtitle languages, prefer English
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang", "en,.*",
        "--output", f"temp_{video_id}",
        "--no-check-certificate",
        url,
    ]

    try:
        subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=45,
        )

        found_text = ""
        lang_found = "xx"

        for filename in os.listdir("."):
            if filename.startswith(f"temp_{video_id}") and filename.endswith(".vtt"):
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
                        ):
                            lines.append(stripped.replace("&nbsp;", " "))
                    found_text = " ".join(lines)
                    # Extract language code from filename (e.g. temp_xxx.en.vtt → en)
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

    log.info("Found %d rows. Scanning...", len(rows))

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

        # Skip rows that are already fully processed
        if status in SKIP_STATUSES:
            continue

        # Skip rows that already have a "Ready" status (don't overwrite)
        if "Ready" in status:
            continue

        # Skip rows with no video ID
        if not video_id:
            continue

        log.info("Row %d (%s): fetching transcript...", row_num, video_id)

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
            time.sleep(2)  # Rate-limit to avoid YouTube throttling
        else:
            log.warning("Row %d: %s — %s", row_num, code, text[:100])
            # Only mark as failed if not already in a "Ready" state
            worksheet.update_cell(row_num, status_col + 1, "Transcript Failed")
            processed += 1
            time.sleep(1)

    log.info("Done. Processed %d rows.", processed)


def main():
    log.info("--- TRANSCRIPT FETCHER STARTED ---")
    client = get_gspread_client()
    worksheet = open_sheet(client)
    process_rows(worksheet)
    log.info("--- TRANSCRIPT FETCHER FINISHED ---")


if __name__ == "__main__":
    main()
