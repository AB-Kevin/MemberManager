"use strict";

// Bringing in SendNewsletters' list: offered while the list is empty, and
// only done on the host.
function migrationPanel(sources) {
  if (sources.copiedFromSendNewsletters) {
    const c = sources.copiedFromSendNewsletters;
    return `<p class="hint" style="margin-top:0">SendNewsletters' list was brought in on ${escapeHtml(formatDate(c.at))} by ${escapeHtml(c.by || "someone")}, from ${escapeHtml(c.folder)}.</p>`;
  }
  if (!sources.listEmpty) {
    return `<p class="hint" style="margin-top:0">SendNewsletters' list can only be brought into an empty list. To add more people, use <a href="#" data-go="import">Import</a>.</p>`;
  }
  const sn = sources.sendNewsletters;
  const counts = (x) => `${plural(x.people, "person", "people")}, ${plural(x.households, "household")} and ${plural(x.orgs, "organization")}`;
  return `
    <p class="hint" style="margin-top:0">Start the member list from SendNewsletters' mailing list: everyone on it, their households and organizations, and who gets which newsletter,
      with the same records, so SendNewsletters' past mailings still point at the right people. Open SendNewsletters on its host computer first so everyone's
      latest changes are in it. SendNewsletters' own files aren't changed.</p>
    ${
      sn
        ? `<p>Found in the AB Apps folder: ${counts(sn)}${sn.newsletters.length ? `, getting ${sn.newsletters.map(escapeHtml).join(" and ")}` : ""}.</p>
           <div class="row"><button class="btn" id="copy-sn-btn" type="button" ${sources.isHost ? "" : "disabled"}>Bring in SendNewsletters' list</button>
           <button class="btn secondary" id="pick-sn-btn" type="button" ${sources.isHost ? "" : "disabled"}>Use another folder…</button></div>`
        : `<p class="hint">SendNewsletters' list isn't in the AB Apps folder. Choose the folder it uses (Settings → Data location in SendNewsletters).</p>
           <div class="row"><button class="btn" id="pick-sn-btn" type="button" ${sources.isHost ? "" : "disabled"}>Choose SendNewsletters' folder…</button></div>`
    }
    ${sources.isHost ? "" : `<p class="hint">Only the host computer can bring it in.</p>`}
    <p class="hint">FormTracker's contacts come in through <a href="#" data-go="import">Import</a>, matched by Member ID, so their extra columns can become fields.</p>`;
}

