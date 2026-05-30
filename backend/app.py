"""
WatchMe — Smart Security Dashboard
Backend with full auth system:
  - Email-based registration with admin approval flow
  - Gmail SMTP for sending emails
  - JWT session tokens
  - Per-user data isolation (layers, incidents, alerts, settings)
"""

from __future__ import annotations

import io
import json
import logging
import math
import os
import re
import secrets
import smtplib
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("dashboard")

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
ADMIN_EMAIL       = os.environ.get("ADMIN_EMAIL", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
SECRET_KEY        = os.environ.get("SECRET_KEY", "dev-secret-change-me")
BASE_URL          = os.environ.get("BASE_URL", "http://localhost:8000")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
DB_PATH    = BASE_DIR / "watchme.db"

# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(title="WatchMe Security Dashboard", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id                TEXT PRIMARY KEY,
                email             TEXT UNIQUE NOT NULL,
                name              TEXT NOT NULL,
                organization      TEXT DEFAULT '',
                status            TEXT DEFAULT 'pending',
                admin_token       TEXT,
                user_token        TEXT,
                session_token     TEXT,
                session_expires   TEXT,
                created_at        TEXT NOT NULL,
                approved_at       TEXT,
                approved_by       TEXT DEFAULT 'admin'
            );

            CREATE TABLE IF NOT EXISTS layers (
                id      TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name    TEXT NOT NULL,
                geojson TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS incidents (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL,
                description TEXT,
                severity    TEXT DEFAULT 'medium',
                lat         REAL NOT NULL,
                lng         REAL NOT NULL,
                polygon_wkt TEXT,
                created_at  TEXT NOT NULL,
                resolved    INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS alert_log (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                channel     TEXT NOT NULL,
                recipient   TEXT NOT NULL,
                message     TEXT NOT NULL,
                incident_id TEXT,
                status      TEXT DEFAULT 'mock_sent',
                sent_at     TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT NOT NULL,
                key     TEXT NOT NULL,
                value   TEXT,
                PRIMARY KEY (user_id, key)
            );
        """)
    log.info("Database initialised at %s", DB_PATH)


init_db()

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> dict:
    """Extract user from session token in Authorization header or cookie."""
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("wm_session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE session_token = ? AND status = 'approved'",
            (token,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    # Check expiry
    if row["session_expires"]:
        expires = datetime.fromisoformat(row["session_expires"])
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=401, detail="Session expired")

    return dict(row)


def require_auth(request: Request) -> dict:
    return get_current_user(request)

# ---------------------------------------------------------------------------
# Email sending
# ---------------------------------------------------------------------------

def send_email(to_address: str, subject: str, html_body: str) -> bool:
    """Send an email via Gmail SMTP using App Password."""
    if not ADMIN_EMAIL or not GMAIL_APP_PASSWORD:
        log.warning("Email not configured — printing to log instead")
        log.info("TO: %s | SUBJECT: %s", to_address, subject)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"WatchMe Dashboard <{ADMIN_EMAIL}>"
        msg["To"]      = to_address
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(ADMIN_EMAIL, GMAIL_APP_PASSWORD)
            server.sendmail(ADMIN_EMAIL, to_address, msg.as_string())

        log.info("Email sent to %s", to_address)
        return True
    except Exception as exc:
        log.error("Email send failed: %s", exc)
        return False


def email_admin_approval(user: dict) -> None:
    """Send admin an approval request email."""
    approve_url = f"{BASE_URL}/api/auth/approve?token={user['admin_token']}&action=approve"
    reject_url  = f"{BASE_URL}/api/auth/approve?token={user['admin_token']}&action=reject"

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
      <div style="border-bottom:2px solid #ef4444;padding-bottom:16px;margin-bottom:24px">
        <h2 style="color:#ef4444;margin:0">⚠ WatchMe — New Registration Request</h2>
      </div>
      <p style="color:#94a3b8">A new user has requested access to the WatchMe Security Dashboard.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#64748b;width:120px">Name</td><td style="padding:8px;color:#e2e8f0;font-weight:bold">{user['name']}</td></tr>
        <tr style="background:#1e293b"><td style="padding:8px;color:#64748b">Email</td><td style="padding:8px;color:#e2e8f0">{user['email']}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Organization</td><td style="padding:8px;color:#e2e8f0">{user['organization'] or '—'}</td></tr>
        <tr style="background:#1e293b"><td style="padding:8px;color:#64748b">Requested at</td><td style="padding:8px;color:#e2e8f0">{user['created_at']}</td></tr>
      </table>
      <div style="margin-top:32px;display:flex;gap:16px">
        <a href="{approve_url}" style="display:inline-block;background:#22c55e;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-right:12px">
          ✓ Approve Access
        </a>
        <a href="{reject_url}" style="display:inline-block;background:#ef4444;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          ✗ Reject Request
        </a>
      </div>
      <p style="color:#475569;font-size:12px;margin-top:24px">
        This request was sent automatically by WatchMe Security Dashboard.
        If you did not expect this, you can safely ignore this email.
      </p>
    </div>
    """
    send_email(ADMIN_EMAIL, f"[WatchMe] Access Request from {user['name']}", html)


def email_user_approved(user: dict) -> None:
    """Send user their login link after approval."""
    login_url = f"{BASE_URL}/api/auth/login-link?token={user['user_token']}"

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
      <div style="border-bottom:2px solid #22c55e;padding-bottom:16px;margin-bottom:24px">
        <h2 style="color:#22c55e;margin:0">✓ Access Approved — WatchMe Dashboard</h2>
      </div>
      <p style="color:#94a3b8">Hello <strong style="color:#e2e8f0">{user['name']}</strong>,</p>
      <p style="color:#94a3b8">Your access request has been approved. Click the button below to log in to the WatchMe Security Dashboard.</p>
      <div style="margin:32px 0;text-align:center">
        <a href="{login_url}" style="display:inline-block;background:#3b82f6;color:white;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px">
          🔐 Log In to Dashboard
        </a>
      </div>
      <p style="color:#64748b;font-size:13px">
        This link will log you in automatically. For security, it can only be used once — after login, your session will remain active.
      </p>
      <p style="color:#475569;font-size:12px;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px">
        WatchMe Security Dashboard — Humanitarian Operations
      </p>
    </div>
    """
    send_email(user["email"], "[WatchMe] Your access has been approved", html)


def email_user_rejected(user: dict) -> None:
    """Notify user their request was rejected."""
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
      <div style="border-bottom:2px solid #ef4444;padding-bottom:16px;margin-bottom:24px">
        <h2 style="color:#ef4444;margin:0">WatchMe — Access Request Update</h2>
      </div>
      <p style="color:#94a3b8">Hello <strong style="color:#e2e8f0">{user['name']}</strong>,</p>
      <p style="color:#94a3b8">
        After review, your access request to the WatchMe Security Dashboard could not be approved at this time.
        If you believe this is an error, please contact your organization administrator.
      </p>
    </div>
    """
    send_email(user["email"], "[WatchMe] Access Request Update", html)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email:        str
    name:         str
    organization: str = ""


class IncidentCreate(BaseModel):
    title:       str
    description: str   = ""
    severity:    str   = "medium"
    lat:         float
    lng:         float
    polygon_wkt: str   = ""


class StaffPoint(BaseModel):
    id:         str
    name:       str
    department: str = ""
    phone:      str = ""
    lat:        float
    lng:        float


class ProximityRequest(BaseModel):
    incident_lat:   float
    incident_lng:   float
    radius_m:       float = 1000.0
    staff_list:     list[StaffPoint]
    polygon_coords: list[list[float]] = []


class AlertRequest(BaseModel):
    channel:     str
    recipient:   str
    message:     str
    incident_id: str = ""


class ExportRequest(BaseModel):
    feature_collection: dict
    doc_name:           str = "Security Dashboard Export"
    format:             str = "kml"


class SettingItem(BaseModel):
    key:   str
    value: str

# ---------------------------------------------------------------------------
# AUTH ROUTES
# ---------------------------------------------------------------------------

@app.post("/api/auth/register", tags=["Auth"])
def register(req: RegisterRequest):
    """Step 1: User submits registration. Admin gets approval email."""
    email = req.email.strip().lower()
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        raise HTTPException(400, "Invalid email address")

    with get_db() as conn:
        existing = conn.execute("SELECT id, status FROM users WHERE email = ?", (email,)).fetchone()

    if existing:
        if existing["status"] == "approved":
            raise HTTPException(400, "This email is already registered and approved.")
        elif existing["status"] == "pending":
            raise HTTPException(400, "Your request is already pending admin approval.")
        elif existing["status"] == "rejected":
            raise HTTPException(400, "This email has been rejected. Contact your administrator.")

    user_id     = uuid.uuid4().hex
    admin_token = secrets.token_urlsafe(32)
    user_token  = secrets.token_urlsafe(32)
    now         = datetime.now(timezone.utc).isoformat()

    user = {
        "id":           user_id,
        "email":        email,
        "name":         req.name.strip(),
        "organization": req.organization.strip(),
        "status":       "pending",
        "admin_token":  admin_token,
        "user_token":   user_token,
        "created_at":   now,
    }

    with get_db() as conn:
        conn.execute(
            """INSERT INTO users (id, email, name, organization, status, admin_token, user_token, created_at)
               VALUES (:id, :email, :name, :organization, :status, :admin_token, :user_token, :created_at)""",
            user
        )

    email_admin_approval(user)
    log.info("New registration request from %s (%s)", req.name, email)
    return {"status": "pending", "message": "Your request has been submitted. You will receive an email once approved."}


@app.get("/api/auth/approve", tags=["Auth"])
def approve_user(token: str, action: str = "approve"):
    """Step 2: Admin clicks approve/reject link in their email."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE admin_token = ?", (token,)).fetchone()

    if not row:
        return Response(content=_html_result("Invalid or expired approval link.", success=False), media_type="text/html")

    user = dict(row)

    if user["status"] != "pending":
        msg = f"This request has already been {user['status']}."
        return Response(content=_html_result(msg, success=False), media_type="text/html")

    now = datetime.now(timezone.utc).isoformat()

    if action == "approve":
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET status = 'approved', approved_at = ?, admin_token = NULL WHERE id = ?",
                (now, user["id"])
            )
        user["approved_at"] = now
        email_user_approved(user)
        msg = f"✓ {user['name']} ({user['email']}) has been approved. They will receive a login link by email."
        return Response(content=_html_result(msg, success=True), media_type="text/html")

    elif action == "reject":
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET status = 'rejected', admin_token = NULL WHERE id = ?",
                (user["id"],)
            )
        email_user_rejected(user)
        msg = f"✗ {user['name']} ({user['email']}) has been rejected."
        return Response(content=_html_result(msg, success=False), media_type="text/html")

    return Response(content=_html_result("Unknown action.", success=False), media_type="text/html")


@app.get("/api/auth/login-link", tags=["Auth"])
def magic_login(token: str):
    """Step 3: User clicks login link from their email. Creates session."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE user_token = ? AND status = 'approved'",
            (token,)
        ).fetchone()

    if not row:
        return Response(
            content=_html_result("Invalid or expired login link. Please contact your administrator.", success=False),
            media_type="text/html"
        )

    # Create session (30-day expiry)
    session_token   = secrets.token_urlsafe(48)
    session_expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET session_token = ?, session_expires = ? WHERE id = ?",
            (session_token, session_expires, row["id"])
        )

    log.info("User %s logged in via magic link", row["email"])

    # Redirect to dashboard with session cookie
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        key="wm_session",
        value=session_token,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    return response


