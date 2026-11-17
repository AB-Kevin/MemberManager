"use strict";

// Arranging the Members page's columns by dragging their headings
// (lib/columnLayout.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib/columnLayout");

const usual = () => [
  { key: "name", sticky: true },
  { key: "org", sticky: true },
  { key: "email:a", header: "News" },
  { key: "mail:a", header: "News" },
  { key: "copies:a", header: "News" },
  { key: "email" },
  { key: "city" },
  { key: "f:1" },
  { key: "source" },
];
const keys = (columns) => columns.map((c) => c.key);
const pinned = (columns) => columns.filter((c) => c.sticky).map((c) => c.key);

test("with nothing saved, the columns are as usual", () => {
  const columns = L.apply(usual(), undefined);
  assert.deepEqual(keys(columns), keys(usual()));
  assert.deepEqual(pinned(columns), ["name", "org"]);
});

test("a column moves beside another and keeps its pinning from where it lands", () => {
  const moved = L.move(usual(), ["city"], { key: "email", side: "before" }, false);
  assert.deepEqual(keys(moved), ["name", "org", "email:a", "mail:a", "copies:a", "city", "email", "f:1", "source"]);
  assert.deepEqual(pinned(moved), ["name", "org"]);
});

test("dropping a column among the pinned ones keeps it in view", () => {
  const moved = L.move(usual(), ["city"], { key: "name", side: "after" }, true);
  assert.deepEqual(keys(moved).slice(0, 3), ["name", "city", "org"]);
  assert.deepEqual(pinned(moved), ["name", "city", "org"]);
});

test("dropping on the checkbox column pins it first", () => {
  const moved = L.move(usual(), ["email"], { start: true }, true);
  assert.deepEqual(pinned(moved), ["email", "name", "org"]);
});

test("a pinned column dragged out scrolls with the rest", () => {
  const moved = L.move(usual(), ["org"], { key: "source", side: "after" }, false);
  assert.deepEqual(pinned(moved), ["name"]);
  assert.equal(keys(moved).at(-1), "org");
});

test("a newsletter's columns move together and aren't split by a drop", () => {
  assert.deepEqual(L.unitOf(usual(), "mail:a"), ["email:a", "mail:a", "copies:a"]);
  const moved = L.move(usual(), L.unitOf(usual(), "mail:a"), { key: "source", side: "before" }, false);
  assert.deepEqual(keys(moved), ["name", "org", "email", "city", "f:1", "email:a", "mail:a", "copies:a", "source"]);
  // Dropped after the middle of the newsletter: lands after all of it.
  const after = L.move(usual(), ["city"], { key: "mail:a", side: "after" }, false);
  assert.deepEqual(keys(after).slice(2, 6), ["email:a", "mail:a", "copies:a", "city"]);
});

test("a saved layout comes back, and a column added since lands after its usual neighbour", () => {
  const layout = L.layoutOf(L.move(usual(), ["city"], { key: "name", side: "after" }, true));
  const withNewField = [...usual().slice(0, 8), { key: "f:2" }, usual()[8]];
  const columns = L.apply(withNewField, layout);
  assert.deepEqual(keys(columns), ["name", "city", "org", "email:a", "mail:a", "copies:a", "email", "f:1", "f:2", "source"]);
  assert.deepEqual(pinned(columns), ["name", "city", "org"]);
});

test("a new column after a pinned one doesn't get pinned", () => {
  const layout = { order: ["name", "org", "email:a", "mail:a", "copies:a", "email", "city", "f:1", "source"], pinned: ["name", "org"] };
  const columns = L.apply([{ key: "name", sticky: true }, { key: "id", sticky: true }, ...usual().slice(1)], layout);
  assert.deepEqual(pinned(columns), ["name", "org"]);
  assert.equal(keys(columns)[2], "id");
});

test("columns that are gone are dropped from a saved layout", () => {
  const layout = { order: ["source", "gone", "name", "org", "email:a", "mail:a", "copies:a", "email", "city", "f:1"], pinned: ["name", "gone"] };
  const columns = L.apply(usual(), layout);
  assert.deepEqual(keys(columns), ["name", "source", "org", "email:a", "mail:a", "copies:a", "email", "city", "f:1"]);
  assert.deepEqual(pinned(columns), ["name"]);
});

test("a layout that isn't one is ignored", () => {
  assert.equal(L.isLayout({ order: ["a"], pinned: [] }), true);
  assert.equal(L.isLayout({ order: "a", pinned: [] }), false);
  assert.equal(L.isLayout({ order: [1], pinned: [] }), false);
  assert.deepEqual(keys(L.apply(usual(), { order: "nope" })), keys(usual()));
});

test("a column made wider keeps its width; the rest keep their usual ones", () => {
  const sized = usual().map((c) => ({ ...c, width: 100 }));
  const arranged = L.apply(sized, undefined);
  arranged.find((c) => c.key === "city").width = 260;
  const layout = L.layoutOf(arranged, sized);
  assert.deepEqual(layout.widths, { city: 260 });
  const columns = L.apply(sized, layout);
  assert.equal(columns.find((c) => c.key === "city").width, 260);
  assert.equal(columns.find((c) => c.key === "email").width, 100);
  // A width saved out of bounds is brought back within them.
  assert.equal(L.apply(sized, { ...layout, widths: { city: 5 } }).find((c) => c.key === "city").width, L.MIN_WIDTH);
  assert.equal(L.isLayout({ ...layout, widths: { city: "wide" } }), false);
  assert.equal(L.isLayout({ ...layout, widths: [] }), false);
});
