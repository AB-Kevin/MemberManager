"use strict";

// Map: where members live, as a heat map on a street map. Each household is
// counted at its ZIP code's centre point (lib/nearZip.js zipCounts, the same
// rules as Near ZIP), so the map is as fine as ZIP codes and no finer. Zoomed
// in, each ZIP code gets a dot with its counts, and a way to Near ZIP.
//
// The street map's tiles come from OpenStreetMap and need an internet
// connection; the heat and dots are drawn here from the counts alone, so no
// member's details ever leave the computer. Leaflet draws the map.

// How strongly a place shows depends on the busiest place in view, so
// zooming into one area shows how members spread within it.
const HEAT_STOPS = [
  [0, "#2b83ba"],
  [0.3, "#3fbfb0"],
  [0.5, "#abdda4"],
  [0.68, "#fdd25c"],
  [0.84, "#f68a3c"],
  [1, "#d7191c"],
];

function heatPalette() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [at, color] of HEAT_STOPS) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

// The heat is a density: each ZIP code spreads its count over a soft round
// spot, the spots add up, and the busiest point in view is the top colour.
// Worked out on a grid a quarter the window's size, then drawn smoothed.
const GRID = 4;

const HeatLayer = L.Layer.extend({
  initialize() {
    this._points = [];
    this._palette = heatPalette();
    this._kernels = new Map();
  },
  setPoints(points) {
    this._points = points;
    if (this._map) this._redraw();
    return this;
  },
  onAdd(map) {
    this._canvas = L.DomUtil.create("canvas", "member-heat leaflet-zoom-hide");
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on("moveend resize", this._redraw, this);
    this._redraw();
  },
  onRemove(map) {
    map.off("moveend resize", this._redraw, this);
    this._canvas.remove();
  },
  // A spot's shape, R grid squares across from its middle: full at the
  // middle, fading smoothly to nothing at its edge.
  _kernel(R) {
    if (!this._kernels.has(R)) {
      const k = new Float32Array((2 * R + 1) ** 2);
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d2 = (dx * dx + dy * dy) / (R * R);
          k[(dy + R) * (2 * R + 1) + dx + R] = d2 < 1 ? (1 - d2) ** 2 : 0;
        }
      this._kernels.set(R, k);
    }
    return this._kernels.get(R);
  },
  _redraw() {
    const map = this._map;
    const size = map.getSize();
    const canvas = this._canvas;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x;
    canvas.height = size.y;
    if (!this._points.length) return;

    // Spots grow as the map zooms in, since a ZIP code covers more of the screen.
    const radius = Math.max(14, Math.min(60, 4 + map.getZoom() * 4));
    const R = Math.max(2, Math.round(radius / GRID));
    const W = Math.ceil(size.x / GRID);
    const H = Math.ceil(size.y / GRID);
    const grid = new Float32Array(W * H);
    const k = this._kernel(R);
    const side = 2 * R + 1;
    for (const p of this._points) {
      const at = map.latLngToContainerPoint([p.lat, p.lon]);
      const cx = Math.round(at.x / GRID);
      const cy = Math.round(at.y / GRID);
      if (cx < -R || cy < -R || cx > W + R || cy > H + R) continue;
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= W) continue;
          const v = k[(dy + R) * side + dx + R];
          if (v) grid[y * W + x] += v * p.w;
        }
      }
    }
    let max = 0;
    for (const v of grid) if (v > max) max = v;
    if (!max) return;

    // On a square-root scale, so a handful of households still shows beside
    // a settlement of hundreds.
    const small = new ImageData(W, H);
    const px = small.data;
    const pal = this._palette;
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      const t = Math.sqrt(grid[i] / max);
      if (t < 0.02) continue;
      const j = Math.min(255, Math.round(t * 255)) * 4;
      px[i * 4] = pal[j];
      px[i * 4 + 1] = pal[j + 1];
      px[i * 4 + 2] = pal[j + 2];
      px[i * 4 + 3] = Math.round(255 * Math.min(1, t * 1.8));
    }
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    off.getContext("2d").putImageData(small, 0, 0);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W * GRID, H * GRID);
  },
});

