"use strict";

// How many members live around a place -- a hospital the office is
// contracting with, say: households and people within 10, 25, 50, 75 and 100
// miles of a ZIP code, and by ZIP. Counts only, no names, so a printout can
// go to the hospital. Distances are straight-line miles between ZIP code
// centre points (US Census Bureau data in zip-locations.txt), not driving
// distance. The same rules as the office's Member Finder.

const fs = require("fs");
const path = require("path");

const BANDS = [10, 25, 50, 75, 100];
const MAX_CHOICES = [25, 50, 75, 100, 150, 200, 250];

let zips = null;
/** ZIP -> [lat, lon], read once. */
function loadZips(file = path.join(__dirname, "zip-locations.txt")) {
  if (!zips) zips = parseZips(fs.readFileSync(file, "utf8"));
  return zips;
}

function parseZips(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const [z, a, b] = line.split(",");
    if (/^\d{5}$/.test(z)) map.set(z, [Number(a), Number(b)]);
  }
  return map;
}

/** The 5-digit ZIP at the start of a ZIP or ZIP+4, or "". */
const zip5 = (v) => (String(v || "").match(/^\s*(\d{5})/) || [])[1] || "";

// A ZIP's point. A PO-box-only ZIP has no area of its own, so it borrows the
// numerically nearest ZIP with the same first three digits (the same mail
// sorting area): close, but marked approximate.
function zipPoint(map, zip, cache = new Map()) {
  if (!zip) return null;
  if (cache.has(zip)) return cache.get(zip);
  let found = map.has(zip) ? { pt: map.get(zip), approx: false } : null;
  if (!found) {
    const n = Number(zip);
    const prefix = zip.slice(0, 3);
    let best = null;
    for (const [z, pt] of map) if (z.startsWith(prefix) && (!best || Math.abs(Number(z) - n) < Math.abs(Number(best[0]) - n))) best = [z, pt];
    found = best ? { pt: best[1], approx: true, via: best[0] } : null;
  }
  cache.set(zip, found);
  return found;
}

/** Straight-line ("as the crow flies") miles between two [lat, lon] points. */
function milesBetween([la1, lo1], [la2, lo2]) {
  const R = 3958.8;
  const rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad;
  const dLo = (lo2 - lo1) * rad;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Households (and the people in them) within `maxMi` of ZIP `origin`, by
 * distance ring and by ZIP; null when `origin` isn't a real ZIP area (a typo
 * shouldn't quietly borrow a neighbour's location). `households` are the
 * model's (lib/memberModel.js); options: { maxMi, plan, inactive }. People
 * counts are the household's active members unless `inactive`.
 */
function nearReport(model, map, origin, { maxMi = 100, plan = "", inactive = false } = {}) {
  if (!map.has(origin)) return null;
  const from = map.get(origin);
  const bands = [...BANDS.filter((b) => b < maxMi), maxMi].map((to) => ({ to, households: 0, people: 0 }));
  const byZip = new Map();
  const cache = new Map();
  let noZip = 0;
  let approx = 0;
  for (const h of model.households) {
    if (!inactive && !h.active) continue;
    if (plan && h.plan !== plan) continue;
    const z = zip5(h.zip);
    const at = zipPoint(map, z, cache);
    if (!at) {
      noZip++;
      continue;
    }
    const mi = milesBetween(from, at.pt);
    if (mi > maxMi) continue;
    const people = h.memberIds.filter((id) => inactive || model.byPerson.get(id)?.active).length;
    for (const b of bands) {
      if (mi <= b.to) {
        b.households++;
        b.people += people;
      }
    }
    if (at.approx) approx++;
    const g = byZip.get(z) || { zip: z, miles: mi, approx: at.approx, households: 0, people: 0, cities: new Map(), state: h.state };
    g.households++;
    g.people += people;
    if (h.city) g.cities.set(h.city, (g.cities.get(h.city) || 0) + 1);
    byZip.set(z, g);
  }
  const zipRows = [...byZip.values()]
    .map((g) => ({ zip: g.zip, miles: g.miles, approx: g.approx, households: g.households, people: g.people, state: g.state, city: [...g.cities].sort((a, b) => b[1] - a[1])[0]?.[0] || "" }))
    .sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip));
  const total = bands[bands.length - 1];
  return { origin, maxMi, bands, zips: zipRows, households: total.households, people: total.people, nearest: zipRows.length ? zipRows[0].miles : null, approx, noZip };
}

/**
 * Where members live, for the Map page: households and people per ZIP code,
 * each at its ZIP's centre point, by the same rules as nearReport (active
 * households only unless `inactive`; `plan` narrows to one plan; a PO-box ZIP
 * at its nearest ZIP and marked approximate). Counts only, no names.
 */
function zipCounts(model, map, { plan = "", inactive = false } = {}) {
  const byZip = new Map();
  const cache = new Map();
  let noZip = 0;
  let approx = 0;
  let households = 0;
  let people = 0;
  for (const h of model.households) {
    if (!inactive && !h.active) continue;
    if (plan && h.plan !== plan) continue;
    const z = zip5(h.zip);
    const at = zipPoint(map, z, cache);
    if (!at) {
      noZip++;
      continue;
    }
    const n = h.memberIds.filter((id) => inactive || model.byPerson.get(id)?.active).length;
    households++;
    people += n;
    if (at.approx) approx++;
    const g = byZip.get(z) || { zip: z, lat: at.pt[0], lon: at.pt[1], approx: at.approx, households: 0, people: 0, cities: new Map(), state: h.state };
    g.households++;
    g.people += n;
    if (h.city) g.cities.set(h.city, (g.cities.get(h.city) || 0) + 1);
    byZip.set(z, g);
  }
  const zips = [...byZip.values()]
    .map((g) => ({ zip: g.zip, lat: g.lat, lon: g.lon, approx: g.approx, households: g.households, people: g.people, state: g.state, city: [...g.cities].sort((a, b) => b[1] - a[1])[0]?.[0] || "" }))
    .sort((a, b) => b.households - a.households || a.zip.localeCompare(b.zip));
  return { zips, households, people, approx, noZip };
}

module.exports = { BANDS, MAX_CHOICES, loadZips, parseZips, zip5, zipPoint, milesBetween, nearReport, zipCounts };
