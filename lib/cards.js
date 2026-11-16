"use strict";

// Member cards, printed on preprinted CR80 cards (the office's IDP SMART-51):
// a card design has a front and a back, each with a template image (an SVG
// of the preprinted card, for placing fields on) and the fields to print on
// it. Each side is printed on its own -- a stack of fronts, then the same
// cards' backs. Usually only the fields print, since the card already has
// the rest; a side can print its image too, for blank cards.
//
// A design is a row in cardTemplates.json:
//
//   { id, name, cardFor: "household" | "person", orientation: "landscape" | "portrait",
//     sides: { front: Side, back: Side } }
//   Side: { image: "card-templates/<id>.svg" | null, imageName, printImage,
//           offset: { x, y }, elements: [Element] }
//   Element: { id, kind: "field" | "text", key, text, prefix, x, y, w, h,
//              font, size, bold, italic, align, color, case, fit }
//
// `case` is how a field's capitals print: "asis", "name" (an ALL-CAPS name
// as "Bruce L Graber") or "upper". Names come from FundTrack in capitals, so
// name fields start as "name"; the list itself keeps them as they are, since
// SendNewsletters' envelopes and FormTracker use it too.
//
// Positions and sizes are millimetres from the card's top left corner; font
// sizes are points. `offset` moves everything on that side, for a printer that
// prints a little off. A field's `key` is a Lists field (lib/lists.js) or one
// of the card fields below.

const lists = require("./lists");

const CARD = { long: 85.6, short: 53.98 }; // CR80, in mm

// Fonts that come with MemberManager, embedded in every printed card so it
// looks the same on any computer: Atkinson Hyperlegible (the Braille
// Institute's, SIL Open Font License) draws its zero with a slash, so a 0
// can't be mistaken for an O in a Member ID. `files` are its latin WOFF2s in
// node_modules/@fontsource.
const BUNDLED_FONTS = [
  {
    family: "Atkinson Hyperlegible",
    note: "slashed zero",
    files: [
      { weight: 400, style: "normal", file: "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2" },
      { weight: 700, style: "normal", file: "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2" },
      { weight: 400, style: "italic", file: "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2" },
      { weight: 700, style: "italic", file: "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-italic.woff2" },
    ],
  },
];
// Then Windows' own.
const FONTS = [...BUNDLED_FONTS.map((f) => f.family), "Arial", "Arial Narrow", "Calibri", "Segoe UI", "Tahoma", "Verdana", "Georgia", "Times New Roman", "Courier New"];

/** @font-face rules embedding the bundled fonts; `read(file)` gives a file's bytes. */
function fontFaces(read) {
  return BUNDLED_FONTS.flatMap((f) =>
    f.files.map(
      (x) =>
        `@font-face { font-family: '${f.family}'; font-weight: ${x.weight}; font-style: ${x.style}; src: url(data:font/woff2;base64,${read(x.file).toString("base64")}) format('woff2'); }`
    )
  ).join("\n");
}
const SIDES = ["front", "back"];

/** The card's width and height in mm. */
const cardSize = (orientation) => (orientation === "portrait" ? { w: CARD.short, h: CARD.long } : { w: CARD.long, h: CARD.short });

const blankSide = () => ({ image: null, imageName: "", printImage: false, offset: { x: 0, y: 0 }, elements: [] });

function newDesign(name, cardFor = "household", orientation = "landscape") {
  return { name, cardFor: cardFor === "person" ? "person" : "household", orientation: orientation === "portrait" ? "portrait" : "landscape", sides: { front: blankSide(), back: blankSide() } };
}

const listKind = (cardFor) => (cardFor === "person" ? "people" : "households");

// Fields that are names: they start out printed as "Bruce L Graber".
const NAME_FIELDS = new Set(["p.name", "h.name", "h.head", "card.spouse", "card.members", "card.membersBirth", "c.attn", "c.cname"]);
const CASES = ["asis", "name", "upper"];

