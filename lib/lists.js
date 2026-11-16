"use strict";

// The Lists page: any list of people, households or churches, on any field,
// with any conditions -- "everyone 65 and over in Ohio", "households within
// 50 miles of 44691 with no email" -- to save as a spreadsheet or print. The
// same rules as the office's Member Finder.
//
// A field is { k (a stable key, kept in saved lists), label, group, type:
// "text" | "enum" | "num" | "date" | "bool", get(record) -> value, opts }.
// Dates are ISO (YYYY-MM-DD) and shown as 3/5/1950; a yes/no is "Yes" or
// "No". Every field is offered: the built-in ones, the office's own fields,
// FundTrack's details, which newsletters each gets, and "Miles from" a ZIP.

const Fields = require("./fields");
const rules = require("./contactRules");
const { MONTHS } = require("./memberModel");
const { zipPoint, zip5, milesBetween } = require("./nearZip");

const KINDS = { people: "People", households: "Households", churches: "Churches" };

const OPS = {
  text: [["has", "contains"], ["is", "is"], ["not", "is not"], ["sw", "starts with"], ["blank", "is blank"], ["set", "is not blank"]],
  enum: [["is", "is"], ["not", "is not"], ["has", "contains"], ["blank", "is blank"], ["set", "is not blank"]],
  num: [["ge", "at least"], ["le", "at most"], ["eq", "equals"], ["ne", "not equal to"], ["bt", "between"], ["blank", "is blank"], ["set", "is not blank"]],
  date: [["on", "on"], ["before", "before"], ["after", "after"], ["bt", "between"], ["month", "in month"], ["year", "in year"], ["blank", "is blank"], ["set", "is not blank"]],
  bool: [["yes", "is Yes"], ["no", "is No / blank"]],
};

const DEFAULT_COLUMNS = {
  people: ["p.name", "p.role", "p.birth", "p.age", "h.name", "h.phone", "h.email", "h.city", "h.state", "h.church"],
  households: ["h.name", "h.memberId", "h.head", "h.members", "h.phone", "h.email", "h.addr1", "h.addr2", "h.city", "h.state", "h.zip", "h.church"],
  churches: ["c.name", "c.code", "c.type", "c.hh", "c.people", "c.cname", "c.cphone", "c.cemail", "c.city", "c.state"],
};

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
/** "03/05/1950" -> "1950-03-05"; ISO stays as it is; anything else "". */
function isoDate(v) {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = US_DATE.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}
const isNum = (v) => /^-?\d+(\.\d+)?$/.test(String(v).replace(/[$,]/g, ""));

// A FundTrack detail column's type, from its values.
function guessType(values) {
  const xs = values.filter((v) => v !== "" && v != null);
  if (!xs.length) return "text";
  if (xs.every((v) => v === "Yes" || v === "No")) return "bool";
  if (xs.every((v) => US_DATE.test(v))) return "date";
  if (xs.every(isNum)) return "num";
  const distinct = new Set(xs);
  return distinct.size <= 30 && xs.length >= distinct.size * 2 ? "enum" : "text";
}

const enumOf = (values) => [...new Set(values.filter((v) => v !== "" && v != null).map(String))].sort((a, b) => a.localeCompare(b));

/** How a value reads in a list or spreadsheet. */
function display(field, value) {
  if (value === "" || value == null) return "";
  if (field.type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(value);
  }
  return value;
}

/**
 * The records and fields for one kind: { kind, records, fields, byKey }.
 * `near` is { zips, origin } to offer "Miles from <origin>".
 */
