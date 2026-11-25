"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme, clipboard, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { randomUUID } = require("crypto");

const store = require("./db/store");
const listImport = require("./lib/listImport");
const rules = require("./lib/contactRules");
const matching = require("./lib/matching");
const Fields = require("./lib/fields");
const { isSensitive } = require("./lib/sensitiveColumns");
const duplicates = require("./lib/duplicates");
const gravityForms = require("./lib/gravityForms");
const { membershipPreset, DEFAULT_PLAN, PLAN_COLUMN } = require("./lib/membership");
const fundTrack = require("./lib/fundTrack");
const { buildModel } = require("./lib/memberModel");
const searchLib = require("./lib/search");
const lists = require("./lib/lists");
const nearZip = require("./lib/nearZip");
const cards = require("./lib/cards");
const ColumnLayout = require("./lib/columnLayout");
const { appFolder, chooseFolder, readMovedNote, moveToAbApps } = require("ab-common/appfolder");
const { readIdentity, watchIdentity, sharedServices } = require("./lib/abApps");
const { Team, peopleDir, readPeople, isActive, activeHosts } = require("./lib/team");

let mainWindow = null;

// ---- secret encryption (the Gravity Forms consumer secret) ----
// Uses the OS keychain (DPAPI on Windows) via Electron's safeStorage, same
// idea as any other locally-stored credential; falls back to a plain base64
// encoding only if the OS facility is unavailable, so the app still works
// rather than hard-failing on an obscure environment.
function encryptSecret(plainText) {
  if (!plainText) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plainText).toString("base64");
  }
  return "plain:" + Buffer.from(plainText, "utf8").toString("base64");
}

function decryptSecret(stored) {
  if (!stored) return "";
  if (stored.startsWith("plain:")) {
    return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return "";
  }
}

// ---- theme ----
// The Settings page's Appearance choice, applied as nativeTheme.themeSource:
// the renderer's prefers-color-scheme follows it (styles.css keys its dark
// palette off that), and so do the Windows title bar and native controls.
// "system" follows Windows' own light/dark setting, live.
const THEMES = ["system", "light", "dark"];

function savedTheme() {
  const theme = store.getSettings().theme;
  return THEMES.includes(theme) ? theme : "system";
}

// styles.css's --surface-page for each theme, painted before the page loads
// so a dark-mode window doesn't flash white on open.
function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#1e1c1d" : "#ffffff";
}

nativeTheme.on("updated", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: windowBackground(),
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // A web link on a page (the Map's "OpenStreetMap" credit) opens in the
  // browser rather than replacing the app in its window.
  const external = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    event.preventDefault();
    external(url);
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// The Map page's street map comes from OpenStreetMap's tile server, whose
// usage policy asks every app to name itself in its requests
// (operations.osmfoundation.org/policies/tiles). Only the map squares in view
// are asked for, and the browser cache keeps them as the server says to;
// nothing about members goes with them.
const TILE_HOST = "https://tile.openstreetmap.org/*";
function tileHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [TILE_HOST] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "User-Agent": `MemberManager/${app.getVersion()} (Anabaptist Brotherhood office app; Electron)` } });
  });
}

// Lets a dev/test run point at a throwaway data directory instead of the
// real one (%APPDATA%\membermanager by default) -- set MEMBERMANAGER_DATA_DIR
// before launching to avoid ever reading, seeding, or deleting a real
// installation's member list while exercising the app.
// MEMBERMANAGER_APPDATA does the same for where AB Apps' sign-in is read
// (<appData>\AB Apps\identity.json), so a test run can't find a real
// sign-in and write to the real AB Apps folder.
if (process.env.MEMBERMANAGER_APPDATA) {
  app.setPath("appData", process.env.MEMBERMANAGER_APPDATA);
}
if (process.env.MEMBERMANAGER_DATA_DIR) {
  app.setPath("userData", process.env.MEMBERMANAGER_DATA_DIR);
}

// Matches the installer's appId (package.json), so Windows shows this app's
// icon on the taskbar -- not Electron's -- and pins it as itself.
app.setAppUserModelId("org.anabaptistbrotherhood.membermanager");

// One copy of the app per computer: in a shared folder, two would both claim
// to be this computer.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  abIdentity = readIdentity(app.getPath("appData"));
  try {
    choosePlace();
  } catch (err) {
    console.error("Couldn't use the AB Apps folder:", err);
  }
  const dataDir = resolveDataDir();
  if (!dataDir) {
    app.quit();
    return;
  }
  store.init(dataDir, app.getPath("userData"));
  abIdentity = readIdentity(app.getPath("appData"));
  openTeam();
  // Signing in or out of AB Apps, or a manager's rename there, reaches the others right away.
  watchIdentity(app.getPath("appData"), (next) => {
    const folderChanged = next?.dataDir !== abIdentity?.dataDir;
    abIdentity = next;
    if (folderChanged) followToAbApps();
    try {
      team?.setName(shownName(), abIdentity?.personId ?? null);
    } catch {
      // The data folder is unavailable for now; the next heartbeat writes the new name.
    }
    sendTeamStatus();
  });
  nativeTheme.themeSource = savedTheme();
  tileHeaders();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Tells everyone else using the folder that this computer has left.
app.on("before-quit", () => {
  if (team) team.close();
});

// ---------------------------------------------------------------------------
// Data location
// ---------------------------------------------------------------------------
// The member list lives in a data folder that can be anywhere: by default
// one inside this computer's app folder, or one picked on the Settings page
// -- on OneDrive, say, so the office's computers all work from the same
// list. FormTracker and SendNewsletters find it in the AB Apps folder.
// Which folder is remembered in data-location.json in this computer's app
// folder, next to this computer's own settings (see db/store.js).

const PICKED_FOLDER_NAME = "MemberManager Data";
const defaultDataDir = () => path.join(app.getPath("userData"), "membermanager-data");
const locationFile = () => path.join(app.getPath("userData"), "data-location.json");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// ---- the AB Apps folder ----
// The member list lives in the MemberManager subfolder of the AB Apps
// folder (ab-common's appfolder.js). A list that's still somewhere else stays
// there until a manager on the host computer moves it from Settings; every
// other computer follows the note the move leaves.
const FOLDER_NAME = "MemberManager";
let folderChoice = { reason: "own", target: null };

function abAppsTarget() {
  return abIdentity?.dataDir && fs.existsSync(abIdentity.dataDir) ? appFolder(abIdentity, FOLDER_NAME) : null;
}

// Works out where the list is. When that's the AB Apps subfolder but this
// computer uses another, points it there and returns the folder; otherwise null.
//
// A computer that has never had a list of its own (no folder chosen, and its
// own default folder not made yet) goes straight to the AB Apps folder: the
// other apps only find the list there.
function choosePlace() {
  const own = configuredDataDir() || (fs.existsSync(defaultDataDir()) ? defaultDataDir() : null);
  const target = abAppsTarget();
  folderChoice = { ...chooseFolder({ own, target, hasData: (dir) => store.isDataFolder(dir) }), target };
  if (folderChoice.reason !== "ab-apps" || !folderChoice.dir || (own && samePath(own, folderChoice.dir))) return null;
  fs.mkdirSync(folderChoice.dir, { recursive: true });
  // This computer's own changes made between the move's copy and now are only
  // in the old folder; its files there have one writer -- this computer.
  // Read from the file, since this runs before the store is opened at startup.
  let mine = null;
  try {
    mine = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "local-settings.json"), "utf8")).personId || null;
  } catch {
    // No settings yet: nothing of this computer's to bring across.
  }
  if (mine && own && readMovedNote(own)) {
    for (const name of [`${mine}.json`, `${mine}.changes.json`]) {
      const a = path.join(own, "people", name);
      const b = path.join(folderChoice.dir, "people", name);
      try {
        if (fs.existsSync(a) && (!fs.existsSync(b) || fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs)) {
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.copyFileSync(a, b);
        }
      } catch {
        // Left in the old folder; nothing there is removed.
      }
    }
  }
  rememberDataDir(folderChoice.dir);
  return folderChoice.dir;
}

// Opens the list in the AB Apps subfolder, once it's there.
function followToAbApps() {
  const dir = choosePlace();
  if (dir) switchDataDir(dir, "The member list moved to the AB Apps folder, where every computer finds it.");
}

function configuredDataDir() {
  try {
    return JSON.parse(fs.readFileSync(locationFile(), "utf8")).dataDir || null;
  } catch {
    return null;
  }
}

function rememberDataDir(dir) {
  if (!dir || samePath(dir, defaultDataDir())) fs.rmSync(locationFile(), { force: true });
  else fs.writeFileSync(locationFile(), JSON.stringify({ dataDir: dir }, null, 2), "utf8");
}

// Where a picked folder's list goes: the folder itself when it already holds
// a list or is empty; otherwise a "MemberManager Data" folder inside it, so
// the list's files don't land loose among other documents.
function dataDirFor(picked) {
  if (store.isDataFolder(picked)) return picked;
  const inside = path.join(picked, PICKED_FOLDER_NAME);
  if (fs.existsSync(inside)) return inside;
  const empty = fs.readdirSync(picked).filter((name) => !name.startsWith(".") && name.toLowerCase() !== "desktop.ini").length === 0;
  return empty ? picked : inside;
}

// The folder to open at startup. One that was picked but can't be found
// right now -- OneDrive not signed in yet, a network drive not connected --
// is asked about rather than quietly replaced with an empty list.
function resolveDataDir() {
  let dir = configuredDataDir();
  while (dir && !fs.existsSync(dir)) {
    const response = dialog.showMessageBoxSync({
      type: "warning",
      title: "MemberManager",
      message: "The member list's folder can't be found",
      detail: `MemberManager is set to keep its member list in:\n${dir}\n\nIf that's on OneDrive or a network drive, make sure it's connected and synced, then try again.`,
      buttons: ["Try again", "Choose another folder…", "Use this computer's own folder", "Quit"],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    });
    if (response === 1) {
      const picked = dialog.showOpenDialogSync({ title: "Choose the member list's folder", properties: ["openDirectory", "createDirectory"] });
      if (picked?.[0]) {
        dir = dataDirFor(picked[0]);
        rememberDataDir(dir);
      }
    } else if (response === 2) {
      dir = null;
      rememberDataDir(null);
    } else if (response === 3) {
      return null;
    }
  }
  return dir || defaultDataDir();
}

function folderSummary(dir) {
  const count = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).length || 0;
    } catch {
      return 0;
    }
  };
  return `${count("contacts").toLocaleString()} people, ${count("households").toLocaleString()} households and ${count("orgs").toLocaleString()} organizations`;
}

// Shown once the window has reloaded on the new folder.
let pendingNotice = null;

// `role` is "editor" to join a folder another computer hosts, "host" for a
// folder this computer has just filled (or started empty), where nobody else
// is yet; otherwise this computer keeps its setting.
function switchDataDir(dir, notice, role) {
  team.close();
  store.setJournal(null);
  store.init(dir, app.getPath("userData"));
  if (role === "editor") store.updateSettings({ isHost: false, hostSince: null });
  if (role === "host" && !store.getSettings().isHost) store.updateSettings({ isHost: true, hostSince: new Date().toISOString() });
  rememberDataDir(dir);
  openTeam();
  parsedFileCache = null;
  signupCache = null;
  pendingNotice = notice;
  mainWindow.reload();
}

// Starts using `target` for the list. If it already holds a list, that list
// is used as it is (another computer's, say); if not, this computer's list
// is copied there or a new one started. The old folder is never changed, so
// it's there as a backup.
async function moveDataTo(target) {
  const current = store.getDataDir();
  if (samePath(target, current)) return { changed: false, message: "That's the folder already in use." };
  if (path.resolve(target).toLowerCase().startsWith(path.resolve(current).toLowerCase() + path.sep)) {
    throw new Error("Choose a folder outside the one the list is in now.");
  }
  const ask = async (options) => (await dialog.showMessageBox(mainWindow, { type: "question", noLink: true, ...options })).response;

  if (fs.existsSync(target) && store.isDataFolder(target)) {
    const hostThere = activeHosts(readPeople(target).filter((p) => p.id !== team.me.id))[0] || null;
    const choice = await ask({
      message: "That folder already has a MemberManager list",
      detail:
        `It has ${folderSummary(target)}. Use that list on this computer?` +
        (hostThere ? `\n\n${hostThere.name}'s computer is its host, so this computer's changes will be saved through it.` : "") +
        `\n\nThis computer's current list stays where it is, unused, in case it's needed:\n${current}`,
      buttons: ["Use that list", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice !== 0) return { changed: false };
    switchDataDir(target, `Now using the list in ${target}.`, hostThere ? "editor" : null);
    return { changed: true };
  }

  const choice = await ask({
    message: "Move the member list to the new folder?",
    detail: `This computer's list (${folderSummary(current)}) will be copied to:\n${target}\n\nThe old folder is left as it was, as a backup.`,
    buttons: ["Copy it there and use it", "Start an empty list there", "Cancel"],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice === 2) return { changed: false };
  fs.mkdirSync(target, { recursive: true });
  if (choice === 0) {
    // Other computers' files stay behind: they've never used the new folder.
    const people = peopleDir(current);
    fs.cpSync(current, target, { recursive: true, filter: (src) => !src.endsWith(".tmp") && src !== people && !src.startsWith(people + path.sep) });
    // The list as this computer sees it, including changes the host hasn't
    // saved yet -- in the new folder, this computer is the one that saves.
    for (const [name, value] of Object.entries(store.snapshot())) store.writeJson(path.join(target, `${name}.json`), value);
  }
  switchDataDir(target, choice === 0 ? `The list was copied to ${target} and is used from there now.` : `Started an empty list in ${target}.`, "host");
  return { changed: true };
}

ipcMain.handle("data:get-location", async () => ({
  dataDir: store.getDataDir(),
  isDefault: samePath(store.getDataDir(), defaultDataDir()),
  // Where the list is: "ab-apps", "own", or "not-moved" with where it belongs,
  // and whether this computer can move it (the host, with a manager signed in).
  folder: { reason: folderChoice.reason, target: folderChoice.target, canMove: actingHost && abIdentity?.class === "manager" },
}));

// A manager on the host moves the list into the AB Apps folder, once, after
// saving everyone's waiting changes. Every other computer follows the note
// it leaves, and the old folder is kept as it was.
ipcMain.handle("data:move-to-ab-apps", async () => {
  if (folderChoice.reason !== "not-moved") throw new Error("The member list is already in the AB Apps folder.");
  requireHost("moves the member list");
  if (abIdentity?.class !== "manager") throw new Error("Only a manager can move the member list.");
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Move", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: "Move the member list to the AB Apps folder?",
    detail: `Everything in ${store.getDataDir()} is copied to ${folderChoice.target}, and every computer uses it from there. The current folder is left as it was, as a backup you can delete later.`,
  });
  if (response !== 0) return { changed: false };
  saveIncoming();
  const from = store.getDataDir();
  team.close(); // nothing more is written to the old folder from here
  let files;
  try {
    files = moveToAbApps({ from, to: folderChoice.target, folder: FOLDER_NAME, by: abIdentity.name });
  } catch (err) {
    openTeam(); // back to the old folder, which is unchanged
    throw err;
  }
  switchDataDir(choosePlace() || folderChoice.target, `The member list moved to the AB Apps folder: ${files.toLocaleString()} files, which every computer finds there.`);
  return { changed: true };
});

ipcMain.handle("data:choose-location", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Choose where to keep the member list", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { changed: false };
  return moveDataTo(dataDirFor(result.filePaths[0]));
});

