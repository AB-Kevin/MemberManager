"use strict";

// FundTrack's exports (lib/fundTrack.js), with made-up rows.

const test = require("node:test");
const assert = require("node:assert/strict");
const ft = require("../lib/fundTrack");

const fs = require("fs");
const os = require("os");
const path = require("path");

const HEADERS = {
  groups: "ID,MemberGroupUID,MemberOrganizationUID,GroupCode,PrimaryAddressLine1,fundName",
  individuals: "ID,MemberIndividualUID,MemberGroupUID,FirstName,BirthDate",
  orgs: "ID,MemberOrganizationUID,OrganizationName,OrganizationCode",
  contacts: "ID,MemberOrganizationContactUID,MemberOrganizationUID,FirstName",
  addresses: "ID,MemberOrganizationAddressUID,MemberOrganizationUID,AddressLine1,City",
};
function folderWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-fundtrack-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, table] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), `﻿${HEADERS[table] || table}\r\n"1","2","3"\r\n`);
  return dir;
}

test("files are told apart by their columns, whatever they're called", (t) => {
  const dir = folderWith(t, {
    "MemberGroups_261116.csv": "groups",
    "memberindividuals261116.csv": "individuals",
    "memberorganizations261116.csv": "orgs",
    "memberorganizationcontacts261116.csv": "contacts",
    "memberorganizationaddresses261116.csv": "addresses",
    "something else.csv": "Name,Email",
    "notes.txt": "groups",
  });
  const { found, unknown } = ft.scanExports(dir);
  assert.deepEqual(
    Object.fromEntries(Object.entries(found).map(([k, f]) => [k, [f.file, f.date, f.dateFrom]])),
    {
      groups: ["MemberGroups_261116.csv", "2026-11-16", "name"],
      individuals: ["memberindividuals261116.csv", "2026-11-16", "name"],
      contacts: ["memberorganizationcontacts261116.csv", "2026-11-16", "name"],
      addresses: ["memberorganizationaddresses261116.csv", "2026-11-16", "name"],
      orgs: ["memberorganizations261116.csv", "2026-11-16", "name"],
    }
  );
  assert.deepEqual(unknown, ["something else.csv"]);
});

test("the newest of each is used unless another is chosen; copies only when chosen", (t) => {
  const dir = folderWith(t, {
    "MemberGroups 10092026.csv": "groups",
    "MemberGroups 11022026.csv": "groups",
    "MemberGroups 11022026 - Copy.csv": "groups",
    "groups.csv": "groups", // no date in its name: when it was saved
    "MemberIndividuals 10092026.csv": "individuals",
  });
  const old = new Date(2026, 0, 1);
  fs.utimesSync(path.join(dir, "groups.csv"), old, old);
  let { found, ignored, files } = ft.scanExports(dir);
  assert.equal(found.groups.file, "MemberGroups 11022026.csv");
  assert.deepEqual(ignored, ["MemberGroups 11022026 - Copy.csv"]);
  assert.equal(files.find((f) => f.file === "groups.csv").dateFrom, "saved");
  ({ found } = ft.scanExports(dir, { groups: "MemberGroups 10092026.csv" }));
  assert.equal(found.groups.file, "MemberGroups 10092026.csv");
  assert.equal(found.groups.chosen, true);
  ({ found } = ft.scanExports(dir, { groups: "MemberIndividuals 10092026.csv" }));
  assert.equal(found.groups.file, "MemberGroups 11022026.csv", "a file of another table can't be chosen");
  assert.deepEqual(ft.mixedDates(found).map((d) => d.table).sort(), ["groups", "individuals"]);
});

test("dates are read from names in the usual ways", () => {
  const cases = {
    "MemberGroups 11162026.csv": "2026-11-16",
    "MemberGroups_261116.csv": "2026-11-16",
    "groups 2026-11-16.csv": "2026-11-16",
    "groups 20261116.csv": "2026-11-16",
    "groups 11-16-2026.csv": "2026-11-16",
    "groups 11.16.26.csv": "2026-11-16",
    "groups 111626.csv": "2026-11-16",
    "groups.csv": null,
    "groups 1234.csv": null,
  };
  for (const [name, date] of Object.entries(cases)) assert.equal(ft.dateFromName(name), date, name);
});

test("details keep FundTrack's other columns, but never identity, health, case or bookkeeping ones", () => {
  const row = {
    ID: "1",
    MemberIndividualUID: "00010-1",
    MaritalStatus: "Married",
    Last4SSN: "1234",
    CaseIDifAny: "C-9",
    Preexisting: "True",
    Other: "asthma",
    IsAdultWithDisability: "True",
    invoiceCount: "4.00",
    DateMadeInactive: "00/00/0000",
    IsInactiveNextYear: "False",
    RecordCreatedBy: "admin",
  };
  assert.deepEqual(ft.details(row, "individuals", []), { MaritalStatus: "Married", invoiceCount: "4" });
});

