let suggestionItems = [];
let activeIndex = -1;
let selectedStation = null;
let originalStation = null;
window._suggestions = [];
let originalMarker = null;

// 1) Station search: fetch up to 4 matching stations
async function searchStations() {
  const q = document.getElementById('stationSearch').value.trim();
  const ul = document.getElementById('suggestions');
  // reset
  ul.innerHTML = '';
  ul.classList.add('hidden');
  document.getElementById('stationSearch').classList.remove('open');
  suggestionItems = [];
  activeIndex = -1;
  selectedStation = null;

  if (!q) return;

  const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
  const stations = await res.json();

  // dedupe + limit to 4
  const seen = new Set();
  const filtered = stations.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  }).slice(0, 4);

  filtered.forEach((st, i) => {
    const li = document.createElement('li');
    li.textContent = st.name;
    li.addEventListener('click', () => selectStation(i));
    ul.appendChild(li);
    suggestionItems.push({ el: li, station: st });
  });

  if (filtered.length) {ul.classList.remove('hidden');
  document.getElementById('stationSearch').classList.add('open');
  }
  else {
  document.getElementById('stationSearch').classList.remove('open');}
}

// 2) Keyboard navigation for station suggestions
function handleKeydown(e) {
  const ul = document.getElementById('suggestions');
  if (ul.classList.contains('hidden')) return;

  if (e.key === 'ArrowDown') {
    activeIndex = Math.min(activeIndex + 1, suggestionItems.length - 1);
    updateActive();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive();
    e.preventDefault();
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    selectStation(activeIndex);
    e.preventDefault();
  }
}

function updateActive() {
  suggestionItems.forEach(({ el }, i) =>
    el.classList.toggle('active', i === activeIndex)
  );
}

// 3) When a station is clicked
function selectStation(idx) {
  const st = suggestionItems[idx].station;
  selectedStation = st;
  originalStation = st;

  document.getElementById('searchWrapper').classList.add('hidden');
  document.getElementById('suggestions').classList.add('hidden');
  document.getElementById('stationSearch').classList.remove('open');
  document.getElementById('chosenStationName').textContent = st.name;
  document.getElementById('chosenStation').classList.remove('hidden');

  // center map + update WMS
  centerStation(st.lat, st.lon);

  if (originalMarker) {
    map.removeLayer(originalMarker);
  }

  const icon = L.divIcon({
    className: 'original-marker',
    iconSize:    [16, 16],
    iconAnchor:  [8, 8]          // center the div over the coords
  });

  // add the new marker
  originalMarker = L.marker([st.lat, st.lon], { icon })
                    .addTo(map);
}

// 4) Fetch the 3 nearest ski-resort recommendations
async function fetchRecommendations() {
  if (!selectedStation) {
    showMessage('Please select a station first.');
    return;
  }

  try {
    const res = await fetch('/weather', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name: selectedStation.name })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}…`);
    }

    const data = await res.json();

    if (data.suggestions?.length) {
      window._suggestions = data.suggestions;
      showResortSuggestions(data.suggestions);
      showRecommendations();
      showMessage('Here are your recommended destinations:');
    } else {
      showMessage(data.error || 'No recommendations available.');
    }

  } catch (err) {
    showMessage(err.message);
  }
}
// 5) Populate dropdown under "See recommended destinations"
function showRecommendations() {
  const list = document.getElementById('recommendList');
  list.innerHTML = '';
  list.classList.remove('hidden');
  document.getElementById('recommendBtn').classList.add('open'); 

  if (!window._suggestions.length) {
    list.innerHTML = '<li>No recommendations</li>';
    return;
  }

  window._suggestions.forEach((sug, i) => {
    const li = document.createElement('li');
    li.textContent = `${sug.name} (${sug.distance_km} km)`;
    li.addEventListener('click', () => {
      list.classList.add('hidden');
      document.getElementById('recommendBtn').classList.remove('open');
      pickRecommended(i);
    });
    list.appendChild(li);
  });
}

/* ========== SHARED RENDERER  (paste once near top of connect.js) ========== */
function renderWeatherHTML(data){
  let html = `
    <div id="panelStation">${data.resort_chosen.name}</div>
    <p>
    Station used: ${data.station_used.name}
    (${data.station_used.distance_km.toFixed(1)} km away)
    <p>
    <div class="daily-summary-container">
  `;

  data.daily.forEach(day => {
    html += `
      <div class="day-summary glass-light">
        <div class="date">${day.date}</div>
        <div class="meteo">Min ${day.min_temp.toFixed(1)} °C</div>
        <div class="meteo">Max ${day.max_temp.toFixed(1)} °C</div>
        <div class="meteo">Avg ${day.avg_temp.toFixed(1)} °C</div>
        <div class="meteo">Precip ${day.total_precip.toFixed(1)} mm</div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

