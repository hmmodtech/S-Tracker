WatchMe — Smart Security & Tracking Dashboard
لوحة تحكم أمنية ذكية — فلسطين وقطاع غزة
<div align="center">
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet.js-1.9.4-199900?style=flat-square&logo=leaflet&logoColor=white)
![Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?style=flat-square&logo=render&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)
A humanitarian GIS dashboard for real-time staff safety monitoring in Gaza Strip operations.  
لوحة GIS إنسانية لمراقبة سلامة الموظفين في الوقت الفعلي لعمليات قطاع غزة.
Live Demo · Features · Setup · Deploy
</div>
---
Screenshots
> _Add screenshots here after deployment. Suggested shots:_
> - Full dashboard with layers loaded
> - Incident placement with danger radius circle
> - At-risk staff list with alert buttons
> - Dark mode vs light mode comparison
---
English Documentation
What Is This?
WatchMe is a full-stack web application that gives humanitarian organizations operating in Palestine and Gaza Strip a real-time map-based dashboard for:
Visualising staff locations on an interactive map
Importing field data from KML, KMZ, and CSV files
Drawing custom zones, routes, and markers
Detecting which staff are endangered when an incident occurs
Sending emergency alerts via SMS, WhatsApp, or Telegram
It runs entirely on free hosting (Render Free Tier + GitHub) with no paid services required to get started.
---
Features
Map & Navigation
Centred on Gaza Strip by default (latitude 31.35°N, longitude 34.30°E)
Three tile layers: OpenStreetMap (Street), Esri World Imagery (Satellite), OpenTopoMap (Terrain)
Click-to-copy coordinates, live cursor position display, scale indicator
Locate Me button using browser geolocation
Layer Management (up to 15 layers)
Import `.kml`, `.kmz`, and `.csv` files via drag-and-drop or file browser
Each layer has: visibility toggle, colour picker, opacity slider, zoom-to-fit, delete
Supports Points, LineStrings, Polygons, MultiGeometry from Google Maps and Maps.me exports
Reads `<ExtendedData>` / `<SimpleData>` tags (staff names, departments, phone numbers)
Drawing Tools
Marker, Polyline (path), Polygon (zone), Circle (radius area), Edit, Delete modes
Real-time distance (km) and area (m² / km²) measurement HUD
All drawn shapes exportable to KML/KMZ
Search
Free-text place name search via Nominatim OpenStreetMap geocoder
Direct coordinate entry: `31.5, 34.47` format supported
Staff name and department search across all loaded layers
Incident & Proximity System
Click map or enter coordinates to place an incident
Adjustable hazard radius: 100 m to 5,000 m
Haversine geodesic distance calculation (accurate to <0.5%)
Ray-casting Point-in-Polygon algorithm for zone intersection
Results colour-coded: 🔴 Inside Zone / Critical (<250 m) · 🟠 High (<500 m) · 🟡 Medium (within radius) · 🟢 Safe
Emergency Alerts
Per-staff buttons: SMS, WhatsApp, Telegram
"Alert All" bulk send for all endangered staff
Pre-filled message template with incident name and distance
Mock mode logs to database — real integration ready for Twilio / UltraMsg / Telegram Bot API
All alerts logged to SQLite `alert_log` table
Export
Export all visible layers + drawn shapes as `.kml` or `.kmz`
OGC-compliant output with `<Placemark>`, `<Style>`, `<ExtendedData>` tags
Compatible with Google My Maps and Maps.me for offline field navigation
Theme
Dark mode (default) and Light mode
Preference saved in browser localStorage
All panels, modals, and map controls update instantly
---
Tech Stack
Layer	Technology
Frontend	HTML5 + Tailwind CSS (CDN) + Vanilla JavaScript (ES6+)
Mapping	Leaflet.js 1.9.4 + Leaflet.draw 1.0.4
KML Parsing	`@mapbox/togeojson` (client-side)
KMZ Decompression	JSZip 3.10.1 (client-side)
Area Calculation	Turf.js 6.5.0 (client-side)
Backend	Python 3.11 + FastAPI 0.111
Database	SQLite (file-based, zero config)
Fonts	Syne + Manrope + JetBrains Mono (Google Fonts)
Hosting	Render Free Tier
---
Local Development
Prerequisites
Before you start, make sure you have these installed on your computer:
Python 3.11 or newer — Download here
During installation on Windows, check "Add Python to PATH"
Verify: open a terminal and type `python --version`
Git — Download here
Verify: type `git --version`
A terminal / command prompt
Windows: use "Command Prompt" or "PowerShell"
Mac/Linux: use "Terminal"
---
Step 1 — Get the Project Files
If you cloned from GitHub, skip to Step 2.
If you are starting from scratch with the files you created:
```bash
# Create a folder for your project
mkdir watchme-dashboard
cd watchme-dashboard

# Copy your files into this structure:
# watchme-dashboard/
# ├── app.py
# ├── requirements.txt
# └── static/
#     ├── index.html
#     ├── style.css
#     └── script.js
```
---
Step 2 — Create a Python Virtual Environment
A virtual environment keeps your project's packages separate from the rest of your computer.
```bash
# Create the virtual environment (do this once)
python -m venv venv

# Activate it:

# On Windows:
venv\Scripts\activate

# On Mac / Linux:
source venv/bin/activate

# You will see (venv) appear at the start of your terminal prompt.
# This means it worked.
```
---
Step 3 — Install Dependencies
```bash
pip install -r requirements.txt
```
This installs FastAPI, Uvicorn, and the other packages listed in `requirements.txt`.
It takes about 30 seconds.
---
Step 4 — Run the Application
```bash
python app.py
```
You will see output like this:
```
INFO:     Started server process [12345]
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```
Now open your browser and go to: http://localhost:8000
The dashboard should load with the map centred on Gaza Strip.
---
Step 5 — Test the Features
Import a layer: Click the upload area and select a `.kml`, `.kmz`, or `.csv` file
Search: Type a place name like "Gaza City" in the search bar
Draw: Click "Marker" in Drawing Tools, then click on the map
Incident: Enter coordinates in the Incident form, adjust radius, click "Scan Area"
Export: Click "Export KML" to download your map data
---
Folder Structure Explained
```
watchme-dashboard/
│
├── app.py                 ← Backend: FastAPI server, all API routes
├── requirements.txt       ← Python package list for pip install
├── incidents.db           ← SQLite database (auto-created on first run)
│
└── static/                ← Frontend: served directly by FastAPI
    ├── index.html         ← Full page layout: sidebar, map, modals
    ├── style.css          ← All custom styles + dark/light mode
    └── script.js          ← All application logic (20 sections, 1825 lines)
```
---
API Endpoints Reference
Method	Endpoint	Description
GET	`/api/health`	Server status check
POST	`/api/upload`	Upload KML/KMZ → returns GeoJSON
GET	`/api/layers`	List all stored layers
DELETE	`/api/layers/{id}`	Remove a layer
POST	`/api/export`	Export GeoJSON → KML or KMZ download
POST	`/api/incidents`	Log a new incident
GET	`/api/incidents`	List all incidents
PATCH	`/api/incidents/{id}/resolve`	Mark incident resolved
POST	`/api/proximity`	Run proximity scan (Haversine + PIP)
POST	`/api/alert/sms`	Send SMS (mock)
POST	`/api/alert/whatsapp`	Send WhatsApp (mock)
POST	`/api/alert/telegram`	Send Telegram (mock)
GET	`/api/alerts/log`	View all sent alert logs
GET	`/api/geocode?q=...`	Proxy to Nominatim geocoder
Full interactive API documentation is available at: http://localhost:8000/docs
---
Deployment
Overview
You will deploy to two free services:
GitHub — stores your code (free forever)
Render — runs your application on the internet (free tier)
Total time: about 20 minutes.
---
Part A — Push to GitHub
Step A1 — Create a GitHub Account
If you do not have one: go to github.com and sign up. It is free.
Step A2 — Create a New Repository
Click the + icon in the top right of GitHub
Click "New repository"
Name it: `watchme-dashboard`
Leave it Public (required for free Render deployment)
Do NOT tick "Add a README" — you already have one
Click "Create repository"
Copy the URL shown — it looks like: `https://github.com/YOUR_USERNAME/watchme-dashboard.git`
Step A3 — Create a .gitignore File
In your project folder, create a file called `.gitignore` (no extension) with this content:
```
# Python
venv/
__pycache__/
*.pyc
*.pyo
.Python

# Environment variables
.env
.env.local

# Database (optional — remove this line if you want to commit demo data)
incidents.db

# Build outputs
dist/
build/

# Logs
*.log
npm-debug.log*

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
```
Step A4 — Initialise Git and Push
Open your terminal in the project folder and run these commands one at a time:
```bash
# 1. Initialise a new Git repository in this folder
git init

# 2. Stage all your files for the first commit
git add .

# 3. Create the first commit
git commit -m "Initial commit: WatchMe Smart Security Dashboard"

# 4. Set the main branch name to 'main'
git branch -M main

# 5. Link your local folder to the GitHub repository you just created
#    REPLACE the URL below with YOUR repository URL from Step A2
git remote add origin https://github.com/YOUR_USERNAME/watchme-dashboard.git

# 6. Push your code to GitHub
git push -u origin main
```
If Git asks for your username and password:
Username: your GitHub username
Password: use a Personal Access Token, not your GitHub password
Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → Generate new token
Give it a name, set expiry to 90 days, tick the `repo` checkbox, click Generate
Copy the token and paste it as your password
Verify: Go to `https://github.com/YOUR_USERNAME/watchme-dashboard` and you should see all your files.
---
Part B — Set Up the Database on Render
Render provides a free PostgreSQL database, but for this project we use SQLite (a file stored on disk) which needs no setup — it is created automatically when the app starts. This is simpler and works within Render's free tier.
> **Note**: Render's free tier spins down after 15 minutes of inactivity. When someone visits again, it takes about 30 seconds to wake up. The SQLite database persists between wake-ups as long as you stay on the same instance. For permanent storage, upgrade to Render's paid tier or switch to their PostgreSQL database.
---
Part C — Deploy Backend to Render
Step C1 — Create a Render Account
Go to render.com and sign up with your GitHub account. Click "Sign up with GitHub" for the easiest setup.
Step C2 — Create a New Web Service
From the Render dashboard, click "New +" button (top right)
Select "Web Service"
Under "Connect a repository", click "Connect account" if GitHub is not linked yet
Find `watchme-dashboard` in the list and click "Connect"
Step C3 — Configure the Service
Fill in the settings exactly as follows:
Setting	Value
Name	`watchme-dashboard` (or any name you like)
Region	Frankfurt (EU Central) — closest to Palestine
Branch	`main`
Root Directory	(leave blank — your app.py is in the root)
Runtime	`Python 3`
Build Command	`pip install -r requirements.txt`
Start Command	`python app.py`
Instance Type	`Free`
Step C4 — Add Environment Variables
Scroll down to the "Environment Variables" section and add:
Key	Value	Notes
`PYTHON_VERSION`	`3.11.0`	Tells Render which Python to use
`PORT`	`8000`	FastAPI listens on this port
Click "Add Environment Variable" for each row.
> Optional (for real alert integration — add these later):
> - `TWILIO_SID` — your Twilio account SID
> - `TWILIO_TOKEN` — your Twilio auth token
> - `TELEGRAM_BOT_TOKEN` — your Telegram bot token from @BotFather
Step C5 — Deploy
Click "Create Web Service" at the bottom of the page.
Render will now:
Clone your GitHub repository
Run `pip install -r requirements.txt`
Start `python app.py`
You can watch the build logs in real time. The first deploy takes 2–4 minutes.
When you see this in the logs:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```
Your app is live! Render gives you a URL like:
```
https://watchme-dashboard.onrender.com
```
Click the URL at the top of the Render dashboard to open your live dashboard.
---
Part D — Verify the Deployment
Open your live URL and check:
[ ] The loading screen appears and then the map loads
[ ] The map is centred on Gaza Strip
[ ] The search bar works (try typing "Gaza City")
[ ] You can drag and drop a KML file onto the upload area
[ ] The incident form accepts coordinates
[ ] Dark/Light mode toggle works
Check the API health endpoint:
```
https://YOUR-APP-NAME.onrender.com/api/health
```
You should see: `{"status": "ok", "timestamp": "...", "layers": 0}`
View the interactive API docs:
```
https://YOUR-APP-NAME.onrender.com/docs
```
---
Part E — Auto-Deploy on Git Push
Every time you push changes to GitHub, Render automatically redeploys. The workflow is:
```bash
# 1. Make your changes to any file