window.Pages.settings = {
  async render(container) {
    const settings = await window.api.getSettings();
    const gf = await window.api.getGfSettings();
    const sources = await window.api.migrationSources();
    const location = await window.api.getDataLocation();
    const team = await window.api.getTeamStatus();
    const version = await window.api.getVersion();

    container.innerHTML = `
      <h1>Settings</h1>
      <p class="subtitle">The member list FormTracker and SendNewsletters read, kept in the AB Apps folder. Signups come from a Gravity Forms form on the website,
        which a manager can set once for everyone in AB Apps.</p>

      <div class="panel">
        <h2 style="margin-top:0">Bring in SendNewsletters' list</h2>
        ${migrationPanel(sources)}
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Signup form (Gravity Forms)</h2>
        <p class="hint" style="margin-top:0">Lets the Import page bring in new signups. In WordPress, under Forms → Settings → REST API, turn the API on and
          add a key with read access; the site has to use https.</p>
        ${gf.shared ? `<p class="shared-note">Signups are read from the website a manager set in AB Apps, <strong>${escapeHtml(gf.shared.siteUrl)}</strong>,
          with its key. A manager changes it on AB Apps' Mail and website page.</p>
        <details class="own-settings"><summary>This computer's own website settings, used when AB Apps doesn't set one</summary>` : ""}
        <div class="row">
          <div class="field" style="flex:1">
            <label for="gf-site">Website address</label>
            <input type="url" id="gf-site" value="${escapeHtml(gf.siteUrl)}" placeholder="https://www.example.org" />
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label for="gf-key">Consumer key</label>
            <input type="text" id="gf-key" value="${escapeHtml(gf.consumerKey)}" />
          </div>
          <div class="field" style="flex:1">
            <label for="gf-secret">Consumer secret ${gf.hasSecret ? "(saved — leave blank to keep)" : ""}</label>
            <input type="password" id="gf-secret" placeholder="${gf.hasSecret ? "••••••••" : ""}" />
          </div>
        </div>
        ${gf.shared ? "</details>" : ""}
        <div class="row">
          <div class="field" style="flex:1">
            <label for="gf-form">Signup form</label>
            <select id="gf-form">${
              gf.formId ? `<option value="${escapeHtml(gf.formId)}">${escapeHtml(gf.formTitle || `Form ${gf.formId}`)}</option>` : '<option value="">Connect to see the forms</option>'
            }</select>
          </div>
          <button class="btn secondary" id="gf-connect-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Connect and list forms</button>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn" id="gf-save-btn" type="button">Save</button>
        </div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Data location</h2>
        <p class="hint" style="margin-top:0">The member list, its fields and newsletters are kept in this folder${
          location.folder?.reason === "ab-apps"
            ? " — MemberManager's subfolder of the AB Apps folder, which every computer finds by itself, and where FormTracker and SendNewsletters read it"
            : location.isDefault
            ? " on this computer"
            : ""
        }:</p>
        <div class="row">
          <code>${escapeHtml(location.dataDir)}</code>
          <button class="btn secondary" id="open-data-dir-btn" type="button">Open folder</button>
          ${location.folder?.reason === "ab-apps" ? "" : `<button class="btn secondary" id="change-data-dir-btn" type="button">Change…</button>`}
          ${location.isDefault || location.folder?.reason === "ab-apps" ? "" : `<button class="btn secondary" id="default-data-dir-btn" type="button">Use this computer's own folder</button>`}
        </div>
        ${
          location.folder?.reason === "not-moved"
            ? `<p class="shared-note">The member list belongs in the AB Apps folder, where every computer and the other apps find it by itself: <strong>${escapeHtml(location.folder.target)}</strong>.
          Moving it copies everything there; this folder is kept as it was, and every other computer switches over on its own.
          ${location.folder.canMove ? "" : "A manager can move it, on the host computer."}</p>
          ${location.folder.canMove ? `<div class="row"><button class="btn" id="move-data-btn" type="button">Move to the AB Apps folder</button></div>` : ""}`
            : ""
        }
        <p class="hint" ${location.folder?.reason === "own" ? "" : "hidden"}>FormTracker and SendNewsletters only find the list in the AB Apps folder: sign in to AB Apps to keep it there.
          To share one list between computers without AB Apps, choose the same folder on each of them — on OneDrive, say.</p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Sharing</h2>
        <p class="hint" style="margin-top:0">Several computers can work on the list at once from one shared folder. One of them is the host: it saves everyone's changes
          to the shared list, which is what FormTracker and SendNewsletters read. Everyone else's changes go to it, and show up on the other computers within seconds of OneDrive syncing.
          The host's app has to be open for changes to be saved; until it is, they wait safely on the computer that made them.</p>
        <div class="row" style="align-items:flex-end">
          <div class="field" style="flex:1;max-width:320px">
            <label for="team-name">Your name</label>
            <input type="text" id="team-name" value="${escapeHtml(team?.name || "")}" ${team?.abApps ? "disabled" : ""} />
            <p class="hint" id="team-name-hint">Shown to others using the same folder.</p>
          </div>
          <label class="check-label" style="margin-bottom:28px"><input type="checkbox" id="team-host" ${team?.isHost ? "checked" : ""} /> This computer is the host</label>
          <button class="btn" id="team-save-btn" type="button" style="margin-bottom:22px">Save</button>
        </div>
        <p id="team-summary"></p>
        <ul class="people-list hint" id="team-people"></ul>
        <p class="hint">If two computers are set as host, the one that has been host longer keeps the job and the other waits; when that one's app closes, the waiting one
          takes over. Changes are put in order by each computer's clock, so keep Windows' automatic time setting on.</p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Appearance</h2>
        <div class="field">
          <label>Theme</label>
          <select id="theme-select" style="align-self:flex-start">
            <option value="system" ${settings.theme === "system" ? "selected" : ""}>Match Windows</option>
            <option value="light" ${settings.theme === "light" ? "selected" : ""}>Light</option>
            <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>Dark</option>
          </select>
          <p class="hint">Applies right away. Match Windows follows Windows' own light/dark setting.</p>
        </div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Updates</h2>
        <p class="hint">You're running version ${escapeHtml(version)}.</p>
        <div id="update-action-area"></div>
      </div>
    `;

    qsa("[data-go]", container).forEach((link) =>
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(link.dataset.go);
      })
    );
    const copySendNewsletters = async (folder) => {
      try {
        const result = await window.api.copySendNewsletters(folder);
        if (!result.changed) return;
        toast(`Brought in ${plural(result.people, "person", "people")}, ${plural(result.households, "household")} and ${plural(result.orgs, "organization")}.`);
        navigate("contacts");
      } catch (err) {
        toast(err.message, true);
      }
    };
    qs("#copy-sn-btn", container)?.addEventListener("click", () => copySendNewsletters(sources.sendNewsletters.folder));
    qs("#pick-sn-btn", container)?.addEventListener("click", async () => {
      try {
        const picked = await window.api.pickOtherAppFolder("sendNewsletters");
        if (picked) await copySendNewsletters(picked.folder);
      } catch (err) {
        toast(err.message, true);
      }
    });

    function gfFields() {
      return {
        siteUrl: qs("#gf-site", container).value.trim(),
        consumerKey: qs("#gf-key", container).value.trim(),
        consumerSecret: qs("#gf-secret", container).value,
      };
    }
    qs("#gf-connect-btn", container).addEventListener("click", async () => {
      const btn = qs("#gf-connect-btn", container);
      btn.disabled = true;
      btn.textContent = "Connecting…";
      try {
        const forms = await window.api.listGfForms(gfFields());
        const select = qs("#gf-form", container);
        const current = select.value;
        select.innerHTML = forms.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title)}</option>`).join("") || '<option value="">No forms on this site</option>';
        if (forms.some((f) => f.id === current)) select.value = current;
        else {
          const signup = forms.find((f) => /sign\s*up|subscribe|newsletter/i.test(f.title));
          if (signup) select.value = signup.id;
        }
        toast(`Connected — ${plural(forms.length, "form")} found. Pick the signup form and save.`);
      } catch (err) {
        toast(`Couldn't connect: ${err.message}`, true);
      }
      btn.disabled = false;
      btn.textContent = "Connect and list forms";
    });
    qs("#gf-save-btn", container).addEventListener("click", async () => {
      const select = qs("#gf-form", container);
      try {
        await window.api.saveGfSettings({ ...gfFields(), formId: select.value, formTitle: select.selectedOptions[0]?.textContent || "" });
        toast("Signup form settings saved.");
      } catch (err) {
        toast(`Couldn't save: ${err.message}`, true);
      }
    });

    qs("#open-data-dir-btn", container).addEventListener("click", () => window.api.openPath(location.dataDir));
    // Changing it reloads the window on the new folder, so a toast after that
    // comes from boot.js.
    const moveData = async (fn) => {
      try {
        const result = await fn();
        if (!result.changed && result.message) toast(result.message);
      } catch (err) {
        toast(err.message, true);
      }
    };
    qs("#change-data-dir-btn", container)?.addEventListener("click", () => moveData(window.api.chooseDataLocation));
    qs("#move-data-btn", container)?.addEventListener("click", () => moveData(window.api.moveDataToAbApps));

    const teamSummary = qs("#team-summary", container);
    const onPage = () => document.body.contains(teamSummary);
    function renderTeam(status) {
      if (!status || !onPage()) return;
      const summary = {
        host: "This computer is the host.",
        "waiting-host": `This computer is set as the host, but ${status.host?.name ?? "another"}'s computer already is, so this computer's changes go through that one for now.`,
        editor: status.host ? `${status.host.name}'s computer is the host; changes made here are saved through it.` : "No host computer's app is open right now; changes made here wait on this computer until one is.",
      }[status.role];
      const unsaved = status.unsaved ? ` ${plural(status.unsaved, "change")} made here ${status.unsaved === 1 ? "is" : "are"} waiting to be saved.` : "";
      teamSummary.textContent = summary + unsaved;
      // While someone is signed in to AB Apps, others see that name, and it can't be changed here.
      const nameInput = qs("#team-name", container);
      if (status.abApps) nameInput.value = status.abApps.name;
      else if (nameInput.disabled) nameInput.value = status.name; // just signed out: the name set here again
      nameInput.disabled = !!status.abApps;
      qs("#team-name-hint", container).textContent = status.abApps
        ? "Shown to others using the same folder. It comes from AB Apps, where you're signed in; a manager changes it there."
        : "Shown to others using the same folder.";
      const others = status.people.filter((p) => !p.isMe);
      qs("#team-people", container).innerHTML = others.length
        ? others.map((p) => `<li>${escapeHtml(p.name)} — ${escapeHtml(p.computer || "")}${p.role === "host" ? " (host)" : ""}</li>`).join("")
        : "<li>Nobody else is using this folder right now.</li>";
    }
    renderTeam(team);
    const stopTeamStatus = window.api.onTeamStatus((status) => {
      if (!onPage()) stopTeamStatus();
      else renderTeam(status);
    });
    qs("#team-save-btn", container).addEventListener("click", async () => {
      try {
        const status = await window.api.saveTeamSettings({ name: qs("#team-name", container).value, isHost: qs("#team-host", container).checked });
        renderTeamStatus(status);
        renderTeam(status);
        toast("Sharing settings saved.");
      } catch (err) {
        toast(err.message, true);
      }
    });
    qs("#default-data-dir-btn", container)?.addEventListener("click", () => moveData(window.api.useDefaultDataLocation));

    qs("#theme-select", container).addEventListener("change", (e) =>
      window.api.setTheme(e.target.value).catch((err) => toast(`Couldn't change the theme: ${err.message}`, true))
    );

    // main.js owns autoUpdater and only reports status over "update:status" --
    // this just mirrors that status into the panel. window.__updateStatus
    // (set in boot.js) carries over whatever the most recent check found, so
    // opening Settings after the automatic startup check already shows its
    // result instead of starting blank every time.
    const actionArea = qs("#update-action-area", container);

    function renderUpdateAction(status) {
      let html;
      if (status.state === "checking") {
        html = `<span class="hint">Checking for updates…</span>`;
      } else if (status.state === "available") {
        html = `<button class="btn" id="update-download-btn" type="button">Download update ${escapeHtml(status.version)}</button>`;
      } else if (status.state === "downloading") {
        html = `<span class="hint">Downloading update… ${status.percent ?? 0}%</span>`;
      } else if (status.state === "downloaded") {
        html = `<button class="btn" id="update-restart-btn" type="button">Restart to install ${escapeHtml(status.version)}</button>`;
      } else if (status.state === "not-available") {
        html = `<span class="hint">You're up to date.</span> <button class="btn secondary" id="update-check-btn" type="button">Check again</button>`;
      } else if (status.state === "error") {
        html = `<span class="hint" style="color:var(--danger)">Update check failed: ${escapeHtml(status.message || "")}</span> <button class="btn secondary" id="update-check-btn" type="button">Try again</button>`;
      } else {
        html = `<button class="btn secondary" id="update-check-btn" type="button">Check for updates</button>`;
      }
      actionArea.innerHTML = html;
      qs("#update-check-btn", actionArea)?.addEventListener("click", () => window.api.checkForUpdates());
      qs("#update-download-btn", actionArea)?.addEventListener("click", () => window.api.downloadUpdate());
      qs("#update-restart-btn", actionArea)?.addEventListener("click", () => window.api.quitAndInstall());
    }

    renderUpdateAction(window.__updateStatus || { state: "idle" });
    const unsubscribeUpdateStatus = window.api.onUpdateStatus((status) => {
      // The page's own root DOM gets replaced wholesale on every navigate()
      // (there's no per-page unmount hook in this app), so once actionArea is
      // no longer attached, this render has been left behind -- stop reacting.
      if (!document.body.contains(actionArea)) {
        unsubscribeUpdateStatus();
        return;
      }
      renderUpdateAction(status);
    });
  },
};
