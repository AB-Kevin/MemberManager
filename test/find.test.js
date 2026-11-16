"use strict";

// The Find, Lists and Near ZIP pages' engines (lib/memberModel.js,
// lib/search.js, lib/lists.js, lib/nearZip.js), on a small made-up list.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildModel, ageOn } = require("../lib/memberModel");
const { buildIndex, search, matchesWords } = require("../lib/search");
const lists = require("../lib/lists");
const near = require("../lib/nearZip");

const TODAY = new Date(2026, 10, 16); // 11/16/2026
const F = (id, label, appliesTo, type) => ({ id, label, appliesTo, type });
const fields = [
  F("phone", "Phone", "contact", "text"),
  F("plan", "Plan", "contact", "choice"),
  F("birth", "Birth date", "contact", "date"),
  F("role", "Role", "contact", "choice"),
  F("over65", "Over 65", "household", "yesno"),
  F("code", "Code", "org", "text"),
];
const place = (id, zip, city, state) => ({ id, addressLine1: `1 ${city} Rd`, addressLine2: "", city, state, zip, subs: {}, fields: {} });
function list() {
  return {
    publications: [{ id: "oh", name: "Our Health" }],
    fields,
    orgs: [{ id: "o1", name: "Maple Grove Mennonite", attn: "", email: "", addressLine1: "", city: "Belleville", state: "PA", zip: "17004", subs: { oh: { mail: true, copies: 10 } }, fields: { code: "MG1" }, contacts: [{ name: "Eli Peachey", type: "Deacon", phone: "717-555-0101", email: "eli@example.org" }] }],
    households: [
      { ...place("m1", "17004", "Belleville", "PA"), subs: { oh: { mail: true, copies: 1 } } },
      place("m2", "44691", "Wooster", "OH"),
      place("m3", "99999", "Nowhere", "ZZ"),
    ],
    contacts: [
      // Two FundTrack accounts at one farm (m1): Amos's and his son John's.
      { id: "amos", name: "Amos Byler", email: "amos@example.org", memberId: "BYLAM001", memberStatus: "Active", orgId: "o1", householdId: "m1", fundTrackGroupId: "G1", fundTrackAccount: { householdName: "Byler, Amos" }, fields: { phone: "(717) 555-1234", plan: "Medical Aid & Alms Plan", birth: "1950-03-05", role: "Head of Household" } },
      { id: "ruth", name: "Ruth Byler", email: "", memberStatus: "Active", orgId: "o1", householdId: "m1", fundTrackGroupId: "G1", fields: { birth: "1952-11-20", role: "Spouse" } },
      { id: "john", name: "John Byler", email: "", memberId: "BYLJO002", memberStatus: "Inactive", orgId: "o1", householdId: "m1", fundTrackGroupId: "G2", fields: { phone: "717-555-9999", plan: "Workers' Aid Plan", birth: "1980-06-01", role: "Head of Household" } },
      { id: "katie", name: "Katie Byler", email: "", memberStatus: "Active", orgId: "o1", householdId: "m1", fundTrackGroupId: "G2", fields: { birth: "2015-01-02", role: "Child" } },
      // A newsletter signup, not a member.
      { id: "sam", name: "Sam Signup", email: "sam@example.org", householdId: "m2", fields: {} },
      // A birth date that can't be right.
      { id: "typo", name: "Old Typo", householdId: "m3", memberId: "TYPO1", fundTrackGroupId: "G3", fields: { birth: "1011-01-01", role: "Head of Household" } },
    ],
  };
}

test("ages come from birth dates, and impossible dates have none", () => {
  assert.equal(ageOn("1950-03-05", TODAY), 76);
  assert.equal(ageOn("1950-11-17", TODAY), 75, "birthday tomorrow");
  assert.equal(ageOn("1011-01-01", TODAY), null);
  assert.equal(ageOn("", TODAY), null);
});

test("households are FundTrack's accounts, even two at one address", () => {
  const m = buildModel(list(), TODAY);
  const g1 = m.byHousehold.get("ft:G1");
  const g2 = m.byHousehold.get("ft:G2");
  assert.equal(g1.name, "Byler, Amos");
  assert.deepEqual(g1.memberIds, ["amos", "ruth"]);
  assert.equal(g1.plan, "Medical Aid & Alms Plan");
  assert.equal(g2.head, "John Byler");
  assert.equal(g2.plan, "Workers' Aid Plan");
  assert.equal(g2.active, false);
  assert.equal(g2.children, 1);
  assert.equal(g1.zip, "17004", "the address is the mailing household's");
  assert.equal(m.byPerson.get("katie").active, false, "in an inactive household");
  assert.ok(m.byHousehold.get("hh:m2"), "a signup's household is their address");
  assert.equal(m.byChurch.get("o1").households, 2);
  assert.equal(m.byChurch.get("o1").people, 4);
});

