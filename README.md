# MemberManager

A desktop app that keeps the office's member list in one place: everyone the office keeps in touch with, their households and churches, which newsletters they get, and any fields the office adds. FormTracker and SendNewsletters read their contacts from it, so a person is updated once rather than in each app: SendNewsletters its whole mailing list, FormTracker every member (anyone with a Member ID) with this app's fields as its extra columns. Both pick up a save within seconds, while their host computer's app is open.

- **Find**: anyone, quickly, by name, phone, email, birth date, Member ID, church, city or ZIP, with a card for each household, person and church.
- **Members**: two editable spreadsheets, **People** and **Organizations**. Edits save as you go, and Ctrl+Z undoes them.
- **Lists**: any list of people, households or churches, on any field and any conditions, to save as a spreadsheet, print, or keep for next time.
- **Near ZIP**: how many members live within 10 to 100 miles of a ZIP code. Counts only, so it can be shared.
- **Cards**: member cards for the card printer, designed on an SVG of the preprinted card, front and back.
- **Fields**: the office's own fields, such as Committee, Over 65, Joined or District, for each person, each household or each organization. Add one in a few seconds from **Add field…** on the Members page, or from the **Fields** page.
- **Import**: FundTrack's weekly exports (everyone in every household), a spreadsheet, new signups from the website's Gravity Forms signup form, or FormTracker's contacts. Any spreadsheet column can go into a field, or become a new one.
- **Duplicates**: people, households and churches that might be the same, to merge or keep apart.
- **Newsletters…**: the newsletters and magazines, and who gets each by email or by mail.

It grew out of SendNewsletters' mailing list and works the same way, so anyone who has used that list already knows this one. Find, Lists and Near ZIP do what the office's Member Finder does, apart from its billing pages (contribution invoices, medical bills and overdue accounts), which MemberManager leaves to FundTrack: it never keeps claims or health information.

## FundTrack's exports

**Import → FundTrack's exports** brings in the whole membership from FundTrack's exports (File → Data View → a table → Export, saved as `<Table> MMDDYYYY.csv`): `MemberGroups` and `MemberIndividuals` are needed, and `MemberOrginizations`, `MemberOrganizationContacts` and `MemberOrginizationAddresses` add the churches. It finds the folder by itself when it's the archive library's `exports` folder beside the AB Apps folder's library; otherwise choose it once. The newest export of each table is used, and copies ("… - Copy.csv") are left alone. **Check what it would do** shows the counts first. Run it again whenever there are newer exports: it updates everyone in place.

- **Households** come in as the membership export always has (heads matched by Member ID; new ones on the Medical Aid & Alms Plan get Our Health by mail), now for every plan and including inactive households, which get no newsletters. A household with no Member ID (GroupCode) in FundTrack is left out, since it couldn't be found again next time.
- **Everyone in each household** joins it, with **Birth date**, **Role** and **Gender**. Only the head has the Member ID, so FormTracker still gets one contact per household. The first time, people already on the list are matched by name within their household; after that, by their FundTrack id. Names already on the list aren't changed.
- **A household is a member's account.** Two accounts can share a mailing address (a married son's family on his parents' farm), which still gets one bundle of each newsletter. So an account's **Phone**, **Plan** and **Household type** are fields of its head, and Find, Lists and Near ZIP show FundTrack's accounts as households.
- **Churches** get **Code**, **Denomination**, **Organization type** and **Phone**, their contacts, and an Attention line, email and address where those are blank. A church FundTrack has twice is used once.
- These are ordinary fields, made the first time on the Fields page. Renaming one is fine; it's then treated like any other field.
- FundTrack's other columns are kept as **FundTrack details**, shown on Find's cards and offered on Lists. Identity, health and case columns (Social Security, pre-existing conditions, case IDs and the like) and FundTrack's own bookkeeping are never kept (`lib/fundTrack.js`, `lib/sensitiveColumns.js`).
- Exports saved on different days don't quite line up, and the preview says so. Export every table on the same day.

## Find

Type part of a name (any member of a household), a phone number (any format, or just its last 4 digits), an email, a birth date, a Member ID, a church, a city or a ZIP. Every word has to match, in any order, and names count most. **Households**, **People** and **Churches** narrow the results, as do a plan and **Include inactive**. Open a result for its card:

- **A household** has its phone, email and address (each with **Copy**), church, plan and status; everyone in it with their role, birth date and age; the newsletters it gets; its fields and FundTrack details; and any other account at the same address.
- **A person** has their birth date and age, role, gender, household, church, newsletters and fields. A birth date that can't be right (a year like 1011) gets no age and a **Check** mark.
- **A church** has its code, type, denomination, contacts, every household in it, and **Print household list** (choose "Microsoft Print to PDF" to save it as a PDF).