/**
 * An ALL-CAPS name with only its first letters capitals: "SHEILA R. GRABER"
 * -> "Sheila R. Graber", "GRABER-BRUCE" -> "Graber-Bruce", "MCCOMBS" ->
 * "McCombs", "O'BRIEN" -> "O'Brien". A word that already has small letters
 * is left as it is ("McDonald", "DeLuca"), and so are initials and roman
 * numerals ("III").
 */
function nameCase(text) {
  return String(text ?? "").replace(/[A-Za-z]+(?:'[A-Za-z]+)*/g, (word) => {
    if (/[a-z]/.test(word) || word.length === 1 || /^(II|III|IV|VI|VII|VIII|IX)$/.test(word)) return word;
    const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();
    let out = word.split("'").map((part, i, parts) => (i > 0 && parts[0].length === 1 ? title(part) : i === 0 ? title(part) : part.toLowerCase())).join("'");
    if (/^Mc[a-z]{2,}/.test(out)) out = `Mc${out.charAt(2).toUpperCase()}${out.slice(3)}`;
    return out;
  });
}

/**
 * A name's initials with a period: a letter on its own, with more of the name
 * after it, is an initial -- "BRUCE L GRABER" -> "BRUCE L. GRABER", "J R
 * TOLKIEN" -> "J. R. TOLKIEN". One that has its period already is left
 * alone, and so is a letter at the very end ("SMITH, J") and the O in O'BRIEN.
 */
function initialsWithPeriods(text) {
  return String(text ?? "").replace(/(^|[ \t])([A-Za-z])(?=[ \t]+[A-Za-z])/gm, "$1$2.");
}

/** How a field's capitals start out: names as names, everything else as entered. */
const defaultCase = (kind, key) => (kind === "field" && NAME_FIELDS.has(key) ? "name" : "asis");

