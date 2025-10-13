# server.py

import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# ========== Configuration ==========

DB_PATH = os.environ.get("DB_PATH", "timers.db")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")

# Interval in seconds to check timers
CHECK_INTERVAL_SECONDS = int(os.environ.get("CHECK_INTERVAL_SECONDS", "15"))

# ========== App Setup ==========

app = FastAPI(title="Builder Timer Notifier")

# Allow CORS so frontend can fetch API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the frontend static files
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# ========== Database Helpers ==========

@app.get("/")
def root():
    return FileResponse("static/index.html")


_db_lock = threading.Lock()

def init_db():
    """Initialize the SQLite DB with the timers table."""
    with _db_lock:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS timers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                end_time TEXT NOT NULL,
                notified INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

def run_query(query: str, args=(), fetch=False):
    """Run a DB query thread-safely."""
    with _db_lock:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        c = conn.cursor()
        c.execute(query, args)
        result = None
        if fetch:
            result = c.fetchall()
        conn.commit()
        conn.close()
        return result

# ========== Data Models ==========

class TimerIn(BaseModel):
    name: str
    duration: str  # e.g. "1d2h30m", "90m", "3h"

# ========== Utility Functions ==========

import re
DURATION_RE = re.compile(r"(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?", re.I)

def parse_duration(s: str) -> timedelta:
    """Parse duration like '1d2h30m' or '90m'."""
    s = s.strip().lower()
    # if it's just number, treat as minutes
    if s.isdigit():
        return timedelta(minutes=int(s))
    m = DURATION_RE.fullmatch(s)
    if not m:
        raise ValueError("Invalid duration format. Use e.g. '1d2h30m' or '90m' or '3h'.")
    days = int(m.group(1)) if m.group(1) else 0
    hours = int(m.group(2)) if m.group(2) else 0
    minutes = int(m.group(3)) if m.group(3) else 0
    return timedelta(days=days, hours=hours, minutes=minutes)

def send_telegram_message(text: str):
    """Send a message via Telegram Bot API."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram not configured. Skipping send.")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text
    }
    try:
        r = requests.post(url, data=data)
        if r.status_code != 200:
            print("Telegram send failed:", r.text)
        return r.status_code == 200
    except Exception as e:
        print("Telegram send exception:", e)
        return False

# ========== API Endpoints ==========

@app.get("/ping")
def ping():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.on_event("startup")
def on_startup():
    init_db()
    # Start background checking thread
    threading.Thread(target=background_checker, daemon=True).start()

@app.get("/timers")
def get_timers():
    """Return list of timers with remaining seconds."""
    rows = run_query("SELECT id, name, end_time, notified FROM timers ORDER BY end_time", fetch=True)
    items = []
    now = datetime.utcnow()
    for (tid, name, end_time_str, notified) in rows:
        end = datetime.strptime(end_time_str, "%Y-%m-%d %H:%M:%S")
        remaining = int((end - now).total_seconds())
        if remaining < 0:
            remaining = 0
        items.append({
            "id": tid,
            "name": name,
            "end_time": end_time_str,
            "notified": bool(notified),
            "remaining_seconds": remaining
        })
    return items

@app.post("/timers")
def add_timer(timer: TimerIn):
    """Add a new timer."""
    try:
        delta = parse_duration(timer.duration)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    end_time = (datetime.utcnow() + delta).strftime("%Y-%m-%d %H:%M:%S")
    run_query("INSERT INTO timers (name, end_time, notified) VALUES (?, ?, 0)", (timer.name, end_time))
    return {"success": True}

@app.delete("/timers/{timer_id}")
def delete_timer(timer_id: int):
    run_query("DELETE FROM timers WHERE id = ?", (timer_id,))
    return {"success": True}

# ========== Background Checker ==========

def background_checker():
    """Background thread: check timers, send Telegram when time is up."""
    print("Background checker started. Interval:", CHECK_INTERVAL_SECONDS, "seconds.")
    while True:
        try:
            rows = run_query("SELECT id, name, end_time, notified FROM timers WHERE notified = 0", fetch=True)
            now = datetime.utcnow()
            for (tid, name, end_time_str, notified) in rows:
                end = datetime.strptime(end_time_str, "%Y-%m-%d %H:%M:%S")
                if now >= end:
                    # msg = f"🔔 Builder ready: {name} (timer ended at {end_time_str} UTC)"
                    msg = f"⏰ '{name}' done!"
                    sent = send_telegram_message(msg)
                    if sent:
                        print("Telegram sent for", name)
                    else:
                        print("Failed to send Telegram for", name)
                    run_query("UPDATE timers SET notified = 1 WHERE id = ?", (tid,))
        except Exception as e:
            print("Error in background_checker:", e)
        time.sleep(CHECK_INTERVAL_SECONDS)