test("search finds a household by any member, a phone in any format, a birth date or a church contact", () => {
  const m = buildModel(list(), TODAY);
  const index = buildIndex(m);
  const ids = (q, opts) => search(index, q, opts).results.map((r) => `${r.k}:${r.id}`);
  assert.ok(ids("ruth").includes("h:ft:G1"), "Ruth finds her household");
  assert.ok(ids("ruth").includes("p:ruth"));
  assert.ok(ids("717.555.1234").includes("h:ft:G1"));
  assert.ok(ids("1-717-555-1234").includes("h:ft:G1"));
  assert.ok(ids("1234").includes("h:ft:G1"), "the last 4 digits");
  assert.ok(ids("3/5/1950").includes("p:amos"));
  assert.ok(ids("eli peachey").includes("c:o1"));
  assert.ok(ids("MG1").includes("c:o1"));
  assert.ok(!ids("john").includes("h:ft:G2"), "inactive households are left out…");
  assert.ok(ids("john", { inactive: true }).includes("h:ft:G2"), "…unless asked for");
  assert.deepEqual(ids("byler", { kind: "h", plan: "Medical Aid & Alms Plan" }), ["h:ft:G1"]);
  assert.deepEqual(
    search(index, "byler amos").results.slice(0, 2).map((r) => r.id).sort(),
    ["amos", "ft:G1"],
    "name matches first"
  );
});

test("the Members page search matches phone numbers in any format", () => {
  assert.ok(matchesWords(["Amos Byler", "(717) 555-1234"], "7175551234"));
  assert.ok(matchesWords(["Amos Byler", "(717) 555-1234"], "byler 555-1234"));
  assert.ok(!matchesWords(["Amos Byler"], "ruth"));
});

test("lists: people 65 and over, birthdays, in a church, from a household field", () => {
  const m = buildModel(list(), TODAY);
  const cat = lists.catalog(m, "people");
  const names = (conds, match) => lists.runList(cat, conds, match).map((r) => r.p.id);
  assert.deepEqual(names([{ k: "p.age", op: "ge", v: "65" }]), ["amos", "ruth"]);
  assert.deepEqual(names([{ k: "p.birth", op: "month", v: "11" }]), ["ruth"]);
  assert.deepEqual(names([{ k: "p.birth", op: "bt", v: "1979-01-01", v2: "2016-01-01" }]), ["john", "katie"]);
  assert.deepEqual(names([{ k: "h.plan", op: "is", v: "workers' aid plan" }]), ["john", "katie"]);
  assert.deepEqual(names([{ k: "p.age", op: "le", v: "17" }, { k: "p.role", op: "is", v: "Spouse" }], "any"), ["ruth", "katie"]);
  assert.deepEqual(names([{ k: "p.gets.oh", op: "yes" }]), ["amos", "ruth", "john", "katie"], "through their household or church");
  assert.deepEqual(names([{ k: "hf.over65", op: "no" }]).length, 6);
  assert.deepEqual(names([{ k: "p.age", op: "ge", v: "" }]).length, 6, "a condition not filled in yet changes nothing");
  const sorted = lists.sortRecords(lists.runList(cat, []), cat.byKey.get("p.age"), -1).map((r) => r.p.id);
  assert.deepEqual(sorted.slice(0, 2), ["amos", "ruth"]);
  assert.equal(sorted[sorted.length - 1], "typo", "no age sorts last");
});

test("lists: households and churches, and a condition described in words", () => {
  const m = buildModel(list(), TODAY);
  const hh = lists.catalog(m, "households");
  assert.deepEqual(lists.runList(hh, [{ k: "h.kids", op: "ge", v: "1" }]).map((r) => r.h.key), ["ft:G2"]);
  assert.deepEqual(lists.runList(hh, [{ k: "h.phone", op: "blank" }]).map((r) => r.h.key), ["hh:m2", "ft:G3"]);
  const churches = lists.catalog(m, "churches");
  assert.equal(churches.byKey.get("c.cname").get(churches.records[0]), "Eli Peachey");
  assert.equal(lists.describe(m && lists.catalog(m, "people"), { k: "p.age", op: "ge", v: "65" }), "Age at least 65");
  assert.equal(lists.describe(lists.catalog(m, "people"), { k: "p.birth", op: "month", v: "3" }), "Birth date in March");
});

test("near a ZIP: rings, counts by ZIP, and miles as a list condition", () => {
  const zips = near.parseZips("17004,40.6,-77.7\n17009,40.6,-77.6\n44691,40.8,-81.9");
  const m = buildModel(list(), TODAY);
  const report = near.nearReport(m, zips, "17009", { maxMi: 100 });
  assert.equal(report.households, 1, "John's household is inactive");
  assert.equal(report.people, 2);
  assert.equal(report.bands[0].to, 10);
  assert.equal(report.bands[0].households, 1);
  assert.equal(report.noZip, 1, "Old Typo's ZIP, 99999, has no point");
  assert.equal(near.nearReport(m, zips, "00000"), null, "a ZIP that isn't real");
  const withInactive = near.nearReport(m, zips, "17009", { maxMi: 100, inactive: true });
  assert.equal(withInactive.households, 2);
  const cat = lists.catalog(m, "households", { zips, origin: "17009" });
  const miles = lists.runList(cat, [{ k: "geo.mi", op: "le", v: "50" }]).map((r) => r.h.key);
  assert.deepEqual(miles, ["ft:G1", "ft:G2"]);
  assert.ok(near.milesBetween([40.6, -77.7], [40.8, -81.9]) > 200);
});

test("a PO-box ZIP borrows the nearest ZIP in its area, marked approximate", () => {
  const zips = near.parseZips("17004,40.6,-77.7\n17009,40.6,-77.6");
  assert.deepEqual(near.zipPoint(zips, "17005"), { pt: [40.6, -77.7], approx: true, via: "17004" });
  assert.equal(near.zipPoint(zips, "99999"), null);
});
