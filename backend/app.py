"""
Smart Security & Tracking Dashboard — Backend API
FastAPI application serving:
  - Static frontend files
  - KML/KMZ upload → GeoJSON conversion
  - Haversine distance calculations
  - Point-in-Polygon geofencing
  - Mock emergency alert endpoints (SMS / WhatsApp / Telegram)

Designed for Render Free Tier: no heavy dependencies, in-memory state,
SQLite persistence only for incident log, zero external spatial libraries.
"""

from __future__ import annotations

import io
import json
import logging
import math
import re
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import aiofiles
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("dashboard")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

DB_PATH = BASE_DIR / "incidents.db"

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Smart Security & Tracking Dashboard",
    description="Humanitarian GIS backend for Palestine / Gaza Strip operations.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# SQLite — database connection and schema initialization
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS incidents (
                id          TEXT PRIMARY KEY,
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
                channel     TEXT NOT NULL,
                recipient   TEXT NOT NULL,
                message     TEXT NOT NULL,
                incident_id TEXT,
                status      TEXT DEFAULT 'mock_sent',
                sent_at     TEXT NOT NULL
            );
            """
        )
    log.info("Database initialised at %s", DB_PATH)


init_db()

# ---------------------------------------------------------------------------
# In-memory layer store (lost on restart — acceptable for MVP)
# ---------------------------------------------------------------------------
# Structure: { layer_id: { "name": str, "geojson": dict } }
LAYER_STORE: dict[str, dict] = {}
MAX_LAYERS = 15

# ---------------------------------------------------------------------------
# KML XML namespaces
# ---------------------------------------------------------------------------
KML_NS = "http://www.opengis.net/kml/2.2"
GX_NS  = "http://www.google.com/kml/ext/2.2"

ET.register_namespace("",   KML_NS)
ET.register_namespace("gx", GX_NS)


# ===========================================================================
# KML / KMZ PARSING → GeoJSON
# ===========================================================================

def _tag(local: str, ns: str = KML_NS) -> str:
    return f"{{{ns}}}{local}"


def _child_text(el: ET.Element, local: str, ns: str = KML_NS) -> str:
    child = el.find(_tag(local, ns))
    return child.text.strip() if child is not None and child.text else ""


def _parse_coordinates(raw: str) -> list[list[float]]:
    """
    Parse KML <coordinates> text into [[lon, lat, alt?], ...].
    Handles both comma-separated tuples and whitespace-separated tuples,
    and trims altitude if present.
    """
    coords: list[list[float]] = []
    raw = raw.strip()
    for token in re.split(r"\s+", raw):
        token = token.strip()
        if not token:
            continue
        parts = token.split(",")
        if len(parts) >= 2:
            try:
                lon = float(parts[0])
                lat = float(parts[1])
                coords.append([lon, lat])
            except ValueError:
                continue
    return coords


def _extract_extended_data(placemark: ET.Element) -> dict[str, Any]:
    """Extract <ExtendedData> / <SimpleData> / <Data> into a flat dict."""
    props: dict[str, Any] = {}
    ext = placemark.find(_tag("ExtendedData"))
    if ext is None:
        return props

    # <SimpleData name="...">value</SimpleData>
    for sd in ext.findall(_tag("SimpleData")):
        name = sd.get("name", "")
        if name:
            props[name] = sd.text.strip() if sd.text else ""

    # <Data name="..."><value>...</value></Data>
    for data in ext.findall(_tag("Data")):
        name = data.get("name", "")
        val_el = data.find(_tag("value"))
        if name:
            props[name] = (
                val_el.text.strip()
                if val_el is not None and val_el.text
                else ""
            )
    return props


def _parse_style(style_el: ET.Element | None) -> dict[str, Any]:
    """Parse a <Style> element into a simple style dict."""
    style: dict[str, Any] = {}
    if style_el is None:
        return style

    line_style = style_el.find(_tag("LineStyle"))
    if line_style is not None:
        color_el = line_style.find(_tag("color"))
        width_el = line_style.find(_tag("width"))
        if color_el is not None and color_el.text:
            style["lineColor"] = _kml_color_to_hex(color_el.text.strip())
        if width_el is not None and width_el.text:
            style["lineWidth"] = float(width_el.text.strip())

    poly_style = style_el.find(_tag("PolyStyle"))
    if poly_style is not None:
        color_el = poly_style.find(_tag("color"))
        fill_el  = poly_style.find(_tag("fill"))
        if color_el is not None and color_el.text:
            style["fillColor"] = _kml_color_to_hex(color_el.text.strip())
        if fill_el is not None and fill_el.text:
            style["fill"] = fill_el.text.strip() == "1"

    icon_style = style_el.find(_tag("IconStyle"))
    if icon_style is not None:
        color_el = icon_style.find(_tag("color"))
        if color_el is not None and color_el.text:
            style["iconColor"] = _kml_color_to_hex(color_el.text.strip())
        icon_el = icon_style.find(_tag("Icon"))
        if icon_el is not None:
            href_el = icon_el.find(_tag("href"))
            if href_el is not None and href_el.text:
                style["iconHref"] = href_el.text.strip()

    return style


def _kml_color_to_hex(kml_color: str) -> str:
    """
    Convert KML aabbggrr hex color to CSS #rrggbb.
    KML stores alpha first then BGR order.
    """
    kml_color = kml_color.strip().lstrip("#")
    if len(kml_color) == 8:
        # aabbggrr
        bb = kml_color[2:4]
        gg = kml_color[4:6]
        rr = kml_color[6:8]
        return f"#{rr}{gg}{bb}"
    elif len(kml_color) == 6:
        # Assume rrggbb already
        return f"#{kml_color}"
    return "#3388ff"


def _placemark_to_features(
    placemark: ET.Element,
    styles: dict[str, dict],
) -> list[dict]:
    """
    Convert one KML <Placemark> into one or more GeoJSON Feature dicts.
    Handles: Point, LineString, LinearRing, Polygon, MultiGeometry.
    """
    features: list[dict] = []

    name        = _child_text(placemark, "name")
    description = _child_text(placemark, "description")
    props       = _extract_extended_data(placemark)
    props["name"]        = name
    props["description"] = description

    # Resolve style
    style_url_el = placemark.find(_tag("styleUrl"))
    resolved_style: dict[str, Any] = {}
    if style_url_el is not None and style_url_el.text:
        style_id = style_url_el.text.strip().lstrip("#")
        resolved_style = styles.get(style_id, {})

    # Inline <Style>
    inline_style_el = placemark.find(_tag("Style"))
    if inline_style_el is not None:
        resolved_style.update(_parse_style(inline_style_el))

    props["_style"] = resolved_style

    def make_feature(geometry: dict) -> dict:
        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": dict(props),
        }

    # ---- Point ----
    point_el = placemark.find(_tag("Point"))
    if point_el is not None:
        coords_el = point_el.find(_tag("coordinates"))
        if coords_el is not None and coords_el.text:
            coords = _parse_coordinates(coords_el.text)
            if coords:
                features.append(make_feature({
                    "type": "Point",
                    "coordinates": coords[0],
                }))

    # ---- LineString ----
    line_el = placemark.find(_tag("LineString"))
    if line_el is not None:
        coords_el = line_el.find(_tag("coordinates"))
        if coords_el is not None and coords_el.text:
            coords = _parse_coordinates(coords_el.text)
            if coords:
                features.append(make_feature({
                    "type": "LineString",
                    "coordinates": coords,
                }))

    # ---- Polygon ----
    poly_el = placemark.find(_tag("Polygon"))
    if poly_el is not None:
        rings: list[list[list[float]]] = []
        outer = poly_el.find(f".//{_tag('outerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}")
        if outer is not None and outer.text:
            rings.append(_parse_coordinates(outer.text))
        for inner in poly_el.findall(f".//{_tag('innerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}"):
            if inner.text:
                rings.append(_parse_coordinates(inner.text))
        if rings and rings[0]:
            features.append(make_feature({
                "type": "Polygon",
                "coordinates": rings,
            }))

    # ---- MultiGeometry ----
    multi_el = placemark.find(_tag("MultiGeometry"))
    if multi_el is not None:
        geometries: list[dict] = []

        for child in multi_el:
            local = child.tag.split("}")[-1] if "}" in child.tag else child.tag

            if local == "Point":
                coords_el = child.find(_tag("coordinates"))
                if coords_el is not None and coords_el.text:
                    c = _parse_coordinates(coords_el.text)
                    if c:
                        geometries.append({"type": "Point", "coordinates": c[0]})

            elif local == "LineString":
                coords_el = child.find(_tag("coordinates"))
                if coords_el is not None and coords_el.text:
                    c = _parse_coordinates(coords_el.text)
                    if c:
                        geometries.append({"type": "LineString", "coordinates": c})

            elif local == "Polygon":
                rings = []
                outer = child.find(
                    f".//{_tag('outerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}"
                )
                if outer is not None and outer.text:
                    rings.append(_parse_coordinates(outer.text))
                for inner in child.findall(
                    f".//{_tag('innerBoundaryIs')}/{_tag('LinearRing')}/{_tag('coordinates')}"
                ):
                    if inner.text:
                        rings.append(_parse_coordinates(inner.text))
                if rings:
                    geometries.append({"type": "Polygon", "coordinates": rings})

        if geometries:
            features.append(make_feature({
                "type": "GeometryCollection",
                "geometries": geometries,
            }))

    return features


def _collect_styles(root: ET.Element) -> dict[str, dict]:
    """
    Walk the entire KML tree collecting <Style id="..."> and
    <StyleMap id="..."> (maps normal→Style id) into a flat dict.
    """
    styles: dict[str, dict] = {}

    for style_el in root.iter(_tag("Style")):
        sid = style_el.get("id")
        if sid:
            styles[sid] = _parse_style(style_el)

    for style_map_el in root.iter(_tag("StyleMap")):
        sid = style_map_el.get("id")
        if sid:
            # Resolve the "normal" Pair
            for pair_el in style_map_el.findall(_tag("Pair")):
                key_el = pair_el.find(_tag("key"))
                if key_el is not None and key_el.text and key_el.text.strip() == "normal":
                    url_el = pair_el.find(_tag("styleUrl"))
                    if url_el is not None and url_el.text:
                        target = url_el.text.strip().lstrip("#")
                        styles[sid] = styles.get(target, {})
                        break

    return styles


def kml_bytes_to_geojson(kml_bytes: bytes) -> dict:
    """
    Parse raw KML bytes → GeoJSON FeatureCollection.
    Handles missing/wrong XML declarations gracefully.
    """
    try:
        root = ET.fromstring(kml_bytes)
    except ET.ParseError as exc:
        # Try stripping a BOM or bad encoding declaration
        cleaned = kml_bytes.decode("utf-8", errors="replace").encode("utf-8")
        try:
            root = ET.fromstring(cleaned)
        except ET.ParseError:
            raise ValueError(f"Invalid KML XML: {exc}") from exc

    styles = _collect_styles(root)
    features: list[dict] = []

    for placemark in root.iter(_tag("Placemark")):
        features.extend(_placemark_to_features(placemark, styles))

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def kmz_bytes_to_geojson(kmz_bytes: bytes) -> dict:
    """
    Decompress a KMZ (ZIP) archive, find the root KML file,
    and parse it to GeoJSON.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(kmz_bytes)) as zf:
            # Prefer doc.kml; fall back to any .kml entry
            kml_name = None
            for name in zf.namelist():
                if name.lower() == "doc.kml":
                    kml_name = name
                    break
            if kml_name is None:
                for name in zf.namelist():
                    if name.lower().endswith(".kml"):
                        kml_name = name
                        break
            if kml_name is None:
                raise ValueError("No .kml file found inside KMZ archive.")
            kml_bytes = zf.read(kml_name)
    except zipfile.BadZipFile as exc:
        raise ValueError(f"File is not a valid KMZ/ZIP archive: {exc}") from exc

    return kml_bytes_to_geojson(kml_bytes)