// global handles
let streetPanorama = null;
let pendingStreetData = null;  // will hold the latest coords until we apply them

function initPanorama() {
  // 1) create the panorama shell
  streetPanorama = new google.maps.StreetViewPanorama(
    document.getElementById("streetFrame"), {
      pov:          { heading: 0, pitch: 0 },
      zoom:          1,
      clickToGo:    true,
      linksControl: true
  });

  // 2) if we've already got data (e.g. from /weather), apply it now
  if (pendingStreetData) {
    applyStreetData(pendingStreetData);
    pendingStreetData = null;
  }
}

// helper to position/pov when we _do_ have coords
function applyStreetData(data) {
  // you can also do the StreetViewService lookup here if you like
  streetPanorama.setPosition({ lat: data.lat, lng: data.lon });
  streetPanorama.setPov({ heading: data.heading, pitch: data.pitch });
  streetPanorama.setZoom(data.zoom);

  const svc = new google.maps.StreetViewService();
  svc.getPanorama(
    { location: { lat: data.lat, lng: data.lon }, radius: 500 },
    (panoData, status) => {
      if (status === google.maps.StreetViewStatus.OK) {
        // load that pano so it has its arrows
        streetPanorama.setPano(panoData.location.pano);
      } else {
        console.warn("No pano within 500 m — loading raw coords");
        streetPanorama.setPosition({ lat: data.lat, lng: data.lon });
      }
      // then set your initial POV & zoom
      streetPanorama.setPov({ heading: data.heading, pitch: data.pitch });
      streetPanorama.setZoom(data.zoom);
    }
  );
}

const media = (() => {
  const still   = document.getElementById('stillImg');
  const video   = document.getElementById('bgVideo');
  const street  = document.getElementById('streetFrame');

  let mode = 'still';                  // 'still' | 'video' | 'street'
  show(still);                         // default visible

  function show(el){
    [still, video, street].forEach(x=>{
      const on = (x===el);
      x.style.opacity        = on ? 1 : 0;
      x.style.pointerEvents  = on ? 'auto' : 'none';
    });
    document.body.classList.toggle('street-mode', el===street);
  }

  async function start(videoSrc, streetSrc){
    if (mode !== 'still') return;

    // prepare sources once
    video.src  = videoSrc;
    street.src = streetSrc;

    mode = 'video';
    show(video);

    try{
      await video.play();              // wait – avoids AbortError
    }catch(err){
      console.error('video play error', err);
      reset();
      return;
    }

    video.onended = () => {
      if (mode !== 'video') return;    // user may have reset mid-play
      mode = 'street';
      show(street);
    };
  }

  function reset(){
    mode = 'still';
    video.pause();
    show(still);
  }

  return { start, reset };
})();

