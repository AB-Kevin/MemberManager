"use strict";

// Member cards (lib/cards.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const cards = require("../lib/cards");
const lists = require("../lib/lists");
const { buildModel } = require("../lib/memberModel");

test("an SVG is recognized, with its shape; anything else isn't", () => {
  assert.deepEqual(cards.svgInfo('<?xml version="1.0"?>\n<!-- made in Illustrator -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540"></svg>'), { aspect: 856 / 540 });
  assert.deepEqual(cards.svgInfo('<svg width="85.6mm" height="54mm"></svg>'), { aspect: 85.6 / 54 });
  assert.deepEqual(cards.svgInfo("<svg></svg>"), { aspect: null });
  assert.equal(cards.svgInfo("<html><svg></svg></html>"), null);
  assert.equal(cards.svgInfo("PNG..."), null);
});

test("card sizes are CR80, either way round", () => {
  assert.deepEqual(cards.cardSize("landscape"), { w: 85.6, h: 53.98 });
  assert.deepEqual(cards.cardSize("portrait"), { w: 53.98, h: 85.6 });
});

test("a design from the window is tidied: unknown settings dropped, numbers kept in range", () => {
  const design = { id: "d1", ...cards.newDesign("Member card") };
  const next = cards.cleanDesign(
    {
      name: "  Family card ",
      cardFor: "person",
      orientation: "sideways",
      sides: {
        back: {
          printImage: 1,
          offset: { x: "1.5", y: 99 },
          elements: [{ id: "e1", kind: "field", key: "h.memberId", x: "4", y: 6, w: 0, size: 200, font: "Comic Sans", align: "middle", color: "red", evil: "<script>" }],
        },
      },
    },
    design
  );
  assert.equal(next.name, "Family card");
  assert.equal(next.cardFor, "person");
  assert.equal(next.orientation, "landscape");
  assert.deepEqual(next.sides.front, design.sides.front, "a side not sent is left as it was");
  assert.equal(next.sides.back.printImage, true);
  assert.deepEqual(next.sides.back.offset, { x: 1.5, y: 10 });
  const [e] = next.sides.back.elements;
  assert.deepEqual([e.x, e.y, e.w, e.size, e.font, e.align, e.color, e.evil], [4, 6, 2, 48, "Arial", "left", "#000000", undefined]);
  assert.throws(() => cards.cleanDesign({ name: " " }, design), /name/);
});

function model() {
  return buildModel(
    {
      publications: [],
      fields: [{ id: "birth", label: "Birth date", appliesTo: "contact", type: "date" }],
      orgs: [{ id: "o1", name: "Maple Grove", subs: {}, fields: {} }],
      households: [{ id: "m1", addressLine1: "102 Mill Rd", addressLine2: "", city: "Gordonville", state: "PA", zip: "17529", subs: {}, fields: {} }],
      contacts: [
        { id: "amos", name: "Amos Byler", memberId: "BYLAM001", memberStatus: "Active", orgId: "o1", householdId: "m1", fundTrackGroupId: "G1", fields: { birth: "1950-03-05" } },
        { id: "ruth", name: "Ruth <Byler>", orgId: "o1", householdId: "m1", fundTrackGroupId: "G1", fields: { birth: "1952-11-20" } },
      ],
    },
    new Date(2026, 10, 16)
  );
}

test("a card's fields: Lists fields, card fields, text, a prefix and capitals", () => {
  const m = model();
  const choices = cards.fieldChoices(lists.catalog(m, "households"));
  assert.ok(choices.some((f) => f.k === "card.members" && f.lines));
  assert.ok(choices.some((f) => f.k === "h.memberId"));
  const { cat, records } = cards.recordsFor(lists.catalog(m, "households"), [{ id: "ft:G1" }, { id: "gone" }]);
  assert.equal(records.length, 1);
  const side = {
    elements: [
      { id: "a", kind: "field", key: "h.memberId", prefix: "ID: " },
      { id: "b", kind: "field", key: "card.membersBirth" },
      { id: "c", kind: "field", key: "card.address", case: "upper" },
      { id: "d", kind: "text", text: "Member since 1990" },
      { id: "e", kind: "field", key: "h.phone", prefix: "Phone: " },
    ],
  };
  const values = Object.fromEntries(cards.elementValues(m, cat, side, records[0]).map((e) => [e.id, e.value]));
  assert.equal(values.a, "ID: BYLAM001", "a Member ID prints as it is");
  assert.equal(values.b, "Amos Byler  3/5/1950\nRuth <Byler>  11/20/1952");
  assert.equal(values.c, "102 MILL RD\nGORDONVILLE, PA 17529");
  assert.equal(values.d, "Member since 1990");
  assert.equal(values.e, "", "no prefix on a blank field");
  const person = cards.recordsFor(lists.catalog(m, "people"), [{ id: "ruth" }]);
  assert.equal(cards.elementValues(m, person.cat, { elements: [{ id: "n", kind: "field", key: "p.name" }] }, person.records[0])[0].value, "Ruth <Byler>");
  assert.equal(lists.catalog(m, "people").kind, "people");
});

