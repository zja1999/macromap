/* Macro Map — location & discovery.
 *
 * Leaflet map (OpenStreetMap tiles), browser geolocation, Nominatim geocoding
 * for address/city search, and the Overpass API for finding nearby fast-food /
 * restaurants. All services are free and key-less. Discovered places are matched
 * against our nutrition database so the UI can show which chains have data.
 */
window.MM = window.MM || {};

window.MM.map = (function () {
  var map = null;
  var markerLayer = null;
  var youMarker = null;
  var radiusCircle = null;
  var current = null; // { lat, lng, label }

  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371000; // metres
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function metresToMiles(m) { return m / 1609.34; }

  function init(elementId) {
    if (map) return map;
    map = L.map(elementId, { zoomControl: true }).setView([39.8283, -98.5795], 4); // US centre
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    return map;
  }

  function setView(lat, lng, label, zoom) {
    current = { lat: lat, lng: lng, label: label || "Selected location" };
    window.MM.store.setLastLocation(current);
    map.setView([lat, lng], zoom || 14);

    if (youMarker) markerLayer.removeLayer(youMarker);
    youMarker = L.circleMarker([lat, lng], {
      radius: 8, color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.9, weight: 2
    }).addTo(markerLayer).bindPopup("<b>" + escapeHtml(current.label) + "</b>");
    return current;
  }

  function getCurrent() { return current; }

  // Browser geolocation -> resolves { lat, lng }.
  function locateUser() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error("Geolocation not supported by this browser.")); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function (err) { reject(new Error(geoErr(err))); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  function geoErr(err) {
    if (err.code === 1) return "Location permission denied. Try searching an address instead.";
    if (err.code === 2) return "Location unavailable. Try searching an address instead.";
    if (err.code === 3) return "Location request timed out. Try again or search an address.";
    return "Could not get your location.";
  }

  // Nominatim geocoding -> resolves { lat, lng, label }.
  function geocode(query) {
    var url = NOMINATIM + "?format=json&limit=1&q=" + encodeURIComponent(query);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.length) throw new Error("No place found for \"" + query + "\".");
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          label: data[0].display_name.split(",").slice(0, 2).join(",")
        };
      });
  }

  /* Query Overpass for food places within `radiusMeters` of (lat,lng).
   * Resolves an array of place objects, nearest first. */
  function searchNearby(lat, lng, radiusMeters) {
    var r = radiusMeters || 2400;
    var q =
      "[out:json][timeout:25];(" +
      "node[\"amenity\"~\"fast_food|restaurant|cafe\"](around:" + r + "," + lat + "," + lng + ");" +
      "way[\"amenity\"~\"fast_food|restaurant|cafe\"](around:" + r + "," + lat + "," + lng + ");" +
      ");out center tags 80;";

    function doFetch() {
      return fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q)
      }).then(function (resp) {
        if (resp.status === 429) return null; // signal retry
        if (!resp.ok) throw new Error("Overpass request failed (" + resp.status + ").");
        return resp.json();
      });
    }

    return doFetch().then(function (data) {
      if (data !== null) return data;
      // 429: wait 3 s and try once more before giving up
      return new Promise(function (resolve) { setTimeout(resolve, 3000); })
        .then(doFetch)
        .then(function (data2) {
          if (data2 === null) throw new Error("The map service is busy — wait a moment and try again.");
          return data2;
        });
    })
      .then(function (data) {
        var seen = {};
        var places = (data.elements || []).map(function (el) {
          var plat = el.lat != null ? el.lat : (el.center && el.center.lat);
          var plng = el.lon != null ? el.lon : (el.center && el.center.lon);
          var tags = el.tags || {};
          var name = tags.brand || tags.name;
          if (!plat || !plng || !name) return null;
          var chain = window.MM.matchChain(tags.brand || tags.name);
          return {
            id: el.type + "/" + el.id,
            name: name,
            amenity: tags.amenity,
            lat: plat,
            lng: plng,
            distance: haversine(lat, lng, plat, plng),
            chain: chain,
            hasData: !!chain
          };
        }).filter(Boolean).filter(function (p) {
          // de-dupe by name + rounded coords
          var key = p.name + Math.round(p.lat * 1000) + Math.round(p.lng * 1000);
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
        places.sort(function (a, b) { return a.distance - b.distance; });
        return places;
      });
  }

  /* Draw markers for places. onSelect(place) fires on marker/popup click. */
  function renderPlaces(places, radiusMeters, onSelect) {
    // clear existing place markers but keep the "you" marker
    markerLayer.clearLayers();
    if (youMarker) youMarker.addTo(markerLayer);

    if (current && radiusMeters) {
      if (radiusCircle) markerLayer.removeLayer(radiusCircle);
      radiusCircle = L.circle([current.lat, current.lng], {
        radius: radiusMeters, color: "#3b82f6", weight: 1, opacity: 0.35,
        fillColor: "#3b82f6", fillOpacity: 0.05
      }).addTo(markerLayer);
    }

    places.forEach(function (p) {
      var color = p.hasData ? (p.chain.color || "#16a34a") : "#9ca3af";
      var marker = L.marker([p.lat, p.lng], { icon: pinIcon(color, p.hasData) }).addTo(markerLayer);
      var miles = metresToMiles(p.distance).toFixed(1);
      var html = "<div class='popup'><b>" + escapeHtml(p.name) + "</b><br>" +
        "<span class='popup-sub'>" + escapeHtml(p.amenity || "food") + " · " + miles + " mi</span><br>" +
        (p.hasData
          ? "<button class='popup-btn' data-place='" + p.id + "'>View menu &amp; macros →</button>"
          : "<span class='popup-nodata'>No nutrition data yet</span>") +
        "</div>";
      marker.bindPopup(html);
      marker.on("popupopen", function () {
        var btn = document.querySelector(".popup-btn[data-place='" + p.id + "']");
        if (btn && onSelect) btn.addEventListener("click", function () { onSelect(p); });
      });
    });
  }

  function pinIcon(color, hasData) {
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='26' height='34' viewBox='0 0 26 34'>" +
      "<path d='M13 0C6 0 0 5.4 0 12.2 0 21 13 34 13 34s13-13 13-21.8C26 5.4 20 0 13 0z' fill='" + color + "'/>" +
      "<circle cx='13' cy='12' r='5.5' fill='white'/>" +
      (hasData ? "<circle cx='13' cy='12' r='2.6' fill='" + color + "'/>" : "") +
      "</svg>";
    return L.divIcon({
      className: "mm-pin",
      html: svg,
      iconSize: [26, 34],
      iconAnchor: [13, 34],
      popupAnchor: [0, -32]
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  return {
    init: init,
    setView: setView,
    getCurrent: getCurrent,
    locateUser: locateUser,
    geocode: geocode,
    searchNearby: searchNearby,
    renderPlaces: renderPlaces,
    metresToMiles: metresToMiles,
    invalidate: function () { if (map) setTimeout(function () { map.invalidateSize(); }, 80); }
  };
})();