const fields = [
  { id: "birth", label: "Birth date", appliesTo: "contact", type: "date" },
  { id: "role", label: "Role", appliesTo: "contact", type: "choice" },
  { id: "gender", label: "Gender", appliesTo: "contact", type: "choice" },
];
const person = (uuid, group, first, last, more = {}) => ({ MemberIndividualUUID: uuid, MemberGroupUID: group, FirstName: first, LastName: last, fullName: `${first} ${last}`, ...more });

test("everyone in two accounts at one address goes to the right account", () => {
  // Amos's account (G1) and his son John's (G2) share mailing household m1.
  const contacts = [
    { id: "amos", name: "Amos Byler", memberId: "A1", householdId: "m1" },
    { id: "john", name: "John Byler", memberId: "J2", householdId: "m1" },
    { id: "ruth", name: "Ruth Byler", householdId: "m1" }, // on the list from a newsletter list
  ];
  const accounts = { G1: { householdId: "m1", orgId: "o1", headId: "amos" }, G2: { householdId: "m1", orgId: "o1", headId: "john" } };
  const rows = [
    person("u-amos", "G1", "Amos", "Byler", { IndividualType: "Head of Household", BirthDate: "03/05/1950", fullGender: "Male" }),
    person("u-ruth", "G1", "Ruth", "Byler", { IndividualType: "Spouse", BirthDate: "11/20/1952" }),
    person("u-john", "G2", "John", "Byler", { IndividualType: "Head of Household", BirthDate: "00/00/0000" }),
    person("u-katie", "G2", "Katie", "Byler", { IndividualType: "Child", BirthDate: "01/02/2015", IsInactiveThisYear: "True" }),
    person("u-lost", "G9", "Lost", "Person"),
  ];
  // BirthDate fills Birth date by its name; the other two were chosen on the Import page.
  const headers = ["MemberIndividualUUID", "MemberGroupUID", "FirstName", "LastName", "fullName", "IndividualType", "BirthDate", "Gender", "fullGender", "IsInactiveThisYear"];
  const columns = ft.fieldColumns("individuals", headers, fields, { IndividualType: "role", fullGender: "gender", Gender: "" });
  const plan = ft.planPeople(rows, contacts, (g) => accounts[g] || null, columns, fields);
  assert.deepEqual(plan.stats, { rowsRead: 5, added: 1, updated: 3, unchanged: 0, noHousehold: 1 });
  const patch = (id) => plan.updates.find((u) => u.id === id).patch;
  assert.equal(patch("amos").fundTrackGroupId, "G1");
  assert.deepEqual(patch("amos").fields, { birth: "1950-03-05", role: "Head of Household", gender: "Male" });
  assert.equal(patch("ruth").fundTrackGroupId, "G1");
  assert.equal(patch("john").fundTrackGroupId, "G2");
  assert.equal(patch("john").fields.birth, undefined, "00/00/0000 is no date");
  const [katie] = plan.inserts;
  assert.equal(katie.name, "Katie Byler");
  assert.equal(katie.householdId, "m1");
  assert.equal(katie.orgId, "o1");
  assert.equal(katie.memberStatus, "Inactive");
  assert.equal(katie.memberId, "", "only the head has the Member ID");

  // The next import finds everyone by their FundTrack id: nothing changes.
  const after = contacts.map((c) => ({ ...c, ...(plan.updates.find((u) => u.id === c.id)?.patch || {}) })).concat([{ id: "katie", ...katie }]);
  const again = ft.planPeople(rows, after, (g) => accounts[g] || null, columns, fields);
  assert.deepEqual(again.stats, { rowsRead: 5, added: 0, updated: 0, unchanged: 4, noHousehold: 1 });
});

