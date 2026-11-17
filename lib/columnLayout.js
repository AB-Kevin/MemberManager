"use strict";

// How someone has arranged the Members page's columns: the order they're in,
// which are pinned at the left, staying in view while the rest scroll, and
// any they've made wider or narrower. Kept as { order: [column key], pinned:
// [column key], widths: { [column key]: pixels } } for each tab, on
// this computer (it's how one person likes to look at the list, not part of
// the list). Loaded with require() in main and tests and as a plain
// <script> in the renderer, where it's window.ColumnLayout.
//
// A column the layout doesn't know -- a field or newsletter added since --
// goes where it would have gone anyway: right after the column before it in
// the usual order. Pinned columns always come first. Columns drawn under one
// heading (a newsletter's Email, Mail and Copies) move as one.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ColumnLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_KEYS = 2000;
  const MIN_WIDTH = 40;
  const MAX_WIDTH = 900;

  const clampWidth = (width) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

  // Pinned first, otherwise as they are.
  function pinnedFirst(columns) {
    return [...columns.filter((c) => c.sticky), ...columns.filter((c) => !c.sticky)];
  }

  // `columns` in their usual order, with their usual `sticky`, arranged as
  // `layout` says. Returns new column objects; the originals are untouched.
  function apply(columns, layout) {
    if (!isLayout(layout)) return columns.map((c) => ({ ...c }));
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const pinned = new Set(layout.pinned);
    const widths = layout.widths || {};
    const sized = (col) => (Object.hasOwn(widths, col.key) ? { ...col, width: clampWidth(widths[col.key]) } : col);
    const result = [...new Set(layout.order)].filter((key) => byKey.has(key)).map((key) => ({ ...sized(byKey.get(key)), sticky: pinned.has(key) }));
    const placed = new Set(result.map((c) => c.key));
    columns.forEach((col, i) => {
      if (placed.has(col.key)) return;
      const after = i > 0 ? result.findIndex((c) => c.key === columns[i - 1].key) : -1;
      result.splice(after + 1, 0, { ...sized(col), sticky: false });
      placed.add(col.key);
    });
    return pinnedFirst(result);
  }

  // The keys that move together with `key`: every column under the same
  // heading, next to it.
  function unitOf(columns, key) {
    const i = columns.findIndex((c) => c.key === key);
    if (i < 0) return [];
    const header = columns[i].header;
    if (!header) return [key];
    let start = i;
    let end = i;
    while (start > 0 && columns[start - 1].header === header) start--;
    while (end < columns.length - 1 && columns[end + 1].header === header) end++;
    return columns.slice(start, end + 1).map((c) => c.key);
  }

  // Moves the columns `keys` to `target` -- { key, side: "before" | "after" }
  // beside another column, or { start: true } for the very first place --
  // pinned or not as `pinned` says. Landing in the middle of another
  // heading's columns moves past them, so a heading is never split.
  function move(columns, keys, target, pinned) {
    const moving = new Set(keys);
    const moved = columns.filter((c) => moving.has(c.key)).map((c) => ({ ...c, sticky: !!pinned }));
    if (!moved.length) return columns.map((c) => ({ ...c }));
    const rest = columns.filter((c) => !moving.has(c.key)).map((c) => ({ ...c }));
    let index = 0;
    if (!target.start) {
      const unit = unitOf(rest, target.key);
      if (!unit.length) return columns.map((c) => ({ ...c }));
      const edge = target.side === "after" ? unit[unit.length - 1] : unit[0];
      index = rest.findIndex((c) => c.key === edge) + (target.side === "after" ? 1 : 0);
    }
    rest.splice(index, 0, ...moved);
    return pinnedFirst(rest);
  }

  // What to save for `columns` as they're arranged now. Only widths that
  // differ from the `usual` columns' are kept, so the rest follow any change
  // to the usual ones (a yes/no field's column fits its name).
  function layoutOf(columns, usual = []) {
    const usualWidth = new Map(usual.map((c) => [c.key, c.width]));
    const widths = {};
    for (const c of columns) if (c.width !== usualWidth.get(c.key)) widths[c.key] = c.width;
    return { order: columns.map((c) => c.key), pinned: columns.filter((c) => c.sticky).map((c) => c.key), widths };
  }

  function isLayout(layout) {
    return (
      !!layout &&
      Array.isArray(layout.order) &&
      Array.isArray(layout.pinned) &&
      layout.order.length <= MAX_KEYS &&
      layout.pinned.length <= MAX_KEYS &&
      [...layout.order, ...layout.pinned].every((key) => typeof key === "string" && key.length <= 200) &&
      (layout.widths === undefined ||
        (!!layout.widths &&
          typeof layout.widths === "object" &&
          !Array.isArray(layout.widths) &&
          Object.keys(layout.widths).length <= MAX_KEYS &&
          Object.entries(layout.widths).every(([key, width]) => key.length <= 200 && Number.isFinite(width))))
    );
  }

  return { apply, move, unitOf, layoutOf, isLayout, clampWidth, MIN_WIDTH, MAX_WIDTH };
});
