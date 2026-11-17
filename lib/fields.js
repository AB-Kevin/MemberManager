"use strict";

// Fields the office adds to people, households and organizations -- "Over 65",
// "Committee", "Joined", "Board member" -- on top of the ones every record
// has (name, email, address, Member ID). Loaded with require() in main and as
// a plain <script> in the renderer, where it's window.Fields, so the
// spreadsheet and the importer read a value the same way.
//
// A field's definition is a row in fields.json:
//
//   { id, label, appliesTo: "contact" | "household" | "org", type, choices }
//
// and a record keeps its values under `fields`, by the field's id:
//
//   { id, name, ..., fields: { "<field id>": "Finance", "<field id>": true } }
//
// Values are kept by id, not label, so renaming a field keeps every value,
// and two fields can never collide however they're named. A blank value is
// no entry at all.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Fields = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TYPES = [
    { value: "text", label: "Text", hint: "Anything — a committee, a note, a phone number" },
    { value: "choice", label: "Choice", hint: "Text, with the values already used offered as you type" },
    { value: "number", label: "Number", hint: "A number, like a count or an amount" },
    { value: "date", label: "Date", hint: "A date, kept as year-month-day" },
    { value: "yesno", label: "Yes / No", hint: "A checkbox" },
  ];
  const TYPE_VALUES = new Set(TYPES.map((t) => t.value));

  // Who a field belongs to. A household's fields show on every member's row
  // (like its address); a person's are their own.
  const LEVELS = [
    { value: "contact", label: "Person", plural: "People" },
    { value: "household", label: "Household", plural: "Households" },
    { value: "org", label: "Organization", plural: "Organizations" },
  ];
  const LEVEL_VALUES = new Set(LEVELS.map((l) => l.value));

  const MAX_LABEL = 60;
  const MAX_TEXT = 2000;

  const FALSE_WORDS = new Set(["", "no", "n", "false", "f", "0", "off", "unchecked", "-", "—", "none", "n/a", "na"]);
  const TRUE_WORDS = new Set(["yes", "y", "true", "t", "1", "x", "✓", "✔", "on", "checked"]);

  const pad = (n) => String(n).padStart(2, "0");
  const isRealDate = (y, m, d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };

  // "2024-03-05", "3/5/2024", "3/5/24", "March 5, 2024" -> "2024-03-05".
  // US order (month first), as the office's spreadsheets are. Null when it
  // isn't a date.
  function parseDate(text) {
    const t = String(text ?? "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
    }
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
    if (m) {
      let y = Number(m[3]);
      if (m[3].length === 2) y += y > (new Date().getFullYear() % 100) + 10 ? 1900 : 2000;
      const [mo, d] = [Number(m[1]), Number(m[2])];
      return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
    }
    if (/[a-z]/i.test(t) && /\d{4}/.test(t)) {
      const parsed = new Date(`${t} 12:00`);
      if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }
    return null;
  }

  // "1,234.50", "$40", "12%" -> a number; null when it isn't one.
  function parseNumber(text) {
    if (typeof text === "number") return Number.isFinite(text) ? text : null;
    const t = String(text ?? "").trim().replace(/[$,%\s]/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t);
  }

  /**
   * A typed or imported value for a field of type `type`:
   * { value } to save, { blank: true } for nothing (clears it when typed,
   * says nothing when imported), or { error } when it can't be read.
   */
  function parseValue(type, raw) {
    if (raw === null || raw === undefined) return { blank: true };
    if (type === "yesno") {
      if (typeof raw === "boolean") return { value: raw };
      const t = String(raw).trim().toLowerCase();
      if (t === "") return { blank: true };
      if (TRUE_WORDS.has(t)) return { value: true };
      if (FALSE_WORDS.has(t)) return { value: false };
      return { error: `"${String(raw).trim()}" isn't yes or no.` };
    }
    const text = String(raw).replace(/\s+/g, " ").trim();
    if (!text) return { blank: true };
    if (type === "number") {
      const n = parseNumber(text);
      return n === null ? { error: `"${text}" isn't a number.` } : { value: n };
    }
    if (type === "date") {
      const d = parseDate(text);
      return d === null ? { error: `"${text}" isn't a date. Use a form like 3/5/2024.` } : { value: d };
    }
    return { value: text.slice(0, MAX_TEXT) };
  }

  /** How a stored value reads on screen and in exports. */
  function formatValue(type, value) {
    if (value === undefined || value === null || value === "") return "";
    if (type === "yesno") return value ? "Yes" : "No";
    if (type === "date") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(value);
    }
    return String(value);
  }

  // Whether a column of sample values reads as this type -- to suggest a type
  // when a new field is made from an imported column.
  function guessType(samples) {
    const values = (samples || []).map((s) => String(s).trim()).filter(Boolean);
    if (!values.length) return "text";
    if (values.every((v) => TRUE_WORDS.has(v.toLowerCase()) || FALSE_WORDS.has(v.toLowerCase()))) return "yesno";
    if (values.every((v) => parseDate(v) !== null && /\d/.test(v) && !/^\d+$/.test(v))) return "date";
    if (values.every((v) => parseNumber(v) !== null) && !values.some((v) => /^0\d/.test(v))) return "number";
    const distinct = new Set(values.map((v) => v.toLowerCase()));
    if (values.length >= 6 && distinct.size <= Math.max(3, values.length / 4)) return "choice";
    return "text";
  }

  /** A definition as it's saved: checked and tidied, or an Error thrown. */
  function cleanDefinition(input, existing, exceptId) {
    const label = String(input?.label ?? "").replace(/\s+/g, " ").trim();
    if (!label) throw new Error("Give the field a name.");
    if (label.length > MAX_LABEL) throw new Error(`Use ${MAX_LABEL} characters or fewer for the name.`);
    const appliesTo = input?.appliesTo;
    if (!LEVEL_VALUES.has(appliesTo)) throw new Error("Choose who the field is for: a person, a household or an organization.");
    const type = input?.type || "text";
    if (!TYPE_VALUES.has(type)) throw new Error("Choose what kind of field it is.");
    const clash = (existing || []).find(
      (f) => f.id !== exceptId && f.appliesTo === appliesTo && f.label.toLowerCase() === label.toLowerCase()
    );
    if (clash) throw new Error(`${levelLabel(appliesTo)} already has a field called "${clash.label}".`);
    return { label, appliesTo, type };
  }

  const levelLabel = (appliesTo) => (LEVELS.find((l) => l.value === appliesTo) || LEVELS[0]).label;

  const hasValue = (v) => v !== undefined && v !== null && v !== "";

  /**
   * What moving household field `fieldId` to people does: everyone gets
   * their household's value, as the Members page already shows it on their
   * row. { people: Map(contactId -> value), households: how many have a
   * value, stranded: how many of those have no one in them, whose values
   * have nowhere to go }.
   */
  function householdToPeople(fieldId, households, contacts) {
    const values = new Map();
    for (const h of households || []) if (hasValue(h.fields?.[fieldId])) values.set(h.id, h.fields[fieldId]);
    const people = new Map();
    const occupied = new Set();
    for (const c of contacts || []) {
      if (!values.has(c.householdId)) continue;
      occupied.add(c.householdId);
      people.set(c.id, values.get(c.householdId));
    }
    return { people, households: values.size, stranded: values.size - occupied.size };
  }

  return { TYPES, LEVELS, MAX_LABEL, parseValue, formatValue, parseDate, parseNumber, guessType, cleanDefinition, levelLabel, householdToPeople };
});