function wireBackgroundToggle(info){        // not “streetURL” any more
  const btn = document.getElementById('playVideoBtn');
  if (!btn) return;

  const videoSrc = '/static/transition_ski.mp4';

  btn.onclick = () => {
    if (btn.dataset.state !== 'playing'){
      // drive the Street View camera
      streetPanorama.setPosition({ lat: info.lat, lng: info.lon });
      streetPanorama.setPov({ heading: info.heading, pitch: info.pitch });
      streetPanorama.setZoom(info.zoom);

      media.start(videoSrc);
      btn.dataset.state = 'playing';
      btn.textContent   = 'Back to photo';
    }else{
      media.reset();
      btn.dataset.state = '';
      btn.textContent   = 'Play animation';
    }
  };
}

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  const recContainer = document.querySelector('.recommend-container');
  if (recContainer && !recContainer.contains(e.target)) {
    document.getElementById('recommendList').classList.add('hidden');
    document.getElementById('recommendBtn').classList.remove('open'); 
  }
  const searchWrapper = document.getElementById('searchWrapper');
  if (searchWrapper && !searchWrapper.contains(e.target)) {
    document.getElementById('suggestions').classList.add('hidden');
    document.getElementById('stationSearch').classList.remove('open');
  }
});

// current scale
let bgScale = 1;
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const bg = document.querySelector('.bg-container');

// prevent passive so we can call preventDefault
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();

    // adjust scale by a small amount
    const delta = -e.deltaY * 0.001;      // tweak sensitivity
    bgScale = Math.min(Math.max(bgScale + delta, MIN_SCALE), MAX_SCALE);

    // apply the transform
    bg.style.transform = `scale(${bgScale})`;
  }
}, { passive: false });

function showMessage(html) {
  const box   = document.getElementById('output');
  const inner = document.getElementById('outputInner');
  inner.innerHTML = html;
  box.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', loadPopular);

async function loadPopular() {
  try {
    const res = await fetch('/popular');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const popular = await res.json();

    const list = document.getElementById('popularList');
    popular.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r.name;
      li.addEventListener('click', () => choosePopular(r));
      list.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

// Re-use the same weather route as pickRecommended
async function choosePopular(r) {
  centerStation(r.lat, r.lon);

  try {
    // 1) fetch weather + street_data
    const res = await fetch('/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resort_name: r.name,
        lat:         r.lat,
        lon:         r.lon
      })
    });

    // 2) check HTTP status
    if (!res.ok) {
      // server returned an error payload
      throw new Error(await res.text());
    }

    // 3) parse JSON
    const data = await res.json();

    // 4) server‐side error?
    if (data.error) {
      showMessage(data.error);
      return;
    }

    // 5) wire up StreetView now that we have data.street_data
    pendingStreetData = data.street_data;
    if (streetPanorama) {
      applyStreetData(pendingStreetData);
      pendingStreetData = null;
    }
    wireBackgroundToggle(data.street_data);

    // 6) update the UI
    showMessage(renderWeatherHTML(data));
    addHistory(
      data.resort_chosen.name,
      data.resort_chosen.lat,
      data.resort_chosen.lon
    );

  } catch (err) {
    // any network, parse, or thrown error ends up here
    showMessage(err.message);
  }
}

async function pickRecommended(idx){
  const rec = window._suggestions[idx];
  if (!rec) return;                               // safety guard

  // 1) centre the map on that resort
  centerStation(rec.lat, rec.lon);

  try {
    // 2) ask the server for weather + daily summary + Street-View URL
    const res = await fetch('/weather', {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({
        resort_name: rec.name,
        lat: rec.lat,
        lon: rec.lon
      })
    });
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    if (data.error){
      showMessage(data.error);
      return;
    }

    // 3) render the panel
    showMessage( renderWeatherHTML(data) );

    // 4) wire the Play-animation button for THIS resort’s Street-View
    wireBackgroundToggle( data.street_data );

    // 5) drop it into history so the user can recall it
    addHistory(
      data.resort_chosen.name,
      data.resort_chosen.lat,
      data.resort_chosen.lon
    );

  } catch (err){
    showMessage(err.message);
  }
}

/* ─── Recent-history buffer ─────────────────────────────*/
const MAX_HISTORY = 10;        // max items shown; tweak to taste
let historyEntries = [];       // newest first

