# server.py
import os
import threading
import time
from datetime import datetime, timedelta
import requests
import re
import json
import io
import base64
from typing import List

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, BigInteger, Boolean
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base
from google.cloud import vision
from google.oauth2 import service_account

# ========== Configuration ==========
DATABASE_URL = os.environ.get("DATABASE_URL")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
CHECK_INTERVAL_SECONDS = int(os.environ.get("CHECK_INTERVAL_SECONDS", 15))
NTFY_TOPIC = os.environ.get("NTFY_TOPIC")
backend_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(backend_dir)
STATIC_PATH = os.path.join(root_dir, 'static')

# ========== SQLAlchemy Setup ==========
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set.")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ========== Database Models ==========
class Timer(Base):
    __tablename__ = "timers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, default="General", nullable=False)
    start_time = Column(BigInteger, nullable=False)
    end_time = Column(BigInteger, nullable=False)
    notified = Column(Boolean, default=False, nullable=False)
    cleared_by_user = Column(Boolean, default=False, nullable=False)
    is_repeating = Column(Boolean, default=False, nullable=False)
    duration_seconds = Column(Integer, nullable=False)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def init_db(): Base.metadata.create_all(bind=engine)

# ========== Pydantic Models ==========
class TimerIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    duration: str = Field(..., min_length=1)
    category: str = "General"
    is_repeating: bool = False

class TimerOut(BaseModel):
    id: int
    name: str
    category: str  # ✅ ADDED
    notified: bool
    remaining_seconds: int
    total_seconds: int
    is_repeating: bool # ✅ ADDED
    duration_seconds: int # ✅ ADDED
    end_time: int

class TimerAdjustIn(BaseModel): 
    timer_ids: List[int]
    minutes: int

# ========== App Setup ==========
app = FastAPI(title="Notifimers")
app.add_middleware(CORSMiddleware, allow_origins=["https://thingdoms.web.app"], allow_methods=["*"], allow_headers=["*"])
# app.mount("/static", StaticFiles(directory=STATIC_PATH, html=True), name="static")

# ========== Google Cloud Vision Setup ==========
GOOGLE_CREDENTIALS_BASE64 = os.environ.get("GOOGLE_CREDENTIALS_BASE64")
vision_client = None
if GOOGLE_CREDENTIALS_BASE64:
    try:
        # Decode the Base64 string back to the original JSON string
        credentials_json = base64.b64decode(GOOGLE_CREDENTIALS_BASE64).decode('utf-8')
        credentials_info = json.loads(credentials_json)
        
        google_credentials = service_account.Credentials.from_service_account_info(credentials_info)
        vision_client = vision.ImageAnnotatorClient(credentials=google_credentials)
        print("Google Cloud credentials loaded successfully.")
    except Exception as e:
        print(f"ERROR: Could not load/decode Google credentials: {e}")
else:
    print("WARNING: GOOGLE_CREDENTIALS_BASE64 not found. OCR will not work.")


# ========== Utility Functions ==========
def reconstruct_text_by_lines(annotations):
    lines = {}
    for annotation in annotations[1:]:
        avg_y = sum(v.y for v in annotation.bounding_poly.vertices) / 4
        found_line = False
        for line_y, line in lines.items():
            if abs(line_y - avg_y) < 15:
                line.append(annotation); found_line = True; break
        if not found_line: lines[avg_y] = [annotation]
    reconstructed_lines = []
    for line_y in sorted(lines.keys()):
        lines[line_y].sort(key=lambda a: a.bounding_poly.vertices[0].x)
        reconstructed_lines.append(" ".join(a.description for a in lines[line_y]))
    return "\n".join(reconstructed_lines)


def parse_duration(s: str) -> timedelta:
    s = s.strip().lower().replace('-', ' ').replace(',', ' ')
    if s.isdigit(): return timedelta(minutes=int(s))
    days, hours, minutes = 0, 0, 0
    d_match = re.search(r"(\d+)\s*d", s); h_match = re.search(r"(\d+)\s*h", s); m_match = re.search(r"(\d+)\s*m", s)
    if d_match: days = int(d_match.group(1))
    if h_match: hours = int(h_match.group(1))
    if m_match: minutes = int(m_match.group(1))
    if not d_match and not h_match and not m_match: raise ValueError("Invalid duration format")
    return timedelta(days=days, hours=hours, minutes=minutes)

