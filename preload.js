const { contextBridge, ipcRenderer } = require("electron");

// Errors thrown in main.js arrive as "Error invoking remote method 'x':
// Error: <message>"; pages show the message itself.
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ""));
  });
}

contextBridge.exposeInMainWorld("api", {
  pickImportFile: () => invoke("dialog:pick-import-file"),
  // source: { kind: "file", filePath }, { kind: "signup", includeImported }
  // or { kind: "formtracker", folder }
  previewImport: (source) => invoke("import:preview", source),
  planImport: (source, mapping, options) => invoke("import:plan", source, mapping, options),
  commitImport: (source, mapping, options) => invoke("import:commit", source, mapping, options),

  getList: () => invoke("list:get"),
  updateList: (changes) => invoke("list:update", changes),
  createContact: () => invoke("contacts:create"),
  createOrg: () => invoke("orgs:create"),
  deleteOrgs: (ids) => invoke("orgs:delete-many", ids),
  exportOrgs: (ids) => invoke("orgs:export", ids),
  mergeOrgs: (merge) => invoke("orgs:merge", merge),

  listPublications: () => invoke("publications:list"),
  addPublication: (name) => invoke("publications:add", name),
  renamePublication: (id, name) => invoke("publications:rename", id, name),
  removePublication: (id) => invoke("publications:remove", id),

  createHouseholdFor: (contactId) => invoke("households:create-for", contactId),
  combineHouseholds: (selection) => invoke("households:combine", selection),
  separateHouseholds: (contactIds) => invoke("households:separate", contactIds),
  deleteContacts: (ids) => invoke("contacts:delete-many", ids),
  exportContacts: (ids) => invoke("contacts:export", ids),

  reviewCounts: () => invoke("review:counts"),
  listReview: () => invoke("review:list"),
  dismissReview: (kind, ids) => invoke("review:dismiss", kind, ids),
  mergeContacts: (merge) => invoke("contacts:merge", merge),

  getGfSettings: () => invoke("gf:get-settings"),
  listGfForms: (connection) => invoke("gf:list-forms", connection),
  saveGfSettings: (data) => invoke("gf:save-settings", data),

  listFields: () => invoke("fields:list"),
  addField: (field) => invoke("fields:add", field),
  updateField: (id, patch) => invoke("fields:update", id, patch),
  removeField: (id) => invoke("fields:remove", id),
  moveField: (id, direction) => invoke("fields:move", id, direction),
  moveFieldToPeople: (id, options) => invoke("fields:to-people", id, options),

  // Bringing in SendNewsletters' list and FormTracker's contacts.
  migrationSources: () => invoke("migrate:sources"),
  pickOtherAppFolder: (key) => invoke("migrate:pick-folder", key),
  copySendNewsletters: (folder) => invoke("migrate:send-newsletters", folder),

  // FundTrack's exports: everyone in every household, and the churches.
  fundTrackStatus: () => invoke("fundtrack:status"),
  pickFundTrackFolder: () => invoke("fundtrack:pick-folder"),
  // Which file is which table, when the newest isn't the one to use.
  chooseFundTrackFile: (table, file) => invoke("fundtrack:choose", table, file),
  previewFundTrack: () => invoke("fundtrack:preview"),
  mapFundTrackColumn: (table, header, fieldId) => invoke("fundtrack:map-column", table, header, fieldId),
  commitFundTrack: () => invoke("fundtrack:commit"),

  // Find, Lists and Near ZIP.
  findSearch: (query, options) => invoke("find:search", query, options),
  findCard: (k, id) => invoke("find:card", k, id),
  printChurch: (id) => invoke("find:print-church", id),
  listCatalog: (kind, zip) => invoke("lists:catalog", kind, zip),
  runList: (state, shown) => invoke("lists:run", state, shown),
  exportList: (state) => invoke("lists:export", state),
  printList: (state) => invoke("lists:print", state),
  saveList: (name, state) => invoke("lists:save", name, state),
  deleteList: (id) => invoke("lists:delete", id),
  nearReport: (options) => invoke("near:report", options),
  exportNear: (options) => invoke("near:export", options),
  printNear: (options) => invoke("near:print", options),
  copyText: (text) => invoke("clipboard:copy", text),

  // Member cards.
  listCardDesigns: () => invoke("cards:list"),
  getCardDesign: (id) => invoke("cards:get", id),
  createCardDesign: (input) => invoke("cards:create", input),
  updateCardDesign: (id, patch) => invoke("cards:update", id, patch),
  deleteCardDesign: (id) => invoke("cards:delete", id),
  setCardImage: (id, side) => invoke("cards:set-image", id, side),
  clearCardImage: (id, side) => invoke("cards:clear-image", id, side),
  cardFields: (cardFor) => invoke("cards:fields", cardFor),
  cardValues: (id, side, ref) => invoke("cards:values", id, side, ref),
  cardPrinters: () => invoke("cards:printers"),
  setCardPrinter: (name) => invoke("cards:set-printer", name),
  setCardDpi: (dpi) => invoke("cards:set-dpi", dpi),
  printCards: (job) => invoke("cards:print", job),

  getSettings: () => invoke("settings:get"),
  setTheme: (theme) => invoke("settings:set-theme", theme),
  setMemberColumns: (tab, layout) => invoke("settings:set-member-columns", tab, layout),

  confirm: (message, okLabel) => invoke("dialog:confirm", message, okLabel),
  choose: (message, detail, buttons) => invoke("dialog:choose", message, detail, buttons),
  openPath: (filePath) => invoke("shell:open-path", filePath),
  moveDataToAbApps: () => invoke("data:move-to-ab-apps"),
  getDataLocation: () => invoke("data:get-location"),
  chooseDataLocation: () => invoke("data:choose-location"),
  useDefaultDataLocation: () => invoke("data:use-default"),
  takeNotice: () => invoke("app:take-notice"),

  getTeamStatus: () => invoke("team:status"),
  saveTeamSettings: (data) => invoke("team:save", data),
  onTeamStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on("team:status", listener);
    return () => ipcRenderer.removeListener("team:status", listener);
  },
  // Another computer's changes arrived (or, on the host, were saved).
  onDataChanged: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
  getVersion: () => invoke("app:get-version"),

  checkForUpdates: () => invoke("update:check"),
  downloadUpdate: () => invoke("update:download"),
  quitAndInstall: () => invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
