# MemberManager

A desktop app that keeps the office's member list in one place: everyone the office keeps in touch with, their households and churches, which newsletters they get, and any fields the office adds. FormTracker and SendNewsletters read their contacts from it, so a person is updated once rather than in each app.

- **Members**: two editable spreadsheets, **People** and **Organizations**. Edits save as you go, and Ctrl+Z undoes them.
- **Fields**: the office's own fields, such as Committee, Over 65, Joined or District, for each person, each household or each organization. Add one in a few seconds from **Add field…** on the Members page, or from the **Fields** page.
- **Import**: a spreadsheet (the membership software's export, say), new signups from the website's Gravity Forms signup form, or FormTracker's contacts. Any column can go into a field, or become a new one.
- **Duplicates**: people, households and churches that might be the same, to merge or keep apart.
- **Newsletters…**: the newsletters and magazines, and who gets each by email or by mail.

It grew out of SendNewsletters' mailing list and works the same way, so anyone who has used that list already knows this one.

## Who's on it

- **People** have a name, an email address, an organization (their church), and which newsletters they get by email. A member household's head also has its **Member ID** (the membership software's GroupCode) and **Status** (Active or Inactive).
- **Households** are an address shared by everyone who lives there, which newsletters it gets by mail, and how many copies.
- **Organizations** have a church's name, address, an **Attention** line, an email address, and which newsletters it gets as a batch for its members.

Members and non-members are on one list: a newsletter signup is a person without a Member ID. On the Members page, **Show** narrows the list to members, active members, inactive members, or people who aren't members.

## Fields

A field belongs to one level:

| For | Shown | Examples |
| --- | --- | --- |
| Each person | on their own row | Phone, Birthdate, Committee |
| Each household | once across everyone at the address, like the address | Over 65, Plan, District |
| Each organization | on the Organizations tab | District, Contact phone |

There are five kinds:

| Kind | Holds |
| --- | --- |
| **Text** | anything |
| **Choice** | text, with the values already used offered as you type |
| **Number** | a number |
| **Date** | a date (typed as 3/5/2024) |
| **Yes / No** | a checkbox |

- **Add field…** on the Members page adds a field and takes you to its column. The **Fields** page renames, reorders and removes fields, and shows how many records have each one filled in.
- A typed or pasted value that doesn't fit its field, such as a word in a Date field, is refused with a message rather than saved.
- **Renaming** a field keeps every value, since values are kept by the field's id, not its name.
- **Changing a field's kind** converts every value, and is refused while any value wouldn't fit the new kind.
- **Removing** a field takes its values off everyone. While someone is signed in to AB Apps, only a manager can remove one.
- **Imports and exports** use a field's name as its column heading, so an exported list imports straight back, and a column headed with a field's name goes into that field. On the Import page, **New field from this column…** makes a field from any column, with its kind guessed from the values.
- **Identity and health information** is never kept: the membership export's Social Security, health-condition and claims columns can't be imported or made into a field (`lib/sensitiveColumns.js`, the same list FormTracker uses).

## Getting started

MemberManager keeps the list in its `MemberManager` subfolder of the AB Apps folder, where FormTracker and SendNewsletters find it. Install it from AB Apps and sign in there.

1. **Bring in SendNewsletters' list.** On **Settings**, **Bring in SendNewsletters' list** copies SendNewsletters' people, households, organizations, newsletters and duplicate decisions as they are, with the same record ids, so SendNewsletters' past mailings still point at the right people.
   - It's only offered while the member list is empty, and only on the host computer.
   - Open SendNewsletters on its host first, so everyone's latest changes are saved in its files.
   - SendNewsletters' own files aren't changed.
2. **Add FormTracker's contacts.** On **Import**, **Bring in … contacts** reads FormTracker's contacts, leaving out the ones removed there. They're matched to members already on the list by Member ID, or else by name and email or address. Map the extra columns you want to keep (Over 65, say) to fields, or make new fields from them.
3. **Check Duplicates** for anyone the two lists had under different names.
4. **From then on**, re-import the membership export whenever it's refreshed. Members are updated by Member ID, a blank cell never erases anything, and fields you added are kept.

If either app's data isn't in the AB Apps folder yet, choose its folder instead (its own **Settings → Data location** says where it is).

## Imports

Imports work as they did in SendNewsletters; its README has the details on matching, households and newsletters. In short:

- A row updates whoever has its Member ID, or else someone with the same name and the same email address or street address. Anything less certain comes in as a new person and is flagged on Duplicates.
- A blank cell never erases what's there. A value that doesn't fit its field is counted in the preview and left out.
- A **Member status** column saying Inactive marks the person Inactive and stops the newsletters they get. An inactive member who isn't on the list isn't added.
- The **membership software's household export** (`Membergroup<date>.csv`) is recognized by its columns and set up as the office decided: each household's head is the person, its GroupCode is the Member ID, one plan's households at a time.
- Column guesses skip identifier columns (`MemberOrganizationUID`, `AccountsPKID`) and yes/no columns for names and organizations, so `churchName` is the Organization.

