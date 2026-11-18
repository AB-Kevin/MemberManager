"use strict";

// Columns MemberManager never keeps. The membership software's exports carry
// identity, health and insurance-claim details alongside the names and
// addresses a mailing needs, and anything MemberManager keeps sits in a data
// folder everyone with the AB Apps folder can read. Imports leave these out,
// and none of them can be made into a field (lib/fields.js).
//
// Matched ignoring case, spaces and punctuation, so "Last 4 SSN" is caught as
// well as "Last4SSN".
//
// Whether a member is exempt from Social Security (MemberGroups'
// SocialSecurityExempt; a church's is MemberOrganizations' HasSSNExemption)
// isn't on the list: it's a yes or no, not a number, and the office needs it
// to know who gets certain forms. It's kept as the person field "Social
// Security Exempt", on each account's head (lib/fundTrack.js).

const SENSITIVE = [
  "last4ssn",
  "ssnlast4",
  "ssn",
  "socialsecuritynumber",
  "has4029copyonfile",
  "haspreexistingcondition",
  "preexisting",
  "accidentdeductibleyear",
  "accidentdate",
  "accidentdescription",
  "accidentcategory",
  "accidenttype",
  "caseidifany",
  "defectcodeifany",
  "isadultwithdisability",
  "coveredbymedicarepart",
];

const normalize = (header) => String(header).toLowerCase().replace(/[^a-z0-9]/g, "");

function isSensitive(header) {
  return SENSITIVE.includes(normalize(header));
}

/** `extra` without its sensitive columns, or the same object when it has none. */
function withoutSensitive(extra) {
  if (!extra || !Object.keys(extra).some(isSensitive)) return extra;
  return Object.fromEntries(Object.entries(extra).filter(([key]) => !isSensitive(key)));
}

module.exports = { isSensitive, withoutSensitive };
