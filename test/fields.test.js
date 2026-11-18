"use strict";

// The office's own fields: reading typed and imported values (lib/fields.js),
// and imports filling them in on people, households and organizations
// (lib/listImport.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const Fields = require("../lib/fields");
const { planImport, importTargets } = require("../lib/listImport");
const { isSensitive } = require("../lib/sensitiveColumns");

test("values are read as their field's kind", () => {
  assert.deepEqual(Fields.parseValue("yesno", "Yes"), { value: true });
  assert.deepEqual(Fields.parseValue("yesno", "no"), { value: false });
  assert.deepEqual(Fields.parseValue("yesno", ""), { blank: true });
  assert.ok(Fields.parseValue("yesno", "maybe").error);
  assert.deepEqual(Fields.parseValue("number", "1,234.50"), { value: 1234.5 });
  assert.ok(Fields.parseValue("number", "lots").error);
  assert.deepEqual(Fields.parseValue("date", "3/5/2024"), { value: "2024-03-05" });
  assert.deepEqual(Fields.parseValue("date", "2024-03-05"), { value: "2024-03-05" });
  assert.ok(Fields.parseValue("date", "2/30/2024").error, "no February 30th");
  assert.deepEqual(Fields.parseValue("text", "  Finance   committee "), { value: "Finance committee" });
  assert.deepEqual(Fields.parseValue("choice", " "), { blank: true });
});

test("stored values read back the way they're typed", () => {
  assert.equal(Fields.formatValue("date", "2024-03-05"), "3/5/2024");
  assert.equal(Fields.formatValue("yesno", true), "Yes");
  assert.equal(Fields.formatValue("number", 12.5), "12.5");
  assert.equal(Fields.formatValue("text", undefined), "");
});

test("a new field's kind is guessed from the column", () => {
  assert.equal(Fields.guessType(["Yes", "No", "", "Yes"]), "yesno");
  assert.equal(Fields.guessType(["3/5/1950", "12/1/1948"]), "date");
  assert.equal(Fields.guessType(["12", "4.5"]), "number");
  assert.equal(Fields.guessType(["01234", "00012"]), "text", "leading zeros are codes, not numbers");
  assert.equal(Fields.guessType(["Finance", "Missions", "Finance", "Finance", "Missions", "Finance", "Missions"]), "choice");
  assert.equal(Fields.guessType(["Bought the farm in 1987", "Moved from Ohio"]), "text");
});

test("a field needs a name, a level and a kind, and names don't repeat at one level", () => {
  const existing = [{ id: "a", label: "Committee", appliesTo: "contact", type: "text" }];
  assert.throws(() => Fields.cleanDefinition({ label: " ", appliesTo: "contact" }, existing), /name/);
  assert.throws(() => Fields.cleanDefinition({ label: "committee", appliesTo: "contact" }, existing), /already/);
  assert.deepEqual(Fields.cleanDefinition({ label: "Committee", appliesTo: "org", type: "choice" }, existing), { label: "Committee", appliesTo: "org", type: "choice" });
  assert.deepEqual(Fields.cleanDefinition({ label: "Committee", appliesTo: "contact", type: "yesno" }, existing, "a"), { label: "Committee", appliesTo: "contact", type: "yesno" });
});

test("identity and health columns are recognized", () => {
  assert.ok(isSensitive("Last 4 SSN"));
  assert.ok(isSensitive("HasPreExistingCondition"));
  assert.ok(!isSensitive("Over 65"));
  // Whether a household is exempt is kept; the number itself never is.
  assert.ok(!isSensitive("SocialSecurityExempt"));
  assert.ok(!isSensitive("HasSSNExemption"));
  assert.ok(isSensitive("Social Security Number"));
});

// ---- imports into fields ----