test("churches: matched by id or name, contacts and blanks filled in, and a church FundTrack has twice used once", () => {
  const orgFields = [{ id: "code", label: "Code", appliesTo: "org", type: "text" }, { id: "phone", label: "Phone", appliesTo: "org", type: "text" }];
  const orgs = [{ id: "o1", name: "The Maple Grove Mennonite Church", attn: "Office", email: "", addressLine1: "", fields: {} }];
  const rows = [
    { MemberOrganizationUID: "U1", OrganizationName: "Maple Grove Mennonite", OrganizationCode: "MG1", IsInactive: "False" },
    { MemberOrganizationUID: "U2", OrganizationName: "MAPLE GROVE MENNONITE", OrganizationCode: "MG2" },
    { MemberOrganizationUID: "U3", OrganizationName: "Pine Hill", OrganizationCode: "PH" },
    { MemberOrganizationUID: "U4", OrganizationName: "Closed Church", IsInactive: "True" },
  ];
  const contacts = [
    { MemberOrganizationUID: "U1", FirstName: "Eli", LastName: "Peachey", PrimaryPhone: "717-555-0101", PrimaryEmail: "eli@example.org", IsInactive: "False" },
    { MemberOrganizationUID: "U1", FirstName: "Gone", LastName: "Away", IsInactive: "True" },
  ];
  const addresses = [{ MemberOrganizationUID: "U1", AddressLine1: "5 Church Rd", City: "Belleville", State: "PA", Zip: "17004", IsMailingAddress: "True" }];
  const columns = ft.fieldColumns("orgs", ["MemberOrganizationUID", "OrganizationName", "OrganizationCode", "DfltContactPrimePhoneCopy"], orgFields, { OrganizationCode: "code", DfltContactPrimePhoneCopy: "phone" });
  rows[0].DfltContactPrimePhoneCopy = "717-555-0101";
  const plan = ft.planOrgs(rows, contacts, addresses, orgs, columns, orgFields);
  assert.equal(plan.stats.sameAsAnother, 1);
  const p = plan.updates[0].patch;
  assert.equal(p.fundTrackId, "U1");
  assert.deepEqual(p.fields, { code: "MG1", phone: "717-555-0101" });
  assert.equal(p.attn, undefined, "an Attention line already set is kept");
  assert.equal(p.email, "eli@example.org");
  assert.equal(p.addressLine1, "5 Church Rd");
  assert.deepEqual(p.contacts, [{ name: "Eli Peachey", type: "", phone: "717-555-0101", email: "eli@example.org" }]);
  assert.deepEqual(plan.inserts.map((o) => o.name), ["Pine Hill"], "an inactive church new to the list isn't added");
});

test("a church merged into another isn't brought back by the next import", () => {
  const { mergedOrgs, planImport } = require("../lib/listImport");
  // FundTrack keeps Beacon of Light twice; the office merged "BEACON OF LIGHT"
  // (FundTrack's U2) into the Mennonite church (U1), twice over.
  const orgs = [{ id: "bolmc", name: "Beacon of Light Mennonite Church", fundTrackId: "U1", fields: {} }];
  const retired = [
    { kind: "org", fromId: "old1", toId: "mid", snapshot: { name: "BEACON OF LIGHT", fundTrackId: "U2" } },
    { kind: "org", fromId: "mid", toId: "bolmc", snapshot: { name: "Beacon of Light (2)" } },
    { kind: "household", fromId: "h", toId: "h2", snapshot: { name: "x" } },
    { kind: "org", fromId: "gone", toId: null, snapshot: { name: "Closed Church" } },
  ];
  const merged = mergedOrgs(retired, orgs);
  assert.deepEqual([...merged.byFundTrackId], [["U2", "bolmc"]], "followed through to the church still on the list");
  assert.deepEqual([...merged.byName.values()], ["bolmc", "bolmc"]);
  assert.ok(![...merged.byName.keys()].some((k) => /closed/.test(k)), "a deleted church isn't an alias");

  // The churches: U2's row is left out, U1's still updates the one kept.
  const plan = ft.planOrgs(
    [
      { MemberOrganizationUID: "U1", OrganizationName: "BEACON OF LIGHT MENNONITE CHURCH" },
      { MemberOrganizationUID: "U2", OrganizationName: "BEACON OF LIGHT" },
    ],
    [],
    [],
    orgs,
    [],
    [],
    { merged }
  );
  assert.deepEqual([plan.stats.added, plan.stats.merged, plan.inserts.length], [0, 1, 0]);

  // A household whose church is "BEACON OF LIGHT" joins the one kept.
  const people = planImport(
    [{ Name: "Amos Byler", Church: "BEACON OF LIGHT" }],
    { Name: "name", Church: "orgName" },
    { mode: "person", publicationIds: [] },
    { contacts: [], households: [], orgs, orgAliases: merged.byName },
    []
  );
  assert.equal(people.orgInserts.length, 0);
  assert.equal(people.contactInserts[0].orgId, "bolmc");
});

