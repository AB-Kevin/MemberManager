"use strict";

// The Find page's search: households, people and churches by name (any
// member of a household), phone (any format, or just the last 4 digits),
// email, birth date, Member ID, church, city, ZIP, or a church's code,
// denomination or contacts -- every word in any order, best matches first.
// The same rules as the office's Member Finder.

/** Lower case, with anything but letters, digits, @ and dots as spaces, so "Smith, J." and "smith j" agree. */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9@.\s]/g, " ");
const digits = (s) => String(s ?? "").replace(/\D/g, "");

// A phone number typed with dots, dashes, parentheses, spaces or a leading 1
// becomes plain digits; dots between other digits (10.05.1980) act like the
// slashes in a date.
const searchText = (q) =>
  String(q ?? "")
    .replace(/(?<!\d)(?:1[\s.\-]*)?\(?(\d{3})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})(?!\d)/g, "$1$2$3")
    .replace(/(\d)\.+(?=\d)/g, "$1 ");

const LIMIT = 200;

/** (717) 555-1234 for a 10-digit number; anything else as it was typed. */
function formatPhone(v) {
  const d = digits(v).replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
}

// Dates are searchable as they're written (3/5/1950, 03/05/1950 or 1950-03-05).
function dateWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return `${Number(m[2])} ${Number(m[3])} ${m[1]} ${m[2]} ${m[3]} ${iso}`;
}

/** Every household, person and church with what a search matches against. */
function buildIndex(model) {
  const index = [];
  const church = (id) => model.byChurch.get(id)?.name || "";
  const place = (h) => [h.city, h.state].filter(Boolean).join(", ");
  const fieldText = (record) =>
    Object.entries(record?.fields || {})
      .map(([id, v]) => {
        const f = model.fields.find((x) => x.id === id);
        return f && f.type !== "yesno" && f.type !== "date" ? v : "";
      })
      .join(" ");
  for (const h of model.households) {
    const members = h.memberIds.map((id) => model.byPerson.get(id));
    index.push({
      k: "h",
      id: h.key,
      active: h.active,
      plans: [h.plan],
      title: h.name,
      sub: [h.head !== h.name ? h.head : "", place(h), church(h.orgId)].filter(Boolean).join(" · "),
      meta: [formatPhone(h.phone), h.memberId].filter(Boolean).join(" · "),
      text: norm([h.name, h.head, members.map((p) => p.name).join(" "), h.memberId, h.email, church(h.orgId), h.city, h.zip, h.addressLine1, h.account.CompanyName].join(" ")),
      dig: [h.phone, h.memberId].map(digits).join(" "),
      names: norm(`${h.name} ${h.head}`),
    });
  }
  for (const p of model.people) {
    const h = p.household;
    index.push({
      k: "p",
      id: p.id,
      active: p.active,
      plans: [h?.plan || ""],
      title: p.name,
      sub: [p.role, p.birthShown && `Born ${p.birthShown}`].filter(Boolean).join(" · "),
      meta: [formatPhone(h?.phone || p.phone), h && h.name !== p.name ? h.name : "", church(p.orgId)].filter(Boolean).join(" · "),
      text: norm([p.name, dateWords(p.birthDate), h?.name, p.memberId || h?.memberId, p.email, h?.email, church(p.orgId), h?.city, h?.zip, fieldText(p.record)].join(" ")),
      dig: [h?.phone || p.phone, p.birthDate, p.memberId || h?.memberId].map(digits).join(" "),
      names: norm(p.name),
    });
  }
  for (const c of model.churches) {
    const plans = [...new Set(c.householdKeys.map((k) => model.byHousehold.get(k)?.plan).filter(Boolean))];
    index.push({
      k: "c",
      id: c.id,
      active: c.active,
      plans,
      title: c.name,
      sub: [c.households ? `${c.households.toLocaleString()} household${c.households === 1 ? "" : "s"}` : "", c.states.join("/"), c.denomination].filter(Boolean).join(" · "),
      meta: [c.code && `Code ${c.code}`, formatPhone(c.phone)].filter(Boolean).join(" · "),
      text: norm([c.name, c.code, c.denomination, c.type, c.attn, c.email, c.city, c.zip, ...c.contacts.map((x) => `${x.name} ${x.email}`), fieldText(c.record)].join(" ")),
      dig: [c.phone, ...c.contacts.map((x) => x.phone)].map(digits).join(" "),
      names: norm(c.name),
    });
  }
  return index;
}

/**
 * Searches the index: { total, results: [{ k, id, title, sub, meta, active }] },
 * the first LIMIT, best first. `kind` is "h", "p", "c" or "" for all;
 * `plan` narrows to one plan; inactive ones are left out unless `inactive`.
 * With no words, it lists households and churches (people are too many to
 * be useful that way).
 */
function search(index, query, { kind = "", plan = "", inactive = false, limit = LIMIT } = {}) {
  const words = norm(searchText(query)).split(/\s+/).filter(Boolean);
  const found = [];
  for (const e of index) {
    if (kind && e.k !== kind) continue;
    if (!inactive && !e.active) continue;
    if (plan && !e.plans.includes(plan)) continue;
    if (!words.length && !kind && e.k === "p") continue;
    let score = 0;
    let ok = true;
    for (const w of words) {
      const d = digits(w);
      const phone = d.replace(/^1(?=\d{10}$)/, ""); // 11 digits starting with 1 = a 10-digit phone
      const hit = e.text.includes(w) || (d.length >= 3 && d === w && (e.dig.includes(d) || e.dig.includes(phone)));
      if (!hit) {
        ok = false;
        break;
      }
      if (` ${e.names}`.includes(` ${w}`)) score += 2;
    }
    if (ok) found.push([score, e]);
  }
  // "(No name)" and the like sort last.
  const placeholder = (e) => (e.title.startsWith("(") ? 1 : 0);
  found.sort((a, b) => b[0] - a[0] || placeholder(a[1]) - placeholder(b[1]) || a[1].title.localeCompare(b[1].title));
  return {
    total: found.length,
    results: found.slice(0, limit).map(([, e]) => ({ k: e.k, id: e.id, title: e.title, sub: e.sub, meta: e.meta, active: e.active })),
  };
}

/** Whether `query` (as typed in the Members page's search box) matches `parts`: every word somewhere, a number also as digits (a phone in any format). */
function matchesWords(parts, query) {
  const words = norm(searchText(query)).split(/\s+/).filter(Boolean);
  const hay = norm(parts.join(" "));
  const dig = parts.map(digits).join(" ");
  return words.every((w) => hay.includes(w) || (/^\d{3,}$/.test(w) && dig.includes(w.replace(/^1(?=\d{10}$)/, ""))));
}

module.exports = { buildIndex, search, matchesWords, formatPhone, norm, digits, searchText, LIMIT };