ipcMain.handle("data:use-default", async () => moveDataTo(defaultDataDir()));

ipcMain.handle("app:take-notice", async () => {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
});

// ---------------------------------------------------------------------------
// Sharing the data folder (see lib/team.js)
// ---------------------------------------------------------------------------
// One computer is the host: it writes the shared files. Any other computer
// using the same folder records its changes in a file of its own, which the
// host saves to the shared files within seconds of OneDrive syncing it.
// Until then the editing computer shows its changes on top of the shared
// files, so to whoever's using it, nothing looks different. One computer on
// its own is its own host, so it works just as it always has.

let team = null;
// This computer is set as host and no longer-serving host is open, so it
// writes the shared files.
let actingHost = false;

// Who is signed in to AB Apps on this computer, or null. While someone is,
// others see that name instead of the one set in Settings, and this
// computer's presence file records the AB Apps person. Each computer still
// writes its own files, since OneDrive can't merge two writers.
let abIdentity = null;

// Who is using this computer, set up the first time the app runs. A new
// install is the host.
function identity() {
  const s = store.getSettings();
  if (s.personId) return s;
  return store.updateSettings({ personId: randomUUID(), personName: os.userInfo().username || "Me", isHost: true, hostSince: new Date().toISOString() });
}

/** The name others see: AB Apps' while someone is signed in there, otherwise the one set in Settings. */
const shownName = () => abIdentity?.name ?? identity().personName;

function openTeam() {
  const me = identity();
  const who = { id: me.personId, name: shownName(), abAppsId: abIdentity?.personId ?? null };
  if (!team) {
    team = new Team(who);
    watchTeam();
  } else {
    team.identity = who;
  }
  actingHost = false;
  team.setActing(false);
  team.open(store.getDataDir(), { isHost: !!me.isHost, hostSince: me.hostSince });
  store.setJournal(team.journal);
  updateRole();
  if (actingHost) seedPublications();
}

// Works out whether this computer acts as host. The host then saves anything
// others have sent; anywhere else, changes the host has saved are dropped.
function updateRole() {
  const hosts = activeHosts(team.people());
  const acting = !!store.getSettings().isHost && hosts[0]?.id === team.me.id;
  if (acting !== actingHost) {
    actingHost = acting;
    team.setActing(acting);
  }
  if (actingHost) saveIncoming();
  else team.trim(store.isReflected);
  sendTeamStatus();
}

function listNames(names) {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function saveIncoming() {
  const changes = team.incoming();
  if (!changes.length) return;
  store.applyIncoming(changes);
  team.markApplied(changes);
  const names = [...new Set(changes.filter((c) => c.personId !== team.me.id).map((c) => c.name))];
  dataChanged(names.length ? `Saved changes from ${listNames(names)}.` : null);
}

function watchTeam() {
  // Someone arrived, left, or sent changes: re-check who's host, and as
  // host, save what's new.
  team.on("people", () => updateRole());
  // A manager moved the list while this computer had it open: follow it.
  team.on("tick", () => {
    if (folderChoice.reason === "not-moved" && readMovedNote(store.getDataDir())) followToAbApps();
  });
  // The host saved: everyone else shows the new list.
  team.on("shared", () => {
    if (actingHost) return;
    team.trim(store.isReflected);
    dataChanged(null);
    sendTeamStatus();
  });
  team.on("changes", () => sendTeamStatus());
}

let dataChangedTimer = null;
let dataChangedMessages = [];
function dataChanged(message) {
  if (message) dataChangedMessages.push(message);
  clearTimeout(dataChangedTimer);
  dataChangedTimer = setTimeout(() => {
    const messages = dataChangedMessages;
    dataChangedMessages = [];
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("data:changed", { messages });
  }, 300);
}

function teamStatus() {
  if (!team?.me) return null;
  const now = Date.now();
  const people = team.people();
  const hosts = activeHosts(people, now);
  const settings = store.getSettings();
  return {
    role: actingHost ? "host" : settings.isHost ? "waiting-host" : "editor",
    name: team.me.name,
    abApps: abIdentity && { name: abIdentity.name },
    isHost: !!settings.isHost,
    host: hosts[0] ? { name: hosts[0].name, computer: hosts[0].computer, isMe: hosts[0].id === team.me.id } : null,
    otherHosts: hosts.slice(1).map((h) => h.name),
    people: people
      .filter((p) => p.id === team.me.id || isActive(p, now))
      .map((p) => ({ name: p.name, computer: p.computer, isMe: p.id === team.me.id, role: hosts[0]?.id === p.id ? "host" : "editor" })),
    unsaved: actingHost ? 0 : team.unsavedCount(),
  };
}

function sendTeamStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("team:status", teamStatus());
}

ipcMain.handle("team:status", async () => teamStatus());

ipcMain.handle("team:save", async (event, { name, isHost }) => {
  const was = store.getSettings();
  // While someone is signed in to AB Apps the name comes from there, and the one set here waits.
  const clean = abIdentity ? was.personName : cleanText(name);
  if (!clean) throw new Error("Enter the name others will see.");
  if (clean.length > 60) throw new Error("Use 60 characters or fewer for the name.");
  const hostSince = isHost ? (was.isHost ? was.hostSince : new Date().toISOString()) : null;
  store.updateSettings({ personName: clean, isHost: !!isHost, hostSince });
  if (team.me.name !== shownName()) team.setName(shownName());
  if (!!isHost !== !!was.isHost) team.setRole(!!isHost, hostSince);
  updateRole();
  return teamStatus();
});

// Moving the list is the host's: it saves everyone's waiting changes first.
function requireHost(what) {
  if (actingHost) return;
  const host = activeHosts(team.people())[0];
  throw new Error(`Only the host computer ${what}${host ? ` — that's ${host.name}'s computer` : ", and its app isn't open right now"}.`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// People, households (addresses) and organizations, and the newsletters each
// gets -- see lib/contactRules.js.
const BLANK_ADDRESS = { addressLine1: "", addressLine2: "", city: "", state: "", zip: "" };
const BLANK_CONTACT = { name: "", email: "", memberId: "", memberStatus: "", orgId: null, householdId: null, subs: {}, fields: {}, sourceBatch: "" };
const BLANK_HOUSEHOLD = { ...BLANK_ADDRESS, subs: {}, fields: {} };
const BLANK_ORG = { name: "", attn: "", email: "", ...BLANK_ADDRESS, subs: {}, fields: {}, sourceBatch: "" };

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Keeps only what each kind of record actually has, in the types it's stored
// as, whatever the renderer sent. `subs` patches are { [publicationId]:
// { email, mail, copies } } for the fields that kind uses; a copy count
// that isn't a number is dropped rather than saved as 0. `fields` patches
// are { [fieldId]: value } for that kind's own fields (lib/fields.js); a
// blank clears one (null), and a value that isn't the field's type is an
// error rather than quietly lost.
const RECORD_FIELDS = {
  contact: { text: rules.PERSON_TEXT_FIELDS, subs: ["email"] },
  household: { text: rules.ADDRESS_FIELDS, subs: ["mail", "copies"] },
  org: { text: [...rules.ORG_TEXT_FIELDS, ...rules.ADDRESS_FIELDS], subs: ["email", "mail", "copies"] },
};

function sanitizePatch(kind, patch, publicationIds, fieldDefs) {
  const { text, subs } = RECORD_FIELDS[kind];
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === "memberStatus" && kind === "contact") clean.memberStatus = cleanMemberStatus(value);
    else if (text.includes(key)) clean[key] = cleanText(value);
    else if (key === "fields") {
      clean.fields = {};
      for (const [fieldId, fieldValue] of Object.entries(value || {})) {
        const def = fieldDefs.get(fieldId);
        if (!def || def.appliesTo !== kind) continue;
        const parsed = Fields.parseValue(def.type, fieldValue);
        if (parsed.error) throw new Error(`${def.label}: ${parsed.error}`);
        clean.fields[fieldId] = parsed.blank ? null : parsed.value;
      }
    }
    else if (key === "orgName" && kind === "contact") clean.orgName = cleanText(value);
    else if (key === "subs") {
      clean.subs = {};
      for (const [pubId, fields] of Object.entries(value || {})) {
        if (!publicationIds.has(pubId)) continue;
        const entry = {};
        for (const [field, fieldValue] of Object.entries(fields || {})) {
          if (!subs.includes(field)) continue;
          if (field === "copies") {
            const copies = rules.parseCopies(fieldValue);
            if (copies !== null) entry.copies = copies;
          } else entry[field] = !!fieldValue;
        }
        clean.subs[pubId] = entry;
      }
    }
  }
  return clean;
}

// "Active" or "Inactive", whatever it's typed as; blank for not known.
function cleanMemberStatus(value) {
  const t = cleanText(value).toLowerCase();
  if (!t) return "";
  if (/^(inactive|terminated|cancell?ed|withdrawn|dropped|no|n)$/.test(t)) return "Inactive";
  if (/^(active|current|yes|y)$/.test(t)) return "Active";
  throw new Error(`Member status is Active or Inactive, not "${cleanText(value)}".`);
}

// A record's fields with a patch laid on: a value replaces, null removes.
function mergeFields(current, patch) {
  const next = { ...(current || {}) };
  for (const [id, value] of Object.entries(patch || {})) {
    if (value === null || value === undefined) delete next[id];
    else next[id] = value;
  }
  return next;
}

function mergeSubs(current, patch) {
  const next = { ...(current || {}) };
  for (const [pubId, fields] of Object.entries(patch || {})) next[pubId] = { ...(next[pubId] || {}), ...fields };
  return next;
}

function contactLabel(contact) {
  return contact?.name || "(no name)";
}

// Everything on the member list, with lookups both ways.
function loadList() {
  const contacts = store.list("contacts");
  const households = store.list("households");
  const orgs = store.list("orgs");
  const publications = store.list("publications");
  const groupBy = (key) => {
    const map = new Map();
    for (const c of contacts) {
      if (!c[key]) continue;
      if (!map.has(c[key])) map.set(c[key], []);
      map.get(c[key]).push(c);
    }
    return map;
  };
  return {
    contacts,
    households,
    orgs,
    publications,
    contactById: new Map(contacts.map((c) => [c.id, c])),
    householdById: new Map(households.map((h) => [h.id, h])),
    orgById: new Map(orgs.map((o) => [o.id, o])),
    membersOf: groupBy("householdId"),
    orgMembers: groupBy("orgId"),
  };
}