const fields = [
  { id: "phone", label: "Phone", appliesTo: "contact", type: "text" },
  { id: "over65", label: "Over 65", appliesTo: "household", type: "yesno" },
  { id: "joined", label: "Joined", appliesTo: "contact", type: "date" },
  { id: "district", label: "District", appliesTo: "org", type: "choice" },
];
const existing = () => ({
  households: [{ id: "h1", addressLine1: "102 Mill Rd", addressLine2: "", city: "Gordonville", state: "PA", zip: "17529", subs: {}, fields: { over65: false } }],
  contacts: [{ id: "c1", name: "Amos Beiler", email: "amos@example.org", memberId: "BEILA123", orgId: "o1", householdId: "h1", subs: {}, fields: { phone: "555-0100" } }],
  orgs: [{ id: "o1", name: "Maple Grove Mennonite", attn: "", email: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", subs: {}, fields: {} }],
});
const mapping = { Name: "name", Code: "memberId", Church: "orgName", Phone: "field:phone", "Over 65": "field:over65", Joined: "field:joined", District: "field:district" };
const opts = { mode: "person", publicationIds: [], deliveryDefault: "auto", sourceBatch: "Test" };
const run = (rows, list = existing()) => planImport(rows, mapping, opts, list, [], fields);

test("fields are importable targets, listed under Fields", () => {
  const targets = importTargets([], fields);
  assert.deepEqual(
    targets.filter((t) => t.group === "Fields").map((t) => [t.value, t.label]),
    [
      ["field:phone", "Phone (person)"],
      ["field:over65", "Over 65 (household)"],
      ["field:joined", "Joined (person)"],
      ["field:district", "District (organization)"],
    ]
  );
});

test("an import fills in a person's, their household's and their organization's fields", () => {
  const p = run([{ Name: "Amos Beiler", Code: "BEILA123", Church: "The Maple Grove Mennonite Church", Phone: "555-0199", "Over 65": "Yes", Joined: "6/1/1990", District: "Lancaster" }]);
  assert.equal(p.stats.added, 0);
  assert.deepEqual(p.contactUpdates, [{ id: "c1", patch: { fields: { phone: "555-0199", joined: "1990-06-01" } } }]);
  assert.deepEqual(p.householdUpdates, [{ id: "h1", patch: { fields: { over65: true } } }]);
  assert.deepEqual(p.orgUpdates, [{ id: "o1", patch: { fields: { district: "Lancaster" } } }]);
  assert.deepEqual(p.matches[0].changedFields, ["fields"]);
});

test("a blank cell never erases a field, and a value that doesn't fit is counted and left out", () => {
  const p = run([{ Name: "Amos Beiler", Code: "BEILA123", Phone: "", "Over 65": "", Joined: "someday" }]);
  assert.deepEqual(p.contactUpdates, []);
  assert.deepEqual(p.householdUpdates, []);
  assert.equal(p.stats.unreadableFields, 1);
  assert.equal(p.stats.unchanged, 1);
});

test("a new person's fields come in with them; household fields need an address", () => {
  const p = run([{ Name: "Ruth Zook", Phone: "555-0123", "Over 65": "Yes" }]);
  assert.equal(p.stats.added, 1);
  assert.deepEqual(p.contactInserts[0].fields, { phone: "555-0123" });
  assert.equal(p.stats.fieldsNoAddress, 1);
});

test("identifier and yes/no columns aren't guessed as a church, and a church column wins over a company one,, but ZIPs still are ZIPs", () => {
  const { guessMapping } = require("../lib/listImport");
  const headers = ["MemberOrganizationUID", "CompanyName", "ChurchParticipation70Perc", "churchName", "ZIP", "AccountsPKID"];
  const rows = [
    { MemberOrganizationUID: "00013-0000000145", CompanyName: "Vernon Troyer", ChurchParticipation70Perc: "True", churchName: "Disciples' Fellowship", ZIP: "17529", AccountsPKID: "8812" },
    { MemberOrganizationUID: "00013-0000000154", CompanyName: "", ChurchParticipation70Perc: "False", churchName: "Old German Baptist", ZIP: "45309-1234", AccountsPKID: "8813" },
  ];
  const mapping = guessMapping(headers, rows, []);
  assert.equal(mapping.MemberOrganizationUID, "");
  assert.equal(mapping.ChurchParticipation70Perc, "");
  assert.equal(mapping.churchName, "orgName", "the church, not the company");
  assert.notEqual(mapping.CompanyName, "orgName");
  assert.equal(mapping.ZIP, "zip");
  assert.equal(mapping.AccountsPKID, "");
});

// ---- moving a household field to people ----

test("a household field moved to people gives everyone their household's value", () => {
  const households = [
    { id: "h1", fields: { over65: true } },
    { id: "h2", fields: { over65: false } },
    { id: "h3", fields: {} },
    { id: "h4", fields: { over65: true } }, // no one lives here
  ];
  const contacts = [
    { id: "c1", householdId: "h1", fields: {} },
    { id: "c2", householdId: "h1" },
    { id: "c3", householdId: "h2", fields: {} },
    { id: "c4", householdId: "h3", fields: {} },
    { id: "c5", householdId: null, fields: {} },
  ];
  const plan = Fields.householdToPeople("over65", households, contacts);
  assert.deepEqual([...plan.people], [["c1", true], ["c2", true], ["c3", false]], "No is a value too; a blank isn't");
  assert.equal(plan.households, 3);
  assert.equal(plan.stranded, 1);

  // Only the people with a Member ID: an account's head.
  contacts[1].memberId = "A1";
  const heads = Fields.householdToPeople("over65", households, contacts, { onlyMembers: true });
  assert.deepEqual([...heads.people], [["c2", true]]);
  assert.equal(heads.stranded, 2, "h2's only person has no Member ID, and h4 has no one");
});

test("a saved list's field key is renamed in its conditions, columns and sort", () => {
  const { renameKey } = require("../lib/lists");
  const state = { kind: "people", conds: [{ k: "hf.x", op: "yes" }, { k: "p.name", op: "has", v: "A" }], match: "all", cols: ["p.name", "hf.x"], sort: "hf.x", dir: 1 };
  assert.deepEqual(renameKey(state, "hf.x", "pf.x"), {
    kind: "people",
    conds: [{ k: "pf.x", op: "yes" }, { k: "p.name", op: "has", v: "A" }],
    match: "all",
    cols: ["p.name", "pf.x"],
    sort: "pf.x",
    dir: 1,
  });
  assert.deepEqual(renameKey({ kind: "people", conds: [] }, "hf.x", "pf.x"), { kind: "people", conds: [] }, "no columns or sort stays none");
});