/** Whether a file's text is an SVG image, and its aspect (width / height) if it says. */
function svgInfo(text) {
  const t = String(text || "").replace(/^﻿/, "");
  const m = /<svg\b([^>]*)>/i.exec(t);
  if (!m || !/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg\b/i.test(t)) return null;
  const attr = (name) => (new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(m[1]) || [])[1];
  const box = (attr("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const num = (v) => (v ? parseFloat(v) : NaN);
  const w = box.length === 4 && box[2] > 0 ? box[2] : num(attr("width"));
  const h = box.length === 4 && box[3] > 0 ? box[3] : num(attr("height"));
  return { aspect: w > 0 && h > 0 ? w / h : null };
}

// Card-only fields: lines worked out for a card, besides every Lists field.
function cardFields(kind) {
  const address = (h) => (h ? [h.addressLine1, h.addressLine2, [[h.city, h.state].filter(Boolean).join(", "), h.zip].filter(Boolean).join(" ")].filter(Boolean) : []);
  const today = () => new Date().toLocaleDateString("en-US");
  const memberLines = (model, h, withBirth) =>
    (h ? h.memberIds.map((id) => model.byPerson.get(id)).filter((p) => p.active) : []).map((p) => (withBirth && p.birthShown ? `${p.name}  ${p.birthShown}` : p.name));
  const H = (r) => (kind === "households" ? r.h : r.h);
  // The head's spouse: someone in the household whose role is Spouse (or
  // Wife or Husband), and who's still covered -- a spouse FundTrack has made
  // inactive isn't put on a card. On a person's card it's their own spouse:
  // the head's spouse for the head, the head for the spouse, and nobody for
  // anyone else.
  const isSpouse = (p) => /\b(spouse|wife|husband)\b/i.test(p?.role || "");
  const spouseName = (model, r) => {
    const h = H(r);
    if (!h) return "";
    const members = h.memberIds.map((id) => model.byPerson.get(id)).filter(Boolean);
    const head = model.byPerson.get(h.headId);
    const spouse = members.find((p) => p.id !== h.headId && isSpouse(p) && p.ownStatus !== "Inactive");
    if (kind === "households" || r.p.id === h.headId) return spouse?.name || "";
    if (isSpouse(r.p) && head && head.ownStatus !== "Inactive") return head.name;
    return "";
  };
  return [
    { k: "card.spouse", label: "Spouse's name (blank if none)", group: "Card", value: (model, r) => spouseName(model, r) },
    { k: "card.address", label: "Address (on 2–3 lines)", group: "Card", lines: true, value: (model, r) => address(H(r)).join("\n") },
    { k: "card.address1", label: "Address (on one line)", group: "Card", value: (model, r) => address(H(r)).join(", ") },
    { k: "card.members", label: "Household members (one per line)", group: "Card", lines: true, value: (model, r) => memberLines(model, H(r), false).join("\n") },
    { k: "card.membersBirth", label: "Household members with birth dates", group: "Card", lines: true, value: (model, r) => memberLines(model, H(r), true).join("\n") },
    { k: "card.today", label: "Today's date", group: "Card", value: () => today() },
  ];
}

/** Every field a design's cards can show: [{ k, label, group, lines }], card fields first. `cat` is the Lists catalog for its kind. */
function fieldChoices(cat) {
  const kind = cat.kind;
  return [
    ...cardFields(kind).map(({ k, label, group, lines }) => ({ k, label, group, lines: !!lines, name: NAME_FIELDS.has(k) })),
    ...cat.fields.map((f) => ({ k: f.k, label: f.label, group: f.group, lines: false, name: NAME_FIELDS.has(f.k) })),
  ];
}

/**
 * The records cards are printed for, from refs ([{ k, id }] as Find and
 * Lists give them), in that order; ones no longer on the list are left out.
 * `cat` is the Lists catalog for the design's kind.
 */
function recordsFor(cat, refs) {
  const byRef = new Map(cat.records.map((r) => [cat.kind === "people" ? r.p.id : r.h.key, r]));
  return { cat, records: refs.map((ref) => byRef.get(ref.id)).filter(Boolean) };
}

/** What each of a side's elements says for one record: [{ ...element, value }]. */
function elementValues(model, cat, side, record) {
  const special = new Map(cardFields(cat.kind).map((f) => [f.k, f]));
  return (side.elements || []).map((el) => {
    let value = "";
    if (el.kind === "text") value = el.text || "";
    else if (special.has(el.key)) value = special.get(el.key).value(model, record) || "";
    else if (cat.byKey.has(el.key)) {
      const f = cat.byKey.get(el.key);
      value = String(lists.display(f, f.get(record)) ?? "");
    }
    const how = CASES.includes(el.case) ? el.case : el.upper ? "upper" : defaultCase(el.kind, el.key);
    // A name's initials get their period, however its capitals print.
    const isName = how === "name" || (how === "upper" && el.kind === "field" && NAME_FIELDS.has(el.key));
    if (isName) value = initialsWithPeriods(value);
    if (how === "name") value = nameCase(value);
    else if (how === "upper") value = value.toUpperCase();
    if (el.kind === "field" && value && el.prefix) value = `${el.prefix}${value}`;
    return { ...el, value };
  });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * A printable page per card: the side's fields for each record (and its
 * image, when `printImage` or `withImage` for a preview), at the card's
 * exact size with no margins. `imageUrl` is the side's image as a data URL.
 */
function printHtml(design, sideName, cards, { imageUrl = null, withImage = false, fonts = "" } = {}) {
  const { w, h } = cardSize(design.orientation);
  const side = design.sides[sideName];
  const dx = num(side.offset?.x);
  const dy = num(side.offset?.y);
  const showImage = imageUrl && (side.printImage || withImage);
  const element = (el) => {
    const style = [
      `left:${(num(el.x) + dx).toFixed(2)}mm`,
      `top:${(num(el.y) + dy).toFixed(2)}mm`,
      `width:${Math.max(1, num(el.w, 30)).toFixed(2)}mm`,
      el.h ? `height:${num(el.h).toFixed(2)}mm` : "",
      `font-family:'${String(el.font || "Arial").replace(/'/g, "")}',Arial,sans-serif`,
      `font-size:${num(el.size, 9)}pt`,
      el.bold ? "font-weight:700" : "",
      el.italic ? "font-style:italic" : "",
      `text-align:${["left", "center", "right"].includes(el.align) ? el.align : "left"}`,
      `color:${/^#[0-9a-f]{3,8}$/i.test(el.color || "") ? el.color : "#000"}`,
    ]
      .filter(Boolean)
      .join(";");
    return `<div class="el${el.fit ? " fit" : ""}" style="${style}">${esc(el.value)}</div>`;
  };
  const pages = cards
    .map((elements) => `<div class="card">${showImage ? `<img class="bg" src="${esc(imageUrl)}" alt="" />` : ""}${elements.map(element).join("")}</div>`)
    .join("");
  // Shrink to fit, once the fonts are in: a field marked so gets smaller until it fits its box.
  const fit = `<script>document.fonts.ready.then(()=>{for(const el of document.querySelectorAll(".el.fit")){let s=parseFloat(el.style.fontSize);while(s>4&&(el.scrollWidth>el.clientWidth+0.5||el.scrollHeight>el.clientHeight+0.5)){s-=0.25;el.style.fontSize=s+"pt";}}document.body.dataset.ready="1";});</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(design.name)} (${sideName})</title><style>
    ${fonts}
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .card { position: relative; width: ${w}mm; height: ${h}mm; overflow: hidden; page-break-after: always; break-after: page; }
    .card:last-child { page-break-after: auto; break-after: auto; }
    .bg { position: absolute; left: ${dx}mm; top: ${dy}mm; width: ${w}mm; height: ${h}mm; object-fit: fill; }
    .el { position: absolute; white-space: pre-wrap; overflow: hidden; line-height: 1.15; }
  </style></head><body>${pages}${fit}</body></html>`;
}

/** A design as it's saved, whatever the window sent: known settings only, numbers as numbers. */
function cleanDesign(input, existing) {
  const out = { ...existing };
  if (input.name !== undefined) {
    const name = String(input.name).replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Give the card design a name.");
    out.name = name.slice(0, 80);
  }
  if (input.cardFor !== undefined) out.cardFor = input.cardFor === "person" ? "person" : "household";
  if (input.orientation !== undefined) out.orientation = input.orientation === "portrait" ? "portrait" : "landscape";
  if (input.sides) {
    out.sides = { ...existing.sides };
    for (const sideName of SIDES) {
      const s = input.sides[sideName];
      if (!s) continue;
      const was = existing.sides?.[sideName] || blankSide();
      out.sides[sideName] = {
        ...was,
        printImage: s.printImage !== undefined ? !!s.printImage : was.printImage,
        offset: s.offset ? { x: Math.max(-10, Math.min(10, num(s.offset.x))), y: Math.max(-10, Math.min(10, num(s.offset.y))) } : was.offset,
        elements: Array.isArray(s.elements)
          ? s.elements.slice(0, 60).map((el) => ({
              id: String(el.id || ""),
              kind: el.kind === "text" ? "text" : "field",
              key: String(el.key || ""),
              text: String(el.text || "").slice(0, 500),
              prefix: String(el.prefix || "").slice(0, 40),
              x: num(el.x),
              y: num(el.y),
              w: Math.max(2, num(el.w, 30)),
              h: el.h ? Math.max(2, num(el.h)) : null,
              font: FONTS.includes(el.font) ? el.font : "Arial",
              size: Math.max(4, Math.min(48, num(el.size, 9))),
              bold: !!el.bold,
              italic: !!el.italic,
              align: ["left", "center", "right"].includes(el.align) ? el.align : "left",
              color: /^#[0-9a-f]{3,8}$/i.test(el.color || "") ? el.color : "#000000",
              // Designs saved with the old CAPITALS box keep it.
              case: CASES.includes(el.case) ? el.case : el.upper ? "upper" : defaultCase(el.kind === "text" ? "text" : "field", String(el.key || "")),
              fit: !!el.fit,
            }))
          : was.elements,
      };
    }
  }
  return out;
}

module.exports = { CARD, FONTS, BUNDLED_FONTS, fontFaces, SIDES, CASES, nameCase, initialsWithPeriods, defaultCase, cardSize, newDesign, blankSide, listKind, svgInfo, fieldChoices, recordsFor, elementValues, printHtml, cleanDesign };