# 2. Stage the changed files
git add .

# 3. Commit with a description of what you changed
git commit -m "Fix: improved layer colour picker"

# 4. Push to GitHub — Render detects this and starts a new deploy
git push

# Render rebuilds in about 2 minutes. Your live URL updates automatically.
```
---
Integrating Real Alert Services (Optional)
WhatsApp via UltraMsg
Sign up at ultramsg.com (free trial available)
Create an instance and connect your WhatsApp
Get your `instance_id` and `token`
In `app.py`, replace the `_mock_send` function body for `whatsapp` with:
```python
import urllib.request, urllib.parse
url  = f"https://api.ultramsg.com/{instance_id}/messages/chat"
data = urllib.parse.urlencode({
    "token": token,
    "to":    recipient,   # international format: +970599000001
    "body":  message,
}).encode()
urllib.request.urlopen(urllib.request.Request(url, data=data, method="POST"))
```
Telegram Bot
Open Telegram, search for `@BotFather`
Send `/newbot` and follow the prompts to get your `BOT_TOKEN`
The `recipient` field should be the staff member's Telegram `chat_id` (a number)
In `app.py`, replace the `_mock_send` function body for `telegram` with:
```python
import urllib.request, json as _json
url  = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
data = _json.dumps({"chat_id": recipient, "text": message}).encode()
req  = urllib.request.Request(url, data=data,
       headers={"Content-Type": "application/json"}, method="POST")
