"use strict";

// The office's own fields (lib/fields.js), for each person, household and
// organization: add one, rename it, change what kind it is, move it, or
// remove it. Each is a column on the Members page, comes and goes with
// imports and exports under its name, and is what FormTracker's templates
// and filters and SendNewsletters' filters see.

window.Pages.fields = {
  async render(container) {
    const F = window.Fields;
    let fields = [];
    let usage = new Map();
    let canRemove = true;

    async function load() {
      const [list, settings] = await Promise.all([window.api.getList(), window.api.getSettings()]);
      fields = list.fields || [];
      // Removing a field takes its values off everyone, so while someone is
      // signed in to AB Apps only a manager can (main.js checks too).
      canRemove = !settings.abApps || settings.abApps.class === "manager";
      const records = { contact: list.contacts, household: list.households, org: list.orgs };
      usage = new Map(
        fields.map((f) => [f.id, records[f.appliesTo].filter((r) => r.fields && r.fields[f.id] !== undefined && r.fields[f.id] !== null && r.fields[f.id] !== "").length])
      );
    }
    await load();

    const typeLabel = (type) => F.TYPES.find((t) => t.value === type)?.label || type;
    const LEVEL_TEXT = {
      contact: "Each person's own — a phone number, a birthdate, a committee.",
      household: "Shared by everyone at one address, like the address itself — Over 65, a plan, a district.",
      org: "Each church or organization's own — a district, a contact phone.",
    };

    function section(level) {
      const mine = fields.filter((f) => f.appliesTo === level.value);
      return `
        <div class="panel">
          <h2 style="margin-top:0">${escapeHtml(level.plural)}</h2>
          <p class="hint" style="margin-top:0">${escapeHtml(LEVEL_TEXT[level.value])}</p>
          ${
            mine.length
              ? `<table class="fields-table">
                  <thead><tr><th>Name</th><th>Kind</th><th>Filled in</th><th></th></tr></thead>
                  <tbody>${mine
                    .map(
                      (f, i) => `
                    <tr data-id="${f.id}">
                      <td><input type="text" class="field-label" value="${escapeHtml(f.label)}" maxlength="${F.MAX_LABEL}" aria-label="Name" /></td>
                      <td><select class="field-type" aria-label="Kind">${F.TYPES.map((t) => `<option value="${t.value}" ${t.value === f.type ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}</select></td>
                      <td class="hint">${plural(usage.get(f.id) || 0, level.value === "contact" ? "person" : level.value === "household" ? "household" : "organization", level.value === "contact" ? "people" : undefined)}</td>
                      <td class="field-actions">
                        <button class="btn secondary" data-move="-1" type="button" ${i === 0 ? "disabled" : ""} title="Move its column left">↑</button>
                        <button class="btn secondary" data-move="1" type="button" ${i === mine.length - 1 ? "disabled" : ""} title="Move its column right">↓</button>
                        <button class="btn danger" data-remove type="button" ${canRemove ? "" : 'disabled title="Only a manager can remove a field"'}>Remove…</button>
                      </td>
                    </tr>`
                    )
                    .join("")}</tbody>
                </table>`
              : `<p class="hint">No ${escapeHtml(level.label.toLowerCase())} fields yet.</p>`
          }
        </div>`;
    }

    function render() {
      container.innerHTML = `
        <h1>Fields</h1>
        <p class="subtitle">Your own fields, on top of the name, email, address and Member ID everyone has. Each is a column on the Members page, filled in there
          by typing or pasting, or by an import (a column headed with a field's name goes into it). FormTracker and SendNewsletters see them too.</p>
        <div class="panel">
          <h2 style="margin-top:0">Add a field</h2>
          <div class="field-add">
            <label>Name <input type="text" id="add-label" maxlength="${F.MAX_LABEL}" placeholder="e.g. Committee, Over 65, Joined" /></label>
            <label>For
              <select id="add-level">${F.LEVELS.map((l) => `<option value="${l.value}">Each ${escapeHtml(l.label.toLowerCase())}</option>`).join("")}</select>
            </label>
            <label>Kind
              <select id="add-type">${F.TYPES.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join("")}</select>
            </label>
            <button class="btn" id="add-btn" type="button">Add field</button>
          </div>
          <p class="hint" id="add-hint">${escapeHtml(F.TYPES[0].hint)}</p>
        </div>
        ${F.LEVELS.map(section).join("")}
        <p class="hint">Changing a field's kind keeps every value, so it can't be done while a value wouldn't fit (a word in a Date field, say) — change those first.
          Identity and health information (Social Security numbers, health conditions) can't be kept in a field.</p>
      `;
      wire();
    }

    async function refresh() {
      await load();
      if (document.body.contains(container)) render();
    }

    function wire() {
      const typeSelect = qs("#add-type", container);
      typeSelect.addEventListener("change", () => (qs("#add-hint", container).textContent = F.TYPES.find((t) => t.value === typeSelect.value).hint));
      const add = async () => {
        try {
          const field = await window.api.addField({ label: qs("#add-label", container).value, appliesTo: qs("#add-level", container).value, type: typeSelect.value });
          toast(`Added ${field.label}.`);
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
      qs("#add-btn", container).addEventListener("click", add);
      qs("#add-label", container).addEventListener("keydown", (e) => e.key === "Enter" && add());

      qsa("tr[data-id]", container).forEach((row) => {
        const id = row.dataset.id;
        const field = fields.find((f) => f.id === id);
        qs(".field-label", row).addEventListener("change", async (e) => {
          try {
            await window.api.updateField(id, { label: e.target.value });
            toast("Renamed.");
          } catch (err) {
            toast(err.message, true);
          }
          await refresh();
        });
        qs(".field-type", row).addEventListener("change", async (e) => {
          const type = e.target.value;
          const used = usage.get(id) || 0;
          if (used && !(await confirmAction(`Change ${field.label} from ${typeLabel(field.type)} to ${typeLabel(type)}? Its ${plural(used, "value")} ${used === 1 ? "is" : "are"} converted.`, "Change"))) {
            e.target.value = field.type;
            return;
          }
          try {
            await window.api.updateField(id, { type });
            toast(`${field.label} is ${typeLabel(type)} now.`);
          } catch (err) {
            toast(err.message, true);
          }
          await refresh();
        });
        qsa("[data-move]", row).forEach((btn) =>
          btn.addEventListener("click", async () => {
            await window.api.moveField(id, Number(btn.dataset.move));
            await refresh();
          })
        );
        qs("[data-remove]", row).addEventListener("click", async () => {
          const used = usage.get(id) || 0;
          const message =
            `Remove the ${field.label} field?` +
            (used ? `\n\nIts values are taken off ${plural(used, "record")}. This can't be undone here — export the list first to keep a copy.` : "") +
            "\n\nAny FormTracker or SendNewsletters template or filter that uses it will find it blank.";
          if (!(await confirmAction(message, "Remove"))) return;
          try {
            await window.api.removeField(id);
            toast(`Removed ${field.label}.`);
          } catch (err) {
            toast(err.message, true);
          }
          await refresh();
        });
      });
    }

    render();
    // Another computer's changes: show the new fields and counts, unless
    // someone's typing here (app.js waits for that).
    window.__refreshPage = refresh;
  },
};