function addHistory(label, lat, lon) {
  // 1) keep newest at the front
  historyEntries.unshift({ label, lat, lon });

  // 2) truncate if over limit
  if (historyEntries.length > MAX_HISTORY) {
    historyEntries.pop();
  }
  renderHistory();
}

function renderHistory() {
  const ul = document.getElementById('historyList');
  ul.innerHTML = '';                                     // clear
  historyEntries.forEach((h, idx) => {
    const li = document.createElement('li');
    li.textContent = h.label;
    li.title = `${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}`; // tooltip
    li.addEventListener('click', () => {
      // re-center & show weather again if user clicks history entry
      centerStation(h.lat, h.lon);
      fetchWeatherDirect(h.label, h.lat, h.lon);
    });
    ul.appendChild(li);
  });
}

/* direct weather fetch reused by click-through history */
async function fetchWeatherDirect(label,lat,lon){
  try{
    const res = await fetch('/weather',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({resort_name:label,lat,lon})
    });
    if(!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if(data.error){ showMessage(data.error); return; }

    showMessage( renderWeatherHTML(data) );
    wireBackgroundToggle(data.street_data);   
  }catch(err){
    showMessage(err.message);
  }
}

;(function () {
  const box = document.getElementById('output');
  if (!box) return;

  let dragging = false;
  let offsetX  = 0;   // pointer → box left
  let offsetY  = 0;   // pointer → box top

  // helper to start dragging
  function startDrag(clientX, clientY) {
    const rect = box.getBoundingClientRect();

    // 1) switch to fixed positioning
    box.style.position = 'fixed';
    box.style.top      = rect.top  + 'px';
    box.style.left     = rect.left + 'px';
    box.style.bottom   = 'auto';
    box.style.right    = 'auto';

    // 2) compute offsets entirely in viewport space
    offsetX = clientX - rect.left;
    offsetY = clientY - rect.top;

    dragging = true;
    document.body.style.userSelect = 'none';
  }

  // helper to move
  function moveAt(clientX, clientY) {
    if (!dragging) return;
    box.style.left = (clientX - offsetX) + 'px';
    box.style.top  = (clientY - offsetY) + 'px';
  }

  // mouse
  box.addEventListener('mousedown', e => {
    // ignore clicks on the close button
    if (e.target.closest('.close-btn')) return;
    startDrag(e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => moveAt(e.clientX, e.clientY));
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });

  // touch
  box.addEventListener('touchstart', e => {
    if (e.target.closest('.close-btn')) return;
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    moveAt(t.clientX, t.clientY);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    dragging = false;
  });
})();

(function loadGMapsApi(){
  const apiKey = window.GOOGLE_JS_API_KEY;
  if (!apiKey) {
    console.error('Missing Maps API key');
    return;
  }
  const script = document.createElement('script');
  script.defer = true;
  script.src   = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initPanorama`;
  document.head.appendChild(script);
})();

document.addEventListener('DOMContentLoaded', () => {
  document
    .querySelector('#output .close-btn')
    .addEventListener('click', () => {
      document.getElementById('output').classList.add('hidden');
    });
});

document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.getElementById('playVideoBtn');
  const video = document.getElementById('bgVideo');

  if (!btn || !video) return;

  btn.addEventListener('click', () => {
    const playing = document.body.classList.toggle('play-video');

    if (playing) {
      video.currentTime = 0;
      video.play().catch(err => {
      if (err.name !== 'AbortError')   // ignore the harmless one
       console.error('video play error:', err);
      });
      btn.textContent = 'Stop animation';
    } else {
      video.pause();
      btn.textContent = 'Play animation';
    }
  });
});

function attachPlayButtonListener(){
  const btn   = document.getElementById('playVideoBtn');
  const video = document.getElementById('bgVideo');
  if(!btn || !video) return;
  btn.onclick = () => {
    const playing = document.body.classList.toggle('play-video');
    if (playing) { video.currentTime = 0; video.play(); btn.textContent='Stop animation'; }
    else         { video.pause();        btn.textContent='Play animation'; }
  };
}