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
  const plan = ft.planPeople(rows, contacts, (g) => accounts[g] || null, fields);
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
  const again = ft.planPeople(rows, after, (g) => accounts[g] || null, fields);
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
  const plan = ft.planOrgs(rows, contacts, addresses, orgs, orgFields);
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

test("the fields the import needs are made once, as person, household and church fields", () => {
  const missing = ft.missingFields([{ id: "x", label: "phone", appliesTo: "contact", type: "text" }]);
  assert.deepEqual(
    missing.map((f) => `${f.label}/${f.appliesTo}`),
    ["Plan/contact", "Household type/contact", "Social Security exempt/household", "Birth date/contact", "Role/contact", "Gender/contact", "Code/org", "Denomination/org", "Organization type/org", "Phone/org"]
  );
  assert.equal(missing.find((f) => f.appliesTo === "household").type, "yesno");
});

test("a field already made under a differently written name isn't made again", () => {
  const existing = [{ id: "s", label: "SocialSecurityExempt", appliesTo: "household", type: "yesno" }];
  assert.ok(!ft.missingFields(existing).some((f) => f.appliesTo === "household"));
  assert.equal(ft.fieldIndex(existing).household[ft.labelKey("Social Security exempt")].id, "s");
});
