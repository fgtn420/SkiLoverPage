var map;
var stationMarker;
var resortMarkers = [];

/* base map only */
document.addEventListener('DOMContentLoaded', () => {
  map = L.map('map').setView([47.0, 10.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              { maxZoom: 18 }).addTo(map);
});

/* centre on a single point, no WMS call */
function centerStation(lat, lon) {
  map.setView([lat, lon], 10);

  if (stationMarker) map.removeLayer(stationMarker);
  stationMarker = L.circleMarker([lat, lon], {
    radius: 7, color: 'blue', fillOpacity: 0.6
  }).addTo(map);
}

/* red markers for the three suggestions */
function showResortSuggestions(list) {
  resortMarkers.forEach(m => map.removeLayer(m));
  resortMarkers = [];
  list.forEach((r, i) => {
    const m = L.marker([r.lat, r.lon])
      .addTo(map)
      .bindPopup(`${r.name}<br>${r.distance_km} km`)
      .on('click', () => pickRecommended(i));   // pickRecommended is in connect.js
    resortMarkers.push(m);
  });
}