## For FormTracker and SendNewsletters: the files

The list is JSON files in `<AB Apps folder>\MemberManager\`. Only MemberManager's host computer writes them, so another app only ever reads them. Changes made on other computers reach the files once the host has saved them, usually within seconds.

| File | What's in it |
| --- | --- |
| `contacts.json` | people: `{ id, name, email, memberId, memberStatus, orgId, householdId, subs, fields, sourceBatch, createdAt, updatedAt }` |
| `households.json` | addresses: `{ id, addressLine1, addressLine2, city, state, zip, subs, fields }` |
| `orgs.json` | organizations: `{ id, name, attn, email, addressLine1 … zip, subs, fields, sourceBatch }` |
| `publications.json` | newsletters: `{ id, name }` |
| `fields.json` | field definitions, in column order: `{ id, label, appliesTo: "contact" \| "household" \| "org", type: "text" \| "choice" \| "number" \| "date" \| "yesno" }` |
| `retired.json` | records that left the list: `{ kind: "contact" \| "household" \| "org", fromId, toId, snapshot, at }` |
| `reviewDismissed.json`, `settings.json` | MemberManager's own |

- **`subs`** are `{ [publicationId]: { email, mail, copies } }`. A person uses `email`, a household `mail` and `copies`, an organization all three. `lib/contactRules.js` has the rules for who actually gets what.
- **`fields`** are `{ [field id]: value }`. Dates are `YYYY-MM-DD`, Yes/No is `true`/`false`, and a blank field has no entry. Look a field up in `fields.json` by id for its name; a value whose id isn't there any more belongs to a removed field.
- **A household's Member ID** is its head's: the person in it with a `memberId`.
- **`retired.json`** says where records went when they were deleted (`toId` is null) or merged or combined into another (`toId` is the one kept). `snapshot` is the record as it was. An app that keeps its own records of people, such as mailings, follows it: a mailing that hasn't gone out moves to `toId` or drops the person, and one that has keeps the snapshot to say who it went to.
- Read the files leniently. A file mid-sync can fail to parse, so keep the last good copy and try again shortly.

## Sharing between computers

The same as SendNewsletters: one computer is the **host** and saves everyone's changes to the shared files, and the others are **editors** whose changes wait in their own file under `people/` until the host saves them. **Settings → Sharing** shows who's using the folder and which computer is the host. Leave the host's app open while others work, and since it's the host's saves that FormTracker and SendNewsletters read, leave it open for them too.

## Development

```
npm install
npm start
npm test    # imports, fields, and the build settings
```

`MEMBERMANAGER_DATA_DIR` keeps this computer's own settings in another folder, and `MEMBERMANAGER_APPDATA` reads AB Apps' sign-in from `<folder>\AB Apps\identity.json` instead of the real one. Set both for a test run that can't touch the real AB Apps folder.

## Releasing

Pushing a version tag builds the Windows installer on GitHub and publishes it as a release (`.github/workflows/release.yml`):

```
npm version patch       # or minor / major: runs the tests, bumps the version, commits, and tags vX.Y.Z
git push --follow-tags
```

The release appears as `MemberManager-Setup-X.Y.Z.exe` with its `.blockmap` and `latest.yml`. To offer it in AB Apps, add it to AB Apps' `catalog.json`:

```json
{
  "id": "membermanager",
  "name": "MemberManager",
  "description": "Keep the member list FormTracker and SendNewsletters use: people, households, churches, newsletters and your own fields.",
  "repo": "AB-Kevin/MemberManager",
  "appId": "org.anabaptistbrotherhood.membermanager",
  "productName": "MemberManager",
  "icon": "build/icon.png",
  "dataFolder": "MemberManager",
  "classes": ["manager", "employee"]
}
```

## Project layout

- `main.js` / `preload.js`: the Electron main process and the bridge the window calls.
- `db/store.js`: the JSON-file store, and the host and editors' change journal.
- `lib/fields.js`: field kinds, reading and showing values (shared with the window).
- `lib/listImport.js`, `lib/membership.js`, `lib/matching.js`, `lib/duplicates.js`: imports, the membership export's set-up, name and address comparison, and finding duplicates.
- `lib/sensitiveColumns.js`: the identity and health columns that are never kept.
- `lib/team.js`: sharing a data folder between computers.
- `renderer/`: the window (plain HTML/CSS/JS). `grid.js` is the spreadsheet, and `pages/fields.js` the Fields page.
