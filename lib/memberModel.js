"use strict";

// The member list as the Find, Lists and Near ZIP pages see it: people,
// households and churches, linked up, with what each page searches or
// filters on worked out once.
//
// A "household" here is a member's account, as FundTrack has it: its head
// and everyone with the same FundTrack account (`fundTrackGroupId`), with
// the head's Member ID, phone, plan and status (see lib/fundTrack.js). The
// list's own households are mailing addresses, which two accounts can share;
// a household's address is its head's. People who aren't in a FundTrack
// account -- newsletter signups, say -- are a household per mailing address.
//
// The fields FundTrack's import fills in are found by name (Phone, Plan,
// Household type, Birth date, Role, Gender; Code, Denomination, Organization
// type and Phone for churches), so renaming one only means it's treated like
// any other field.

const Fields = require("./fields");
const rules = require("./contactRules");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Years from an ISO birth date to `today`, or null when there's none or it can't be right (a typo like 1011 or 7200). */
function ageOn(birthDate, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate || "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  return age >= 0 && age <= 120 ? age : null;
}

const text = (v) => String(v ?? "").trim();

/**
 * The model: { people, households, churches, fields, publications, byPerson,
 * byHousehold, byChurch }. `list` is { contacts, households, orgs,
 * publications, fields }.
 */