# ===========================================================================
# GeoJSON → KML EXPORT
# ===========================================================================

def _hex_to_kml_color(hex_color: str, alpha: str = "ff") -> str:
    """Convert CSS #rrggbb to KML aabbggrr."""
    h = hex_color.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return f"{alpha}ff8833"
    rr, gg, bb = h[0:2], h[2:4], h[4:6]
    return f"{alpha}{bb}{gg}{rr}"


def _coords_to_kml(coords: list) -> str:
    """Flatten coordinate list to KML <coordinates> text."""
    parts: list[str] = []
    for c in coords:
        if isinstance(c[0], (int, float)):
            parts.append(f"{c[0]},{c[1]},0")
        else:
            parts.extend(f"{pt[0]},{pt[1]},0" for pt in c)
    return " ".join(parts)


def geojson_to_kml(
    feature_collection: dict,
    doc_name: str = "Smart Security Dashboard Export",
) -> str:
    """
    Convert a GeoJSON FeatureCollection to an OGC-compliant KML string.
    Supports Point, LineString, Polygon, GeometryCollection.
    Embeds style and ExtendedData from feature properties.
    """
    lines: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"',
        '     xmlns:gx="http://www.google.com/kml/ext/2.2">',
        f"  <Document>",
        f"    <name>{_xml_escape(doc_name)}</name>",
        f"    <description>Exported by Smart Security Dashboard — {datetime.now(timezone.utc).isoformat()}</description>",
    ]

    for feature in feature_collection.get("features", []):
        props    = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        g_type   = geometry.get("type", "")
        style    = props.get("_style", {})

        # Build style elements
        style_id = f"s{uuid.uuid4().hex[:8]}"
        line_color = _hex_to_kml_color(style.get("lineColor", "#3388ff"))
        fill_color = _hex_to_kml_color(style.get("fillColor", "#3388ff"), alpha="88")
        line_width = style.get("lineWidth", 2)

        lines += [
            f'    <Style id="{style_id}">',
            f"      <LineStyle>",
            f"        <color>{line_color}</color>",
            f"        <width>{line_width}</width>",
            f"      </LineStyle>",
            f"      <PolyStyle>",
            f"        <color>{fill_color}</color>",
            f"      </PolyStyle>",
            f"      <IconStyle>",
            f"        <color>{line_color}</color>",
            f"        <Icon><href>https://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>",
            f"      </IconStyle>",
            f"    </Style>",
        ]

        # Placemark
        name        = _xml_escape(str(props.get("name", "Unnamed")))
        description = _xml_escape(str(props.get("description", "")))

        lines += [
            f"    <Placemark>",
            f"      <name>{name}</name>",
            f"      <description>{description}</description>",
            f"      <styleUrl>#{style_id}</styleUrl>",
        ]

        # ExtendedData — skip internal keys
        skip_keys = {"name", "description", "_style"}
        ext_props  = {k: v for k, v in props.items() if k not in skip_keys and v}
        if ext_props:
            lines.append("      <ExtendedData>")
            for k, v in ext_props.items():
                lines += [
                    f'        <Data name="{_xml_escape(str(k))}">',
                    f"          <value>{_xml_escape(str(v))}</value>",
                    f"        </Data>",
                ]
            lines.append("      </ExtendedData>")

        # Geometry
        lines.extend(_geometry_to_kml(geometry, indent=6))

        lines.append("    </Placemark>")

    lines += ["  </Document>", "</kml>"]
    return "\n".join(lines)


