#!/usr/bin/env python3
"""Fetch YouTube transcripts for pending rows in a Google Sheet."""

import json
import logging
import os
import subprocess
import sys
import tempfile

import gspread
from oauth2client.service_account import ServiceAccountCredentials

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

MAX_ROWS_PER_RUN = 50
PENDING_STATUSES = {"Pending", "Pending Transcript", "Transcript Failed"}
WORKSHEET_NAME = "Ingest_Queue"


def get_gspread_client():
    """Authenticate with Google Sheets using service-account credentials."""
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    if not creds_json:
        sys.exit("GOOGLE_CREDENTIALS environment variable is not set")

    creds_dict = json.loads(creds_json)
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    credentials = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    return gspread.authorize(credentials)


def open_sheet(client):
    """Open the Google Sheet and return the Ingest_Queue worksheet."""
    sheet_key = os.environ.get("SHEET_KEY")
    if not sheet_key:
        sys.exit("SHEET_KEY environment variable is not set")

    spreadsheet = client.open_by_key(sheet_key)
    return spreadsheet.worksheet(WORKSHEET_NAME)


def fetch_transcript(video_url):
    """Use yt-dlp to download the transcript for a YouTube video.

    Returns the transcript text on success, or None on failure.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "transcript")
        cmd = [
            "yt-dlp",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-lang", "en",
            "--sub-format", "vtt",
            "--convert-subs", "srt",
            "--output", output_path,
            video_url,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            log.error("yt-dlp failed for %s: %s", video_url, result.stderr)
            return None

        # Look for the downloaded subtitle file
        srt_path = None
        for fname in os.listdir(tmpdir):
            if fname.endswith(".srt"):
                srt_path = os.path.join(tmpdir, fname)
                break

        if srt_path is None:
            log.error("No subtitle file found for %s", video_url)
            return None

        raw = open(srt_path, encoding="utf-8").read()
        return _clean_srt(raw)


def _clean_srt(srt_text):
    """Strip SRT timing lines and indices, returning plain text."""
    lines = []
    for line in srt_text.splitlines():
        line = line.strip()
        # Skip blank lines, numeric indices, and timestamp lines
        if not line:
            continue
        if line.isdigit():
            continue
        if "-->" in line:
            continue
        lines.append(line)
    return "\n".join(lines)


def process_pending_rows(worksheet):
    """Find pending rows, fetch transcripts, and update the sheet."""
    all_records = worksheet.get_all_records()
    headers = worksheet.row_values(1)

    # Determine column indices (1-based for gspread)
    try:
        status_col = headers.index("Status") + 1
        url_col = headers.index("URL") + 1
        transcript_col = headers.index("Transcript") + 1
    except ValueError as exc:
        sys.exit(f"Required column not found in sheet headers: {exc}")

    processed = 0
    for idx, record in enumerate(all_records):
        if processed >= MAX_ROWS_PER_RUN:
            log.info("Reached max rows per run (%d). Stopping.", MAX_ROWS_PER_RUN)
            break

        status = str(record.get("Status", "")).strip()
        if status not in PENDING_STATUSES:
            continue

        row_num = idx + 2  # +1 for header, +1 for 1-based indexing
        video_url = str(record.get("URL", "")).strip()
        if not video_url:
            log.warning("Row %d: no URL found, skipping", row_num)
            continue

        log.info("Row %d: fetching transcript for %s", row_num, video_url)

        try:
            transcript = fetch_transcript(video_url)
        except Exception:
            log.exception("Row %d: unexpected error fetching transcript", row_num)
            transcript = None

        if transcript:
            # Truncate if needed (Google Sheets cell limit is 50 000 chars)
            if len(transcript) > 50000:
                transcript = transcript[:50000]
            worksheet.update_cell(row_num, transcript_col, transcript)
            worksheet.update_cell(row_num, status_col, "Ready for AI (en)")
            log.info("Row %d: transcript saved (%d chars)", row_num, len(transcript))
        else:
            worksheet.update_cell(row_num, status_col, "Transcript Failed")
            log.warning("Row %d: marked as Transcript Failed", row_num)

        processed += 1

    log.info("Done. Processed %d rows.", processed)


def main():
    log.info("Starting transcript fetcher")
    client = get_gspread_client()
    worksheet = open_sheet(client)
    process_pending_rows(worksheet)


if __name__ == "__main__":
    main()
