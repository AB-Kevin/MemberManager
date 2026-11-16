"use strict";

// FundTrack's exports (File -> Data View -> a table -> Export, saved as
// "<Table> MMDDYYYY.csv" in one folder), brought into the member list:
//
//   MemberGroups                 households: their head, address, phone,
//                                email, church, plan and status
//   MemberIndividuals            everyone in each household: birth date,
//                                role, gender, status
//   MemberOrginizations          churches: code, type, denomination
//   MemberOrganizationContacts   church contacts
//   MemberOrginizationAddresses  church addresses
//
// The households go through the membership-export import (lib/listImport.js
// with lib/membership.js's set-up), so heads, addresses and newsletters work
// as they always have. This module adds the rest: everyone in each household,
// the churches' details, and FundTrack's own ids so a re-import finds each
// record again whatever its name.
//
// A FundTrack household is a member's account. On the list it's its head --
// the person with the Member ID -- and everyone with the same
// `fundTrackGroupId`. The list's own household is the mailing address, which
// two accounts can share (a married son's family on his parents' farm) so
// the address gets one bundle. So an account's own details are kept on its
// head: Phone, Plan and Household type as the head's fields, FundTrack's
// account id as `fundTrackGroupId`, and its other columns as
// `fundTrackAccount`. Each person's FundTrack id is `fundTrackId`, and a
// church's too.
//
// Phone, Plan, Household type, Birth date, Role, Gender and the churches'
// Code, Denomination, Type and Phone become the office's own fields
// (lib/fields.js), made the first time if there's no field of that name
// yet. FundTrack's other columns are kept as `fundTrack` details, for
// looking at and for Lists -- except identity, health and case columns,
// which are never kept, and FundTrack's own bookkeeping columns.

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const matching = require("./matching");
const Fields = require("./fields");
const { isSensitive } = require("./sensitiveColumns");

// Each table, told apart by columns only it has, so a file can be named
// anything: FundTrack's own "MemberGroups 11162026.csv", or
// "MemberGroups_261116.csv", or "groups.csv".
const TABLES = {
  groups: { name: "MemberGroups", has: ["MemberGroupUID", "GroupCode", "PrimaryAddressLine1"] },
  individuals: { name: "MemberIndividuals", has: ["MemberIndividualUID", "MemberGroupUID", "BirthDate"] },
  contacts: { name: "MemberOrganizationContacts", has: ["MemberOrganizationContactUID", "MemberOrganizationUID"] },
  addresses: { name: "MemberOrganizationAddresses", has: ["MemberOrganizationAddressUID", "MemberOrganizationUID", "AddressLine1"] },
  orgs: { name: "MemberOrganizations", has: ["MemberOrganizationUID", "OrganizationName"] },
};

/** Which table a file is, from its column headings, or null. */
function tableOf(headers) {
  const set = new Set((headers || []).map((h) => String(h).trim()));
  // Contacts and addresses have MemberOrganizationUID too, so they're checked before organizations.
  return Object.keys(TABLES).find((key) => TABLES[key].has.every((h) => set.has(h))) || null;
}