test("the printable page: one card per page at CR80 size, values escaped, the image only when asked", () => {
  const design = { ...cards.newDesign("Card"), sides: { front: { ...cards.blankSide(), offset: { x: 1, y: -0.5 } }, back: cards.blankSide() } };
  const el = { id: "a", kind: "field", x: 5, y: 10, w: 40, h: null, font: "Arial", size: 9, bold: true, italic: false, align: "left", color: "#000000", fit: true };
  const html = cards.printHtml(design, "front", [[{ ...el, value: "Ruth <Byler>" }], [{ ...el, value: "Amos" }]], { imageUrl: "data:image/svg+xml;base64,AAA" });
  assert.match(html, /@page \{ size: 85.6mm 53.98mm; margin: 0; \}/);
  assert.equal((html.match(/class="card"/g) || []).length, 2);
  assert.ok(html.includes("Ruth &lt;Byler&gt;"));
  assert.ok(!html.includes("<Byler>"));
  assert.ok(html.includes("left:6.00mm;top:9.50mm"), "the side's offset moves every field");
  assert.ok(!html.includes("<img"), "a preprinted card's image isn't printed");
  assert.ok(cards.printHtml(design, "front", [[]], { imageUrl: "data:image/svg+xml;base64,AAA", withImage: true }).includes("<img"), "but the preview shows it");
});