def _geometry_to_kml(geometry: dict, indent: int = 6) -> list[str]:
    pad   = " " * indent
    g_type = geometry.get("type", "")
    coords = geometry.get("coordinates", [])
    lines: list[str] = []

    if g_type == "Point":
        lon, lat = coords[0], coords[1]
        lines += [
            f"{pad}<Point>",
            f"{pad}  <coordinates>{lon},{lat},0</coordinates>",
            f"{pad}</Point>",
        ]

    elif g_type == "LineString":
        kml_c = " ".join(f"{c[0]},{c[1]},0" for c in coords)
        lines += [
            f"{pad}<LineString>",
            f"{pad}  <tessellate>1</tessellate>",
            f"{pad}  <coordinates>{kml_c}</coordinates>",
            f"{pad}</LineString>",
        ]

    elif g_type == "Polygon":
        lines.append(f"{pad}<Polygon>")
        lines.append(f"{pad}  <tessellate>1</tessellate>")
        for i, ring in enumerate(coords):
            tag = "outerBoundaryIs" if i == 0 else "innerBoundaryIs"
            kml_c = " ".join(f"{c[0]},{c[1]},0" for c in ring)
            lines += [
                f"{pad}  <{tag}>",
                f"{pad}    <LinearRing>",
                f"{pad}      <coordinates>{kml_c}</coordinates>",
                f"{pad}    </LinearRing>",
                f"{pad}  </{tag}>",
            ]
        lines.append(f"{pad}</Polygon>")

    elif g_type == "GeometryCollection":
        lines.append(f"{pad}<MultiGeometry>")
        for sub_geom in geometry.get("geometries", []):
            lines.extend(_geometry_to_kml(sub_geom, indent + 2))
        lines.append(f"{pad}</MultiGeometry>")

    return lines


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
    )


