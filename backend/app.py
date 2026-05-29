import os
import json
import sqlite3
from datetime import datetime
from contextlib import contextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ============================================================================
# DATABASE SETUP
# ============================================================================

DATABASE_FILE = "incidents.db"

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    """Initialize database with required tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Alert log table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alert_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                staff_name TEXT,
                phone TEXT,
                channel TEXT,
                message TEXT,
                status TEXT DEFAULT 'sent'
            )
        """)
        
        # Settings table (NEW)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Layers cache table (NEW - for persistence)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_layers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                layer_name TEXT NOT NULL,
                layer_data TEXT NOT NULL,
                color TEXT DEFAULT '#3388FF',
                opacity REAL DEFAULT 0.7,
                visibility INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()

# ============================================================================
# FASTAPI INITIALIZATION
# ============================================================================

app = FastAPI(
    title="S-Tracker Dashboard",
    description="Smart Security & Tracking Dashboard for Gaza Operations",
    version="2.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize database on startup
@app.on_event("startup")
async def startup():
    init_db()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM alert_log")
        alert_count = cursor.fetchone()["count"]
    
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "alerts_logged": alert_count
    }

# ============================================================================
# SETTINGS API (NEW)
# ============================================================================

@app.get("/api/settings")
def get_all_settings():
    """Fetch all user settings"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM user_settings")
        settings = cursor.fetchall()
    
    result = {}
    for row in settings:
        try:
            result[row["setting_key"]] = json.loads(row["setting_value"])
        except:
            result[row["setting_key"]] = row["setting_value"]
    
    return result

@app.post("/api/settings/{setting_key}")
def save_setting(setting_key: str, value: dict):
    """Save or update a single setting"""
    try:
        setting_value = json.dumps(value.get("value"))
    except:
        setting_value = str(value.get("value"))
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO user_settings (setting_key, setting_value)
            VALUES (?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET 
                setting_value=excluded.setting_value,
                updated_at=CURRENT_TIMESTAMP
        """, (setting_key, setting_value))
        conn.commit()
    
    return {"status": "saved", "key": setting_key}

@app.delete("/api/settings/{setting_key}")
def delete_setting(setting_key: str):
    """Delete a setting"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM user_settings WHERE setting_key = ?", (setting_key,))
        conn.commit()
    
    return {"status": "deleted", "key": setting_key}

# ============================================================================
# ALERTS API
# ============================================================================

@app.post("/api/alert")
def log_alert(data: dict):
    """Log an alert to database"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO alert_log (staff_name, phone, channel, message, status)
            VALUES (?, ?, ?, ?, ?)
        """, (
            data.get("staff_name"),
            data.get("phone"),
            data.get("channel"),
            data.get("message"),
            data.get("status", "sent")
        ))
        conn.commit()
        alert_id = cursor.lastrowid
    
    return {"status": "logged", "alert_id": alert_id}

@app.get("/api/alerts")
def get_alerts(limit: int = 100):
    """Fetch recent alerts"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM alert_log 
            ORDER BY timestamp DESC 
            LIMIT ?
        """, (limit,))
        alerts = [dict(row) for row in cursor.fetchall()]
    
    return alerts

# ============================================================================
# FILE SERVING
# ============================================================================

@app.get("/")
async def serve_index():
    """Serve the main HTML page"""
    return FileResponse("static/index.html")

# ============================================================================
# ERROR HANDLING
# ============================================================================

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)}
    )

# ============================================================================
# RUN SERVER
# ============================================================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
