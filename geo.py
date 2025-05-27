import time
import csv
import googlemaps

API_KEY = "AIzaSyDuIH7bNj5s25W0FjekH5mjihOo3ri8xNQ"
gmaps   = googlemaps.Client(key=API_KEY)

with open("data/ski_resorts.csv", newline='', encoding="utf-8") as fin, \
     open("data/ski_resorts_coords.csv", "w", newline='', encoding="utf-8") as fout:

    reader  = csv.DictReader(fin)
    fieldnames = reader.fieldnames + ["Resort Lat", "Resort Lon"]
    writer  = csv.DictWriter(fout, fieldnames=fieldnames)
    writer.writeheader()

    for row in reader:
        name = row["Ski Resort"] + ", Alps, Europe"
        try:
            geocode_result = gmaps.geocode(name, region="eu")
            if geocode_result:
                loc = geocode_result[0]["geometry"]["location"]
                row["Resort Lat"] = loc["lat"]
                row["Resort Lon"] = loc["lng"]
            else:
                row["Resort Lat"] = ""
                row["Resort Lon"] = ""
        except Exception as e:
            row["Resort Lat"], row["Resort Lon"] = "", ""
        writer.writerow(row)
        time.sleep(0.1)


gmaps = googlemaps.Client(key=API_KEY)

INPUT_CSV  = "data/find_station.csv"
OUTPUT_CSV = "data/find_station_with_elev.csv"

with open(INPUT_CSV, newline="", encoding="utf-8") as fin, \
     open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as fout:

    reader = csv.DictReader(fin, delimiter=";")
    # We'll keep all original fields plus a new Elevation_m
    fieldnames = reader.fieldnames + ["Elevation_m"]
    writer = csv.DictWriter(fout, fieldnames=fieldnames, delimiter=";")
    writer.writeheader()

    for row in reader:
        loc = row["Location Lat,Lon"].strip()
        try:
            lat_str, lon_str = loc.split(",")
            lat, lon = float(lat_str), float(lon_str)
        except ValueError:
            row["Elevation_m"] = ""
            writer.writerow(row)
            continue

        # Query Google Elevation API
        try:
            result = gmaps.elevation((lat, lon))
            if result and "elevation" in result[0]:
                row["Elevation_m"] = round(result[0]["elevation"], 1)
            else:
                row["Elevation_m"] = ""
        except Exception as e:
            print(f"Error fetching elevation for {row['Name']}: {e}")
            row["Elevation_m"] = ""

        writer.writerow(row)
        # Be kind to the API
        time.sleep(0.02)