function catalog(model, kind, near = null) {
  const field = (k, label, group, type, get, opts = null) => ({ k, label, group, type, get, opts });
  const church = (id) => model.byChurch.get(id)?.name || "";
  const builtIn = new Set(Object.values(model.F).filter(Boolean).map((f) => f.id));

  // The office's own fields of one level, as list fields.
  const ownFields = (appliesTo, prefix, group, recordOf, records) =>
    model.fields
      .filter((f) => f.appliesTo === appliesTo && !builtIn.has(f.id))
      .map((f) => {
        const raw = (r) => recordOf(r)?.fields?.[f.id];
        const type = { yesno: "bool", choice: "enum", number: "num", date: "date" }[f.type] || "text";
        const get = (r) => {
          const v = raw(r);
          if (v === undefined || v === null || v === "") return "";
          return type === "bool" ? (v ? "Yes" : "No") : type === "text" ? Fields.formatValue(f.type, v) : v;
        };
        return field(prefix + f.id, f.label, group, type, get, type === "enum" ? enumOf(records.map(get)) : null);
      });

  // FundTrack's detail columns on a kind of record.
  const details = (prefix, group, detailsOf, records) => {
    const labels = new Set();
    for (const r of records) for (const key of Object.keys(detailsOf(r) || {})) labels.add(key);
    return [...labels].sort().map((label) => {
      const rawGet = (r) => detailsOf(r)?.[label] ?? "";
      const type = guessType(records.map(rawGet));
      const get = type === "date" ? (r) => isoDate(rawGet(r)) : rawGet;
      return field(prefix + label, label, group, type, get, type === "enum" ? enumOf(records.map(rawGet)) : null);
    });
  };

  // Which newsletters it gets.
  const gets = (prefix, group, test) => model.publications.map((pub) => field(`${prefix}${pub.id}`, `Gets ${pub.name}`, group, "bool", (r) => (test(r, pub.id) ? "Yes" : "No")));

  // A household's fields, for households and for the people in them.
  const householdFields = (H, records) => [
    field("h.name", "Household", "Household", "text", (r) => H(r)?.name ?? ""),
    field("h.memberId", "Member ID", "Household", "text", (r) => H(r)?.memberId ?? ""),
    field("h.head", "Head of household", "Household", "text", (r) => H(r)?.head ?? ""),
    field("h.phone", "Phone", "Household", "text", (r) => H(r)?.phone ?? ""),
    field("h.email", "Email", "Household", "text", (r) => H(r)?.email ?? ""),
    field("h.addr1", "Address line 1", "Household", "text", (r) => H(r)?.addressLine1 ?? ""),
    field("h.addr2", "Address line 2", "Household", "text", (r) => H(r)?.addressLine2 ?? ""),
    field("h.city", "City", "Household", "text", (r) => H(r)?.city ?? ""),
    field("h.state", "State", "Household", "enum", (r) => H(r)?.state ?? "", enumOf(model.households.map((h) => h.state))),
    field("h.zip", "ZIP", "Household", "text", (r) => H(r)?.zip ?? ""),
    field("h.church", "Church", "Household", "enum", (r) => church(H(r)?.orgId), enumOf(model.households.map((h) => church(h.orgId)))),
    field("h.plan", "Plan", "Household", "enum", (r) => H(r)?.plan ?? "", enumOf(model.households.map((h) => h.plan))),
    field("h.type", "Household type", "Household", "enum", (r) => H(r)?.type ?? "", enumOf(model.households.map((h) => h.type))),
    field("h.status", "Household status", "Household", "enum", (r) => H(r)?.status ?? "", ["Active", "Inactive"]),
    field("h.members", "People in household", "Household", "num", (r) => (H(r) ? H(r).size : "")),
    field("h.kids", "Children in household (under 18)", "Household", "num", (r) => (H(r) ? H(r).children : "")),
    field("h.oldest", "Oldest member's age", "Household", "num", (r) => (H(r) ? H(r).oldest ?? "" : "")),
    ...gets("h.mail.", "Household newsletters", (r, pubId) => {
      const place = model.mail.get(H(r)?.mailHouseholdId);
      return rules.getsMail(place, pubId);
    }),
    ...ownFields("household", "hf.", "Household's own fields", (r) => model.mail.get(H(r)?.mailHouseholdId), records),
    ...details("hd.", "Household · FundTrack", (r) => {
      const h = H(r);
      return h ? model.byPerson.get(h.headId)?.record.fundTrackAccount : null;
    }, records),
  ];

  let records;
  let fields;
  if (kind === "churches") {
    records = model.churches.map((c) => ({ c }));
    const C = (r) => r.c;
    const first = (r) => C(r).contacts[0] || {};
    fields = [
      field("c.name", "Church", "Church", "text", (r) => C(r).name),
      field("c.code", "Code", "Church", "text", (r) => C(r).code),
      field("c.type", "Type", "Church", "enum", (r) => C(r).type, enumOf(model.churches.map((c) => c.type))),
      field("c.denom", "Denomination", "Church", "enum", (r) => C(r).denomination, enumOf(model.churches.map((c) => c.denomination))),
      field("c.status", "Status", "Church", "enum", (r) => C(r).status, ["Active", "Inactive"]),
      field("c.hh", "Households", "Church", "num", (r) => C(r).households),
      field("c.people", "People", "Church", "num", (r) => C(r).people),
      field("c.states", "States", "Church", "text", (r) => C(r).states.join(" ")),
      field("c.attn", "Attention", "Church", "text", (r) => C(r).attn),
      field("c.email", "Email", "Church", "text", (r) => C(r).email),
      field("c.phone", "Phone", "Church", "text", (r) => C(r).phone),
      field("c.cname", "Contact name", "Church contact", "text", (r) => first(r).name || ""),
      field("c.ctype", "Contact type", "Church contact", "text", (r) => first(r).type || ""),
      field("c.cphone", "Contact phone", "Church contact", "text", (r) => first(r).phone || ""),
      field("c.cemail", "Contact email", "Church contact", "text", (r) => first(r).email || ""),
      field("c.addr1", "Address line 1", "Church address", "text", (r) => C(r).addressLine1),
      field("c.addr2", "Address line 2", "Church address", "text", (r) => C(r).addressLine2),
      field("c.city", "City", "Church address", "text", (r) => C(r).city),
      field("c.state", "State", "Church address", "enum", (r) => C(r).state, enumOf(model.churches.map((c) => c.state))),
      field("c.zip", "ZIP", "Church address", "text", (r) => C(r).zip),
      ...gets("c.gets.", "Church newsletters", (r, pubId) => rules.coveredBy(C(r).record, pubId) || rules.getsEmail(C(r).record, pubId)),
      ...ownFields("org", "cf.", "Church's own fields", (r) => C(r).record, records),
      ...details("cd.", "Church · FundTrack", (r) => C(r).record.fundTrack, records),
    ];
  } else if (kind === "households") {
    records = model.households.map((h) => ({ h }));
    fields = householdFields((r) => r.h, records);
  } else {
    records = model.people.map((p) => ({ p, h: p.household }));
    const P = (r) => r.p;
    fields = [
      field("p.name", "Name", "Person", "text", (r) => P(r).name),
      field("p.role", "Role", "Person", "enum", (r) => P(r).role, enumOf(model.people.map((p) => p.role))),
      field("p.birth", "Birth date", "Person", "date", (r) => P(r).birthDate),
      field("p.age", "Age", "Person", "num", (r) => P(r).age ?? ""),
      field("p.bmonth", "Birth month", "Person", "enum", (r) => P(r).birthMonth, MONTHS),
      field("p.gender", "Gender", "Person", "enum", (r) => P(r).gender, enumOf(model.people.map((p) => p.gender))),
      field("p.status", "Status", "Person", "enum", (r) => (P(r).active ? "Active" : "Inactive"), ["Active", "Inactive"]),
      field("p.email", "Own email", "Person", "text", (r) => P(r).email),
      field("p.church", "Church", "Person", "enum", (r) => church(P(r).orgId), enumOf(model.people.map((p) => church(p.orgId)))),
      field("p.member", "Member of record (has the Member ID)", "Person", "bool", (r) => (P(r).memberId ? "Yes" : "No")),
      ...gets("p.gets.", "Newsletters", (r, pubId) => {
        const c = P(r).record;
        return rules.getsEmail(c, pubId) || rules.getsMail(model.mail.get(c.householdId), pubId) || rules.coveredBy(model.byChurch.get(c.orgId)?.record, pubId);
      }),
      ...ownFields("contact", "pf.", "Person's own fields", (r) => P(r).record, records),
      ...details("pd.", "Person · FundTrack", (r) => P(r).record.fundTrack, records),
      ...householdFields((r) => r.h, records),
    ];
  }
  if (near?.zips?.has(near.origin)) {
    const from = near.zips.get(near.origin);
    const cache = new Map();
    const zipOf = (r) => (kind === "churches" ? r.c.zip : r.h?.zip);
    fields.push(
      field("geo.mi", `Miles from ${near.origin}`, "Location", "num", (r) => {
        const at = zipPoint(near.zips, zip5(zipOf(r)), cache);
        return at ? Number(milesBetween(from, at.pt).toFixed(1)) : "";
      })
    );
  }
  return { kind, records, fields, byKey: new Map(fields.map((f) => [f.k, f])) };
}