function formatAddress(place) {
  return [place?.addressLine1, place?.addressLine2, place?.city, [place?.state, place?.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// A household with who lives there and who the label goes to.
function describeHousehold(household, members, list) {
  return {
    ...household,
    members: members.map((m) => ({ id: m.id, name: m.name, orgName: list.orgById.get(m.orgId)?.name || "" })),
    addressee: rules.addresseeOf(members.map((m) => ({ name: m.name, orgName: list.orgById.get(m.orgId)?.name || "" }))),
  };
}

function describeOrg(org, list) {
  return { ...org, memberCount: (list.orgMembers.get(org.id) || []).length };
}

// The organization with this name ("The Maple Grove Mennonite Church" is
// "Maple Grove Mennonite"), if there is one.
function findOrgByName(orgs, name) {
  const key = matching.orgKey(name);
  return orgs.find((o) => matching.orgKey(o.name) === key) || null;
}

// Records that people, households or organizations left the list -- deleted,
// or folded into another (`replacementId`) when merged or combined -- so the
// apps that keep their own records of them (SendNewsletters' and
// FormTracker's mailings) can follow: a mailing that hasn't reached one yet
// moves to the replacement or drops it, and one that has keeps the copy of
// who and where it was saved here. `before` is the list as it was, to
// describe them as they were.
function retire(kind, ids, replacementId = null, before = loadList()) {
  if (!ids.size) return;
  const now = new Date().toISOString();
  const rows = [];
  for (const id of ids) {
    let snapshot = null;
    if (kind === "org" && before.orgById.has(id)) snapshot = describeOrg(before.orgById.get(id), before);
    if (kind === "household" && before.householdById.has(id)) {
      snapshot = describeHousehold(before.householdById.get(id), before.membersOf.get(id) || [], before);
    }
    if (kind === "contact" && before.contactById.has(id)) snapshot = before.contactById.get(id);
    rows.push({ kind, fromId: id, toId: replacementId, snapshot, at: now });
  }
  store.insertMany("retired", rows);
}

// Takes households or organizations off the list, recording where they went.
function retirePlaces(kind, ids, replacementId = null, before = loadList()) {
  if (!ids.size) return;
  retire(kind, ids, replacementId, before);
  store.removeWhere(kind === "org" ? "orgs" : "households", (row) => ids.has(row.id));
}

// Households among `ids` that nobody lives in any more.
function emptyHouseholds(ids) {
  const occupied = new Set(store.list("contacts").map((c) => c.householdId));
  return new Set([...ids].filter((id) => id && !occupied.has(id)));
}

// One save dialog for every export: the file type picked in the dialog
// decides between Excel and CSV.
async function saveTable(columns, rows, { title, defaultName, sheetName }) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title,
    defaultPath: `${defaultName}.xlsx`,
    filters: [
      { name: "Excel workbook", extensions: ["xlsx"] },
      { name: "CSV", extensions: ["csv"] },
    ],
  });
  if (result.canceled || !result.filePath) return null;

  if (path.extname(result.filePath).toLowerCase() === ".csv") {
    const Papa = require("papaparse");
    // The byte-order mark makes Excel read accented names as UTF-8;
    // escapeFormulae keeps a name like "=Smith" from running as a formula.
    const csv = Papa.unparse({ fields: columns, data: rows.map((row) => columns.map((c) => row[c])) }, { escapeFormulae: true });
    fs.writeFileSync(result.filePath, "﻿" + csv, "utf8");
  } else {
    const XLSX = require("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, result.filePath);
  }
  return result.filePath;
}

const yesNo = (value) => (value ? "Yes" : "No");

// ---------------------------------------------------------------------------
// Newsletters and magazines
// ---------------------------------------------------------------------------

// The two the office sends today, added the first time the app runs; after
// that the list is whatever's been added, renamed or removed.
function seedPublications() {
  if (store.getSettings().publicationsSeeded) return;
  if (!store.list("publications").length) store.insertMany("publications", [{ name: "MAAP Newsletter" }, { name: "Our Health" }]);
  store.updateSettings({ publicationsSeeded: true });
}

ipcMain.handle("publications:list", async () => store.list("publications"));

function checkPublicationName(name, exceptId) {
  const clean = cleanText(name);
  if (!clean) throw new Error("Give it a name.");
  if (store.list("publications").some((p) => p.id !== exceptId && p.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`There's already one called "${clean}".`);
  }
  return clean;
}

ipcMain.handle("publications:add", async (event, name) => store.insert("publications", { name: checkPublicationName(name) }));

ipcMain.handle("publications:rename", async (event, id, name) => store.update("publications", id, { name: checkPublicationName(name, id) }));

// Takes it off everyone. SendNewsletters keeps the name on its past mailings.
ipcMain.handle("publications:remove", async (event, id) => {
  const strip = (row) => (row.subs && id in row.subs ? { subs: Object.fromEntries(Object.entries(row.subs).filter(([key]) => key !== id)) } : null);
  for (const collection of ["contacts", "households", "orgs"]) store.updateWhere(collection, strip);
  store.remove("publications", id);
  return true;
});

// ---------------------------------------------------------------------------
// Gravity Forms signup form
// ---------------------------------------------------------------------------

// While a manager has set the website in AB Apps, the signup form is read
// with its address and read-only key; which form stays this app's setting.
const sharedWebsite = () => sharedServices(app.getPath("appData")).website;

function gfConnection(overrides = {}) {
  const s = store.getSettings();
  const website = sharedWebsite();
  if (website) return { ...website, formId: overrides.formId || s.gfFormId || "" };
  const connection = {
    siteUrl: s.gfSiteUrl || "",
    consumerKey: s.gfConsumerKey || "",
    consumerSecret: decryptSecret(s.gfConsumerSecret),
    formId: s.gfFormId || "",
  };
  for (const [key, value] of Object.entries(overrides)) if (value) connection[key] = value;
  return connection;
}

ipcMain.handle("gf:get-settings", async () => {
  const s = store.getSettings();
  return {
    siteUrl: s.gfSiteUrl || "",
    consumerKey: s.gfConsumerKey || "",
    hasSecret: !!s.gfConsumerSecret,
    formId: s.gfFormId || "",
    formTitle: s.gfFormTitle || "",
    lastImportedEntryId: s.gfLastImportedEntryId || 0,
    shared: sharedWebsite() ? { siteUrl: sharedWebsite().siteUrl } : null,
  };
});

// A blank secret means "the one already saved", so testing a change to the
// site URL doesn't need the secret typed in again.
ipcMain.handle("gf:list-forms", async (event, { siteUrl, consumerKey, consumerSecret }) =>
  gravityForms.listForms(gfConnection({ siteUrl: cleanText(siteUrl), consumerKey: cleanText(consumerKey), consumerSecret }))
);

ipcMain.handle("gf:save-settings", async (event, { siteUrl, consumerKey, consumerSecret, formId, formTitle }) => {
  const current = store.getSettings();
  const patch = { gfSiteUrl: cleanText(siteUrl), gfConsumerKey: cleanText(consumerKey), gfFormId: String(formId || ""), gfFormTitle: formTitle || "" };
  if (consumerSecret) patch.gfConsumerSecret = encryptSecret(consumerSecret);
  // A different form numbers its entries separately.
  if (patch.gfFormId !== (current.gfFormId || "")) patch.gfLastImportedEntryId = 0;
  store.updateSettings(patch);
  return true;
});

// ---------------------------------------------------------------------------
// Bringing in SendNewsletters' and FormTracker's lists
// ---------------------------------------------------------------------------
// MemberManager takes over the lists the two apps kept for themselves.
//
// SendNewsletters' list is the same shape as this one -- people, households,
// organizations and who gets which newsletter -- so it's copied as it is,
// with its records' ids, and SendNewsletters' past mailings still point at
// the right people. That's only done into an empty list.
//
// FormTracker's contacts (one per member household, with whatever columns
// were imported alongside) come in through the Import page like any other
// list, matched by Member ID, so their extra columns can become fields.

const OTHER_APPS = { sendNewsletters: "SendNewsletters", formTracker: "FormTracker" };

// The app's folder in the AB Apps folder, if it has its list there.
function otherAppFolder(key) {
  if (!abIdentity?.dataDir) return null;
  const dir = path.join(abIdentity.dataDir, OTHER_APPS[key]);
  return fs.existsSync(path.join(dir, "contacts.json")) ? dir : null;
}

function readOther(dir, name) {
  const value = store.readJson(path.join(dir, `${name}.json`), []);
  return Array.isArray(value) ? value : [];
}

const listIsEmpty = () => !store.list("contacts").length && !store.list("orgs").length;

function formTrackerContacts(dir) {
  return readOther(dir, "contacts").filter((c) => !c.removedAt);
}

// FormTracker's contacts as an imported table: its own columns under the
// headings the importer recognizes, then every extra column it kept,
// except identity and health ones.
function formTrackerTable(folder) {
  const dir = folder || otherAppFolder("formTracker");
  if (!dir) throw new Error("FormTracker's contacts aren't in the AB Apps folder. Choose its data folder instead.");
  const contacts = formTrackerContacts(dir);
  const extraHeaders = [...new Set(contacts.flatMap((c) => Object.keys(c.extra || {})))].filter((h) => !isSensitive(h));
  const BUILT_IN = { "Member ID": "externalId", Name: "name", "Email Address": "email", "Address 1": "addressLine1", "Address 2": "addressLine2", City: "city", State: "state", ZIP: "zip" };
  // An extra column with the same heading as a built-in one is renamed rather than lost.
  const extraName = (h) => (h in BUILT_IN ? `${h} (FormTracker)` : h);
  const headers = [...Object.keys(BUILT_IN), ...extraHeaders.map(extraName)];
  const rows = contacts.map((c) => ({
    ...Object.fromEntries(Object.entries(BUILT_IN).map(([heading, key]) => [heading, c[key] ?? ""])),
    ...Object.fromEntries(extraHeaders.map((h) => [extraName(h), c.extra?.[h] ?? ""])),
  }));
  return { headers, rows };
}

function summarizeOther(key, dir) {
  if (!dir) return null;
  if (key === "formTracker") return { folder: dir, people: formTrackerContacts(dir).length };
  return {
    folder: dir,
    people: readOther(dir, "contacts").length,
    households: readOther(dir, "households").length,
    orgs: readOther(dir, "orgs").length,
    newsletters: readOther(dir, "publications").map((p) => p.name),
  };
}

ipcMain.handle("migrate:sources", async () => ({
  listEmpty: listIsEmpty(),
  isHost: actingHost,
  sendNewsletters: summarizeOther("sendNewsletters", otherAppFolder("sendNewsletters")),
  formTracker: summarizeOther("formTracker", otherAppFolder("formTracker")),
  copiedFromSendNewsletters: store.getSettings().copiedFromSendNewsletters || null,
}));

// Another folder, for an app whose data isn't in the AB Apps folder.
ipcMain.handle("migrate:pick-folder", async (event, key) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: `Choose ${OTHER_APPS[key]}'s data folder`, properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, "contacts.json"))) throw new Error(`That folder doesn't have ${OTHER_APPS[key]}'s list in it (contacts.json).`);
  return summarizeOther(key, dir);
});

ipcMain.handle("migrate:send-newsletters", async (event, folder) => {
  requireHost("brings in SendNewsletters' list");
  if (!listIsEmpty()) throw new Error("SendNewsletters' list can only be brought into an empty list.");
  const dir = folder || otherAppFolder("sendNewsletters");
  if (!dir) throw new Error("SendNewsletters' list isn't in the AB Apps folder. Choose its data folder instead.");
  const summary = summarizeOther("sendNewsletters", dir);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Bring it in", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: "Bring in SendNewsletters' list?",
    detail:
      `${summary.people.toLocaleString()} people, ${summary.households.toLocaleString()} households and ${summary.orgs.toLocaleString()} organizations, ` +
      `with who gets ${summary.newsletters.join(" and ") || "each newsletter"}, are copied from:
${dir}

` +
      "Open SendNewsletters on its host computer first, so everyone's latest changes are in it. SendNewsletters' own files aren't changed.",
  });
  if (response !== 0) return { changed: false };
  for (const name of ["publications", "orgs", "households", "contacts", "reviewDismissed"]) {
    const rows = readOther(dir, name);
    store.mutate(name, () => rows);
  }
  const shared = store.readJson(path.join(dir, "settings.json"), {});
  store.updateSettings({
    publicationsSeeded: true,
    gfLastImportedEntryId: Math.max(store.getSettings().gfLastImportedEntryId || 0, Number(shared.gfLastImportedEntryId) || 0),
    copiedFromSendNewsletters: { at: new Date().toISOString(), folder: dir, by: shownName() },
  });
  dataChanged(null);
  return { changed: true, ...summary };
});

// ---------------------------------------------------------------------------
// Find, Lists and Near ZIP
// ---------------------------------------------------------------------------
// Finding anyone (lib/search.js), lists of anyone on any field
// (lib/lists.js) and how many members live near a place (lib/nearZip.js),
// all from one model of the list (lib/memberModel.js). The model is built
// again only when the list's files change or this computer makes a change.

let modelCache = null;

function modelKey() {
  const stamp = ["contacts", "households", "orgs", "fields", "publications"]
    .map((name) => {
      try {
        const s = fs.statSync(path.join(store.getDataDir(), `${name}.json`));
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return "-";
      }
    })
    .join("|");
  return `${store.getDataDir()}|${stamp}|${team ? team.unsavedCount() : 0}|${new Date().toDateString()}`;
}

function currentModel() {
  const key = modelKey();
  if (modelCache?.key !== key) {
    const list = loadList();
    const model = buildModel({ contacts: list.contacts, households: list.households, orgs: list.orgs, publications: list.publications, fields: store.list("fields") });
    modelCache = { key, model, index: searchLib.buildIndex(model), catalogs: new Map() };
  }
  return modelCache;
}

function listCatalog(kind, zip) {
  const cache = currentModel();
  const origin = nearZip.zip5(zip);
  const key = `${kind}|${origin}`;
  if (!cache.catalogs.has(key)) {
    const zips = origin ? nearZip.loadZips() : null;
    cache.catalogs.set(key, lists.catalog(cache.model, lists.KINDS[kind] ? kind : "people", origin && zips.has(origin) ? { zips, origin } : null));
  }
  return cache.catalogs.get(key);
}

const plansOf = (model) => [...new Set(model.households.map((h) => h.plan).filter(Boolean))].sort();

ipcMain.handle("find:search", async (event, query, options) => {
  const { model, index } = currentModel();
  return { ...searchLib.search(index, query, options || {}), plans: plansOf(model), empty: !model.people.length && !model.churches.length };
});