urllib.request.urlopen(req)
```
SMS via Twilio
Sign up at twilio.com (free trial with $15 credit)
Get your Account SID, Auth Token, and a Twilio phone number
In `app.py`, replace the `_mock_send` body for `sms` with:
```python
import urllib.request, urllib.parse, base64
url  = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
data = urllib.parse.urlencode({
    "From": twilio_phone,
    "To":   recipient,
    "Body": message,
}).encode()
auth = base64.b64encode(f"{twilio_sid}:{twilio_token}".encode()).decode()
req  = urllib.request.Request(url, data=data,
       headers={"Authorization": f"Basic {auth}"}, method="POST")
urllib.request.urlopen(req)
```
Then add the credentials to Render's Environment Variables (never hardcode them in the source).
---
Pre-Launch Checklist
Before sharing your live URL with your team, verify:
[ ] Live URL opens without errors
[ ] `https://YOUR-APP.onrender.com/api/health` returns `{"status": "ok"}`
[ ] KML file import works (test with a small file)
[ ] CSV import works (test with: `name,lat,lng` + a few rows)
[ ] Incident placement and Scan Area produce results
[ ] Export KML downloads a valid file (open it in Google My Maps to confirm)
[ ] Alert buttons open the confirmation modal
[ ] Alert log is reachable at `/api/alerts/log`
---
Arabic Documentation / التوثيق بالعربية
ما هو هذا التطبيق؟
WatchMe هي تطبيق ويب متكامل يمنح المنظمات الإنسانية العاملة في فلسطين وقطاع غزة لوحة تحكم تفاعلية قائمة على الخرائط لـ:
عرض مواقع الموظفين على خريطة تفاعلية في الوقت الفعلي
استيراد بيانات الميدان من ملفات KML وKMZ وCSV
رسم مناطق مخصصة وطرق ومعالم على الخريطة
اكتشاف الموظفين المعرّضين للخطر فور وقوع أي حادث
إرسال تنبيهات طوارئ عبر SMS أو واتساب أو تيليغرام
يعمل التطبيق بالكامل على استضافة مجانية دون الحاجة لأي خدمات مدفوعة للبدء.
---
المتطلبات الأساسية
قبل البدء، تأكد من تثبيت ما يلي على جهازك:
Python 3.11 أو أحدث — تحميل من هنا
عند التثبيت على Windows، اختر "Add Python to PATH"
للتحقق: افتح Terminal واكتب `python --version`
Git — تحميل من هنا
للتحقق: اكتب `git --version`
---
هيكل المشروع
```
watchme-dashboard/
│
├── app.py                 ← الخادم الخلفي: FastAPI + جميع نقاط API
├── requirements.txt       ← قائمة حزم Python لتثبيتها
├── incidents.db           ← قاعدة بيانات SQLite (تُنشأ تلقائياً)
│
└── static/                ← الواجهة الأمامية
    ├── index.html         ← هيكل الصفحة الكاملة
    ├── style.css          ← التنسيقات + الوضع الداكن/الفاتح
    └── script.js          ← كامل منطق التطبيق
```
---
تشغيل التطبيق محلياً
```bash
# 1. إنشاء البيئة الافتراضية
python -m venv venv

# 2. تفعيل البيئة الافتراضية
# على Windows:
venv\Scripts\activate
# على Mac/Linux:
source venv/bin/activate

# 3. تثبيت المكتبات
pip install -r requirements.txt

# 4. تشغيل التطبيق
python app.py

# 5. افتح المتصفح على:
# http://localhost:8000
```
---
رفع الكود إلى GitHub
```bash
# 1. تهيئة مستودع Git
git init

# 2. إضافة جميع الملفات
git add .

# 3. أول commit
git commit -m "لوحة التحكم الأمنية الذكية — WatchMe"

# 4. تسمية الفرع الرئيسي
git branch -M main

# 5. ربط المستودع المحلي بـ GitHub
# استبدل YOUR_USERNAME باسم حسابك
git remote add origin https://github.com/YOUR_USERNAME/watchme-dashboard.git

# 6. رفع الكود
git push -u origin main
```
---
نشر التطبيق على Render (مجاناً)
سجّل الدخول على render.com عبر حساب GitHub
انقر "New +" ثم اختر "Web Service"
اختر مستودع `watchme-dashboard`
اضبط الإعدادات:
Runtime: `Python 3`
Build Command: `pip install -r requirements.txt`
Start Command: `python app.py`
Instance Type: `Free`
أضف متغير بيئة: `PYTHON_VERSION` = `3.11.0`
انقر "Create Web Service"
انتظر 3-4 دقائق حتى ينتهي النشر
افتح الرابط الذي يمنحك إياه Render
---
الميزات الرئيسية
الميزة	الوصف
إدارة الطبقات	حتى 15 طبقة، مع تبديل الرؤية والألوان والشفافية
استيراد الملفات	دعم KML وKMZ وCSV بالسحب والإفلات
أدوات الرسم	علامات ومسارات ومناطق مع قياس المسافة والمساحة
نظام الحوادث	إدخال الإحداثيات + دائرة نصف قطر الخطر القابلة للتعديل
مسح التقارب	حساب المسافة الجيوديسية الفورية لجميع الموظفين
تنبيهات الطوارئ	SMS وواتساب وتيليغرام مع تسجيل في قاعدة البيانات
التصدير	KML وKMZ متوافق مع Google Maps وMaps.me
الوضع الداكن/الفاتح	تبديل فوري محفوظ في المتصفح
---
استكشاف الأخطاء وإصلاحها
مشكلة: الصفحة لا تفتح على المنفذ 8000
تأكد من تفعيل البيئة الافتراضية (`venv`) قبل تشغيل `python app.py`.
```bash
# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate
```
---
مشكلة: خطأ "Module not found"
```bash
pip install -r requirements.txt
```
---
مشكلة: النشر على Render يفشل
تحقق من سجل البناء (Build Logs) في لوحة Render. الأسباب الشائعة:
خطأ في اسم الفرع — تأكد أن الفرع اسمه `main` وليس `master`
`requirements.txt` غير موجود في الجذر — تأكد من مسار الملف
---
مشكلة: ملف KML لا يُستورد
تأكد أن الملف بصيغة KML صحيحة (XML valid)
جرّب فتح الملف في محرر نصوص للتحقق من بنيته
ملفات KMZ يجب أن تحتوي على `doc.kml` داخلها
---
مشكلة: Render يتوقف بعد 15 دقيقة (Free Tier)
هذا طبيعي في الطبقة المجانية. يستغرق الإيقاظ حوالي 30 ثانية. للحل:
استخدم خدمة مثل UptimeRobot (مجاني) لإرسال طلب ping كل 10 دقائق لإبقاء التطبيق نشطاً
---
Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
---
License
MIT License — free to use, modify, and distribute.
---
Acknowledgements
Leaflet.js — open-source mapping library
OpenStreetMap — free map tiles and geocoding
FastAPI — modern Python web framework
Render — free cloud hosting
Tailwind CSS — utility-first CSS framework