/** One condition { k, op, v, v2 } as a test(record), or null when its field isn't offered. A condition not filled in yet passes everything. */
function condTest(field, c) {
  if (!field) return null;
  const get = field.get;
  const op = c.op;
  const lower = (x) => String(x ?? "").toLowerCase();
  const v = lower(c.v).trim();
  switch (op) {
    case "blank":
      return (r) => get(r) === "" || get(r) == null;
    case "set":
      return (r) => !(get(r) === "" || get(r) == null);
    case "yes":
      return (r) => get(r) === "Yes";
    case "no":
      return (r) => get(r) !== "Yes";
  }
  if (field.type === "num") {
    const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(/[$,]/g, "")));
    const a = n(c.v);
    const b = n(c.v2);
    if (a == null || Number.isNaN(a)) return () => true;
    const tests = {
      ge: (r) => n(get(r)) != null && n(get(r)) >= a,
      le: (r) => n(get(r)) != null && n(get(r)) <= a,
      eq: (r) => n(get(r)) === a,
      ne: (r) => n(get(r)) !== a,
      bt: (r) => {
        const x = n(get(r));
        return x != null && x >= Math.min(a, b ?? a) && x <= Math.max(a, b ?? a);
      },
    };
    return tests[op] || (() => true);
  }
  if (field.type === "date") {
    if (op === "month") {
      const m = Number(c.v);
      return m >= 1 && m <= 12 ? (r) => !!get(r) && Number(String(get(r)).slice(5, 7)) === m : () => true;
    }
    if (op === "year") {
      const y = String(c.v).trim();
      return /^\d{4}$/.test(y) ? (r) => String(get(r)).slice(0, 4) === y : () => true;
    }
    const a = isoDate(c.v);
    const b = isoDate(c.v2);
    if (!a) return () => true;
    const lo = b && b < a ? b : a;
    const hi = b && b > a ? b : a;
    const tests = {
      on: (r) => get(r) === a,
      before: (r) => !!get(r) && get(r) < a,
      after: (r) => !!get(r) && get(r) > a,
      bt: (r) => !!get(r) && get(r) >= lo && get(r) <= hi,
    };
    return tests[op] || (() => true);
  }
  if (!v && ["has", "is", "not", "sw"].includes(op)) return () => true;
  const tests = {
    has: (r) => lower(get(r)).includes(v),
    is: (r) => lower(get(r)).trim() === v,
    not: (r) => lower(get(r)).trim() !== v,
    sw: (r) => lower(get(r)).startsWith(v),
  };
  return tests[op] || (() => true);
}