def parse_ocr_text_and_create_timers(text_annotations, db: Session):
    timers_found = []
    
    # 1. Isolate the relevant annotations between our start and end markers
    try:
        full_text_lower = text_annotations[0].description.lower()
        start_marker = "upgrades in progress"
        end_marker = "suggested upgrades"
        
        start_pos = full_text_lower.find(start_marker)
        end_pos = full_text_lower.find(end_marker, start_pos)

        if start_pos == -1 or end_pos == -1:
             raise ValueError("Markers not found")

        start_y = 0; end_y = float('inf')
        for text in text_annotations[1:]:
            if start_marker in text.description.lower():
                start_y = text.bounding_poly.vertices[3].y
            if end_marker in text.description.lower():
                end_y = text.bounding_poly.vertices[0].y
        
        relevant_annotations = [
            ann for ann in text_annotations[1:] 
            if (ann.bounding_poly.vertices[0].y > start_y and 
                ann.bounding_poly.vertices[3].y < end_y)
        ]
    except (ValueError, IndexError):
        print("Could not find markers, parsing all annotations.")
        relevant_annotations = text_annotations[1:]

    # 2. Group annotations into lines
    lines = {}
    for ann in relevant_annotations:
        avg_y = sum(v.y for v in ann.bounding_poly.vertices) / 4
        found = False
        for line_y, line_anns in lines.items():
            if abs(line_y - avg_y) < 15:
                line_anns.append(ann); found = True; break
        if not found: lines[avg_y] = [ann]

    # 3. For each line, separate into Name (left) and Duration (right) columns
    if not lines: return []
    
    all_x = [v.x for ann in relevant_annotations for v in ann.bounding_poly.vertices]
    center_x = (min(all_x) + max(all_x)) / 2 if all_x else 0

    for line_y in sorted(lines.keys()):
        line_anns = lines[line_y]
        line_anns.sort(key=lambda a: a.bounding_poly.vertices[0].x)
        
        name_parts = [ann.description for ann in line_anns if ann.bounding_poly.vertices[0].x < center_x]
        duration_parts = [ann.description for ann in line_anns if ann.bounding_poly.vertices[0].x >= center_x]

        name = " ".join(name_parts).strip()
        duration_str = " ".join(duration_parts).strip()

        # ✅ NEW, SMARTER FIX: Replaces 'S' with '5' only when it's followed by d, h, or m.
        duration_str = re.sub(r'S([dhm])', r'5\1', duration_str, flags=re.IGNORECASE)

        if name and any(c in duration_str.lower() for c in "dhm"):
            print(f"OCR Found: Name='{name}', Duration='{duration_str}'")
            try:
                delta = parse_duration(duration_str)
                start_time_dt = datetime.utcnow()
                end_time_dt = start_time_dt + delta
                new_timer = Timer(name=name, start_time=int(start_time_dt.timestamp()), end_time=int(end_time_dt.timestamp()))
                db.add(new_timer)
                timers_found.append(name)
            except ValueError:
                print(f"Could not parse duration '{duration_str}' for '{name}'")

    if timers_found:
        db.commit()
    return timers_found
    
def send_telegram_message(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID: return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        r = requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "text": text}, timeout=10)
        return r.status_code == 200
    except Exception: return False

def send_ntfy_alarm(title: str):
    if not NTFY_TOPIC: return False
    try:
        requests.post(f"https://ntfy.sh/{NTFY_TOPIC}", data=f"Your timer for '{title}' is complete!", headers={"Title": "Timer Finished!", "Priority": "max", "Tags": "alarm_clock"})
        return True
    except Exception: return False

# ========== API Endpoints ==========
@app.on_event("startup")
def on_startup():
    init_db()
    threading.Thread(target=background_checker, daemon=True).start()

# @app.get("/", include_in_schema=False)
# def root(): return FileResponse(os.path.join(STATIC_PATH, "index.html"))

@app.get("/ping")
def ping(): return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.get("/timers", response_model=list[TimerOut])
def get_timers(db: Session = Depends(get_db)):
    timers_db = db.query(Timer).filter(Timer.cleared_by_user == False).order_by(Timer.end_time).all()
    now_ts = int(datetime.utcnow().timestamp())
    response_items = []
    for t in timers_db:
        remaining = t.end_time - now_ts
        # ✅ UPDATED: Include new fields in the API response
        response_items.append(TimerOut(
            id=t.id, 
            name=t.name, 
            category=t.category,
            notified=t.notified, 
            remaining_seconds=max(0, remaining), 
            total_seconds=t.duration_seconds,
            is_repeating=t.is_repeating,
            duration_seconds=t.duration_seconds,
            end_time=t.end_time
        ))
    return response_items

