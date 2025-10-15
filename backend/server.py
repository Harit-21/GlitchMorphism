# server.py
import os
import threading
import time
from datetime import datetime, timedelta
import requests
import re
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, BigInteger, Boolean
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base

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

# ========== Database Models (SQLAlchemy ORM) ==========
class Timer(Base):
    __tablename__ = "timers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    start_time = Column(BigInteger, nullable=False)
    end_time = Column(BigInteger, nullable=False)
    notified = Column(Boolean, default=False, nullable=False)
    cleared_by_user = Column(Boolean, default=False, nullable=False) # ✅ ADDED THIS NEW COLUMN

# ========== Dependency to get a DB session ==========
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)

# ========== Pydantic Models ==========
class TimerIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    duration: str = Field(..., min_length=1)

class TimerOut(BaseModel):
    id: int
    name: str
    notified: bool
    remaining_seconds: int
    total_seconds: int

# ========== App Setup ==========
app = FastAPI(title="Notifimers")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=STATIC_PATH, html=True), name="static")

# ========== Utility Functions ==========
DURATION_RE = re.compile(r"(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?", re.I)
def parse_duration(s: str) -> timedelta:
    s = s.strip().lower()
    if s.isdigit(): return timedelta(minutes=int(s))
    m = DURATION_RE.fullmatch(s)
    if not m: raise ValueError("Invalid duration format")
    days = int(m.group(1)) if m.group(1) else 0
    hours = int(m.group(2)) if m.group(2) else 0
    minutes = int(m.group(3)) if m.group(3) else 0
    return timedelta(days=days, hours=hours, minutes=minutes)

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

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(os.path.join(STATIC_PATH, "index.html"))


@app.get("/ping")
def ping():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.get("/timers", response_model=list[TimerOut])
def get_timers(db: Session = Depends(get_db)):
    timers_db = db.query(Timer).filter(Timer.cleared_by_user == False).order_by(Timer.end_time).all()
    now_ts = int(datetime.utcnow().timestamp())
    
    response_items = []
    for t in timers_db:
        remaining = t.end_time - now_ts
        total = t.end_time - t.start_time
        response_items.append(
            TimerOut(id=t.id, name=t.name, notified=t.notified, remaining_seconds=max(0, remaining), total_seconds=total)
        )
    return response_items

@app.post("/timers", response_model=TimerOut)
def add_timer(timer_in: TimerIn, db: Session = Depends(get_db)):
    try: delta = parse_duration(timer_in.duration)
    except ValueError as e: raise HTTPException(status_code=400, detail=str(e))
    start_time_dt = datetime.utcnow()
    end_time_dt = start_time_dt + delta
    start_time_ts = int(start_time_dt.timestamp())
    end_time_ts = int(end_time_dt.timestamp())
    new_timer = Timer(name=timer_in.name, start_time=start_time_ts, end_time=end_time_ts)
    db.add(new_timer)
    db.commit()
    db.refresh(new_timer)
    return TimerOut(id=new_timer.id, name=new_timer.name, notified=new_timer.notified, remaining_seconds=max(0, new_timer.end_time - start_time_ts), total_seconds=(new_timer.end_time - new_timer.start_time))

@app.delete("/timers/{timer_id}", status_code=204)
def delete_timer(timer_id: int, db: Session = Depends(get_db)):
    timer_to_delete = db.query(Timer).filter(Timer.id == timer_id).first()
    if not timer_to_delete: raise HTTPException(status_code=404, detail="Timer not found")
    db.delete(timer_to_delete)
    db.commit()
    return Response(status_code=204)

@app.post("/timers/{timer_id}/clear", status_code=204)
def clear_timer(timer_id: int, db: Session = Depends(get_db)):
    timer_to_clear = db.query(Timer).filter(Timer.id == timer_id).first()
    if not timer_to_clear: raise HTTPException(status_code=404, detail="Timer not found")
    timer_to_clear.cleared_by_user = True
    db.commit()
    return Response(status_code=204)

@app.post("/upload-screenshot")
async def upload_screenshot(db: Session = Depends(get_db), file: UploadFile = File(...)):
    """
    Receives a screenshot, but does not process it yet.
    This is a placeholder for the real OCR logic.
    """
    print(f"Received file: {file.filename}, content type: {file.content_type}")
    
    # In the next step, we will add the Google Cloud Vision API logic here.
    
    return {"message": f"File '{file.filename}' received. OCR processing not yet implemented."}


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
                    db.commit()
        except Exception as e:
            print(f"Error in background_checker: {e}")
            db.rollback()
        finally:
            db.close()
        time.sleep(CHECK_INTERVAL_SECONDS)