/** The records matching all the conditions (`match` "all") or any of them ("any"). Conditions on fields that aren't offered are ignored. */
function runList(cat, conds, match = "all") {
  const tests = (conds || []).map((c) => condTest(cat.byKey.get(c.k), c)).filter(Boolean);
  if (!tests.length) return cat.records.slice();
  return cat.records.filter(match === "any" ? (r) => tests.some((t) => t(r)) : (r) => tests.every((t) => t(r)));
}

/** Records sorted by a field (blanks last either way). */
function sortRecords(records, field, dir = 1) {
  if (!field) return records;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return records
    .map((r) => [field.get(r), r])
    .sort(([a], [b]) => {
      const blankA = a === "" || a == null;
      const blankB = b === "" || b == null;
      if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
      if (field.type === "num") return (Number(a) - Number(b)) * dir;
      return collator.compare(String(a), String(b)) * dir;
    })
    .map(([, r]) => r);
}

/** A record's id, for opening it on the Find page. */
function recordRef(kind, r) {
  return kind === "churches" ? { k: "c", id: r.c.id } : kind === "households" ? { k: "h", id: r.h.key } : { k: "p", id: r.p.id };
}

/** Ready-made lists to start from: [{ name, state: { kind, conds, match, cols, sort, dir } }]. */
function presets(today = new Date()) {
  const active = { k: "p.status", op: "is", v: "Active" };
  const householdActive = { k: "h.status", op: "is", v: "Active" };
  const month = String(today.getMonth() + 1);
  return [
    { name: "65 and over", state: { kind: "people", conds: [{ k: "p.age", op: "ge", v: "65" }, active] } },
    { name: "Under 18", state: { kind: "people", conds: [{ k: "p.age", op: "le", v: "17" }, active] } },
    { name: "Birthdays this month", state: { kind: "people", conds: [{ k: "p.birth", op: "month", v: month }, active], sort: "p.bmonth" } },
    { name: "Heads of household", state: { kind: "people", conds: [{ k: "p.role", op: "is", v: "Head of Household" }, active] } },
    { name: "Households: mailing list", state: { kind: "households", conds: [householdActive], cols: ["h.name", "h.head", "h.addr1", "h.addr2", "h.city", "h.state", "h.zip"] } },
    { name: "Households with no email", state: { kind: "households", conds: [{ k: "h.email", op: "blank" }, householdActive] } },
    { name: "Households with no phone", state: { kind: "households", conds: [{ k: "h.phone", op: "blank" }, householdActive] } },
    { name: "Church contacts", state: { kind: "churches", conds: [{ k: "c.status", op: "is", v: "Active" }] } },
  ];
}

/** A condition as words: "Age at least 65". */
function describe(cat, c) {
  const field = cat.byKey.get(c.k);
  if (!field) return "";
  const op = (OPS[field.type].find((o) => o[0] === c.op) || [c.op, c.op])[1];
  if (["blank", "set", "yes", "no"].includes(c.op)) return `${field.label} ${op}`;
  if (c.op === "month") return `${field.label} in ${MONTHS[Number(c.v) - 1] || "?"}`;
  const shown = (x) => (field.type === "date" ? display(field, isoDate(x)) : x);
  return `${field.label} ${op} ${shown(c.v)}${c.op === "bt" ? ` and ${shown(c.v2)}` : ""}`;
}

module.exports = { KINDS, OPS, DEFAULT_COLUMNS, catalog, condTest, runList, sortRecords, recordRef, presets, describe, display, isoDate, guessType };