@app.post("/timers", response_model=TimerOut)
def add_timer(timer_in: TimerIn, db: Session = Depends(get_db)):
    try: 
        delta = parse_duration(timer_in.duration)
    except ValueError as e: 
        raise HTTPException(status_code=400, detail=str(e))
    
    start_time_dt = datetime.utcnow()
    end_time_dt = start_time_dt + delta
    duration_seconds = int(delta.total_seconds())

    # ✅ UPDATED: Create timer with all new fields
    new_timer = Timer(
        name=timer_in.name,
        category=timer_in.category if timer_in.category else "General",
        start_time=int(start_time_dt.timestamp()),
        end_time=int(end_time_dt.timestamp()),
        is_repeating=timer_in.is_repeating,
        duration_seconds=duration_seconds
    )
    db.add(new_timer)
    db.commit()
    db.refresh(new_timer)

    # ✅ UPDATED: Return all necessary fields in the response
    return TimerOut(
        id=new_timer.id, 
        name=new_timer.name, 
        category=new_timer.category,
        notified=new_timer.notified, 
        remaining_seconds=max(0, new_timer.end_time - new_timer.start_time), 
        total_seconds=new_timer.duration_seconds,
        is_repeating=new_timer.is_repeating,
        duration_seconds=new_timer.duration_seconds,
        end_time=new_timer.end_time
    )

@app.delete("/timers/{timer_id}", status_code=204)
def delete_timer(timer_id: int, db: Session = Depends(get_db)):
    timer_to_delete = db.query(Timer).filter(Timer.id == timer_id).first()
    if not timer_to_delete: raise HTTPException(status_code=404, detail="Timer not found")
    db.delete(timer_to_delete); db.commit()
    return Response(status_code=204)

@app.post("/timers/{timer_id}/clear", status_code=204)
def clear_timer(timer_id: int, db: Session = Depends(get_db)):
    timer_to_clear = db.query(Timer).filter(Timer.id == timer_id).first()
    if not timer_to_clear: raise HTTPException(status_code=404, detail="Timer not found")
    timer_to_clear.cleared_by_user = True; db.commit()
    return Response(status_code=204)

@app.post("/timers/adjust-time", status_code=204)
def adjust_timers_time(data: TimerAdjustIn, db: Session = Depends(get_db)):
    if not data.timer_ids:
        return Response(status_code=204)

    seconds_to_adjust = data.minutes * 60
    
    timers_to_update = db.query(Timer).filter(Timer.id.in_(data.timer_ids)).all()
    
    for timer in timers_to_update:
        if timer.end_time > int(datetime.utcnow().timestamp()):
            # This single line now handles both adding and subtracting
            timer.end_time += seconds_to_adjust
    
    db.commit()
    return Response(status_code=204)

@app.post("/upload-screenshot")
async def upload_screenshot(db: Session = Depends(get_db), file: UploadFile = File(...)):
    if not vision_client: raise HTTPException(status_code=500, detail="OCR service is not configured.")
    print(f"Received file for OCR: {file.filename}")
    contents = await file.read(); image = vision.Image(content=contents)
    response = vision_client.text_detection(image=image)
    texts = response.text_annotations
    if response.error.message: raise HTTPException(status_code=500, detail=f"Google Vision API Error: {response.error.message}")
    if texts:
        full_text = reconstruct_text_by_lines(texts)
        print("---- OCR Full Text ----\n" + full_text + "\n-----------------------")
        timers_created = parse_ocr_text_and_create_timers(texts, db)
        return {"message": f"Successfully created {len(timers_created)} timers.", "timers": timers_created}
    else: return {"message": "No text found in the image."}

# ========== Background Checker ==========
def background_checker():
    while True:
        db = SessionLocal()
        try:
            now_ts = int(datetime.utcnow().timestamp())
            timers_to_notify = db.query(Timer).filter(Timer.notified == False, Timer.end_time <= now_ts).all()
            for timer in timers_to_notify:
                telegram_msg = f"⏰ '{timer.name}' DONE!".upper()
                sent_telegram = send_telegram_message(telegram_msg)
                sent_alarm = send_ntfy_alarm(timer.name)
                if sent_telegram or sent_alarm:
                    timer.notified = True 
                    if timer.is_repeating:
                    new_start_dt = datetime.utcnow()
                    new_end_dt = new_start_dt + timedelta(seconds=timer.duration_seconds)
                    restarted_timer = Timer(
                        name=timer.name,
                        category=timer.category,
                        start_time=int(new_start_dt.timestamp()),
                        end_time=int(new_end_dt.timestamp()),
                        is_repeating=True,
                        duration_seconds=timer.duration_seconds
                    )
                    db.add(restarted_timer)
                    db.commit()
        except Exception as e:
            print(f"Error in background_checker: {e}"); db.rollback()
        finally: db.close()
        time.sleep(CHECK_INTERVAL_SECONDS)
        