const officeFields = [
  { id: "ss", label: "Social Security Exempt", appliesTo: "contact", type: "yesno" },
  { id: "plan", label: "Plan", appliesTo: "contact", type: "choice" },
  { id: "start", label: "Start Date", appliesTo: "household", type: "date" },
  { id: "code", label: "Code", appliesTo: "org", type: "text" },
];
const groupHeaders = ["ID", "MemberGroupUID", "GroupCode", "FirstName", "PrimaryAddressLine1", "fundName", "StartDate", "SocialSecurityExempt", "Last4SSN", "Notes"];

test("columns go into the field with their name, from the tables that can fill it", () => {
  const cols = ft.fieldColumns("groups", groupHeaders, officeFields);
  assert.deepEqual(
    cols.map((c) => [c.header, c.fieldId, c.chosen]),
    [
      ["fundName", null, false],
      ["StartDate", "start", false],
      ["SocialSecurityExempt", "ss", false],
      ["Notes", null, false],
    ],
    "built-in, identity and bookkeeping columns aren't offered; a church field isn't filled from MemberGroups"
  );
  assert.deepEqual(ft.fieldColumns("orgs", ["MemberOrganizationUID", "OrganizationName", "Code", "StartDate"], officeFields).map((c) => [c.header, c.fieldId]), [
    ["Code", "code"],
    ["StartDate", null],
  ]);
});

test("a column with no field of its name fills nothing -- nothing made up", () => {
  // The organizations' HasSSNExemption isn't MemberGroups' column, and isn't read from it.
  const cols = ft.fieldColumns("groups", ["MemberGroupUID", "GroupCode", "HasSSNExemption"], [{ id: "ss", label: "Social Security exempt", appliesTo: "contact", type: "yesno" }]);
  assert.deepEqual(cols.map((c) => [c.header, c.fieldId]), [["HasSSNExemption", null]]);
});

test("choices made on the Import page win, are kept, and are forgotten when their field goes", () => {
  const saved = { fundName: "plan", SocialSecurityExempt: "", StartDate: "gone" };
  const cols = Object.fromEntries(ft.fieldColumns("groups", groupHeaders, officeFields, saved).map((c) => [c.header, c]));
  assert.deepEqual([cols.fundName.fieldId, cols.fundName.chosen], ["plan", true]);
  assert.deepEqual([cols.SocialSecurityExempt.fieldId, cols.SocialSecurityExempt.chosen], [null, true], "sent to no field");
  assert.deepEqual([cols.StartDate.fieldId, cols.StartDate.chosen], ["start", false], "a removed field's choice goes back to matching by name");
  // A field chosen for one column isn't matched by name to another too.
  const twice = ft.fieldColumns("groups", groupHeaders, officeFields, { Notes: "ss" });
  assert.deepEqual(twice.filter((c) => c.fieldId === "ss").map((c) => c.header), ["Notes"]);
});

test("values are read as their field reads them, and the ones that don't fit are counted", () => {
  const byId = new Map(officeFields.map((f) => [f.id, f]));
  const cols = ft.fieldColumns("groups", groupHeaders, officeFields, { fundName: "plan" });
  const rows = [
    { SocialSecurityExempt: "Yes", StartDate: "03/01/2010", fundName: "Medical Aid & Alms Plan" },
    { SocialSecurityExempt: "No", StartDate: "00/00/0000", fundName: "" },
    { SocialSecurityExempt: "In Process", StartDate: "", fundName: "" },
    { SocialSecurityExempt: "False", StartDate: "", fundName: "" },
  ];
  assert.deepEqual(rows.map((r) => ft.rowFields(r, cols, byId).values), [
    { contact: { ss: true, plan: "Medical Aid & Alms Plan" }, household: { start: "2010-03-01" }, org: {} },
    { contact: { ss: false }, household: {}, org: {} },
    { contact: {}, household: {}, org: {} },
    { contact: { ss: false }, household: {}, org: {} },
  ]);
  assert.deepEqual(ft.unreadableValues(rows, cols, byId), [{ header: "SocialSecurityExempt", fieldId: "ss", count: 1, examples: ["In Process"] }]);
  assert.deepEqual(ft.cleanRows(rows, cols, byId)[1].StartDate, "", "no date is blank, not a date that doesn't fit");
});

test("columns that go into fields aren't kept as details too", () => {
  const cols = ft.fieldColumns("groups", groupHeaders, officeFields);
  const row = { MemberGroupUID: "G1", GroupCode: "A1", SocialSecurityExempt: "Yes", StartDate: "03/01/2010", Notes: "Call first", fundName: "Plan A", Last4SSN: "1234" };
  assert.deepEqual(ft.accountDetails(row, cols), { fundTrackGroupId: "G1", fundTrackAccount: { Notes: "Call first", fundName: "Plan A" } });
});