test("the slashed-zero font comes first, and is embedded in what's printed", () => {
  assert.equal(cards.FONTS[0], "Atkinson Hyperlegible");
  const faces = cards.fontFaces((file) => require("fs").readFileSync(require.resolve(file)));
  assert.equal((faces.match(/@font-face/g) || []).length, 4, "regular, bold, italic, bold italic");
  assert.match(faces, /font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-style: normal; src: url\(data:font\/woff2;base64,d09GMg/);
  const design = cards.newDesign("Card");
  const html = cards.printHtml(design, "front", [[{ id: "a", kind: "field", x: 1, y: 1, w: 30, font: "Atkinson Hyperlegible", size: 10, align: "left", color: "#000000", value: "GRABR001" }]], { fonts: faces });
  assert.ok(html.includes("@font-face"));
  assert.ok(html.includes("font-family:'Atkinson Hyperlegible',Arial,sans-serif"));
  const cleaned = cards.cleanDesign({ sides: { front: { elements: [{ id: "a", font: "Atkinson Hyperlegible" }] } } }, { id: "d", ...design });
  assert.equal(cleaned.sides.front.elements[0].font, "Atkinson Hyperlegible");
});

test("the spouse's name: the head's spouse, blank when there's none or they're inactive", () => {
  const F = [{ id: "role", label: "Role", appliesTo: "contact", type: "choice" }];
  const person = (id, name, group, role, more = {}) => ({ id, name, householdId: "m1", fundTrackGroupId: group, fields: { role }, ...more });
  const m = buildModel(
    {
      publications: [],
      fields: F,
      orgs: [],
      households: [{ id: "m1", addressLine1: "1 Farm Ln", city: "Gap", state: "PA", zip: "17527", subs: {}, fields: {} }],
      contacts: [
        person("amos", "Amos Byler", "G1", "Head of Household", { memberId: "A1", memberStatus: "Active" }),
        person("katie", "Katie Byler", "G1", "Child"),
        person("ruth", "Ruth Byler", "G1", "Spouse"),
        person("john", "John Byler", "G2", "Head of Household", { memberId: "J2", memberStatus: "Active" }), // no spouse
        person("eli", "Eli Zook", "G3", "Head of Household", { memberId: "E3", memberStatus: "Active" }),
        person("mary", "Mary Zook", "G3", "Spouse", { memberStatus: "Inactive" }), // no longer covered
      ],
    },
    new Date(2026, 10, 16)
  );
  const side = { elements: [{ id: "s", kind: "field", key: "card.spouse", prefix: "& " }] };
  const spouse = (cardFor, id) => {
    const cat = lists.catalog(m, cardFor === "person" ? "people" : "households");
    const { records } = cards.recordsFor(cat, [{ id }]);
    return cards.elementValues(m, cat, side, records[0])[0].value;
  };
  assert.equal(spouse("household", "ft:G1"), "& Ruth Byler", "found among the children, after the head");
  assert.equal(spouse("household", "ft:G2"), "", "no spouse: blank, and no prefix");
  assert.equal(spouse("household", "ft:G3"), "", "an inactive spouse isn't put on a card");
  assert.equal(spouse("person", "amos"), "& Ruth Byler");
  assert.equal(spouse("person", "ruth"), "& Amos Byler", "a spouse's own card names the head");
  assert.equal(spouse("person", "katie"), "");
  assert.ok(cards.fieldChoices(lists.catalog(m, "households")).some((f) => f.k === "card.spouse"));
});

test("names in capitals print with only their first letters capitals", () => {
  const cases = {
    "BRUCE L GRABER": "Bruce L Graber",
    "SHEILA R. GRABER": "Sheila R. Graber",
    "GRABER-BRUCE": "Graber-Bruce",
    "TIMOTHY MCCOMBS": "Timothy McCombs",
    "MARY O'BRIEN": "Mary O'Brien",
    "AMOS STOLTZFUS JR": "Amos Stoltzfus Jr",
    "AMOS STOLTZFUS III": "Amos Stoltzfus III",
    "Ruth McDonald": "Ruth McDonald",
    "JOHN DeLUCA": "John DeLUCA",
    "ELI & RUTH ZOOK": "Eli & Ruth Zook",
    "BRUCE L GRABER  3/5/1950": "Bruce L Graber  3/5/1950",
    "MAC": "Mac",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(cards.nameCase(from), to, from);
});

test("name fields start out printed as names; IDs, addresses and text as entered; the old CAPITALS box still works", () => {
  assert.equal(cards.defaultCase("field", "p.name"), "name");
  assert.equal(cards.defaultCase("field", "card.spouse"), "name");
  assert.equal(cards.defaultCase("field", "h.memberId"), "asis");
  assert.equal(cards.defaultCase("field", "card.address"), "asis");
  assert.equal(cards.defaultCase("text", ""), "asis");
  const design = { id: "d", ...cards.newDesign("Card") };
  const [a, b, c] = cards.cleanDesign({ sides: { front: { elements: [{ id: "a", key: "h.head" }, { id: "b", key: "h.state" }, { id: "c", key: "h.head", upper: true }] } } }, design).sides.front.elements;
  assert.deepEqual([a.case, b.case, c.case], ["name", "asis", "upper"]);
});

test("a middle initial gets a period when it hasn't one", () => {
  const cases = {
    "BRUCE L GRABER": "BRUCE L. GRABER",
    "SHEILA R. GRABER": "SHEILA R. GRABER",
    "J R TOLKIEN": "J. R. TOLKIEN",
    "AMOS STOLTZFUS": "AMOS STOLTZFUS",
    "SMITH, J": "SMITH, J",
    "MARY O'BRIEN": "MARY O'BRIEN",
    "ELI & RUTH ZOOK": "ELI & RUTH ZOOK",
    "BRUCE L GRABER  3/5/1950\nKARA R GRABER": "BRUCE L. GRABER  3/5/1950\nKARA R. GRABER",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(cards.initialsWithPeriods(from), to, from);

  const m = buildModel(
    {
      publications: [],
      fields: [],
      orgs: [],
      households: [{ id: "m1", addressLine1: "1 A ST", city: "Gap", state: "PA", zip: "17527", subs: {}, fields: {} }],
      contacts: [{ id: "b", name: "BRUCE L GRABER", memberId: "GRABR001", householdId: "m1", fundTrackGroupId: "G1", fields: {} }],
    },
    new Date(2026, 10, 16)
  );
  const cat = lists.catalog(m, "households");
  const { records } = cards.recordsFor(cat, [{ id: "ft:G1" }]);
  const side = {
    elements: [
      { id: "n", kind: "field", key: "h.head" },
      { id: "u", kind: "field", key: "h.head", case: "upper" },
      { id: "e", kind: "field", key: "h.head", case: "asis" },
      { id: "a", kind: "field", key: "card.address1" },
    ],
  };
  const v = Object.fromEntries(cards.elementValues(m, cat, side, records[0]).map((x) => [x.id, x.value]));
  assert.deepEqual(v, { n: "Bruce L. Graber", u: "BRUCE L. GRABER", e: "BRUCE L GRABER", a: "1 A ST, Gap, PA 17527" }, "as entered is as entered, and an address isn't a name");
});