def build_kmz_bytes(feature_collection: dict, doc_name: str = "export") -> bytes:
    kml_str = geojson_to_kml(feature_collection, doc_name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("doc.kml", kml_str.encode("utf-8"))
    return buf.getvalue()


# ===========================================================================
# SPATIAL ALGORITHMS
# ===========================================================================

EARTH_RADIUS_M = 6_371_000.0  # metres


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Return geodesic distance in metres between two WGS-84 points
    using the Haversine formula.
    """
    phi1     = math.radians(lat1)
    phi2     = math.radians(lat2)
    dphi     = math.radians(lat2 - lat1)
    dlambda  = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_M * c


def point_in_polygon(
    lat: float,
    lon: float,
    polygon_coords: list[list[float]],
) -> bool:
    """
    Ray-casting algorithm to determine whether (lat, lon) lies
    inside a polygon defined by a list of [lon, lat] pairs
    (GeoJSON coordinate order).

    Returns True if the point is inside the polygon.
    """
    # Normalise to (x=lon, y=lat)
    x, y = lon, lat
    n     = len(polygon_coords)
    inside = False
    j      = n - 1

    for i in range(n):
        xi, yi = polygon_coords[i][0], polygon_coords[i][1]
        xj, yj = polygon_coords[j][0], polygon_coords[j][1]

        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
        ):
            inside = not inside
        j = i

    return inside


def point_in_geojson_polygon(
    lat: float,
    lon: float,
    polygon_feature: dict,
) -> bool:
    """
    Test a point against a GeoJSON Polygon feature.
    Accounts for outer ring (must be inside) and inner rings (holes).
    """
    geometry = polygon_feature.get("geometry", {})
    if geometry.get("type") != "Polygon":
        return False

    rings: list[list[list[float]]] = geometry.get("coordinates", [])
    if not rings:
        return False

    # Must be inside outer ring
    if not point_in_polygon(lat, lon, rings[0]):
        return False

    # Must NOT be inside any hole (inner rings)
    for hole in rings[1:]:
        if point_in_polygon(lat, lon, hole):
            return False

    return True


# ===========================================================================
# PYDANTIC MODELS
# ===========================================================================

class IncidentCreate(BaseModel):
    title:       str
    description: str   = ""
    severity:    str   = "medium"   # low | medium | high | critical
    lat:         float
    lng:         float
    polygon_wkt: str   = ""         # optional WKT polygon for geofenced incidents


class StaffPoint(BaseModel):
    id:         str
    name:       str
    department: str = ""
    phone:      str = ""
    lat:        float
    lng:        float


class ProximityRequest(BaseModel):
    incident_lat:  float
    incident_lng:  float
    radius_m:      float = 1000.0   # default alert radius in metres
    staff_list:    list[StaffPoint]
    polygon_coords: list[list[float]] = []  # [lon, lat] pairs; empty = point incident


class AlertRequest(BaseModel):
    channel:    str         # "sms" | "whatsapp" | "telegram"
    recipient:  str         # phone number or Telegram chat id
    message:    str
    incident_id: str = ""


class ExportRequest(BaseModel):
    feature_collection: dict
    doc_name:           str  = "Security Dashboard Export"
    format:             str  = "kml"   # "kml" or "kmz"


class SettingItem(BaseModel):
    key: str
    value: str


# ===========================================================================
# API ROUTES
# ===========================================================================

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["System"])
def health():
    return {
        "status":    "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "layers":    len(LAYER_STORE),
    }


# ---------------------------------------------------------------------------
# KML / KMZ upload → GeoJSON
# ---------------------------------------------------------------------------

@app.post("/api/upload", tags=["Layers"])
async def upload_file(file: UploadFile = File(...)):
    """
    Accept a .kml or .kmz file, parse it, return GeoJSON + layer metadata.
    Stores the layer in memory for later export / proximity checks.
    """
    if len(LAYER_STORE) >= MAX_LAYERS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_LAYERS} layers reached. Remove a layer first.",
        )

    filename = file.filename or "upload"
    ext      = Path(filename).suffix.lower()

    if ext not in {".kml", ".kmz"}:
        raise HTTPException(
            status_code=415,
            detail="Only .kml and .kmz files are accepted.",
        )

    raw_bytes = await file.read()
    log.info("Received upload: %s (%d bytes)", filename, len(raw_bytes))

    try:
        if ext == ".kmz":
            geojson = kmz_bytes_to_geojson(raw_bytes)
        else:
            geojson = kml_bytes_to_geojson(raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected parse error for %s", filename)
        raise HTTPException(status_code=500, detail=f"Parse error: {exc}") from exc

    layer_id = uuid.uuid4().hex[:12]
    layer_name = Path(filename).stem

    LAYER_STORE[layer_id] = {
        "id":      layer_id,
        "name":    layer_name,
        "geojson": geojson,
    }

    feature_count = len(geojson.get("features", []))
    log.info("Parsed %d features from '%s' → layer %s", feature_count, filename, layer_id)

    return {
        "layer_id":      layer_id,
        "name":          layer_name,
        "feature_count": feature_count,
        "geojson":       geojson,
    }


# ---------------------------------------------------------------------------
# Layer management
# ---------------------------------------------------------------------------

@app.get("/api/layers", tags=["Layers"])
def list_layers():
    return [
        {
            "id":            lid,
            "name":          data["name"],
            "feature_count": len(data["geojson"].get("features", [])),
        }
        for lid, data in LAYER_STORE.items()
    ]


@app.delete("/api/layers/{layer_id}", tags=["Layers"])
def delete_layer(layer_id: str):
    if layer_id not in LAYER_STORE:
        raise HTTPException(status_code=404, detail="Layer not found.")
    del LAYER_STORE[layer_id]
    return {"deleted": layer_id}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@app.post("/api/export", tags=["Export"])
def export_layers(req: ExportRequest):
    """
    Accept a GeoJSON FeatureCollection (assembled on the client from all
    visible layers + drawn features) and return a KML or KMZ file download.
    """
    fmt = req.format.lower()
    if fmt not in {"kml", "kmz"}:
        raise HTTPException(status_code=400, detail="format must be 'kml' or 'kmz'.")

    try:
        if fmt == "kml":
            content     = geojson_to_kml(req.feature_collection, req.doc_name)
            media_type  = "application/vnd.google-earth.kml+xml"
            filename    = "export.kml"
            body        = content.encode("utf-8")
        else:
            body        = build_kmz_bytes(req.feature_collection, req.doc_name)
            media_type  = "application/vnd.google-earth.kmz"
            filename    = "export.kmz"

    except Exception as exc:
        log.exception("Export error")
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc

    return Response(
        content     = body,
        media_type  = media_type,
        headers     = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length":      str(len(body)),
        },
    )


# ---------------------------------------------------------------------------
# Settings (SQLite Persistence)
# ---------------------------------------------------------------------------

@app.get("/api/settings", tags=["Settings"])
def get_settings():
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {row["key"]: row["value"] for row in rows}
    except Exception as e:
        log.warning("Could not load settings from database: %s", e)
        return {}


@app.post("/api/settings", tags=["Settings"])
def save_setting(item: SettingItem):
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (item.key, item.value),
            )
            conn.commit()
        return {"status": "success"}
    except Exception as e:
        log.exception("Could not save setting %s: %s", item.key, e)
        raise HTTPException(status_code=500, detail=f"Database write error: {e}")


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

@app.post("/api/incidents", tags=["Incidents"])
def create_incident(inc: IncidentCreate):
    incident_id = uuid.uuid4().hex
    now         = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO incidents (id, title, description, severity, lat, lng, polygon_wkt, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (incident_id, inc.title, inc.description, inc.severity,
             inc.lat, inc.lng, inc.polygon_wkt, now),
        )

    log.info("Incident created: %s @ (%.5f, %.5f)", incident_id, inc.lat, inc.lng)
    return {"id": incident_id, "created_at": now}


@app.get("/api/incidents", tags=["Incidents"])
def list_incidents(resolved: bool = False):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM incidents WHERE resolved = ? ORDER BY created_at DESC",
            (1 if resolved else 0,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.patch("/api/incidents/{incident_id}/resolve", tags=["Incidents"])
def resolve_incident(incident_id: str):
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE incidents SET resolved = 1 WHERE id = ?", (incident_id,)
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Incident not found.")
    return {"resolved": incident_id}


# ---------------------------------------------------------------------------
# Proximity & Geofencing
# ---------------------------------------------------------------------------

@app.post("/api/proximity", tags=["Incidents"])
def check_proximity(req: ProximityRequest):
    """
    Given an incident location and a list of staff members:
    1. Compute Haversine distance from incident to each staff member.
    2. If polygon_coords are provided, run point-in-polygon for each staff.
    3. Return a prioritised result list.

    Result status codes:
        "inside"  — staff is within the incident polygon
        "critical" — within 250 m
        "high"     — within 500 m
        "medium"   — within req.radius_m
        "safe"     — beyond radius
    """
    has_polygon = len(req.polygon_coords) >= 3
    results: list[dict] = []

    for staff in req.staff_list:
        dist_m = haversine_distance(
            req.incident_lat, req.incident_lng,
            staff.lat, staff.lng,
        )

        inside = False
        if has_polygon:
            inside = point_in_polygon(staff.lat, staff.lng, req.polygon_coords)

        if inside:
            status = "inside"
        elif dist_m <= 250:
            status = "critical"
        elif dist_m <= 500:
            status = "high"
        elif dist_m <= req.radius_m:
            status = "medium"
        else:
            status = "safe"

        results.append({
            "id":         staff.id,
            "name":       staff.name,
            "department": staff.department,
            "phone":      staff.phone,
            "lat":        staff.lat,
            "lng":        staff.lng,
            "distance_m": round(dist_m, 1),
            "inside":     inside,
            "status":     status,
        })

    # Sort: inside first, then by distance ascending
    priority = {"inside": 0, "critical": 1, "high": 2, "medium": 3, "safe": 4}
    results.sort(key=lambda r: (priority[r["status"]], r["distance_m"]))

    endangered = [r for r in results if r["status"] != "safe"]
    return {
        "total_staff":      len(results),
        "endangered_count": len(endangered),
        "results":          results,
    }


# ---------------------------------------------------------------------------
# Emergency Alerts (Mock — ready for Twilio / UltraMsg / Telegram integration)
# ---------------------------------------------------------------------------

ALERT_CHANNELS = {
    "sms":       "Twilio REST API → POST /2010-04-01/Accounts/{SID}/Messages.json",
    "whatsapp":  "UltraMsg API   → POST https://api.ultramsg.com/{instance}/messages/chat",
    "telegram":  "Telegram Bot   → POST https://api.telegram.org/bot{TOKEN}/sendMessage",
}


def _mock_send(channel: str, recipient: str, message: str) -> dict:
    """
    Simulate sending a message. Replace this function body with the
    real HTTP call to Twilio / UltraMsg / Telegram when credentials
    are available. All parameters and return shape remain identical.
    """
    log.info("[MOCK ALERT] channel=%s recipient=%s msg=%.80s", channel, recipient, message)
    return {
        "provider":   ALERT_CHANNELS.get(channel, channel),
        "recipient":  recipient,
        "message":    message,
        "mock":       True,
        "note":       (
            "This is a mock response. Integrate real credentials to activate. "
            f"Provider endpoint: {ALERT_CHANNELS.get(channel, 'unknown')}"
        ),
    }


@app.post("/api/alert/sms", tags=["Alerts"])
def send_sms(req: AlertRequest):
    if req.channel != "sms":
        raise HTTPException(400, "Use /api/alert/sms for SMS alerts.")
    result = _mock_send("sms", req.recipient, req.message)
    _log_alert("sms", req)
    return {"status": "mock_sent", "detail": result}


@app.post("/api/alert/whatsapp", tags=["Alerts"])
def send_whatsapp(req: AlertRequest):
    if req.channel != "whatsapp":
        raise HTTPException(400, "Use /api/alert/whatsapp for WhatsApp alerts.")
    result = _mock_send("whatsapp", req.recipient, req.message)
    _log_alert("whatsapp", req)
    return {"status": "mock_sent", "detail": result}


@app.post("/api/alert/telegram", tags=["Alerts"])
def send_telegram(req: AlertRequest):
    if req.channel != "telegram":
        raise HTTPException(400, "Use /api/alert/telegram for Telegram alerts.")
    result = _mock_send("telegram", req.recipient, req.message)
    _log_alert("telegram", req)
    return {"status": "mock_sent", "detail": result}


def _log_alert(channel: str, req: AlertRequest) -> None:
    alert_id = uuid.uuid4().hex
    now      = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO alert_log (id, channel, recipient, message, incident_id, sent_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (alert_id, channel, req.recipient, req.message, req.incident_id, now),
        )


@app.get("/api/alerts/log", tags=["Alerts"])
def get_alert_log(limit: int = 100):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM alert_log ORDER BY sent_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Geocoding proxy (Nominatim — avoids CORS issues from the browser)
# ---------------------------------------------------------------------------

@app.get("/api/geocode", tags=["Search"])
async def geocode(q: str):
    """
    Forward a free-text query to Nominatim OSM geocoder and return results.
    The client could call Nominatim directly, but proxying avoids browser
    CORS restrictions and allows future caching / rate-limiting here.
    """
    import urllib.request
    import urllib.parse

    encoded = urllib.parse.urlencode({"q": q, "format": "json", "limit": 8})
    url     = f"https://nominatim.openstreetmap.org/search?{encoded}"

    req_obj = urllib.request.Request(
        url,
        headers={"User-Agent": "SmartSecurityDashboard/1.0 (humanitarian-ops)"},
    )
    try:
        with urllib.request.urlopen(req_obj, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        log.warning("Geocoding error for '%s': %s", q, exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})

    return data


# ---------------------------------------------------------------------------
# Static files — serve the frontend
# ---------------------------------------------------------------------------
# Mount AFTER all /api routes so API endpoints take priority.
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ---------------------------------------------------------------------------
# Entry point (for local development: python app.py)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