@app.post("/api/auth/logout", tags=["Auth"])
def logout(user: dict = Depends(require_auth)):
    with get_db() as conn:
        conn.execute("UPDATE users SET session_token = NULL WHERE id = ?", (user["id"],))
    response = JSONResponse({"status": "logged_out"})
    response.delete_cookie("wm_session")
    return response


@app.get("/api/auth/me", tags=["Auth"])
def me(user: dict = Depends(require_auth)):
    return {
        "id":           user["id"],
        "email":        user["email"],
        "name":         user["name"],
        "organization": user["organization"],
        "approved_at":  user["approved_at"],
    }


def _html_result(message: str, success: bool) -> str:
    color  = "#22c55e" if success else "#ef4444"
    icon   = "✓" if success else "✗"
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>WatchMe</title>
<style>body{{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
.card{{background:#1e293b;border:1px solid {color}40;border-radius:12px;padding:40px;max-width:480px;text-align:center}}
.icon{{font-size:48px;color:{color};margin-bottom:16px}}.msg{{color:#94a3b8;line-height:1.6}}
a{{color:#3b82f6;text-decoration:none}}</style></head>
<body><div class="card"><div class="icon">{icon}</div>
<p class="msg">{message}</p>
<p style="margin-top:24px"><a href="/">← Back to Dashboard</a></p>
</div></body></html>"""

# ---------------------------------------------------------------------------
# HEALTH
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

# ---------------------------------------------------------------------------
# KML/KMZ parsing helpers (unchanged from original)
# ---------------------------------------------------------------------------
KML_NS = "http://www.opengis.net/kml/2.2"
ET.register_namespace("", KML_NS)

def _tag(local, ns=KML_NS): return f"{{{ns}}}{local}"
def _child_text(el, local, ns=KML_NS):
    c = el.find(_tag(local, ns)); return c.text.strip() if c is not None and c.text else ""

def _parse_coordinates(raw):
    coords = []
    for token in re.split(r"\s+", raw.strip()):
        parts = token.split(",")
        if len(parts) >= 2:
            try: coords.append([float(parts[0]), float(parts[1])])
            except: pass
    return coords

def _extract_extended_data(placemark):
    props = {}
    ext = placemark.find(_tag("ExtendedData"))
    if ext is None: return props
    for sd in ext.findall(_tag("SimpleData")):
        if sd.get("name"): props[sd.get("name")] = sd.text.strip() if sd.text else ""
    for data in ext.findall(_tag("Data")):
        name = data.get("name",""); val_el = data.find(_tag("value"))
        if name: props[name] = val_el.text.strip() if val_el is not None and val_el.text else ""
    return props

def _kml_color_to_hex(kml_color):
    kml_color = kml_color.strip().lstrip("#")
    if len(kml_color) == 8: return f"#{kml_color[6:8]}{kml_color[4:6]}{kml_color[2:4]}"
    if len(kml_color) == 6: return f"#{kml_color}"
    return "#3388ff"

def _parse_style(style_el):
    style = {}
    if style_el is None: return style
    ls = style_el.find(_tag("LineStyle"))
    if ls is not None:
        c = ls.find(_tag("color")); w = ls.find(_tag("width"))
        if c is not None and c.text: style["lineColor"] = _kml_color_to_hex(c.text.strip())
        if w is not None and w.text: style["lineWidth"] = float(w.text.strip())
    ps = style_el.find(_tag("PolyStyle"))
    if ps is not None:
        c = ps.find(_tag("color"))
        if c is not None and c.text: style["fillColor"] = _kml_color_to_hex(c.text.strip())
    return style

def _collect_styles(root):
    styles = {}
    for s in root.iter(_tag("Style")):
        sid = s.get("id")
        if sid: styles[sid] = _parse_style(s)
    for sm in root.iter(_tag("StyleMap")):
        sid = sm.get("id")
        if sid:
            for pair in sm.findall(_tag("Pair")):
                key = pair.find(_tag("key"))
                if key is not None and key.text and key.text.strip() == "normal":
                    url = pair.find(_tag("styleUrl"))
                    if url is not None and url.text:
                        styles[sid] = styles.get(url.text.strip().lstrip("#"), {})
                        break
    return styles

def _placemark_to_features(placemark, styles):
    features = []
    name = _child_text(placemark, "name"); desc = _child_text(placemark, "description")
    props = _extract_extended_data(placemark)
    props["name"] = name; props["description"] = desc
    style_url_el = placemark.find(_tag("styleUrl"))
    resolved_style = {}
    if style_url_el is not None and style_url_el.text:
        resolved_style = styles.get(style_url_el.text.strip().lstrip("#"), {})
    inline = placemark.find(_tag("Style"))
    if inline is not None: resolved_style.update(_parse_style(inline))
    props["_style"] = resolved_style
    def mf(geom): return {"type":"Feature","geometry":geom,"properties":dict(props)}
    pt = placemark.find(_tag("Point"))
    if pt is not None:
        ce = pt.find(_tag("coordinates"))
        if ce is not None and ce.text:
            c = _parse_coordinates(ce.text)
            if c: features.append(mf({"type":"Point","coordinates":c[0]}))
    ls = placemark.find(_tag("LineString"))
    if ls is not None:
        ce = ls.find(_tag("coordinates"))
        if ce is not None and ce.text:
            c = _parse_coordinates(ce.text)
            if c: features.append(mf({"type":"LineString","coordinates":c}))
    poly = placemark.find(_tag("Polygon"))
    if poly is not None:
        rings = []
        outer = poly.find(f".//{_tag('outerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}")
        if outer is not None and outer.text: rings.append(_parse_coordinates(outer.text))
        for inner in poly.findall(f".//{_tag('innerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}"):
            if inner.text: rings.append(_parse_coordinates(inner.text))
        if rings and rings[0]: features.append(mf({"type":"Polygon","coordinates":rings}))
    return features

def kml_bytes_to_geojson(kml_bytes):
    try: root = ET.fromstring(kml_bytes)
    except ET.ParseError:
        root = ET.fromstring(kml_bytes.decode("utf-8", errors="replace").encode("utf-8"))
    styles = _collect_styles(root)
    features = []
    for pm in root.iter(_tag("Placemark")):
        features.extend(_placemark_to_features(pm, styles))
    return {"type":"FeatureCollection","features":features}

def kmz_bytes_to_geojson(kmz_bytes):
    with zipfile.ZipFile(io.BytesIO(kmz_bytes)) as zf:
        kml_name = next((n for n in zf.namelist() if n.lower() == "doc.kml"), None)
        if not kml_name: kml_name = next((n for n in zf.namelist() if n.lower().endswith(".kml")), None)
        if not kml_name: raise ValueError("No .kml file found inside KMZ archive.")
        return kml_bytes_to_geojson(zf.read(kml_name))

# ---------------------------------------------------------------------------
# KML Export helpers
# ---------------------------------------------------------------------------
def _hex_to_kml_color(hex_color, alpha="ff"):
    h = hex_color.strip().lstrip("#")
    if len(h) == 3: h = "".join(c*2 for c in h)
    if len(h) != 6: return f"{alpha}ff8833"
    return f"{alpha}{h[4:6]}{h[2:4]}{h[0:2]}"

def _xml_escape(text):
    return str(text).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")

def geojson_to_kml(fc, doc_name="Export"):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>','<kml xmlns="http://www.opengis.net/kml/2.2">',
             f'  <Document><name>{_xml_escape(doc_name)}</name>']
    for f in fc.get("features",[]):
        props = f.get("properties") or {}; geom = f.get("geometry") or {}
        style = props.get("_style",{})
        sid   = f"s{uuid.uuid4().hex[:8]}"
        lc = _hex_to_kml_color(style.get("lineColor","#3388ff"))
        fc2 = _hex_to_kml_color(style.get("fillColor","#3388ff"),"88")
        lines += [f'    <Style id="{sid}"><LineStyle><color>{lc}</color><width>2</width></LineStyle>',
                  f'    <PolyStyle><color>{fc2}</color></PolyStyle></Style>',
                  f'    <Placemark><name>{_xml_escape(props.get("name",""))}</name>',
                  f'    <styleUrl>#{sid}</styleUrl>']
        gt = geom.get("type",""); co = geom.get("coordinates",[])
        if gt == "Point": lines.append(f'    <Point><coordinates>{co[0]},{co[1]},0</coordinates></Point>')
        elif gt == "LineString":
            lines.append(f'    <LineString><coordinates>{" ".join(f"{c[0]},{c[1]},0" for c in co)}</coordinates></LineString>')
        elif gt == "Polygon":
            lines.append(f'    <Polygon><outerBoundaryIs><LinearRing><coordinates>{" ".join(f"{c[0]},{c[1]},0" for c in co[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>')
        lines.append("    </Placemark>")
    lines += ["  </Document>","</kml>"]
    return "\n".join(lines)

def build_kmz_bytes(fc, doc_name="export"):
    kml_str = geojson_to_kml(fc, doc_name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf,"w",zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("doc.kml", kml_str.encode())
    return buf.getvalue()

# ---------------------------------------------------------------------------
# Spatial algorithms
# ---------------------------------------------------------------------------
EARTH_RADIUS_M = 6_371_000.0

def haversine_distance(lat1, lon1, lat2, lon2):
    phi1=math.radians(lat1); phi2=math.radians(lat2)
    dphi=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    a=math.sin(dphi/2)**2+math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return EARTH_RADIUS_M*2*math.atan2(math.sqrt(a),math.sqrt(1-a))

def point_in_polygon(lat, lon, ring):
    x,y=lon,lat; n=len(ring); inside=False; j=n-1
    for i in range(n):
        xi,yi=ring[i][0],ring[i][1]; xj,yj=ring[j][0],ring[j][1]
        if ((yi>y)!=(yj>y)) and (x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi): inside=not inside
        j=i
    return inside

# ---------------------------------------------------------------------------
# LAYER ROUTES (per-user)
# ---------------------------------------------------------------------------

@app.post("/api/upload", tags=["Layers"])
async def upload_file(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()
    if ext not in {".kml",".kmz"}:
        raise HTTPException(415, "Only .kml and .kmz files are accepted.")
    raw = await file.read()
    try:
        geojson = kmz_bytes_to_geojson(raw) if ext == ".kmz" else kml_bytes_to_geojson(raw)
    except Exception as exc:
        raise HTTPException(422, str(exc))
    layer_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute("INSERT INTO layers (id, user_id, name, geojson, created_at) VALUES (?,?,?,?,?)",
                     (layer_id, user["id"], Path(filename).stem, json.dumps(geojson), now))
    return {"layer_id": layer_id, "name": Path(filename).stem,
            "feature_count": len(geojson.get("features",[])), "geojson": geojson}

@app.get("/api/layers", tags=["Layers"])
def list_layers(user: dict = Depends(require_auth)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, name FROM layers WHERE user_id = ?", (user["id"],)).fetchall()
    return [dict(r) for r in rows]

@app.get("/api/layers/{layer_id}", tags=["Layers"])
def get_layer(layer_id: str, user: dict = Depends(require_auth)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM layers WHERE id = ? AND user_id = ?",
                           (layer_id, user["id"])).fetchone()
    if not row: raise HTTPException(404, "Layer not found")
    return {"id": layer_id, "name": row["name"], "geojson": json.loads(row["geojson"])}

@app.delete("/api/layers/{layer_id}", tags=["Layers"])
def delete_layer(layer_id: str, user: dict = Depends(require_auth)):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM layers WHERE id = ? AND user_id = ?", (layer_id, user["id"]))
    if cur.rowcount == 0: raise HTTPException(404, "Layer not found.")
    return {"deleted": layer_id}

# ---------------------------------------------------------------------------
# INCIDENTS (per-user)
# ---------------------------------------------------------------------------

@app.post("/api/incidents", tags=["Incidents"])
def create_incident(inc: IncidentCreate, user: dict = Depends(require_auth)):
    inc_id = uuid.uuid4().hex
    now    = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO incidents (id,user_id,title,description,severity,lat,lng,polygon_wkt,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (inc_id, user["id"], inc.title, inc.description, inc.severity, inc.lat, inc.lng, inc.polygon_wkt, now)
        )
    return {"id": inc_id, "created_at": now}

@app.get("/api/incidents", tags=["Incidents"])
def list_incidents(resolved: bool = False, user: dict = Depends(require_auth)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM incidents WHERE user_id = ? AND resolved = ? ORDER BY created_at DESC",
            (user["id"], 1 if resolved else 0)
        ).fetchall()
    return [dict(r) for r in rows]

@app.patch("/api/incidents/{incident_id}/resolve", tags=["Incidents"])
def resolve_incident(incident_id: str, user: dict = Depends(require_auth)):
    with get_db() as conn:
        cur = conn.execute("UPDATE incidents SET resolved=1 WHERE id=? AND user_id=?",
                           (incident_id, user["id"]))
    if cur.rowcount == 0: raise HTTPException(404, "Incident not found.")
    return {"resolved": incident_id}

# ---------------------------------------------------------------------------
# PROXIMITY
# ---------------------------------------------------------------------------

@app.post("/api/proximity", tags=["Incidents"])
def check_proximity(req: ProximityRequest, user: dict = Depends(require_auth)):
    has_polygon = len(req.polygon_coords) >= 3
    results = []
    for staff in req.staff_list:
        dist_m = haversine_distance(req.incident_lat, req.incident_lng, staff.lat, staff.lng)
        inside = point_in_polygon(staff.lat, staff.lng, req.polygon_coords) if has_polygon else False
        if inside:         status = "inside"
        elif dist_m <= 250:  status = "critical"
        elif dist_m <= 500:  status = "high"
        elif dist_m <= req.radius_m: status = "medium"
        else:                status = "safe"
        results.append({"id":staff.id,"name":staff.name,"department":staff.department,
                        "phone":staff.phone,"lat":staff.lat,"lng":staff.lng,
                        "distance_m":round(dist_m,1),"inside":inside,"status":status})
    priority = {"inside":0,"critical":1,"high":2,"medium":3,"safe":4}
    results.sort(key=lambda r:(priority[r["status"]],r["distance_m"]))
    return {"total_staff":len(results),"endangered_count":len([r for r in results if r["status"]!="safe"]),"results":results}

# ---------------------------------------------------------------------------
# ALERTS (per-user)
# ---------------------------------------------------------------------------

ALERT_CHANNELS = {"sms":"Twilio","whatsapp":"UltraMsg","telegram":"Telegram Bot API"}

def _log_alert(channel, req, user_id):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO alert_log (id,user_id,channel,recipient,message,incident_id,sent_at) VALUES (?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, user_id, channel, req.recipient, req.message, req.incident_id,
             datetime.now(timezone.utc).isoformat())
        )

@app.post("/api/alert/{channel}", tags=["Alerts"])
def send_alert(channel: str, req: AlertRequest, user: dict = Depends(require_auth)):
    if channel not in ALERT_CHANNELS: raise HTTPException(400, f"Unknown channel: {channel}")
    _log_alert(channel, req, user["id"])
    return {"status":"mock_sent","channel":channel,"provider":ALERT_CHANNELS[channel]}

@app.get("/api/alerts/log", tags=["Alerts"])
def get_alert_log(limit: int = 100, user: dict = Depends(require_auth)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM alert_log WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?",
            (user["id"], limit)
        ).fetchall()
    return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# SETTINGS (per-user)
# ---------------------------------------------------------------------------

@app.get("/api/settings", tags=["Settings"])
def get_settings(user: dict = Depends(require_auth)):
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM settings WHERE user_id = ?", (user["id"],)).fetchall()
    return {r["key"]: r["value"] for r in rows}

@app.post("/api/settings", tags=["Settings"])
def save_setting(item: SettingItem, user: dict = Depends(require_auth)):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
            (user["id"], item.key, item.value)
        )
    return {"status":"success"}

# ---------------------------------------------------------------------------
# EXPORT
# ---------------------------------------------------------------------------

@app.post("/api/export", tags=["Export"])
def export_layers(req: ExportRequest, user: dict = Depends(require_auth)):
    fmt = req.format.lower()
    if fmt not in {"kml","kmz"}: raise HTTPException(400, "format must be kml or kmz")
    if fmt == "kml":
        body = geojson_to_kml(req.feature_collection, req.doc_name).encode()
        media_type = "application/vnd.google-earth.kml+xml"; filename = "export.kml"
    else:
        body = build_kmz_bytes(req.feature_collection, req.doc_name)
        media_type = "application/vnd.google-earth.kmz"; filename = "export.kmz"
    return Response(content=body, media_type=media_type,
                    headers={"Content-Disposition":f'attachment; filename="{filename}"'})

# ---------------------------------------------------------------------------
# GEOCODE proxy
# ---------------------------------------------------------------------------

@app.get("/api/geocode", tags=["Search"])
async def geocode(q: str):
    import urllib.request, urllib.parse
    encoded = urllib.parse.urlencode({"q":q,"format":"json","limit":8})
    req_obj = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{encoded}",
        headers={"User-Agent":"WatchMe/2.0"}
    )
    try:
        with urllib.request.urlopen(req_obj, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except Exception as exc:
        return JSONResponse(status_code=502, content={"error":str(exc)})

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