// ZIP dots appear from this zoom on (about a county across the window).
const DOTS_FROM_ZOOM = 8;
const US_VIEW = { center: [39.5, -96], zoom: 4 };

window.Pages.map = {
  fill: true,
  async render(container) {
    const saved = window.__mapState || {};
    const state = { show: "households", plan: "", inactive: false, ...saved, view: saved.view || null };
    container.innerHTML = `
      <div class="map-page">
        <h1>Map</h1>
        <div class="sheet-toolbar">
          <label class="map-control">Show
            <select id="map-show"><option value="households">Households</option><option value="people">People</option></select></label>
          <label class="map-control">Plan <select id="map-plan"><option value="">Any plan</option></select></label>
          <label class="check-label"><input type="checkbox" id="map-inactive" /> Include inactive households</label>
          <span class="toolbar-gap"></span>
          <button class="btn secondary" type="button" id="map-fit">Zoom to members</button>
        </div>
        <div class="map-wrap">
          <div id="member-map" aria-label="Map of where members live"></div>
          <div class="map-legend" aria-hidden="true">
            <div class="map-legend-bar"></div>
            <div class="map-legend-ends"><span>Fewer</span><span>More</span></div>
          </div>
          <div class="map-offline" id="map-offline" hidden>The street map needs an internet connection. Where members live still shows.</div>
        </div>
        <p class="hint map-summary" id="map-summary"></p>
      </div>`;
    qs("#map-show", container).value = state.show;
    qs("#map-inactive", container).checked = state.inactive;
    qs(".map-legend-bar", container).style.background = `linear-gradient(to right, ${HEAT_STOPS
      .map(([at, color]) => `${color} ${at * 100}%`)
      .join(", ")})`;

    const map = L.map(qs("#member-map", container), { zoomSnap: 0.5, minZoom: 3, worldCopyJump: true });
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const offline = qs("#map-offline", container);
    tiles.on("tileerror", () => (offline.hidden = false));
    tiles.on("tileload", () => (offline.hidden = true));

    const heat = new HeatLayer().addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    const dots = L.layerGroup();
    let data = null;

    function remember() {
      const c = map.getCenter();
      window.__mapState = { show: state.show, plan: state.plan, inactive: state.inactive, view: { center: [c.lat, c.lng], zoom: map.getZoom() } };
    }
    // The map goes with the page: Leaflet's listeners, and the size watcher.
    let gone = false;
    const sized = new ResizeObserver(() => map.invalidateSize());
    sized.observe(qs("#member-map", container));
    window.__beforeNavigate = () => {
      gone = true;
      remember();
      sized.disconnect();
      map.remove();
    };

    // Where nearly all households are: the middle 98% north to south and
    // east to west, so one household in Alaska doesn't shrink everyone else.
    function fitAll() {
      const pts = data?.zips || [];
      if (!pts.length) return map.setView(US_VIEW.center, US_VIEW.zoom);
      const total = pts.reduce((n, z) => n + z.households, 0);
      const at = (key, share) => {
        const sorted = [...pts].sort((a, b) => a[key] - b[key]);
        let seen = 0;
        for (const z of sorted) if ((seen += z.households) >= share * total) return z[key];
        return sorted[sorted.length - 1][key];
      };
      map.fitBounds(L.latLngBounds([at("lat", 0.01), at("lon", 0.01)], [at("lat", 0.99), at("lon", 0.99)]), { padding: [40, 40], maxZoom: 9 });
    }

    function dotsShown() {
      const want = map.getZoom() >= DOTS_FROM_ZOOM;
      if (want && !map.hasLayer(dots)) dots.addTo(map);
      if (!want && map.hasLayer(dots)) dots.remove();
    }

    function popupFor(z) {
      const el = document.createElement("div");
      el.className = "map-popup";
      el.innerHTML = `
        <div class="map-popup-title">${escapeHtml(z.zip)}${z.city ? ` · ${escapeHtml(z.city)}${z.state ? `, ${escapeHtml(z.state)}` : ""}` : ""}</div>
        <div>${plural(z.households, "household")}, ${plural(z.people, "person", "people")}</div>
        ${z.approx ? `<div class="hint">PO-box ZIP, placed at the nearest ZIP in its area</div>` : ""}
        <button class="btn secondary" type="button">Members near ${escapeHtml(z.zip)}…</button>`;
      el.querySelector("button").addEventListener("click", () => {
        window.__nearState = { ...(window.__nearState || {}), zip: z.zip };
        navigate("near");
      });
      return el;
    }

    function draw() {
      const key = state.show === "people" ? "people" : "households";
      heat.setPoints(data.zips.filter((z) => z[key] > 0).map((z) => ({ lat: z.lat, lon: z.lon, w: z[key] })));
      dots.clearLayers();
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-text").trim() || "#2e7d55";
      for (const z of data.zips) {
        const n = z[key];
        if (!n) continue;
        L.circleMarker([z.lat, z.lon], { renderer, radius: Math.min(18, 4 + Math.sqrt(n) * 1.6), color: accent, weight: 1.5, fillColor: "#ffffff", fillOpacity: 0.85 })
          .bindTooltip(`${escapeHtml(z.zip)}${z.city ? ` ${escapeHtml(z.city)}` : ""}: ${plural(n, key === "people" ? "person" : "household", key === "people" ? "people" : "households")}`, { direction: "top" })
          .bindPopup(() => popupFor(z))
          .addTo(dots);
      }
      dotsShown();

      const summary = qs("#map-summary", container);
      if (!data.zips.length) {
        summary.textContent = data.noZip ? `None of these ${plural(data.noZip, "household")} has a ZIP code that can be placed on the map.` : "No households to show.";
        return;
      }
      summary.textContent = [
        `${plural(data.households, "household")} and ${plural(data.people, "person", "people")} in ${plural(data.zips.length, "ZIP code")}, each placed at its ZIP code's centre.`,
        data.approx ? `${plural(data.approx, "household")} with a PO-box ZIP ${data.approx === 1 ? "is" : "are"} placed at the nearest ZIP in the same area.` : "",
        data.noZip ? `${plural(data.noZip, "household")} with no usable ZIP code ${data.noZip === 1 ? "is" : "are"} left out.` : "",
        `Zoom in to see each ZIP code's count.`,
      ]
        .filter(Boolean)
        .join(" ");
    }

    let request = 0;
    async function load({ fit = false } = {}) {
      const mine = ++request;
      const r = await window.api.mapPoints({ plan: state.plan, inactive: state.inactive });
      if (mine !== request || gone) return;
      data = r;
      const plan = qs("#map-plan", container);
      if (plan.options.length !== r.plans.length + 1) plan.innerHTML = `<option value="">Any plan</option>${r.plans.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}`;
      plan.value = state.plan;
      draw();
      if (fit) fitAll();
    }

    map.on("zoomend", dotsShown);
    map.on("moveend", remember);
    qs("#map-show", container).addEventListener("change", (e) => {
      state.show = e.target.value;
      if (data) draw();
      remember();
    });
    qs("#map-plan", container).addEventListener("change", (e) => {
      state.plan = e.target.value;
      load();
    });
    qs("#map-inactive", container).addEventListener("change", (e) => {
      state.inactive = e.target.checked;
      load();
    });
    qs("#map-fit", container).addEventListener("click", fitAll);
    // Changes from another computer redraw the counts, leaving the map where it is.
    window.__refreshPage = () => load();

    if (state.view) map.setView(state.view.center, state.view.zoom);
    else map.setView(US_VIEW.center, US_VIEW.zoom);
    await load({ fit: !state.view });
  },
};