function buildModel(list, today = new Date()) {
  const fields = list.fields || [];
  const byLabel = (appliesTo, label) => fields.find((f) => f.appliesTo === appliesTo && f.label.toLowerCase() === label) || null;
  const F = {
    phone: byLabel("contact", "phone"),
    plan: byLabel("contact", "plan"),
    type: byLabel("contact", "household type"),
    birth: byLabel("contact", "birth date"),
    role: byLabel("contact", "role"),
    gender: byLabel("contact", "gender"),
    orgCode: byLabel("org", "code"),
    orgDenom: byLabel("org", "denomination"),
    orgType: byLabel("org", "organization type"),
    orgPhone: byLabel("org", "phone"),
  };
  const val = (record, field) => (field ? record?.fields?.[field.id] ?? "" : "");
  const shown = (record, field) => (field ? Fields.formatValue(field.type, record?.fields?.[field.id]) : "");
  const mail = new Map(list.households.map((h) => [h.id, h]));
  const orgById = new Map(list.orgs.map((o) => [o.id, o]));

  // People.
  const people = list.contacts.map((c) => {
    const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(val(c, F.birth)) ? val(c, F.birth) : "";
    const age = ageOn(birthDate, today);
    return {
      id: c.id,
      record: c,
      name: c.name || "(No name)",
      email: c.email || "",
      memberId: c.memberId || "",
      ownStatus: c.memberStatus || "",
      role: text(val(c, F.role)),
      birthDate,
      birthShown: birthDate ? shown(c, F.birth) : "",
      age,
      birthCheck: !!birthDate && age === null, // a date that can't be right
      birthMonth: birthDate ? MONTHS[Number(birthDate.slice(5, 7)) - 1] : "",
      gender: text(val(c, F.gender)),
      phone: text(val(c, F.phone)),
      orgId: orgById.has(c.orgId) ? c.orgId : null,
      mailHouseholdId: mail.has(c.householdId) ? c.householdId : null,
      householdKey: c.fundTrackGroupId ? `ft:${c.fundTrackGroupId}` : mail.has(c.householdId) ? `hh:${c.householdId}` : null,
    };
  });
  const byPerson = new Map(people.map((p) => [p.id, p]));

  // Households (accounts).
  const groups = new Map();
  for (const p of people) {
    if (!p.householdKey) continue;
    if (!groups.has(p.householdKey)) groups.set(p.householdKey, []);
    groups.get(p.householdKey).push(p);
  }
  const ROLE_ORDER = (role) => (/head/i.test(role) ? 0 : /spouse|wife|husband/i.test(role) ? 1 : /child|son|daughter/i.test(role) ? 2 : 3);
  const households = [...groups].map(([key, members]) => {
    const head = members.find((p) => p.memberId) || members.find((p) => /head/i.test(p.role)) || members[0];
    members.sort((a, b) => (a === head ? -1 : b === head ? 1 : 0) || ROLE_ORDER(a.role) - ROLE_ORDER(b.role) || (a.birthDate || "9").localeCompare(b.birthDate || "9"));
    const account = head.record.fundTrackAccount || {};
    const place = mail.get(head.mailHouseholdId) || mail.get(members.find((p) => p.mailHouseholdId)?.mailHouseholdId) || {};
    const status = head.memberId ? head.ownStatus || "Active" : "";
    const name =
      text(account.householdName) ||
      text(account.MemberGroupName) ||
      (key.startsWith("ft:") || members.length === 1 ? head.name : rules.addresseeOf(members.map((m) => ({ name: m.name, orgName: "" }))));
    const ages = members.map((p) => p.age).filter((a) => a !== null);
    return {
      key,
      fundTrack: key.startsWith("ft:"),
      name,
      headId: head.id,
      head: head.name,
      memberId: head.memberId,
      status: status || (key.startsWith("ft:") ? "Active" : ""),
      active: status !== "Inactive",
      phone: head.phone || members.find((p) => p.phone)?.phone || "",
      email: head.email || members.find((p) => p.email)?.email || "",
      plan: text(val(head.record, F.plan)),
      type: text(val(head.record, F.type)),
      addressLine1: place.addressLine1 || "",
      addressLine2: place.addressLine2 || "",
      city: place.city || "",
      state: place.state || "",
      zip: place.zip || "",
      mailHouseholdId: place.id || null,
      orgId: head.orgId || members.find((p) => p.orgId)?.orgId || null,
      memberIds: members.map((p) => p.id),
      size: members.length,
      children: members.filter((p) => p.age !== null && p.age < 18).length,
      oldest: ages.length ? Math.max(...ages) : null,
      account,
    };
  });
  const byHousehold = new Map(households.map((h) => [h.key, h]));
  for (const p of people) {
    const h = byHousehold.get(p.householdKey);
    p.active = p.ownStatus !== "Inactive" && (!h || h.active);
    p.household = h || null;
  }

  // Churches.
  const churchHouseholds = new Map();
  for (const h of households) {
    if (!h.orgId) continue;
    if (!churchHouseholds.has(h.orgId)) churchHouseholds.set(h.orgId, []);
    churchHouseholds.get(h.orgId).push(h);
  }
  const churches = list.orgs.map((o) => {
    const hh = churchHouseholds.get(o.id) || [];
    const contacts = Array.isArray(o.contacts) ? o.contacts : [];
    const inactive = /^yes$/i.test(text(o.fundTrack?.IsInactive));
    return {
      id: o.id,
      record: o,
      name: o.name || "(No name)",
      code: text(val(o, F.orgCode)),
      type: text(val(o, F.orgType)),
      denomination: text(val(o, F.orgDenom)),
      phone: text(val(o, F.orgPhone)) || contacts.find((c) => c.phone)?.phone || "",
      attn: o.attn || "",
      email: o.email || "",
      contacts,
      addressLine1: o.addressLine1 || "",
      addressLine2: o.addressLine2 || "",
      city: o.city || "",
      state: o.state || "",
      zip: o.zip || "",
      active: !inactive,
      status: inactive ? "Inactive" : "Active",
      householdKeys: hh.map((h) => h.key),
      households: hh.length,
      people: hh.reduce((n, h) => n + h.size, 0) + list.contacts.filter((c) => c.orgId === o.id && !byPerson.get(c.id)?.householdKey).length,
      states: [...new Set(hh.map((h) => h.state).filter(Boolean))].sort(),
    };
  });
  const byChurch = new Map(churches.map((c) => [c.id, c]));
  return { people, households, churches, fields, F, publications: list.publications || [], mail, byPerson, byHousehold, byChurch, today };
}

module.exports = { buildModel, ageOn, MONTHS };