// A household, person or church, with what its card shows.
ipcMain.handle("find:card", async (event, k, id) => {
  const { model } = currentModel();
  const church = (orgId) => (model.byChurch.has(orgId) ? { id: orgId, name: model.byChurch.get(orgId).name } : null);
  const own = (record, appliesTo, skipBuiltIn = true) => {
    const builtIn = new Set(Object.values(model.F).filter(Boolean).map((f) => f.id));
    return model.fields
      .filter((f) => f.appliesTo === appliesTo && !(skipBuiltIn && builtIn.has(f.id)))
      .map((f) => ({ label: f.label, value: Fields.formatValue(f.type, record?.fields?.[f.id]) }))
      .filter((x) => x.value !== "");
  };
  const pubs = model.publications;
  const personSummary = (p) => ({ id: p.id, name: p.name, role: p.role, birth: p.birthShown, age: p.age, birthCheck: p.birthCheck, status: p.active ? "Active" : "Inactive", email: p.email, gender: p.gender });
  if (k === "h") {
    const h = model.byHousehold.get(id);
    if (!h) return null;
    const head = model.byPerson.get(h.headId);
    const place = model.mail.get(h.mailHouseholdId);
    const sharing = model.households.filter((x) => x.key !== h.key && x.mailHouseholdId && x.mailHouseholdId === h.mailHouseholdId).map((x) => ({ key: x.key, name: x.name }));
    const newsletters = pubs
      .map((pub) => {
        const ways = [];
        if (rules.getsMail(place, pub.id)) ways.push(`by mail (${rules.copiesFor(place, pub.id)} ${rules.copiesFor(place, pub.id) === 1 ? "copy" : "copies"} to the address)`);
        const emailed = h.memberIds.map((pid) => model.byPerson.get(pid)).filter((p) => rules.getsEmail(p.record, pub.id));
        if (emailed.length) ways.push(`by email to ${emailed.map((p) => p.name).join(", ")}`);
        if (rules.coveredBy(model.byChurch.get(h.orgId)?.record, pub.id)) ways.push("through their church's batch");
        return ways.length ? { name: pub.name, how: ways.join("; ") } : null;
      })
      .filter(Boolean);
    return {
      k,
      id,
      name: h.name,
      fundTrack: h.fundTrack,
      memberId: h.memberId,
      status: h.status,
      plan: h.plan,
      type: h.type,
      phone: h.phone,
      email: h.email,
      address: [h.addressLine1, h.addressLine2, [h.city, [h.state, h.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean),
      church: church(h.orgId),
      head: head ? { id: head.id, name: head.name } : null,
      members: h.memberIds.map((pid) => personSummary(model.byPerson.get(pid))),
      newsletters,
      fields: [...own(head?.record, "contact"), ...own(place, "household")],
      details: h.account || {},
      sharing,
    };
  }
  if (k === "p") {
    const p = model.byPerson.get(id);
    if (!p) return null;
    const c = p.record;
    const newsletters = pubs
      .map((pub) => {
        const ways = [];
        if (rules.getsEmail(c, pub.id)) ways.push("by email");
        if (rules.getsMail(model.mail.get(c.householdId), pub.id)) ways.push("by mail, with their household");
        if (rules.coveredBy(model.byChurch.get(c.orgId)?.record, pub.id)) ways.push("through their church's batch");
        return ways.length ? { name: pub.name, how: ways.join("; ") } : null;
      })
      .filter(Boolean);
    return {
      k,
      id,
      ...personSummary(p),
      memberId: p.memberId,
      phone: p.phone || p.household?.phone || "",
      household: p.household ? { key: p.household.key, name: p.household.name } : null,
      address: p.household ? [p.household.addressLine1, p.household.addressLine2, [p.household.city, [p.household.state, p.household.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean) : [],
      church: church(p.orgId),
      newsletters,
      fields: own(c, "contact"),
      details: c.fundTrack || {},
    };
  }
  if (k === "c") {
    const c = model.byChurch.get(id);
    if (!c) return null;
    const newsletters = pubs
      .map((pub) => {
        const s = rules.sub(c.record, pub.id);
        const ways = [];
        if (rules.getsMail(c.record, pub.id)) ways.push(`a batch of ${rules.copiesFor(c.record, pub.id)} by mail`);
        if (rules.getsEmail(c.record, pub.id)) ways.push("by email");
        return ways.length || s.mail ? { name: pub.name, how: ways.join("; ") || "by mail (no address yet)" } : null;
      })
      .filter(Boolean);
    return {
      k,
      id,
      name: c.name,
      code: c.code,
      type: c.type,
      denomination: c.denomination,
      status: c.status,
      attn: c.attn,
      email: c.email,
      phone: c.phone,
      contacts: c.contacts,
      address: [c.addressLine1, c.addressLine2, [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean),
      households: c.householdKeys
        .map((key) => model.byHousehold.get(key))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((h) => ({ key: h.key, name: h.name, place: [h.city, h.state].filter(Boolean).join(", "), size: h.size, active: h.active })),
      people: c.people,
      newsletters,
      fields: own(c.record, "org"),
      details: c.record.fundTrack || {},
    };
  }
  return null;
});

// ---- printing ----
// Printed through a hidden window, so Windows' print dialog offers any
// printer or "Microsoft Print to PDF".

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PRINT_CSS = `
  body { font: 10pt "Segoe UI", Arial, sans-serif; color: #000; margin: 0.4in; }
  h1 { font-size: 15pt; margin: 0 0 4px; } p.sub { margin: 0 0 12px; color: #444; }
  table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #bbb; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; } td.num, th.num { text-align: right; }
  tr { page-break-inside: avoid; } .foot { margin-top: 10px; color: #444; font-size: 8.5pt; }`;

async function printTable(title, subtitle, columns, rows, foot = "") {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>
    <h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>
    <table><thead><tr>${columns.map((c) => `<th class="${c.num ? "num" : ""}">${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td class="${columns[i].num ? "num" : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <p class="foot">${escapeHtml(foot)}${foot ? " · " : ""}Printed ${escapeHtml(new Date().toLocaleDateString())} from MemberManager</p></body></html>`;
  const file = path.join(os.tmpdir(), `membermanager-print-${randomUUID()}.html`);
  fs.writeFileSync(file, html, "utf8");
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadFile(file);
    await new Promise((resolve) => win.webContents.print({ printBackground: false }, () => resolve()));
  } finally {
    win.destroy();
    fs.rmSync(file, { force: true });
  }
  return true;
}

// A church's households, to print or save as a PDF.
ipcMain.handle("find:print-church", async (event, id) => {
  const { model } = currentModel();
  const c = model.byChurch.get(id);
  if (!c) throw new Error("That church is no longer on the list.");
  const rows = c.householdKeys
    .map((key) => model.byHousehold.get(key))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => [h.name, h.memberId, [h.addressLine1, h.addressLine2, [h.city, h.state, h.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), h.phone, String(h.size), h.active ? "" : "Inactive"]);
  return printTable(`${c.name}: households`, [c.code && `Code ${c.code}`, `${rows.length.toLocaleString()} households, ${c.people.toLocaleString()} people`].filter(Boolean).join(" · "), [
    { label: "Household" },
    { label: "Member ID" },
    { label: "Address" },
    { label: "Phone" },
    { label: "People", num: true },
    { label: "" },
  ], rows);
});

// ---- Lists ----

const LIST_PAGE = 300;

// The renderer's state, tidied: { kind, conds, match, cols, sort, dir, zip }.
function listState(state) {
  const kind = lists.KINDS[state?.kind] ? state.kind : "people";
  const cat = listCatalog(kind, state?.zip);
  const conds = (state?.conds || []).filter((c) => c && cat.byKey.has(c.k)).map((c) => ({ k: c.k, op: String(c.op || ""), v: String(c.v ?? ""), v2: String(c.v2 ?? "") }));
  const cols = (state?.cols?.length ? state.cols : lists.DEFAULT_COLUMNS[kind]).filter((k) => cat.byKey.has(k));
  const sort = cat.byKey.has(state?.sort) ? state.sort : null;
  return { kind, cat, conds, match: state?.match === "any" ? "any" : "all", cols, sort, dir: state?.dir === -1 ? -1 : 1, zip: nearZip.zip5(state?.zip) };
}

function runListState(state) {
  const s = listState(state);
  let records = lists.runList(s.cat, s.conds, s.match);
  if (s.sort) records = lists.sortRecords(records, s.cat.byKey.get(s.sort), s.dir);
  const columns = s.cols.map((k) => s.cat.byKey.get(k));
  return { s, records, columns, title: s.conds.length ? s.conds.map((c) => lists.describe(s.cat, c)).join(s.match === "any" ? " or " : ", ") : `All ${lists.KINDS[s.kind].toLowerCase()}` };
}

ipcMain.handle("lists:catalog", async (event, kind, zip) => {
  const cat = listCatalog(lists.KINDS[kind] ? kind : "people", zip);
  const origin = nearZip.zip5(zip);
  return {
    kinds: lists.KINDS,
    ops: lists.OPS,
    fields: cat.fields.map((f) => ({ k: f.k, label: f.label, group: f.group, type: f.type, opts: f.opts })),
    defaultColumns: lists.DEFAULT_COLUMNS,
    presets: lists.presets(),
    saved: store.getSettings().savedLists || [],
    zipKnown: !origin || nearZip.loadZips().has(origin),
  };
});

ipcMain.handle("lists:run", async (event, state, shown = LIST_PAGE) => {
  const { s, records, columns, title } = runListState(state);
  return {
    total: records.length,
    title,
    columns: columns.map((f) => ({ k: f.k, label: f.label, type: f.type })),
    rows: records.slice(0, Math.max(LIST_PAGE, shown)).map((r) => ({ ref: lists.recordRef(s.kind, r), cells: columns.map((f) => lists.display(f, f.get(r))) })),
  };
});

// Column headings, made unique for a spreadsheet: a second "Church" is "Church (Household)".
function uniqueHeadings(columns) {
  const seen = new Map();
  return columns.map((f) => {
    const n = seen.get(f.label) || 0;
    seen.set(f.label, n + 1);
    return n ? `${f.label} (${f.group})` : f.label;
  });
}

ipcMain.handle("lists:export", async (event, state) => {
  const { records, columns, title } = runListState(state);
  const headings = uniqueHeadings(columns);
  const rows = records.map((r) => Object.fromEntries(columns.map((f, i) => [headings[i], lists.display(f, f.get(r))])));
  return saveTable(headings, rows, { title: "Save the list", defaultName: title.replace(/[^\w ,.-]+/g, " ").slice(0, 80).trim() || "list", sheetName: "List" });
});

ipcMain.handle("lists:print", async (event, state) => {
  const { s, records, columns, title } = runListState(state);
  const headings = uniqueHeadings(columns);
  return printTable(
    title,
    `${records.length.toLocaleString()} ${lists.KINDS[s.kind].toLowerCase()}`,
    columns.map((f, i) => ({ label: headings[i], num: f.type === "num" })),
    records.map((r) => columns.map((f) => String(lists.display(f, f.get(r)) ?? "")))
  );
});

// Lists kept by name, for everyone using the list.
ipcMain.handle("lists:save", async (event, name, state) => {
  const clean = cleanText(name);
  if (!clean) throw new Error("Give the list a name.");
  const saved = (store.getSettings().savedLists || []).filter((l) => l.name.toLowerCase() !== clean.toLowerCase());
  const { kind, conds, match, cols, sort, dir, zip } = listState(state);
  saved.push({ id: randomUUID(), name: clean, state: { kind, conds, match, cols, sort, dir, zip } });
  saved.sort((a, b) => a.name.localeCompare(b.name));
  store.updateSettings({ savedLists: saved });
  return saved;
});

ipcMain.handle("lists:delete", async (event, id) => {
  const saved = (store.getSettings().savedLists || []).filter((l) => l.id !== id);
  store.updateSettings({ savedLists: saved });
  return saved;
});

// ---- Near ZIP ----

function nearState(options) {
  const zip = nearZip.zip5(options?.zip);
  const maxMi = nearZip.MAX_CHOICES.includes(Number(options?.maxMi)) ? Number(options.maxMi) : 100;
  return { zip, maxMi, plan: String(options?.plan || ""), inactive: !!options?.inactive };
}

function nearFor(options) {
  const o = nearState(options);
  const { model } = currentModel();
  if (!o.zip) return { o, report: null, plans: plansOf(model) };
  const report = nearZip.nearReport(model, nearZip.loadZips(), o.zip, o);
  return { o, report, plans: plansOf(model), unknownZip: !report };
}

ipcMain.handle("near:report", async (event, options) => {
  const { o, report, plans, unknownZip } = nearFor(options);
  return { options: o, report, plans, unknownZip: !!unknownZip, bands: nearZip.BANDS, maxChoices: nearZip.MAX_CHOICES };
});

const nearScope = (o) => [`from ZIP ${o.zip}`, `up to ${o.maxMi} miles`, o.plan && `plan ${o.plan}`, o.inactive ? "including inactive households" : "active households"].filter(Boolean).join(" · ");
const nearRows = (report) => report.zips.map((z) => [z.zip, `${z.miles.toFixed(1)}${z.approx ? " (approx.)" : ""}`, z.city, z.state, String(z.households), String(z.people)]);
const NEAR_COLUMNS = [{ label: "ZIP" }, { label: "Miles", num: true }, { label: "City" }, { label: "State" }, { label: "Households", num: true }, { label: "People", num: true }];

ipcMain.handle("near:export", async (event, options) => {
  const { o, report } = nearFor(options);
  if (!report) throw new Error("Enter a ZIP code first.");
  const headings = NEAR_COLUMNS.map((c) => c.label);
  const rows = [
    ...report.bands.map((b) => ({ ZIP: `Within ${b.to} miles`, Miles: "", City: "", State: "", Households: b.households, People: b.people })),
    ...nearRows(report).map((cells) => Object.fromEntries(headings.map((h, i) => [h, cells[i]]))),
  ];
  return saveTable(headings, rows, { title: "Save the counts", defaultName: `members near ${o.zip}`, sheetName: "Near ZIP" });
});

ipcMain.handle("near:print", async (event, options) => {
  const { o, report } = nearFor(options);
  if (!report) throw new Error("Enter a ZIP code first.");
  const bands = report.bands.map((b) => `within ${b.to} mi: ${b.households.toLocaleString()} households, ${b.people.toLocaleString()} people`).join(" · ");
  return printTable(`Members near ZIP ${o.zip}`, nearScope(o), NEAR_COLUMNS, nearRows(report), `${bands}. Straight-line miles between ZIP code centre points (US Census Bureau); counts only`);
});

// ---- Map ----
// Households and people per ZIP code, for the Map page's heat map. Only these
// counts go to the page; the map's tiles come from OpenStreetMap (see
// tileHeaders), and nothing about members is ever sent anywhere.

ipcMain.handle("map:points", async (event, options) => {
  const { model } = currentModel();
  const o = { plan: String(options?.plan || ""), inactive: !!options?.inactive };
  return { options: o, plans: plansOf(model), ...nearZip.zipCounts(model, nearZip.loadZips(), o) };
});

// ---------------------------------------------------------------------------
// Member cards
// ---------------------------------------------------------------------------
// Card designs (lib/cards.js): a front and a back, each an SVG of the
// preprinted card to place fields on, printed one side at a time on the card
// printer. An SVG is kept in the data folder's card-templates folder under a
// name of its own, so only the computer that added it ever writes it, and
// it's only ever shown as an image -- an SVG's scripts never run.

const CARD_IMAGES = "card-templates";

function cardDesign(id) {
  const design = store.get("cardTemplates", id);
  if (!design) throw new Error("That card design is no longer there.");
  return design;
}

// The bundled fonts as @font-face rules, read once.
let cardFonts = null;
const cardFontFaces = () => (cardFonts ??= cards.fontFaces((file) => fs.readFileSync(require.resolve(file))));

function cardImageUrl(side) {
  if (!side?.image) return null;
  try {
    return `data:image/svg+xml;base64,${fs.readFileSync(path.join(store.getDataDir(), side.image)).toString("base64")}`;
  } catch {
    return null; // OneDrive hasn't brought it to this computer yet
  }
}

ipcMain.handle("cards:list", async () => store.list("cardTemplates"));

ipcMain.handle("cards:get", async (event, id) => {
  const design = cardDesign(id);
  const images = Object.fromEntries(cards.SIDES.map((s) => [s, cardImageUrl(design.sides[s])]));
  return {
    design,
    images,
    size: cards.cardSize(design.orientation),
    fonts: cards.FONTS.map((family) => ({ family, note: cards.BUNDLED_FONTS.find((f) => f.family === family)?.note || "" })),
    printer: store.getSettings().cardPrinter || "",
    dpi: cardDpi(),
  };
});

ipcMain.handle("cards:create", async (event, input) => {
  const name = cleanText(input?.name) || "Member card";
  return store.insert("cardTemplates", { ...cards.newDesign(name, input?.cardFor, input?.orientation), updatedAt: new Date().toISOString() });
});

ipcMain.handle("cards:update", async (event, id, patch) => {
  const design = cardDesign(id);
  const next = cards.cleanDesign(patch || {}, design);
  return store.update("cardTemplates", id, { ...next, updatedAt: new Date().toISOString() });
});

ipcMain.handle("cards:delete", async (event, id) => {
  const design = cardDesign(id);
  store.remove("cardTemplates", id);
  for (const s of cards.SIDES) {
    if (design.sides[s]?.image) fs.rmSync(path.join(store.getDataDir(), design.sides[s].image), { force: true });
  }
  return true;
});

// An SVG of the preprinted card for one side.
ipcMain.handle("cards:set-image", async (event, id, side) => {
  const design = cardDesign(id);
  if (!cards.SIDES.includes(side)) throw new Error("Unknown side.");
  const result = await dialog.showOpenDialog(mainWindow, { title: `Choose the card's ${side} (an SVG image)`, filters: [{ name: "SVG image", extensions: ["svg"] }], properties: ["openFile"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const source = result.filePaths[0];
  if (fs.statSync(source).size > 15 * 1024 * 1024) throw new Error("That SVG is over 15 MB. Save it again with smaller embedded pictures.");
  const text = fs.readFileSync(source, "utf8");
  const info = cards.svgInfo(text);
  if (!info) throw new Error("That file isn't an SVG image.");
  const { w, h } = cards.cardSize(design.orientation);
  const stored = path.join(CARD_IMAGES, `${randomUUID()}.svg`);
  fs.mkdirSync(path.join(store.getDataDir(), CARD_IMAGES), { recursive: true });
  fs.writeFileSync(path.join(store.getDataDir(), stored), text, "utf8");
  const old = design.sides[side]?.image;
  const sides = { ...design.sides, [side]: { ...(design.sides[side] || cards.blankSide()), image: stored.replace(/\\/g, "/"), imageName: path.basename(source) } };
  const saved = store.update("cardTemplates", id, { sides, updatedAt: new Date().toISOString() });
  if (old) fs.rmSync(path.join(store.getDataDir(), old), { force: true });
  // A picture much wider or narrower than the card is stretched to fit it.
  const mismatch = info.aspect && Math.abs(info.aspect - w / h) / (w / h) > 0.04;
  return { design: saved, image: cardImageUrl(saved.sides[side]), warning: mismatch ? `That image's shape doesn't match a ${design.orientation} card (${w} × ${h} mm), so it's stretched to fit. Check the orientation, or export the SVG at the card's size.` : null };
});

ipcMain.handle("cards:clear-image", async (event, id, side) => {
  const design = cardDesign(id);
  const old = design.sides[side]?.image;
  const saved = store.update("cardTemplates", id, { sides: { ...design.sides, [side]: { ...design.sides[side], image: null, imageName: "" } }, updatedAt: new Date().toISOString() });
  if (old) fs.rmSync(path.join(store.getDataDir(), old), { force: true });
  return saved;
});

// The Lists catalog a design's cards come from (cached with the model).
const cardCatalog = (cardFor) => listCatalog(cards.listKind(cardFor), "");

ipcMain.handle("cards:fields", async (event, cardFor) => cards.fieldChoices(cardCatalog(cardFor)));

// What a side's fields say for one person or household (the first one with a
// Member ID when none is given), for the designer.
ipcMain.handle("cards:values", async (event, id, side, ref) => {
  const design = cardDesign(id);
  const { model } = currentModel();
  let refs = ref ? [ref] : [];
  if (!refs.length) {
    const first =
      design.cardFor === "person"
        ? model.people.find((p) => p.memberId && p.active) || model.people[0]
        : model.households.find((h) => h.memberId && h.active) || model.households[0];
    if (first) refs = [{ id: design.cardFor === "person" ? first.id : first.key }];
  }
  const { cat, records } = cards.recordsFor(cardCatalog(design.cardFor), refs);
  if (!records.length) return { name: "", values: {} };
  const r = records[0];
  return {
    ref: lists.recordRef(cat.kind, r),
    name: design.cardFor === "person" ? r.p.name : r.h.name,
    values: Object.fromEntries(cards.elementValues(model, cat, design.sides[side], r).map((el) => [el.id, el.value])),
  };
});

ipcMain.handle("cards:printers", async () => {
  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map((p) => p.name).sort();
});

// The resolution card jobs ask for: 300 dpi (the SMART-51's colour) unless
// set to 600 or 1200 (its black resin panel) or 0, the printer's default.
const CARD_DPI = [300, 600, 1200, 0];
const cardDpi = () => {
  const saved = store.getSettings().cardDpi;
  return CARD_DPI.includes(saved) ? saved : 300;
};

ipcMain.handle("cards:set-dpi", async (event, dpi) => {
  store.updateSettings({ cardDpi: CARD_DPI.includes(Number(dpi)) ? Number(dpi) : 300 });
  return cardDpi();
});

ipcMain.handle("cards:set-printer", async (event, name) => {
  store.updateSettings({ cardPrinter: String(name || "") });
  return true;
});

// Prints one side of a design for people or households -- `refs` from Find,
// or every record of a Lists `listState` -- or, with `pdf`, opens a PDF of
// them (with the template image, to check where everything lands).
ipcMain.handle("cards:print", async (event, { designId, side, refs, listState, pdf, reverse }) => {
  const design = cardDesign(designId);
  if (!cards.SIDES.includes(side)) throw new Error("Unknown side.");
  const { model } = currentModel();
  let wanted = refs || [];
  if (listState) {
    const { s, records } = runListState(listState);
    if (s.kind !== cards.listKind(design.cardFor)) throw new Error(`${design.name} is a card for each ${design.cardFor}; this is a list of ${lists.KINDS[s.kind].toLowerCase()}.`);
    wanted = records.map((r) => lists.recordRef(s.kind, r));
  }
  const { cat, records } = cards.recordsFor(cardCatalog(design.cardFor), wanted);
  if (!records.length) throw new Error("There's no one to print a card for.");
  if (!design.sides[side].elements.length && !design.sides[side].printImage && !pdf) throw new Error(`The ${side} has nothing on it to print yet.`);
  const ordered = reverse ? records.slice().reverse() : records;
  const html = cards.printHtml(
    design,
    side,
    ordered.map((r) => cards.elementValues(model, cat, design.sides[side], r)),
    { imageUrl: cardImageUrl(design.sides[side]), withImage: !!pdf, fonts: cardFontFaces() }
  );
  const file = path.join(os.tmpdir(), `membermanager-cards-${randomUUID()}.html`);
  fs.writeFileSync(file, html, "utf8");
  // Its only script is the shrink-to-fit in lib/cards.js; every value in it is escaped.
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: true, sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(file);
    // The page has its fonts and has shrunk what doesn't fit (lib/cards.js).
    await win.webContents.executeJavaScript("new Promise((resolve) => { const check = () => (document.body.dataset.ready ? resolve() : setTimeout(check, 20)); check(); })");
    if (pdf) {
      const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: "none" } });
      const pdfFile = path.join(os.tmpdir(), `${design.name.replace(/[^\w -]+/g, "")} ${side} ${randomUUID().slice(0, 8)}.pdf`);
      fs.writeFileSync(pdfFile, data);
      await shell.openPath(pdfFile);
      return { cards: records.length, pdf: pdfFile };
    }
    const { w, h } = cards.cardSize(design.orientation);
    const printer = store.getSettings().cardPrinter || "";
    // Asked for outright: some Windows drivers tell Chromium a resolution of
    // 0 or less, and it then falls back to a low default, which prints soft
    // text. 0 here means the printer's own default.
    const dpi = cardDpi();
    const printed = await new Promise((resolve, reject) =>
      win.webContents.print(
        {
          silent: !!printer,
          ...(dpi ? { dpi: { horizontal: dpi, vertical: dpi } } : {}),
          deviceName: printer || undefined,
          printBackground: true,
          margins: { marginType: "none" },
          landscape: design.orientation === "landscape",
          pageSize: { width: Math.round(Math.min(w, h) * 1000), height: Math.round(Math.max(w, h) * 1000) },
        },
        (ok, reason) => (ok || /cancel/i.test(reason || "") ? resolve(ok) : reject(new Error(`The card printer said: ${reason}`)))
      )
    );
    return { cards: printed ? records.length : 0 };
  } finally {
    win.destroy();
    fs.rmSync(file, { force: true });
  }
});

// ---------------------------------------------------------------------------
// FundTrack's exports
// ---------------------------------------------------------------------------
// The whole membership from FundTrack's weekly exports (lib/fundTrack.js):
// every household on every plan, active or not, with everyone in it, and the
// churches' details -- for finding anyone (the Find, Lists and Near ZIP
// pages). Households come in the way the membership export always has (heads
// matched by Member ID; a household new to the list on the Medical Aid & Alms
// Plan gets Our Health by mail, others get nothing), and re-importing a newer
// export updates everyone in place.

const FUNDTRACK_TABLE_NAMES = Object.fromEntries(Object.entries(fundTrack.TABLES).map(([key, t]) => [key, t.name]));

// Where the exports usually are: an "exports" folder in the archive library
// synced beside the AB Apps folder's library, unless one was chosen.
function guessExportsFolder() {
  const saved = store.getSettings().fundTrackFolder;
  if (saved && fs.existsSync(saved)) return saved;
  const start = abIdentity?.dataDir;
  if (!start) return null;
  let dir = path.dirname(start);
  for (let up = 0; up < 3 && dir && dir !== path.dirname(dir); up++, dir = path.dirname(dir)) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const candidate = path.join(dir, name, "exports");
        if (/archive/i.test(name) && fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // not readable; look further up
    }
  }
  return null;
}

// Files are recognized by their columns, whatever they're called
// (lib/fundTrack.js, scanExports). A file chosen for a table on the Import
// page is kept for that folder on this computer until it's set back to the
// newest.
function fundTrackChoices(folder) {
  const saved = store.getSettings().fundTrackChoices;
  return saved && folder && samePath(saved.folder || "", folder) ? saved.files || {} : {};
}

// Raw exports hold Social Security and health columns MemberManager never
// keeps; in the shared AB Apps folder, everyone it's shared with could open them.
const insideAbApps = (folder) => {
  const shared = abIdentity?.dataDir;
  if (!folder || !shared) return false;
  const rel = path.relative(path.resolve(shared), path.resolve(folder));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

function fundTrackStatus(folder) {
  if (!folder || !fs.existsSync(folder)) return { folder: folder || null, found: {}, files: [], unknown: [], ignored: [], missing: Object.values(FUNDTRACK_TABLE_NAMES), insideAbApps: false };
  const { found, files, unknown, ignored } = fundTrack.scanExports(folder, fundTrackChoices(folder));
  const missing = Object.entries(FUNDTRACK_TABLE_NAMES)
    .filter(([key]) => !found[key])
    .map(([, name]) => name);
  return { folder, found, files, unknown, ignored, missing, insideAbApps: insideAbApps(folder) };
}

const fundTrackSummary = (folder) => ({
  ...fundTrackStatus(folder),
  lastImport: store.getSettings().fundTrackImport || null,
});

ipcMain.handle("fundtrack:status", async () => fundTrackSummary(guessExportsFolder()));

// Uses `file` for `table` (or, with none, the newest again).
ipcMain.handle("fundtrack:choose", async (event, table, file) => {
  const folder = guessExportsFolder();
  if (!folder || !FUNDTRACK_TABLE_NAMES[table]) return fundTrackSummary(folder);
  const files = { ...fundTrackChoices(folder) };
  if (file) {
    const known = fundTrack.scanExports(folder).files.find((f) => f.file === file);
    if (!known) throw new Error(`${file} isn't in ${folder} any more.`);
    if (known.table !== table) throw new Error(`${file} has the columns of ${FUNDTRACK_TABLE_NAMES[known.table]}, not ${FUNDTRACK_TABLE_NAMES[table]}.`);
    files[table] = file;
  } else delete files[table];
  store.updateSettings({ fundTrackChoices: { folder, files } });
  return fundTrackSummary(folder);
});

ipcMain.handle("fundtrack:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Choose the folder FundTrack's exports are saved in", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  store.updateSettings({ fundTrackFolder: result.filePaths[0] });
  return fundTrackSummary(result.filePaths[0]);
});

function readFundTrack(folder) {
  const status = fundTrackStatus(folder);
  for (const key of ["groups", "individuals"]) {
    if (!status.found[key]) throw new Error(`There's no ${FUNDTRACK_TABLE_NAMES[key]} export in ${folder || "the exports folder"}.`);
  }
  const read = (key) => (status.found[key] ? fundTrack.readExport(path.join(folder, status.found[key].file)) : { headers: [], rows: [] });
  const groups = read("groups");
  // A household with no Member ID (GroupCode) can't be found again next time,
  // so it would be added again and again: it's left out, and counted.
  const withCode = groups.rows.filter((r) => String(r.GroupCode || "").trim());
  return {
    status,
    groups: { ...groups, rows: withCode },
    noMemberId: groups.rows.length - withCode.length,
    individuals: read("individuals"),
    orgs: read("orgs"),
    contacts: read("contacts"),
    addresses: read("addresses"),
  };
}

// Where each table's columns go: into the office's field of the same name, or
// the one chosen on the Import page (lib/fundTrack.js, "the office's fields").
function fundTrackColumns(data, fields) {
  const saved = store.getSettings().fundTrackFieldMap || {};
  return Object.fromEntries(Object.keys(fundTrack.FIELD_LEVELS).map((table) => [table, fundTrack.fieldColumns(table, data[table].headers, fields, saved[table])]));
}

// The households' import (lib/listImport.js), set up for MemberGroups: the
// membership export's mapping, plus the columns that go into fields -- a
// person field on the account's head, a household field on its address.
// `rows` are MemberGroups' rows with those columns as the fields read them.
function fundTrackHouseholdImport(groups, columns, fields, plan, publications) {
  const preset = membershipPreset(groups.headers, groups.rows, publications);
  if (!preset) throw new Error("The MemberGroups export doesn't have the columns MemberManager expects (GroupCode, MemberGroupUID, PrimaryAddressLine1, statusTerm, fundName).");
  const mapping = withoutSensitive({
    ...preset.mapping,
    ...Object.fromEntries(columns.filter((c) => c.fieldId).map((c) => [c.header, `field:${c.fieldId}`])),
  });
  const base = { ...preset.options, mode: "person", defaultCopies: "1", addInactive: true, sourceBatch: `FundTrack ${new Date().toLocaleDateString()}` };
  return {
    mapping,
    rows: fundTrack.cleanRows(groups.rows, columns, new Map(fields.map((f) => [f.id, f]))),
    // The newsletter plan's households can get Our Health; everyone else's are only kept.
    passes: [
      { ...base, only: { column: PLAN_COLUMN, value: plan } },
      { ...base, only: { column: PLAN_COLUMN, value: plan, not: true }, publicationIds: [] },
    ],
  };
}

// For the Import page's "Remap fields": each table's columns, where they go
// and a few of their values; the fields no column fills; and the values that
// don't fit their field.
function fundTrackFieldMap(data, columns, fields) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const brief = (f) => ({ id: f.id, label: f.label, appliesTo: f.appliesTo, type: f.type });
  const tables = Object.keys(fundTrack.FIELD_LEVELS).filter((table) => data[table].headers.length);
  const filled = new Set(tables.flatMap((table) => columns[table].map((c) => c.fieldId).filter(Boolean)));
  return {
    tables: tables.map((table) => ({
      table,
      name: FUNDTRACK_TABLE_NAMES[table],
      columns: columns[table].map((c) => ({ ...c, samples: listImport.sampleValues(data[table].rows, c.header, 3) })),
      fields: fundTrack.fieldsFor(table, fields).map(brief),
      unreadable: fundTrack.unreadableValues(data[table].rows, columns[table], byId),
    })),
    unfilled: fields.filter((f) => !filled.has(f.id) && tables.some((t) => fundTrack.FIELD_LEVELS[t].includes(f.appliesTo))).map(brief),
  };
}

// Sends one of an export's columns into a field (`fieldId`), into none (""),
// or back to going by its name (null). Kept for every import after.
ipcMain.handle("fundtrack:map-column", async (event, table, header, fieldId) => {
  const levels = fundTrack.FIELD_LEVELS[table];
  if (!levels || typeof header !== "string" || !header) throw new Error("That column can't go into a field.");
  if (fieldId) {
    const field = store.get("fields", fieldId);
    if (!field) throw new Error("That field is no longer there.");
    if (!levels.includes(field.appliesTo)) throw new Error(`${FUNDTRACK_TABLE_NAMES[table]}'s columns can't fill a field for ${Fields.levelLabel(field.appliesTo).toLowerCase()}s.`);
  }
  const all = store.getSettings().fundTrackFieldMap || {};
  const mine = { ...(all[table] || {}) };
  if (fieldId === null || fieldId === undefined) delete mine[header];
  else mine[header] = fieldId || "";
  store.updateSettings({ fundTrackFieldMap: { ...all, [table]: mine } });
  return true;
});

ipcMain.handle("fundtrack:preview", async () => {
  const folder = guessExportsFolder();
  const data = readFundTrack(folder);
  const fields = store.list("fields");
  const columns = fundTrackColumns(data, fields);
  const list = loadList();
  const { mapping, passes, rows } = fundTrackHouseholdImport(data.groups, columns.groups, fields, DEFAULT_PLAN, list.publications);
  const existing = importExisting(list);
  const missingPeople = new Set(data.groups.rows.map((r) => String(r.MemberGroupUID || "").trim()));
  const [a, b] = passes.map((options) => listImport.planImport(rows, mapping, options, existing, list.publications, fields).stats);
  const plans = new Map();
  for (const row of data.groups.rows) plans.set(row[PLAN_COLUMN], (plans.get(row[PLAN_COLUMN]) || 0) + 1);
  const linked = new Set(list.contacts.filter((c) => c.fundTrackId).map((c) => c.fundTrackId));
  return {
    ...fundTrackSummary(folder),
    households: data.groups.rows.length,
    householdsWithoutMemberId: data.noMemberId,
    people: data.individuals.rows.length,
    peopleLinked: data.individuals.rows.filter((r) => linked.has(String(r.MemberIndividualUUID || "").trim())).length,
    // People whose household isn't in the MemberGroups export (exported on another day, say).
    peopleWithoutHousehold: data.individuals.rows.filter((r) => !missingPeople.has(String(r.MemberGroupUID || "").trim())).length,
    mixedDates: fundTrack.mixedDates(data.status.found),
    churches: data.orgs.rows.length,
    plans: [...plans].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
    householdStats: {
      added: a.added + b.added,
      updated: a.updated + b.updated,
      unchanged: a.unchanged + b.unchanged,
      inactiveStopped: a.inactiveStopped + b.inactiveStopped,
      ambiguous: a.ambiguous + b.ambiguous,
    },
    fieldMap: fundTrackFieldMap(data, columns, fields),
  };
});

ipcMain.handle("fundtrack:commit", async () => {
  const folder = guessExportsFolder();
  const data = readFundTrack(folder);
  const now = new Date().toISOString();
  const batch = `FundTrack ${new Date().toLocaleDateString()}`;
  const fields = store.list("fields");
  const columns = fundTrackColumns(data, fields);

  // 1. Households and their heads.
  const { mapping, passes, rows } = fundTrackHouseholdImport(data.groups, columns.groups, fields, DEFAULT_PLAN, store.list("publications"));
  const householdStats = { added: 0, updated: 0, unchanged: 0, inactiveStopped: 0, ambiguous: 0 };
  for (const options of passes) {
    const list = loadList();
    const plan = listImport.planImport(rows, mapping, options, importExisting(list), list.publications, fields);
    applyImportPlan(plan, list);
    for (const key of Object.keys(householdStats)) householdStats[key] += plan.stats[key] || 0;
  }

  // 2. Each account's FundTrack id and details, on its head (found by Member ID).
  const memberKey = (id) => String(id || "").toUpperCase().replace(/[\s-]/g, "");
  let list = loadList();
  const headByMemberId = new Map(list.contacts.filter((c) => c.memberId).map((c) => [memberKey(c.memberId), c]));
  const headPatches = new Map();
  const headOf = new Map(); // FundTrack household id -> { householdId, orgId, headId }
  for (const row of data.groups.rows) {
    const head = headByMemberId.get(memberKey(row.GroupCode));
    if (!head) continue;
    let householdId = head.householdId && list.householdById.has(head.householdId) ? head.householdId : null;
    const info = fundTrack.accountDetails(row, columns.groups);
    if (!householdId) {
      // A head with no address yet still needs a household for everyone else in their account.
      householdId = store.insert("households", { ...BLANK_HOUSEHOLD, createdAt: now, updatedAt: now }).id;
      headPatches.set(head.id, { ...info, householdId });
    } else headPatches.set(head.id, info);
    headOf.set(info.fundTrackGroupId, { householdId, orgId: head.orgId || null, headId: head.id });
  }
  const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  store.updateWhere("contacts", (c) => {
    const patch = headPatches.get(c.id);
    if (!patch || Object.entries(patch).every(([key, value]) => sameJson(c[key], value))) return null;
    return { ...patch, updatedAt: now };
  });

  // 3. Everyone in each household.
  list = loadList();
  const people = fundTrack.planPeople(data.individuals.rows, list.contacts, (groupUid) => headOf.get(groupUid) || null, columns.individuals, fields, { sourceBatch: batch });
  store.insertMany("contacts", people.inserts.map((c) => ({ ...BLANK_CONTACT, ...c, createdAt: now, updatedAt: now })));
  const personPatches = new Map(people.updates.map((u) => [u.id, u.patch]));
  store.updateWhere("contacts", (c) => (personPatches.has(c.id) ? { ...personPatches.get(c.id), updatedAt: now } : null));

  // 4. The churches.
  list = loadList();
  const orgs = fundTrack.planOrgs(data.orgs.rows, data.contacts.rows, data.addresses.rows, list.orgs, columns.orgs, fields, {
    sourceBatch: batch,
    merged: listImport.mergedOrgs(store.list("retired"), list.orgs),
  });
  store.insertMany("orgs", orgs.inserts.map((o) => ({ ...BLANK_ORG, ...o, createdAt: now, updatedAt: now })));
  const orgPatches = new Map(orgs.updates.map((u) => [u.id, u.patch]));
  store.updateWhere("orgs", (o) => (orgPatches.has(o.id) ? { ...orgPatches.get(o.id), updatedAt: now } : null));

  const dated = Object.values(data.status.found)
    .map((f) => f.date)
    .sort()
    .pop();
  store.updateSettings({ fundTrackImport: { at: now, dated, by: shownName(), folder } });
  dataChanged(null);
  return { households: householdStats, people: people.stats, churches: orgs.stats, linkedHouseholds: headOf.size, householdRows: data.groups.rows.length, householdsWithoutMemberId: data.noMemberId };
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

ipcMain.handle("dialog:pick-import-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select a list to import",
    filters: [{ name: "Spreadsheets", extensions: ["csv", "tsv", "xlsx", "xls"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// An import reads from a file ({ kind: "file", filePath }) or the signup
// form ({ kind: "signup", includeImported }). Either way it comes out as
// { headers, rows }, and everything after that is the same.
//
// The import page re-plans on every mapping change, so the last file read
// is kept until it changes on disk, and signups are fetched once, when the
// source is chosen, and kept for that import.
let parsedFileCache = null;
let signupCache = null;

function readImportSource(source) {
  if (source.kind === "signup") {
    if (!signupCache) throw new Error("Get the signups again -- the ones fetched earlier are no longer loaded.");
    return signupCache;
  }
  if (source.kind === "formtracker") return formTrackerTable(source.folder);
  const { mtimeMs } = fs.statSync(source.filePath);
  if (parsedFileCache?.filePath !== source.filePath || parsedFileCache.mtimeMs !== mtimeMs) {
    parsedFileCache = { filePath: source.filePath, mtimeMs, parsed: listImport.parseFile(source.filePath) };
  }
  return parsedFileCache.parsed;
}

ipcMain.handle("import:preview", async (event, source) => {
  let label;
  if (source.kind === "signup") {
    const connection = gfConnection();
    if (!connection.siteUrl || !connection.formId) throw new Error("Set up the signup form in Settings first.");
    const afterId = source.includeImported ? 0 : store.getSettings().gfLastImportedEntryId || 0;
    const [form, entries] = await Promise.all([gravityForms.fetchForm(connection), gravityForms.fetchEntries(connection, afterId)]);
    signupCache = { ...gravityForms.entriesToTable(form, entries), maxEntryId: Math.max(0, ...entries.map((e) => Number(e.id) || 0)) };
    label = `Signup form ${new Date().toLocaleDateString()}`;
  } else if (source.kind === "formtracker") {
    label = "FormTracker contacts";
  } else {
    label = path.basename(source.filePath);
  }
  const { headers, rows } = readImportSource(source);
  const publications = store.list("publications");
  const fields = store.list("fields");
  // The membership software's export comes set up as the office decided (lib/membership.js).
  const membership = source.kind === "file" ? membershipPreset(headers, rows, publications) : null;
  return {
    headers,
    totalRows: rows.length,
    samples: Object.fromEntries(headers.map((h) => [h, listImport.sampleValues(rows, h, 3)])),
    // What kind of field each column would make, from more of its values.
    typeGuesses: Object.fromEntries(headers.map((h) => [h, Fields.guessType(listImport.sampleValues(rows, h, 60))])),
    mapping: withoutSensitive(matchFields(headers, membership ? membership.mapping : listImport.guessMapping(headers, rows, publications), fields)),
    membership,
    targets: listImport.importTargets(publications, fields),
    fields,
    // Identity and health columns can't be imported or made into fields.
    sensitive: headers.filter(isSensitive),
    deliveryDefaults: listImport.DELIVERY_DEFAULTS,
    publications,
    defaultBatchName: label,
  };
});

// A column headed with a field's name goes to that field ("Over 65" to the
// Over 65 field, "SocialSecurityExempt" to Social Security Exempt), unless
// it's already going somewhere -- one of the built-in ones, say.
function matchFields(headers, mapping, fields) {
  const out = { ...mapping };
  const used = new Set(Object.values(out));
  for (const header of headers) {
    if (out[header]) continue;
    const key = fundTrack.labelKey(header);
    const field = fields.find((f) => fundTrack.labelKey(f.label) === key && !used.has(`field:${f.id}`));
    if (field) {
      out[header] = `field:${field.id}`;
      used.add(`field:${field.id}`);
    }
  }
  return out;
}

// Identity and health columns (lib/sensitiveColumns.js) are never brought
// in, whatever the Import page sent.
function withoutSensitive(mapping) {
  return Object.fromEntries(Object.entries(mapping || {}).map(([header, target]) => [header, isSensitive(header) ? "" : target]));
}

// What an import plans against: the list, and the names of organizations
// merged into others, so a merged one isn't brought back
// (listImport.mergedOrgs).
function importExisting(list) {
  return { contacts: list.contacts, households: list.households, orgs: list.orgs, orgAliases: listImport.mergedOrgs(store.list("retired"), list.orgs).byName };
}

function planImport(source, mapping, options) {
  const { rows } = readImportSource(source);
  const list = loadList();
  return listImport.planImport(
    rows,
    withoutSensitive(mapping),
    options,
    importExisting(list),
    list.publications,
    store.list("fields")
  );
}

ipcMain.handle("import:plan", async (event, source, mapping, options) => {
  const { stats, matches, ambiguousNames, noAddressNames, contactInserts, after } = planImport(source, mapping, options);
  // New contacts the duplicate checker would flag once they're in --
  // usually the same person under a nickname or with a different email.
  const newIds = new Set(contactInserts.map((c) => c.id));
  const { duplicates: groups } = duplicates.findDuplicates(after.contacts, after.households, after.orgs, dismissedPairs());
  const possibleDuplicates = groups.filter((g) => g.ids.some((id) => newIds.has(id))).length;
  return { stats, ambiguousNames, noAddressNames, possibleDuplicates, matches: matches.filter((m) => m.changedFields.length).slice(0, 200) };
});

// Writes what an import planned (listImport.planImport); `before` is the list
// it was planned on.
function applyImportPlan(plan, before) {
  const now = new Date().toISOString();
  const stamp = (rows, blank) => rows.map((row) => ({ ...blank, ...row, createdAt: now, updatedAt: now }));
  const patchAll = (collection, updates) => {
    const patches = new Map(updates.map((u) => [u.id, u.patch]));
    store.updateWhere(collection, (row) => (patches.has(row.id) ? { ...patches.get(row.id), updatedAt: now } : null));
  };
  store.insertMany("orgs", stamp(plan.orgInserts, BLANK_ORG));
  patchAll("orgs", plan.orgUpdates);
  store.insertMany("households", stamp(plan.householdInserts, BLANK_HOUSEHOLD));
  patchAll("households", plan.householdUpdates);
  patchAll("contacts", plan.contactUpdates);
  store.insertMany("contacts", stamp(plan.contactInserts, BLANK_CONTACT));
  retirePlaces("household", emptyHouseholds(plan.householdDeletes), null, before);
}

ipcMain.handle("import:commit", async (event, source, mapping, options) => {
  const plan = planImport(source, mapping, options);
  applyImportPlan(plan, loadList());
  if (source.kind === "signup" && signupCache?.maxEntryId) {
    store.updateSettings({ gfLastImportedEntryId: Math.max(store.getSettings().gfLastImportedEntryId || 0, signupCache.maxEntryId) });
  }
  return plan.stats;
});

// ---------------------------------------------------------------------------
// The member list (people, households and organizations)
// ---------------------------------------------------------------------------

ipcMain.handle("list:get", async () => {
  const list = loadList();
  return { contacts: list.contacts, households: list.households, orgs: list.orgs, publications: list.publications, fields: store.list("fields") };
});

ipcMain.handle("contacts:create", async () =>
  store.insert("contacts", { ...BLANK_CONTACT, sourceBatch: "Added by hand", updatedAt: new Date().toISOString() })
);

ipcMain.handle("orgs:create", async () => store.insert("orgs", { ...BLANK_ORG, sourceBatch: "Added by hand", updatedAt: new Date().toISOString() }));

// Gives someone with no address a household of their own, so an address or
// a mailed newsletter can be filled in for them.
ipcMain.handle("households:create-for", async (event, contactId) => {
  const contact = store.get("contacts", contactId);
  if (!contact) throw new Error("Contact not found.");
  if (contact.householdId && store.get("households", contact.householdId)) throw new Error("They already have an address.");
  const now = new Date().toISOString();
  const household = store.insert("households", { ...BLANK_HOUSEHOLD, updatedAt: now });
  return { household, contact: store.update("contacts", contactId, { householdId: household.id, updatedAt: now }) };
});

// Takes [{ kind: "contact" | "household" | "org", id, patch }] -- one cell
// edit, a paste across many cells, a bulk change, or an undo -- in one save
// per collection. A person's Organization comes as a name (`orgName`): it
// links them to the organization of that name, starting one if there isn't
// one yet, or unlinks them when blank. Returns the saved rows, so the page
// shows exactly what was stored.
ipcMain.handle("list:update", async (event, changes) => {
  const now = new Date().toISOString();
  const publicationIds = new Set(store.list("publications").map((p) => p.id));
  const fieldDefs = new Map(store.list("fields").map((f) => [f.id, f]));
  const byKind = { contact: new Map(), household: new Map(), org: new Map() };
  for (const change of changes || []) {
    const patches = byKind[change.kind];
    if (!patches) continue;
    const clean = sanitizePatch(change.kind, change.patch, publicationIds, fieldDefs);
    const prior = patches.get(change.id) || {};
    patches.set(change.id, {
      ...prior,
      ...clean,
      ...(prior.subs || clean.subs ? { subs: mergeSubs(prior.subs, clean.subs) } : {}),
      ...(prior.fields || clean.fields ? { fields: { ...(prior.fields || {}), ...(clean.fields || {}) } } : {}),
    });
  }

  const createdOrgs = [];
  if ([...byKind.contact.values()].some((p) => "orgName" in p)) {
    const orgs = store.list("orgs");
    for (const patch of byKind.contact.values()) {
      if (!("orgName" in patch)) continue;
      const name = patch.orgName;
      delete patch.orgName;
      let org = name ? findOrgByName(orgs, name) : null;
      if (name && !org) {
        org = store.insert("orgs", { ...BLANK_ORG, name, sourceBatch: "Added by hand", updatedAt: now });
        orgs.push(org);
        createdOrgs.push(org);
      }
      patch.orgId = org ? org.id : null;
    }
  }
  for (const [id, patch] of byKind.org) {
    if ("name" in patch && !patch.name) throw new Error("An organization needs a name.");
    const other = "name" in patch && findOrgByName(store.list("orgs").filter((o) => o.id !== id), patch.name);
    if (other) throw new Error(`There's already an organization called "${other.name}". To fold one into the other, use Merge on the Duplicates page.`);
  }

  const collections = { contact: "contacts", household: "households", org: "orgs" };
  const saved = {};
  for (const [kind, patches] of Object.entries(byKind)) {
    if (patches.size) {
      store.updateWhere(collections[kind], (row) => {
        const patch = patches.get(row.id);
        if (!patch || !Object.keys(patch).length) return null;
        return {
          ...patch,
          ...(patch.subs ? { subs: mergeSubs(row.subs, patch.subs) } : {}),
          ...(patch.fields ? { fields: mergeFields(row.fields, patch.fields) } : {}),
          updatedAt: now,
        };
      });
    }
    saved[collections[kind]] = store.list(collections[kind]).filter((row) => patches.has(row.id));
  }
  saved.orgs.push(...createdOrgs);
  return saved;
});

// Anyone deleted is recorded as retired, so SendNewsletters and FormTracker
// drop them from mailings that haven't gone to them yet and keep a copy for
// ones that have; an address nobody lives at any more goes the same way.
ipcMain.handle("contacts:delete-many", async (event, ids) => {
  const idSet = new Set(ids || []);
  const before = loadList();
  const deleted = new Map(before.contacts.filter((c) => idSet.has(c.id)).map((c) => [c.id, c]));
  retire("contact", new Set(deleted.keys()), null, before);
  const theirHouseholds = new Set([...deleted.values()].map((c) => c.householdId).filter(Boolean));
  const left = (householdId) => store.list("contacts").some((c) => c.householdId === householdId && !deleted.has(c.id));
  retirePlaces("household", new Set([...theirHouseholds].filter((h) => !left(h))), null, before);
  const removed = store.removeWhere("contacts", (c) => deleted.has(c.id));
  return { removed };
});

// Their members stay on the list, just no longer part of it.
ipcMain.handle("orgs:delete-many", async (event, ids) => {
  const idSet = new Set(ids || []);
  retirePlaces("org", idSet);
  store.updateWhere("contacts", (c) => (idSet.has(c.orgId) ? { orgId: null, updatedAt: new Date().toISOString() } : null));
  return { removed: idSet.size };
});

// Each field's value from the first record that has one -- the kept one
// comes first.
function combineFields(records) {
  const combined = {};
  for (const record of records) {
    for (const [id, value] of Object.entries(record.fields || {})) if (!(id in combined)) combined[id] = value;
  }
  return combined;
}

// Per newsletter: on if any of them had it, and the most copies any had.
function combineSubs(records) {
  const combined = {};
  for (const record of records) {
    for (const [pubId, s] of Object.entries(record.subs || {})) {
      const c = (combined[pubId] = combined[pubId] || {});
      if (s.email) c.email = true;
      if (s.mail) c.mail = true;
      if (s.copies !== undefined) c.copies = Math.max(Number(c.copies) || 0, Number(s.copies) || 0);
    }
  }
  return combined;
}

// Puts everyone in the given households (and any given people who have no
// address yet) into one household, so the address gets one bundle. The one
// kept is the one with the most people, then the most complete address; it
// gets each newsletter by mail if any of them did, with the most copies.
function combineHouseholds({ contactIds = [], householdIds = [] }) {
  const list = loadList();
  const people = contactIds.map((id) => list.contactById.get(id)).filter(Boolean);
  const ids = new Set([...householdIds, ...people.map((c) => c.householdId)].filter((id) => list.householdById.has(id)));
  if (!ids.size) throw new Error("None of them has an address to share.");
  const candidates = [...ids].map((id) => list.householdById.get(id));
  const completeness = (h) => rules.ADDRESS_FIELDS.filter((f) => h[f]).length;
  const keep = [...candidates].sort(
    (a, b) =>
      (list.membersOf.get(b.id)?.length || 0) - (list.membersOf.get(a.id)?.length || 0) ||
      completeness(b) - completeness(a) ||
      new Date(a.createdAt) - new Date(b.createdAt)
  )[0];
  const others = new Set([...ids].filter((id) => id !== keep.id));
  const now = new Date().toISOString();
  store.update("households", keep.id, { subs: combineSubs(candidates), fields: combineFields([keep, ...candidates]), updatedAt: now });
  retirePlaces("household", others, keep.id);
  const moving = new Set(people.filter((c) => !list.householdById.has(c.householdId)).map((c) => c.id));
  store.updateWhere("contacts", (c) => (others.has(c.householdId) || moving.has(c.id) ? { householdId: keep.id, updatedAt: now } : null));
  return keep.id;
}

ipcMain.handle("households:combine", async (event, selection) => {
  combineHouseholds(selection);
  return true;
});

// Gives each of these people a household of their own at a copy of the same
// address -- they were grouped by mistake, or one has a separate apartment
// to fill in. It gets the same newsletters by mail, one copy each.
// Remembered, so they aren't suggested as one household again.
ipcMain.handle("households:separate", async (event, contactIds) => {
  const list = loadList();
  const now = new Date().toISOString();
  let separated = 0;
  for (const id of contactIds || []) {
    const contact = list.contactById.get(id);
    const household = contact && list.householdById.get(contact.householdId);
    if (!household || (list.membersOf.get(household.id) || []).length < 2) continue;
    const subs = Object.fromEntries(Object.entries(household.subs || {}).filter(([, s]) => s.mail).map(([pubId]) => [pubId, { mail: true, copies: 1 }]));
    const own = store.insert("households", {
      ...BLANK_HOUSEHOLD,
      ...Object.fromEntries(rules.ADDRESS_FIELDS.map((f) => [f, household[f]])),
      subs,
      fields: { ...(household.fields || {}) },
      updatedAt: now,
    });
    store.update("contacts", id, { householdId: own.id, updatedAt: now });
    list.membersOf.set(household.id, list.membersOf.get(household.id).filter((m) => m.id !== id));
    dismissPairs("household", [household.id, own.id]);
    separated++;
  }
  return { separated };
});

// Column headers the importer recognizes, so an exported list can be edited
// in Excel and imported straight back. One row per person, with their
// household's address and mailed newsletters on each.
function publicationColumns(publications, { email = true, mail = true } = {}) {
  return publications.flatMap((p) => [...(email ? [`${p.name}: Email`] : []), ...(mail ? [`${p.name}: Mail`, `${p.name}: Copies`] : [])]);
}

function publicationCells(publications, emailRecord, mailRecord) {
  const cells = {};
  for (const p of publications) {
    if (emailRecord) cells[`${p.name}: Email`] = yesNo(rules.sub(emailRecord, p.id).email);
    if (mailRecord !== undefined) {
      const s = rules.sub(mailRecord, p.id);
      cells[`${p.name}: Mail`] = yesNo(s.mail);
      cells[`${p.name}: Copies`] = s.mail ? rules.copiesFor(mailRecord, p.id) : "";
    }
  }
  return cells;
}

const ADDRESS_COLUMNS = { "Address 1": "addressLine1", "Address 2": "addressLine2", City: "city", State: "state", ZIP: "zip" };
const addressCells = (place) => Object.fromEntries(Object.entries(ADDRESS_COLUMNS).map(([column, field]) => [column, place?.[field] || ""]));

// A field's values as export cells, headed with the field's name -- which an
// import of the file maps straight back to the field.
function fieldCells(fields, record) {
  return Object.fromEntries(fields.map((f) => [f.label, Fields.formatValue(f.type, record?.fields?.[f.id])]));
}

ipcMain.handle("contacts:export", async (event, ids) => {
  const idSet = new Set(ids || []);
  const list = loadList();
  const fields = store.list("fields");
  const personFields = fields.filter((f) => f.appliesTo === "contact");
  const householdFields = fields.filter((f) => f.appliesTo === "household");
  const columns = [
    "Name",
    "Member ID",
    "Member Status",
    "Organization",
    ...publicationColumns(list.publications),
    "Email Address",
    ...Object.keys(ADDRESS_COLUMNS),
    ...personFields.map((f) => f.label),
    ...householdFields.map((f) => f.label),
    "Source",
  ];
  const rows = list.contacts
    .filter((c) => idSet.has(c.id))
    .map((c) => {
      const h = list.householdById.get(c.householdId) || null;
      return {
        Name: c.name,
        "Member ID": c.memberId || "",
        "Member Status": c.memberStatus || "",
        Organization: list.orgById.get(c.orgId)?.name || "",
        ...publicationCells(list.publications, c, h),
        "Email Address": c.email,
        ...addressCells(h),
        ...fieldCells(personFields, c),
        ...fieldCells(householdFields, h),
        Source: c.sourceBatch,
      };
    });
  return saveTable(columns, rows, { title: "Export people", defaultName: "members-people", sheetName: "People" });
});

// For importing back with "Each row is an organization".
ipcMain.handle("orgs:export", async (event, ids) => {
  const idSet = new Set(ids || []);
  const list = loadList();
  const orgFields = store.list("fields").filter((f) => f.appliesTo === "org");
  const columns = [
    "Organization",
    "Attention",
    ...publicationColumns(list.publications),
    "Email Address",
    ...Object.keys(ADDRESS_COLUMNS),
    ...orgFields.map((f) => f.label),
    "Members",
    "Source",
  ];
  const rows = list.orgs
    .filter((o) => idSet.has(o.id))
    .map((o) => ({
      Organization: o.name,
      Attention: o.attn,
      ...publicationCells(list.publications, o, o),
      "Email Address": o.email,
      ...addressCells(o),
      ...fieldCells(orgFields, o),
      Members: (list.orgMembers.get(o.id) || []).length,
      Source: o.sourceBatch,
    }));
  return saveTable(columns, rows, { title: "Export organizations", defaultName: "members-organizations", sheetName: "Organizations" });
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

// Pairs marked "not duplicates" or "keep separate": { kind, key } rows.
function dismissedPairs() {
  return new Set(store.list("reviewDismissed").map((d) => d.key));
}

function dismissPairs(kind, ids) {
  const existing = dismissedPairs();
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = duplicates.pairKey(ids[i], ids[j]);
      if (!existing.has(key)) {
        existing.add(key);
        rows.push({ kind, key });
      }
    }
  }
  if (rows.length) store.insertMany("reviewDismissed", rows);
}

function currentReview() {
  const list = loadList();
  return { list, ...duplicates.findDuplicates(list.contacts, list.households, list.orgs, dismissedPairs()) };
}

ipcMain.handle("review:counts", async () => {
  const { duplicates: groups, sharedAddresses, orgDuplicates } = currentReview();
  return { duplicates: groups.length, sharedAddresses: sharedAddresses.length, orgDuplicates: orgDuplicates.length };
});

ipcMain.handle("review:list", async () => {
  const { list, duplicates: groups, sharedAddresses, orgDuplicates } = currentReview();
  const household = (id) => (list.householdById.has(id) ? describeHousehold(list.householdById.get(id), list.membersOf.get(id) || [], list) : null);
  const oldestFirst = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  return {
    publications: list.publications,
    duplicates: groups.map((g) => ({
      contacts: g.ids
        .map((id) => list.contactById.get(id))
        .sort(oldestFirst)
        .map((c) => ({ ...c, household: household(c.householdId), org: list.orgById.get(c.orgId) || null })),
      pairs: g.pairs,
    })),
    sharedAddresses: sharedAddresses.map((g) => ({ households: g.householdIds.map(household).filter(Boolean) })),
    orgDuplicates: orgDuplicates.map((g) => ({ orgs: g.ids.map((id) => describeOrg(list.orgById.get(id), list)).sort(oldestFirst), pairs: g.pairs })),
  };
});

ipcMain.handle("review:dismiss", async (event, kind, ids) => {
  dismissPairs(kind, ids || []);
  return true;
});

// Folds duplicate people into one. `values` are the name, email and
// organization picked on the Duplicates page; `householdId` is whose address
// to keep (or null for none). They keep every newsletter any of them got by
// email, and each field's value from the kept contact, or else from
// whichever of the others has one. The others are recorded as retired into
// the kept one, so mailings that went to any of them follow it.
ipcMain.handle("contacts:merge", async (event, { keepId, removeIds, values, householdId }) => {
  const list = loadList();
  const keep = list.contactById.get(keepId);
  const removing = (removeIds || []).filter((id) => id !== keepId && list.contactById.has(id));
  if (!keep || !removing.length) throw new Error("Those contacts are no longer on the list.");
  const group = [keep, ...removing.map((id) => list.contactById.get(id))];
  if (householdId && !group.some((c) => c.householdId === householdId)) throw new Error("That address isn't one of theirs.");
  const orgId = values.orgId && group.some((c) => c.orgId === values.orgId) ? values.orgId : null;
  const removeSet = new Set(removing);
  const now = new Date().toISOString();

  retire("contact", removeSet, keepId, list);
  const emailSubs = combineSubs(group.map((c) => ({ subs: Object.fromEntries(Object.entries(c.subs || {}).map(([id, s]) => [id, { email: !!s.email }])) })));
  store.update("contacts", keepId, {
    name: cleanText(values.name),
    email: cleanText(values.email),
    // The kept contact's Member ID, or the one any of the others had.
    memberId: keep.memberId || group.find((c) => c.memberId)?.memberId || "",
    memberStatus: keep.memberStatus || group.find((c) => c.memberStatus)?.memberStatus || "",
    fields: combineFields(group),
    orgId,
    householdId: householdId || null,
    subs: emailSubs,
    updatedAt: now,
  });
  const householdsBefore = new Set(group.map((c) => c.householdId).filter(Boolean));
  store.removeWhere("contacts", (c) => removeSet.has(c.id));
  retirePlaces("household", emptyHouseholds(householdsBefore), null, list);
  return true;
});

// Folds duplicate organizations into one: its name, attention line, email
// and address are the ones picked (`addressFrom` is whose address); it gets
// every newsletter any of them got, with the most copies any had; their
// members all belong to it now.
ipcMain.handle("orgs:merge", async (event, { keepId, removeIds, values, addressFrom }) => {
  const list = loadList();
  const keep = list.orgById.get(keepId);
  const removing = (removeIds || []).filter((id) => id !== keepId && list.orgById.has(id));
  if (!keep || !removing.length) throw new Error("Those organizations are no longer on the list.");
  const group = [keep, ...removing.map((id) => list.orgById.get(id))];
  const addressSource = group.find((o) => o.id === addressFrom) || keep;
  const removeSet = new Set(removing);
  const now = new Date().toISOString();
  retirePlaces("org", removeSet, keepId, list);
  store.update("orgs", keepId, {
    name: cleanText(values.name) || keep.name,
    attn: cleanText(values.attn),
    email: cleanText(values.email),
    ...Object.fromEntries(rules.ADDRESS_FIELDS.map((f) => [f, addressSource[f] || ""])),
    subs: combineSubs(group),
    fields: combineFields(group),
    updatedAt: now,
  });
  store.updateWhere("contacts", (c) => (removeSet.has(c.orgId) ? { orgId: keepId, updatedAt: now } : null));
  return true;
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
// The office's own fields on people, households and organizations (see
// lib/fields.js). Anyone can add one or rename it; changing its type keeps
// every value, so it's refused while any value wouldn't fit the new type.
// Removing one takes its values off every record, so while someone is signed
// in to AB Apps only a manager can.

const FIELD_COLLECTION = { contact: "contacts", household: "households", org: "orgs" };

ipcMain.handle("fields:list", async () => store.list("fields"));

ipcMain.handle("fields:add", async (event, input) => {
  const fields = store.list("fields");
  const clean = Fields.cleanDefinition(input, fields);
  if (isSensitive(clean.label)) throw new Error(`"${clean.label}" is identity or health information, which MemberManager doesn't keep.`);
  return store.insert("fields", clean);
});

ipcMain.handle("fields:update", async (event, id, input) => {
  const fields = store.list("fields");
  const field = fields.find((f) => f.id === id);
  if (!field) throw new Error("That field is no longer there.");
  const clean = Fields.cleanDefinition({ ...field, ...input, appliesTo: field.appliesTo }, fields, id);
  if (isSensitive(clean.label)) throw new Error(`"${clean.label}" is identity or health information, which MemberManager doesn't keep.`);
  if (clean.type !== field.type) {
    const collection = FIELD_COLLECTION[field.appliesTo];
    const converted = new Map();
    const unreadable = [];
    for (const row of store.list(collection)) {
      if (!row.fields || !(id in row.fields)) continue;
      const parsed = Fields.parseValue(clean.type, Fields.formatValue(field.type, row.fields[id]));
      if (parsed.error) unreadable.push(Fields.formatValue(field.type, row.fields[id]));
      else converted.set(row.id, parsed.blank ? null : parsed.value);
    }
    if (unreadable.length) {
      const examples = [...new Set(unreadable)].slice(0, 3).map((v) => `"${v}"`).join(", ");
      const type = Fields.TYPES.find((t) => t.value === clean.type).label;
      throw new Error(`${plural(unreadable.length, "value")} in ${field.label} can't be read as ${type} (${examples}). Change them first, or keep the field as it is.`);
    }
    const now = new Date().toISOString();
    store.updateWhere(collection, (row) => (converted.has(row.id) ? { fields: mergeFields(row.fields, { [id]: converted.get(row.id) }), updatedAt: now } : null));
  }
  return store.update("fields", id, clean);
});

ipcMain.handle("fields:remove", async (event, id) => {
  const field = store.get("fields", id);
  if (!field) return true;
  if (abIdentity && abIdentity.class !== "manager") throw new Error("Only a manager can remove a field, since it takes its values off everyone.");
  const now = new Date().toISOString();
  store.updateWhere(FIELD_COLLECTION[field.appliesTo], (row) => (row.fields && id in row.fields ? { fields: mergeFields(row.fields, { [id]: null }), updatedAt: now } : null));
  store.remove("fields", id);
  return true;
});

// Makes a household field each person's own: everyone gets their household's
// value (what the Members page already showed on their row), then the
// households' copies go. The field keeps its id, so its column, values and
// imports carry on under the same name. Saved lists of people and person
// card designs that used it are re-pointed to it; lists and cards of
// households no longer have it. Done in that order so a stop part way
// never loses a value: the people have theirs before the households' go.
ipcMain.handle("fields:to-people", async (event, id, options = {}) => {
  const fields = store.list("fields");
  const field = fields.find((f) => f.id === id);
  if (!field) throw new Error("That field is no longer there.");
  if (field.appliesTo !== "household") throw new Error(`${field.label} isn't a household field.`);
  Fields.cleanDefinition({ ...field, appliesTo: "contact" }, fields, id); // a person field of the same name already?
  const { people, stranded } = Fields.householdToPeople(id, store.list("households"), store.list("contacts"), { onlyMembers: !!options.onlyMembers });
  const now = new Date().toISOString();
  store.updateWhere("contacts", (c) => (people.has(c.id) ? { fields: mergeFields(c.fields, { [id]: people.get(c.id) }), updatedAt: now } : null));
  const moved = store.update("fields", id, { appliesTo: "contact" });
  store.updateWhere("households", (h) => (h.fields && id in h.fields ? { fields: mergeFields(h.fields, { [id]: null }), updatedAt: now } : null));

  const from = `hf.${id}`;
  const to = `pf.${id}`;
  const savedLists = store.getSettings().savedLists || [];
  const isPeopleList = (l) => (lists.KINDS[l.state?.kind] ? l.state.kind : "people") === "people";
  const usesIt = (l) => JSON.stringify(l.state || {}).includes(`"${from}"`);
  if (savedLists.some((l) => isPeopleList(l) && usesIt(l))) {
    store.updateSettings({ savedLists: savedLists.map((l) => (isPeopleList(l) && usesIt(l) ? { ...l, state: lists.renameKey(l.state, from, to) } : l)) });
  }
  store.updateWhere("cardTemplates", (design) => {
    if (design.cardFor !== "person" || !cards.SIDES.some((s) => design.sides?.[s]?.elements?.some((el) => el.key === from))) return null;
    const sides = { ...design.sides };
    for (const s of cards.SIDES) {
      if (sides[s]?.elements) sides[s] = { ...sides[s], elements: sides[s].elements.map((el) => (el.key === from ? { ...el, key: to } : el)) };
    }
    return { sides, updatedAt: now };
  });
  const householdUses = savedLists.filter((l) => !isPeopleList(l) && usesIt(l)).length +
    store.list("cardTemplates").filter((d) => d.cardFor !== "person" && cards.SIDES.some((s) => d.sides?.[s]?.elements?.some((el) => el.key === from))).length;
  return { field: moved, people: people.size, stranded, householdUses };
});

// Moves a field one place up (-1) or down (1) among those for the same
// level -- the order their columns appear in.
ipcMain.handle("fields:move", async (event, id, direction) => {
  store.mutate("fields", (fields) => {
    const field = fields.find((f) => f.id === id);
    if (!field) return fields;
    const same = fields.filter((f) => f.appliesTo === field.appliesTo);
    const at = same.indexOf(field);
    const swapWith = same[at + Math.sign(direction)];
    if (!swapWith) return fields;
    const next = fields.slice();
    const i = next.indexOf(field);
    const j = next.indexOf(swapWith);
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  return store.list("fields");
});

function plural(n, word) {
  return `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

ipcMain.handle("settings:get", async () => ({
  theme: savedTheme(),
  abApps: abIdentity ? { name: abIdentity.name, class: abIdentity.class } : null,
  memberColumns: store.getSettings().memberColumns || {},
}));

// How the Members page's columns are arranged on this computer, one tab at a
// time (lib/columnLayout.js); null puts that tab's columns back as usual.
ipcMain.handle("settings:set-member-columns", async (event, tab, layout) => {
  if (!["people", "orgs"].includes(tab)) throw new Error("Unknown tab.");
  if (layout !== null && !ColumnLayout.isLayout(layout)) throw new Error("That column layout couldn't be read.");
  const all = { ...(store.getSettings().memberColumns || {}) };
  if (layout) {
    const widths = Object.fromEntries(Object.entries(layout.widths || {}).map(([key, width]) => [key, ColumnLayout.clampWidth(width)]));
    all[tab] = { order: layout.order, pinned: layout.pinned, widths };
  }
  else delete all[tab];
  store.updateSettings({ memberColumns: all });
  return all;
});

// Applies right away.
ipcMain.handle("settings:set-theme", async (event, theme) => {
  if (!THEMES.includes(theme)) throw new Error("Unknown theme.");
  store.updateSettings({ theme });
  nativeTheme.themeSource = theme;
  return theme;
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

// Used instead of window.confirm(): on Windows, Electron's renderer-side
// confirm()/alert() leaves the page unable to take mouse input on form
// controls afterwards (dropdowns won't open, inputs won't focus) until the
// window is blurred and refocused. A native message box owned by the main
// process doesn't have that problem.
ipcMain.handle("dialog:confirm", async (event, message, okLabel) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: [okLabel || "OK", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message,
  });
  if (mainWindow) mainWindow.webContents.focus();
  return response === 0;
});

// A question with several answers: the index of the button chosen, or -1
// for Cancel (always the last button).
ipcMain.handle("dialog:choose", async (event, message, detail, buttons) => {
  const all = [...(buttons || []), "Cancel"];
  const { response } = await dialog.showMessageBox(mainWindow, { type: "question", buttons: all, defaultId: 0, cancelId: all.length - 1, noLink: true, message, detail: detail || undefined });
  if (mainWindow) mainWindow.webContents.focus();
  return response === all.length - 1 ? -1 : response;
});

ipcMain.handle("shell:open-path", async (event, filePath) => shell.openPath(filePath));
ipcMain.handle("clipboard:copy", async (event, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});
ipcMain.handle("app:get-version", async () => app.getVersion());

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------
// Driven entirely by the renderer's Settings page "Check for updates" button
// (and one automatic check at launch, see boot.js) -- never checks or
// downloads silently on its own beyond that, so nothing happens on the
// user's bandwidth/disk without a check having been triggered first.

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// Lets "Check for updates" actually hit GitHub when running unpacked (npm
// start), reading dev-app-update.yml instead of silently no-op'ing. Has no
// effect on a packaged build -- those always use the real app-update.yml
// electron-builder generates, regardless of this flag.
autoUpdater.forceDevUpdateConfig = true;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", status);
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", version: info.version }));
autoUpdater.on("update-not-available", () => sendUpdateStatus({ state: "not-available" }));
autoUpdater.on("download-progress", (progress) =>
  sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) })
);
autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", version: info.version }));
autoUpdater.on("error", (err) => sendUpdateStatus({ state: "error", message: err?.message || String(err) }));

ipcMain.handle("update:check", async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("update:download", async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
