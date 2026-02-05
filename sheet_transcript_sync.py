import gspread
from oauth2client.service_account import ServiceAccountCredentials
import time
import os
import random
import json
import subprocess 
import sys 

# ==========================================
# CONFIGURATION
# ==========================================
SHEET_KEY = "1VOSiF48EhsFYupdIHfA48CgEtdE5x9HaQXhr4BskGeU" 
QUEUE_TAB_NAME = "Ingest_Queue"
# Credentials loaded from Colab Secrets — never store keys in code or files
from google.colab import userdata
CREDENTIALS_JSON = userdata.get('GOOGLE')
print("--- SCRIPT STARTED (yt-dlp Version + Korean Support) ---")

# 1. LOAD CREDENTIALS
    try:
        import json
        creds_dict = json.loads(CREDENTIALS_JSON)
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
        client = gspread.authorize(creds)
        print("-> Credentials Loaded Successfully.")
    print("-> Credentials Loaded Successfully.")
except Exception as e:
    print(f"CRITICAL ERROR: Could not load '{CREDENTIALS_FILE}'.")
    print(f"Details: {e}")
    input("Press Enter to exit...")
    exit()

# 2. HELPER FUNCTION (Uses yt-dlp via Python)
def get_transcript_text(video_id):
    url = f"https://www.youtube.com/watch?v={video_id}"
    
    try:
        # UPDATED COMMAND: Added --no-warnings to hide JS errors
        cmd = [
            sys.executable, "-m", "yt_dlp", 
            "--no-warnings",                  # <--- NEW: Hides "JS Runtime" noise
            "--write-auto-sub",
            "--write-sub",
            "--sub-lang", "en,en-US,en-orig,ko,ko-KR", 
            "--skip-download",
            "--output", "temp_subs", 
            url
        ]
        
        # Run the command
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        text_content = ""
        found_file = False
        
        # yt-dlp might save as .vtt, .srv3, or .ttml
        for file in os.listdir("."):
            if file.startswith("temp_subs") and (file.endswith(".vtt") or file.endswith(".srv3") or file.endswith(".ttml")):
                found_file = True
                try:
                    with open(file, "r", encoding="utf-8") as f:
                        lines = f.readlines()
                        # Cleanup timestamps/headers
                        for line in lines:
                            if "-->" not in line and line.strip() != "" and "WEBVTT" not in line and not line.strip().isdigit():
                                text_content += line.strip() + " "
                except Exception as read_error:
                    return f"ERROR: Could not read transcript file ({read_error})"
                
                # Cleanup: Delete the file after reading
                try:
                    os.remove(file)
                except:
                    pass 
                break
        
        if not found_file:
            return "ERROR: No Transcript Found (Checked EN/KO)"
            
        return text_content

    except subprocess.CalledProcessError as e:
        # Improved Error Reporting: Shows exactly what yt-dlp complained about
        error_msg = e.stderr.decode("utf-8").strip() if e.stderr else "Unknown Error"
        
        # If the error message is empty (because we suppressed warnings), it might just mean no subs found
        if not error_msg:
             return "ERROR: yt-dlp Failed (Likely No Subtitles or Video Unavailable)"

        # Simplify common errors for the spreadsheet
        if "Sign in" in error_msg:
            return "ERROR: Age Restricted / Sign-in Required"
        if "Video unavailable" in error_msg:
            return "ERROR: Video Deleted or Private"
        return f"ERROR: yt-dlp Error ({error_msg[:50]}...)"
        
    except Exception as e:
        return f"ERROR: {str(e)}"

# 3. MAIN LOOP
def run_sync():
    print("-> Connecting to Google Sheet...")
    try:
        sheet = client.open_by_key(SHEET_KEY).worksheet(QUEUE_TAB_NAME)
    except Exception as e:
        print(f"CRITICAL ERROR: Could not find sheet/tab.")
        input("Press Enter to exit...")
        exit()

    rows = sheet.get_all_values()
    print(f"-> Found {len(rows)} rows. Scanning...")

    headers = rows[0]
    try:
        id_col = headers.index("Video ID")
        transcript_col = headers.index("Transcript")
        status_col = headers.index("Status")
    except ValueError:
        print("ERROR: Missing columns.")
        return

    processed_count = 0
    
    for i in range(1, len(rows)):
        row_num = i + 1 
        
        if len(rows[i]) <= status_col:
            continue
            
        video_id = rows[i][id_col]
        current_status = rows[i][status_col]
        
        if current_status == "Pending Transcript" or current_status == "Transcript Failed":
            print(f"Processing Row {row_num}: {video_id}...")
            
            text = get_transcript_text(video_id)
            
            # Write to Sheet
            safe_text = text[:49000] 
            sheet.update_cell(row_num, transcript_col + 1, safe_text)
            
            if "ERROR" not in safe_text:
                status = "Ready for AI"
                print(f"   -> {status}")
            else:
                status = "Transcript Failed"
                print(f"   -> {status} ({safe_text})")
            
            sheet.update_cell(row_num, status_col + 1, status)
            processed_count += 1
            
            time.sleep(random.uniform(3, 6))

    print("--- DONE ---")
    input("Press Enter to close...")

if __name__ == "__main__":

    run_sync()