const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2099;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The date in a file's name, as ISO, or null: "11162026" or "11-16-2026"
 * (FundTrack's month-day-year), "2026-11-16" or "20261116", or "261116"
 * (year-month-day) and "111626" (month-day-year) -- whichever reads as a real
 * date this century.
 */
function dateFromName(file) {
  const base = String(file).replace(/\.[^.]+$/, "");
  const groups = base.match(/\d[\d.\-_]{4,}\d/g) || [];
  for (const raw of groups.reverse()) {
    const parts = raw.split(/[.\-_]/).filter(Boolean);
    if (parts.length === 3) {
      const [a, b, c] = parts.map(Number);
      if (parts[0].length === 4 && validDate(a, b, c)) return iso(a, b, c);
      const year = parts[2].length === 2 ? 2000 + c : c;
      if (validDate(year, a, b)) return iso(year, a, b);
      continue;
    }
    const d = raw.replace(/\D/g, "");
    if (d.length === 8) {
      const [m1, d1, y1] = [Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
      if (validDate(y1, m1, d1)) return iso(y1, m1, d1);
      const [y2, m2, d2] = [Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6))];
      if (validDate(y2, m2, d2)) return iso(y2, m2, d2);
    } else if (d.length === 6) {
      const [y1, m1, d1] = [2000 + Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
      if (validDate(y1, m1, d1)) return iso(y1, m1, d1);
      const [m2, d2, y2] = [Number(d.slice(0, 2)), Number(d.slice(2, 4)), 2000 + Number(d.slice(4))];
      if (validDate(y2, m2, d2)) return iso(y2, m2, d2);
    }
  }
  return null;
}

// A copy someone made by hand ("… - Copy.csv", "… (1).csv") is only used if
// it's chosen.
const isCopy = (file) => /(-\s*copy|\(\d+\))\s*\.csv$/i.test(file);

// The first line of a CSV, as column headings -- without reading the rest.
function readHeaders(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytes).replace(/^﻿/, "").split(/\r?\n/)[0];
    return (Papa.parse(firstLine).data[0] || []).map((h) => String(h).trim());
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The exports in a folder: { found: { groups: { file, date, dateFrom, chosen }, … },
 * files: [{ file, table, date, dateFrom }], unknown, ignored }. Each table's
 * file is the one `choices` names for it (chosen on the Import page), or else
 * the newest one: by the date in its name, or when it was saved if its name
 * has none. `dateFrom` is "name" or "saved".
 */
function scanExports(folder, choices = {}) {
  const files = [];
  const unknown = [];
  const ignored = [];
  for (const file of fs.readdirSync(folder)) {
    if (!/\.csv$/i.test(file)) continue;
    const full = path.join(folder, file);
    let table = null;
    try {
      table = tableOf(readHeaders(full));
    } catch {
      // unreadable (OneDrive still downloading it, say): not recognized
    }
    if (!table) {
      unknown.push(file);
      continue;
    }
    const named = dateFromName(file);
    const saved = fs.statSync(full).mtime;
    const date = named || iso(saved.getFullYear(), saved.getMonth() + 1, saved.getDate());
    files.push({ file, table, date, dateFrom: named ? "name" : "saved", mtimeMs: saved.getTime() });
  }
  const found = {};
  for (const key of Object.keys(TABLES)) {
    const chosen = choices[key] && files.find((f) => f.file === choices[key] && f.table === key);
    if (chosen) {
      found[key] = { ...chosen, chosen: true };
      continue;
    }
    const candidates = files.filter((f) => f.table === key && !isCopy(f.file));
    candidates.sort((a, b) => b.date.localeCompare(a.date) || b.mtimeMs - a.mtimeMs);
    if (candidates[0]) found[key] = { ...candidates[0], chosen: false };
    for (const f of files) if (f.table === key && isCopy(f.file) && found[key]?.file !== f.file) ignored.push(f.file);
  }
  return { found, files: files.map(({ file, table, date, dateFrom }) => ({ file, table, date, dateFrom })), unknown, ignored };
}

/** One export's rows, keyed by its column headings. */
function readExport(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const { data, meta } = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return { headers: meta.fields || [], rows: data };
}

// ---- values ----

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const blankish = (v) => !v || v === "False" || v === "00/00/0000" || /^0+(\.0+)?$/.test(v) || /^<+$/.test(v);
/** FundTrack's way of writing values, tidied: "True" -> "Yes", "4.00" -> "4". */
function tidy(v) {
  const t = text(v);
  if (blankish(t)) return "";
  if (t === "True") return "Yes";
  return t.replace(/^(-?\d+)\.00$/, "$1");
}

// Columns never kept: health, case and identity details (on top of
// lib/sensitiveColumns.js), and FundTrack's bookkeeping.
const NEVER = {
  all: ["ID", "RecordCreatedBy", "RecordCreatedDate", "AccountsPKID", "Reserved01", "DisplaySortOrderWithinGroup", "_memberCount", "memCount", "HasSSNExemption"],
  individuals: ["Other", "CaseIDifAny", "Preexisting", "DefectCodeIfAny", "Unused_WasStillNeedMemberForm"],
};
const neverKept = (table, header) => isSensitive(header) || NEVER.all.includes(header) || (NEVER[table] || []).includes(header) || /UID(IfAny)?$/i.test(header) || /^Unused_/.test(header);

/** A row's kept FundTrack details: every other column with something in it. `used` are the ones already brought in elsewhere. */
function details(row, table, used) {
  const out = {};
  for (const [header, value] of Object.entries(row)) {
    if (used.includes(header) || neverKept(table, header)) continue;
    const v = tidy(value);
    if (v) out[header] = v;
  }
  return out;
}

// The fields each table fills in: by name, made if there's no field of that
// name for that level yet.
//
// `member` fields are the account's, on its head (from MemberGroups);
// `contact` ones are each person's own (from MemberIndividuals). Both are
// person fields.
const FIELDS = {
  member: [
    { label: "Phone", type: "text", from: (r) => r.PrimaryPhone },
    { label: "Plan", type: "choice", from: (r) => r.fundName },
    { label: "Household type", type: "choice", from: (r) => r.GroupType },
  ],
  contact: [
    { label: "Birth date", type: "date", from: (r) => r.BirthDate },
    { label: "Role", type: "choice", from: (r) => r.IndividualType },
    { label: "Gender", type: "choice", from: (r) => r.fullGender || r.Gender },
  ],
  org: [
    { label: "Code", type: "text", from: (r) => r.OrganizationCode },
    { label: "Denomination", type: "choice", from: (r) => r.Denomination },
    { label: "Organization type", type: "choice", from: (r) => r.OrganizationType },
    { label: "Phone", type: "text", from: (r, contact) => contact?.phone },
  ],
};
// Columns that go into a field or a record's own fields, so aren't details too.
const USED = {
  groups: ["GroupCode", "FirstName", "MiddleName", "LastName", "fullName", "PrimaryEmail", "PrimaryAddressLine1", "PrimaryAddressLine2", "PrimaryCity", "PrimaryState", "PrimaryZip", "churchName", "statusTerm", "PrimaryPhone", "fundName", "GroupType"],
  individuals: ["FirstName", "MiddleName", "LastName", "fullName", "BirthDate", "IndividualType", "Gender", "fullGender", "IsInactiveThisYear"],
  orgs: ["OrganizationName", "OrganizationCode", "Denomination", "OrganizationType"],
};

/** The field definitions the import needs that `existing` doesn't have yet: [{ label, appliesTo, type }]. */
function missingFields(existing) {
  const out = [];
  for (const [level, defs] of Object.entries(FIELDS)) {
    const appliesTo = level === "member" ? "contact" : level;
    for (const def of defs) {
      if (!existing.some((f) => f.appliesTo === appliesTo && f.label.toLowerCase() === def.label.toLowerCase())) out.push({ label: def.label, appliesTo, type: def.type });
    }
  }
  return out;
}

/** { [appliesTo]: { [label]: field } } for the import's fields. */
function fieldIndex(fields) {
  const index = { household: {}, contact: {}, org: {} };
  for (const f of fields) if (index[f.appliesTo]) index[f.appliesTo][f.label.toLowerCase()] = f;
  return index;
}

// A row's values for one level's fields, as stored; blanks and values that
// don't fit (a birth date of 00/00/0000) are left out.
function fieldValues(level, row, index, extra) {
  const out = {};
  for (const def of FIELDS[level]) {
    const field = index[level === "member" ? "contact" : level][def.label.toLowerCase()];
    if (!field) continue;
    const raw = tidy(def.from(row, extra));
    if (!raw) continue;
    const parsed = Fields.parseValue(field.type, raw);
    if (!parsed.error && !parsed.blank) out[field.id] = parsed.value;
  }
  return out;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fullName = (r) => text(r.fullName) || [r.FirstName, r.MiddleName, r.LastName].map(text).filter(Boolean).join(" ");
const isHead = (r) => /head/i.test(text(r.IndividualType));
const inactive = (v) => /^true$/i.test(text(v));

/**
 * Everyone in each household, from MemberIndividuals: { inserts, updates:
 * [{ id, patch }], stats }.
 *
 * `accountOf(MemberGroupUID)` is { householdId, orgId, headId } for that
 * FundTrack household -- its head on the list and the head's household (the
 * mailing address) -- or null. A person is found again by their FundTrack id;
 * the first time, the account's head is its head, and anyone else is found by
 * name among the people at that address who aren't another account's head.
 * Names already on the list aren't changed; birth date, role, gender,
 * status, which account they're in and details are FundTrack's.
 */
function planPeople(rows, contacts, accountOf, fields, { sourceBatch = "FundTrack" } = {}) {
  const index = fieldIndex(fields);
  const byFundTrackId = new Map(contacts.filter((c) => c.fundTrackId).map((c) => [c.fundTrackId, c]));
  const inHousehold = new Map();
  for (const c of contacts) {
    if (!c.householdId) continue;
    if (!inHousehold.has(c.householdId)) inHousehold.set(c.householdId, []);
    inHousehold.get(c.householdId).push(c);
  }
  const taken = new Set(contacts.filter((c) => c.fundTrackId).map((c) => c.id));
  const sameName = (c, name) => {
    const a = matching.nameParts(c.name);
    const b = matching.nameParts(name);
    return !!a.first && a.first === b.first && a.last === b.last && matching.middlesAgree(c.name, name);
  };
  const stats = { rowsRead: rows.length, added: 0, updated: 0, unchanged: 0, noHousehold: 0 };
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const inserts = [];
  const updates = [];
  for (const row of rows) {
    const uuid = text(row.MemberIndividualUUID) || text(row.MemberIndividualUID);
    const groupId = text(row.MemberGroupUID);
    const account = accountOf(groupId);
    if (!account) {
      stats.noHousehold++;
      continue;
    }
    const household = { id: account.householdId, orgId: account.orgId };
    const name = fullName(row);
    let person = uuid ? byFundTrackId.get(uuid) : null;
    if (!person && isHead(row) && !taken.has(account.headId)) person = byId.get(account.headId) || null;
    if (!person) {
      const there = (inHousehold.get(household.id) || []).filter((c) => !taken.has(c.id) && (!c.memberId || c.id === account.headId));
      person = there.find((c) => name && sameName(c, name)) || null;
    }
    const own = fieldValues("contact", row, index);
    const status = inactive(row.IsInactiveThisYear) ? "Inactive" : "Active";
    const kept = details(row, "individuals", USED.individuals);
    if (!person) {
      const added = {
        name: name || "(No name)",
        email: "",
        memberId: "",
        memberStatus: status,
        orgId: household.orgId || null,
        householdId: household.id,
        subs: {},
        fields: own,
        sourceBatch,
        fundTrackId: uuid,
        fundTrackGroupId: groupId,
        fundTrack: kept,
      };
      inserts.push(added);
      stats.added++;
      continue;
    }
    taken.add(person.id);
    const patch = {};
    if (uuid && person.fundTrackId !== uuid) patch.fundTrackId = uuid;
    if (person.fundTrackGroupId !== groupId) patch.fundTrackGroupId = groupId;
    const fieldsNow = { ...(person.fields || {}), ...own };
    if (!sameJson(fieldsNow, person.fields || {})) patch.fields = fieldsNow;
    // The head's status is the household's (from MemberGroups); everyone
    // else's is their own.
    if (!person.memberId && person.memberStatus !== status) patch.memberStatus = status;
    if (!person.householdId && !person.memberId) patch.householdId = household.id;
    if (!sameJson(person.fundTrack, kept)) patch.fundTrack = kept;
    if (Object.keys(patch).length) {
      updates.push({ id: person.id, patch });
      stats.updated++;
    } else stats.unchanged++;
  }
  return { inserts, updates, stats };
}

/**
 * The churches' details: { inserts, updates: [{ id, patch }], stats }. A
 * church is found by its FundTrack id, or else by name ("The Maple Grove
 * Mennonite Church" is "Maple Grove Mennonite"). Its Attention line, email
 * and address are filled in from FundTrack's contacts and mailing address
 * only where they're blank, since the office may have set them for its
 * batches. An active church that isn't on the list is added.
 */
function planOrgs(orgRows, contactRows, addressRows, orgs, fields, { sourceBatch = "FundTrack" } = {}) {
  const index = fieldIndex(fields);
  const byFundTrackId = new Map(orgs.filter((o) => o.fundTrackId).map((o) => [o.fundTrackId, o]));
  const byName = new Map();
  for (const o of orgs) if (!byName.has(matching.orgKey(o.name))) byName.set(matching.orgKey(o.name), o);
  const contactsOf = new Map();
  for (const r of contactRows) {
    const uid = text(r.MemberOrganizationUID);
    if (!uid || inactive(r.IsInactive)) continue;
    const contact = {
      name: [r.FirstName, r.LastName].map(text).filter(Boolean).join(" "),
      type: text(r.ContactType),
      phone: text(r.PrimaryPhone),
      email: text(r.PrimaryEmail),
    };
    if (!contact.name && !contact.phone && !contact.email) continue;
    if (!contactsOf.has(uid)) contactsOf.set(uid, []);
    contactsOf.get(uid).push(contact);
  }
  const addressOf = new Map();
  for (const r of addressRows) {
    const uid = text(r.MemberOrganizationUID);
    if (!uid || !text(r.AddressLine1)) continue;
    const mailing = /^true$/i.test(text(r.IsMailingAddress));
    if (addressOf.has(uid) && !mailing) continue;
    addressOf.set(uid, { addressLine1: text(r.AddressLine1), addressLine2: text(r.AddressLine2), city: text(r.City), state: text(r.State), zip: text(r.Zip) });
  }
  const stats = { rowsRead: orgRows.length, added: 0, updated: 0, unchanged: 0, sameAsAnother: 0 };
  const inserts = [];
  const updates = [];
  const seen = new Set();
  const claimed = new Set(); // churches on the list already matched this time
  for (const row of orgRows) {
    const uid = text(row.MemberOrganizationUID);
    const name = text(row.OrganizationName);
    if (!uid || seen.has(uid)) continue; // FundTrack has the odd church twice; the first is used
    seen.add(uid);
    const contacts = contactsOf.get(uid) || [];
    const first = contacts[0];
    const address = addressOf.get(uid);
    const own = fieldValues("org", row, index, first);
    const kept = details(row, "orgs", USED.orgs);
    let org = byFundTrackId.get(uid) || null;
    if (!org && name) {
      // FundTrack sometimes has one church twice, under two ids: the one
      // already matched keeps it, and the other is left out rather than
      // taking it over on every import.
      const sameName = byName.get(matching.orgKey(name));
      if (sameName && (claimed.has(sameName.id) || (sameName.fundTrackId && sameName.fundTrackId !== uid))) {
        stats.sameAsAnother++;
        continue;
      }
      org = sameName || null;
    }
    if (org) claimed.add(org.id);
    if (!org) {
      if (!name || inactive(row.IsInactive)) continue;
      inserts.push({
        name,
        attn: first?.name || "",
        email: first?.email || "",
        ...(address || { addressLine1: "", addressLine2: "", city: "", state: "", zip: "" }),
        subs: {},
        fields: own,
        sourceBatch,
        fundTrackId: uid,
        fundTrack: kept,
        contacts,
      });
      stats.added++;
      continue;
    }
    const patch = {};
    if (org.fundTrackId !== uid) patch.fundTrackId = uid;
    const fieldsNow = { ...(org.fields || {}), ...own };
    if (!sameJson(fieldsNow, org.fields || {})) patch.fields = fieldsNow;
    if (!sameJson(org.fundTrack, kept)) patch.fundTrack = kept;
    if (!sameJson(org.contacts || [], contacts)) patch.contacts = contacts;
    if (!text(org.attn) && first?.name) patch.attn = first.name;
    if (!text(org.email) && first?.email) patch.email = first.email;
    if (address && !text(org.addressLine1)) Object.assign(patch, address);
    if (Object.keys(patch).length) {
      updates.push({ id: org.id, patch });
      stats.updated++;
    } else stats.unchanged++;
  }
  return { inserts, updates, stats };
}

/** An account's FundTrack id and details, for its head, from its MemberGroups row. */
function accountDetails(row) {
  return { fundTrackGroupId: text(row.MemberGroupUID), fundTrackAccount: details(row, "groups", USED.groups) };
}

/**
 * Tables exported on different days don't quite agree (someone added since):
 * each table's date when they differ, as [{ table, date }], else [].
 */
function mixedDates(found) {
  const dates = new Set(Object.values(found).map((f) => f.date));
  return dates.size > 1 ? Object.entries(found).map(([table, f]) => ({ table, date: f.date })) : [];
}

module.exports = { TABLES, FIELDS, tableOf, dateFromName, scanExports, readExport, details, missingFields, fieldIndex, fieldValues, planPeople, planOrgs, accountDetails, mixedDates, tidy };