Names on a card open their own card; **Back** or **Esc** returns. Keys: `/` search, `1`–`4` the tabs, `↓` or `j`/`k` to move, **Enter** to open. **Show on Members page** opens the spreadsheet at that person or church.

## Lists

Pick **People**, **Households** or **Churches**, then add conditions on any field: the built-in ones, **Age**, **Birth month**, **Children in household**, **Oldest member's age**, which newsletters each gets, your own fields, FundTrack's details, and **Miles from** a ZIP code you type in. Tests depend on the field: contains, is, starts with, at least, at most, between, before, after, in month, in year, is blank. Match **all** or **any** condition, open **Columns** to choose what's shown, and click a column heading to sort. **Save as spreadsheet…** (Excel or CSV), **Print**, or **Save list as…** to keep it under **Start from** for everyone, where the ready-made lists are too: 65 and over, under 18, birthdays this month, heads of household, a household mailing list, households with no email or no phone, and church contacts. A saved list runs on the list as it is when it's opened. Click a row to open its card on Find.

## Near ZIP

How many households and people live within 10, 25, 50, 75 and 100 miles of a ZIP code (up to 250), and a table of ZIP codes with their distance and counts, for active households or all of them, on any plan or one. Counts only: no names, phones or addresses, so its printout and spreadsheet can go to a hospital the office is contracting with. Distances are straight-line miles between ZIP code centre points (`lib/zip-locations.txt`, from the US Census Bureau's 2025 Gazetteer, public domain), not driving distance. A PO-box-only ZIP is placed at the nearest ZIP in its area and marked approximate.

## Member cards

The **Cards** page designs member cards for the card printer (the office's IDP SMART-51), printed on preprinted CR80 cards (85.6 × 54 mm).

- **A design** is a card for **each household** or **each person**, landscape or portrait, with a **Front** and a **Back**. Each side has its own template image and its own fields, and is printed on its own: print a stack's fronts, then the same cards' backs.
- **The template image** is an SVG of the preprinted card (**Choose template SVG…**), for placing fields on. It's only ever shown as a picture, so anything else in the file (scripts, links) never runs. It's kept in the data folder's `card-templates` folder. An image that isn't the card's shape is stretched to fit, with a warning.
- **Fields:** any field Lists offers (name, Member ID, plan, phone, your own fields, FundTrack's details…) plus card-only ones: the spouse's name (the person in the household whose role is Spouse, still covered; blank when there's none, along with any text before it; on a person's card, the head for the spouse), the address on 2–3 lines or one, household members one per line (with or without birth dates), and today's date. **Add text** puts plain words on the card.
- **Placing them:** drag a field to move it, and drag its right edge to set its width. With the card selected, the arrow keys move a field 0.5 mm (Shift: 2 mm) and Delete removes it. The panel sets position and size in millimetres, the font, size (pt), bold, italic, alignment, colour, **Capitals**, text before the value ("ID "), and **Shrink to fit**, which makes a long name smaller rather than cutting it off.
- **Capitals:** names come from FundTrack in capitals, so name fields (names, head of household, spouse, household members, church contacts) print as **Names: First Letters**: "SHEILA R. GRABER" as "Sheila R. Graber", "GRABER-BRUCE" as "Graber-Bruce", "MCCOMBS" as "McCombs", and initials and "III" as they are. A word that already has small letters ("McDonald") is left alone. An initial gets a period if it hasn't one ("BRUCE L GRABER" prints as "Bruce L. Graber"), in ALL CAPITALS too; a letter at the very end of a name ("SMITH, J") is left as it is. Everything else prints **As entered**, so a Member ID or "PA" isn't changed, and any field can be set to **ALL CAPITALS**. The member list itself keeps names as they are, since SendNewsletters' envelopes and FormTracker use it too. The card shows a real member's values; **Show someone else…** picks whose. Changes save as you make them.
- **Fonts:** Windows' usual ones, and **Atkinson Hyperlegible**, first in the list, which comes with MemberManager and draws its zero with a slash through it, so a 0 is never read as an O in a Member ID. It's embedded in every printed card and PDF, so the card printer's computer doesn't need it installed. (It's the Braille Institute's, under the SIL Open Font License, which travels with it in `node_modules/@fontsource/atkinson-hyperlegible`.)
- **Only the fields print**, since the card is preprinted. **Print the image too** prints the template as well, for blank cards.
- **Adjust position** moves everything on a side by up to 10 mm, for a printer that prints a little off. It's kept with the design, so measure with a test card once.
- **Printing:** **Print card…** on a household's or person's card on Find, or **Print cards…** on Lists for everyone in the list, in the list's order. Choose the design and side. **Reverse order** is for feeding the printed stack back in for the other side, if your printer turns it over. **Preview as PDF** shows the cards with their template image, to check without using cards. On the Cards page, **Print a test card** prints the member shown, and **Card printer** chooses the printer: "Ask each time" opens Windows' print dialog; choosing the SMART-51 prints straight to it.
- **Print resolution** (on the Cards page, kept per computer) is asked of the printer with every job, since some Windows drivers report a resolution Chromium can't use and it then falls back to a low one. 300 dpi suits the SMART-51's colour printing; with a ribbon that has a black resin (K) panel, 600 or 1200 dpi gives sharper black text. The cards themselves are sent as text, not pictures, so the printer prints them at whatever resolution it's set to.
- **Setting up the printer:** in the SMART-51 driver's printing preferences, set the card to CR80 and the orientation to match the design, and set black text to print with the resin black (K) panel, if your ribbon has one, for crisp text.

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
| `contacts.json` | people: `{ id, name, email, memberId, memberStatus, orgId, householdId, subs, fields, sourceBatch, createdAt, updatedAt }`, and from FundTrack `fundTrackId`, `fundTrackGroupId` (their account), `fundTrack` (details), and on an account's head `fundTrackAccount` |
| `households.json` | addresses: `{ id, addressLine1, addressLine2, city, state, zip, subs, fields }` |
| `orgs.json` | organizations: `{ id, name, attn, email, addressLine1 … zip, subs, fields, sourceBatch }`, and from FundTrack `fundTrackId`, `contacts` and `fundTrack` |
| `publications.json` | newsletters: `{ id, name }` |
| `fields.json` | field definitions, in column order: `{ id, label, appliesTo: "contact" \| "household" \| "org", type: "text" \| "choice" \| "number" \| "date" \| "yesno" }` |
| `retired.json` | records that left the list: `{ kind: "contact" \| "household" \| "org", fromId, toId, snapshot, at }` |
| `reviewDismissed.json`, `settings.json` | MemberManager's own |

- **`subs`** are `{ [publicationId]: { email, mail, copies } }`. A person uses `email`, a household `mail` and `copies`, an organization all three. `lib/contactRules.js` has the rules for who actually gets what.
- **`fields`** are `{ [field id]: value }`. Dates are `YYYY-MM-DD`, Yes/No is `true`/`false`, and a blank field has no entry. Look a field up in `fields.json` by id for its name; a value whose id isn't there any more belongs to a removed field.
- **A household's Member ID** is its head's: the person in it with a `memberId`. Only heads have one, so "everyone with a Member ID" is one person per member household, as FormTracker uses it. An account's Phone, Plan and Household type are its head's fields.
- **`retired.json`** says where records went when they were deleted (`toId` is null) or merged or combined into another (`toId` is the one kept). `snapshot` is the record as it was. An app that keeps its own records of people, such as mailings, follows it: a mailing that hasn't gone out moves to `toId` or drops the person, and one that has keeps the snapshot to say who it went to.
- Read the files leniently. A file mid-sync can fail to parse, so keep the last good copy and try again shortly.

## Sharing between computers

The same as SendNewsletters: one computer is the **host** and saves everyone's changes to the shared files, and the others are **editors** whose changes wait in their own file under `people/` until the host saves them. **Settings → Sharing** shows who's using the folder and which computer is the host. Leave the host's app open while others work, and since it's the host's saves that FormTracker and SendNewsletters read, leave it open for them too.

## Development

```
npm install
npm start
npm test    # imports, fields, FundTrack, Find, Lists, Near ZIP, and the build settings
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
- `lib/fundTrack.js`: FundTrack's exports: finding them, everyone in each household, the churches.
- `lib/memberModel.js`, `lib/search.js`, `lib/lists.js`, `lib/nearZip.js` (with `zip-locations.txt`): Find, Lists and Near ZIP.
- `lib/cards.js`: member card designs, their fields' values and the printable cards; `renderer/pages/cards.js` is the designer and `renderer/cardPrint.js` the print panel on Find and Lists.
- `lib/team.js`: sharing a data folder between computers.
- `renderer/`: the window (plain HTML/CSS/JS). `grid.js` is the spreadsheet; `pages/` has a file for each page.
