from flask import Flask, render_template, request, jsonify
import csv, unicodedata, re, math, datetime as dt
import meteomatics.api as api
import json
from collections import defaultdict
import pandas as pd

GOOGLE_MAPS_JS_KEY = "AIzaSyA21-byz5i3faf3safj9YfcrO6KlvWhVUE"


    # Helper to normalize names (strip accents + non-alphanum)
def normalize(text: str) -> str:
    nf = unicodedata.normalize('NFD', text)
    no_accents = nf.encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]', '', no_accents)

# Load stations (as before)…
stations = []
with open('data/find_station.csv', encoding='utf-8') as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        name = row['Name']
        try:
            lat, lon = map(float, row['Location Lat,Lon'].split(','))
        except:
            continue
        stations.append({
            'name': name,
            'lat': lat,
            'lon': lon,
            'norm': normalize(name)
        })

# Load geocoded ski resorts (with lat/lon)
resorts = []
with open('data/ski_resorts_coords.csv', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for r in reader:
        if not r['Resort Lat'] or not r['Resort Lon']:
            continue
        resorts.append({
            'name': r['Ski Resort'],
            'lat': float(r['Resort Lat']),
            'lon': float(r['Resort Lon']),
            'norm': normalize(r['Ski Resort'])
        })


POPULAR_NAMES = {
    "Val Gardena", "The Three Valleys", "Zermatt", "Les Deux Alpes", "St. Anton am Arlberg",
    "Ischgl", "Kitzbüheler Alpen", "Verbier",
    "Les Arcs", "La Plagne", "Alpe d’Huez"
}

CSV = 'data/ski_resorts_coords.csv'

popular_resorts = []

seen = set()                      # ← remembers which names we’ve kept already

with open(CSV, newline="", encoding="utf-8") as fh:
    rdr = csv.DictReader(fh)
    for row in rdr:
        name = row["Ski Resort"].strip()          # exact header names you said
        if name in POPULAR_NAMES and name not in seen:
            popular_resorts.append({
                "name": name,
                "lat" : float(row["Resort Lat"]),
                "lon" : float(row["Resort Lon"])
            })
            seen.add(name)

# Haversine for distance in km
def hav(a_lat, a_lon, b_lat, b_lon):
    R = 6371.0
    φ1, φ2 = math.radians(a_lat), math.radians(b_lat)
    Δφ = math.radians(b_lat - a_lat)
    Δλ = math.radians(b_lon - a_lon)
    a = math.sin(Δφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


app = Flask(__name__, static_folder='static', template_folder='templates')


@app.route('/')
def index():
    return render_template('index.html', google_js_api_key=GOOGLE_MAPS_JS_KEY)

@app.route('/search')
def search_stations():
    q = normalize(request.args.get('q', ''))
    if not q:
        return jsonify([])
    seen, results = set(), []
    # substring
    for s in stations:
        if q in s['norm'] and s['norm'] not in seen:
            results.append(s); seen.add(s['norm'])
        if len(results) >= 4:
            break
    # fuzzy fallback
    if not results:
        names_norm = [s['norm'] for s in stations]
        close = get_close_matches(q, names_norm, n=8, cutoff=0.3)
        for nm in close:
            for s in stations:
                if s['norm'] == nm and nm not in seen:
                    results.append(s); seen.add(nm)
                    break
            if len(results) >= 4:
                break
    return jsonify([{'name': s['name'], 'lat': s['lat'], 'lon': s['lon']} for s in results])

USER   = "colepolytechnique_nagy_gerg"
PWD   = "8E01pfp2HH"
PARAMS = ['t_2m:C', 'precip_1h:mm']
MODEL      = 'mix'

@app.route('/weather', methods=['POST'])
def get_weather():
    """
    Accepts two kinds of JSON payloads:
      1) {"name": <station_name>}                        → returns 3 nearest resorts
      2) {"resort_name": <name>, "lat": <lat>, "lon": <lon>}
                                                         → returns hourly weather (7d)
                                                            + daily summary
    """
    data = request.get_json(silent=True) or {}

    # ───────────────────────────── 1) SUGGESTIONS ─────────────────────────
    if 'name' in data and all(k not in data for k in ('lat', 'lon', 'resort_name')):
        st_name = data['name']
        station = next((s for s in stations if s['name'] == st_name), None)
        if station is None:
            return jsonify({"error": f"Station '{st_name}' not found."}), 404

        # three closest resorts
        closest = sorted(
            resorts,
            key=lambda r: hav(station['lat'], station['lon'], r['lat'], r['lon'])
        )[:3]

        suggestions = [{
            "name": r["name"],
            "lat":  r["lat"],
            "lon":  r["lon"],
            "distance_km": round(hav(station['lat'], station['lon'],
                                     r['lat'], r['lon']), 2)
        } for r in closest]

        return jsonify({"suggestions": suggestions})

    # ───────────────────────────── 2) WEATHER DATA ────────────────────────
    required = ('resort_name', 'lat', 'lon')
    if not all(k in data for k in required):
        return jsonify({"error": "Bad request – JSON payload missing required keys."}), 400

    resort_name = data['resort_name']
    resort_lat  = float(data['lat'])
    resort_lon  = float(data['lon'])

    # nearest meteo station from your pre-loaded list
    best = min(stations, key=lambda s: hav(resort_lat, resort_lon, s['lat'], s['lon']))
    dist_km = hav(resort_lat, resort_lon, best['lat'], best['lon'])

    # query Meteomatics: 7 days, hourly
    start = dt.datetime.now(dt.UTC).replace(minute=0, second=0, microsecond=0)
    end   = start + dt.timedelta(days=9)
    iv    = dt.timedelta(hours=1)

    try:
        df = api.query_time_series(
            [(best['lat'], best['lon'])],
            start, end, iv,
            PARAMS, USER, PWD,
            model=MODEL
        )
    except Exception as exc:
        app.logger.exception(exc)
        return jsonify({"error": "Meteomatics query failed."}), 502

    # ── tidy the DataFrame ───────────────────────────────────────────────
    # flatten column MultiIndex
    df.columns = [c[0] if isinstance(c, tuple) else str(c) for c in df.columns]

    # ensure DatetimeIndex in UTC
    if isinstance(df.index[0], tuple):
        df.index = pd.to_datetime([idx[-1] for idx in df.index], utc=True)
    else:
        df.index = pd.to_datetime(df.index, utc=True)

    # hourly → dict  { "2025-05-19T12:00:00Z": {"t_2m:C": …, "precip_1h:mm": …}, … }
    weather_json = json.loads(
        df.to_json(date_format="iso", orient="index")
    )

    # ── per-day aggregates (min / max / mean temp, sum precip) ───────────
    daily_df = df.resample("D").agg({
        "t_2m:C":       ["min", "max", "mean"],
        "precip_1h:mm": "sum"
    })
    daily_df.columns = ["min_temp", "max_temp", "avg_temp", "total_precip"]

    daily_summary = [{
        "date":          ts.date().isoformat(),
        "min_temp":      round(row.min_temp, 1),
        "max_temp":      round(row.max_temp, 1),
        "avg_temp":      round(row.avg_temp, 1),
        "total_precip":  round(row.total_precip, 2)
    } for ts, row in daily_df.iterrows()]

    street_data = {
      "lat":     resort_lat,
      "lon":     resort_lon,
      "heading": 0,
      "pitch":   0,
      "zoom":    1    
    }

    # ── final JSON response ──────────────────────────────────────────────
    return jsonify({
        "resort_chosen": {
            "name": resort_name,
            "lat":  resort_lat,
            "lon":  resort_lon
        },
        "station_used": {
            "name": best['name'],
            "lat":  best['lat'],
            "lon":  best['lon'],
            "distance_km": round(dist_km, 2)
        },
        "weather": weather_json,   # hourly (168 keys)
        "daily":   daily_summary,   # 7 elements
        "street_data":  street_data
    })

@app.route("/popular")
def get_popular():
    """Return the hard-wired list on page load."""
    return jsonify(popular_resorts)


@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp




# -----------------------------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True)