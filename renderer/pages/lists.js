"use strict";

// Lists: any list of people, households or churches, on any field. Pick what
// it's a list of, add conditions (Age at least 65; Household state is OH;
// Miles from 44691 at most 50; Email is blank), match all or any of them,
// choose the columns, and save it as a spreadsheet, print it, or keep it by
// name for next time. "Start from" has ready-made lists to begin with. The
// fields and tests are lib/lists.js, in the main process.

window.Pages.lists = {
  async render(container) {
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const blankState = (kind = "people") => ({ kind, conds: [], match: "all", cols: null, sort: null, dir: 1, zip: "" });
    const state = window.__listState ? { ...blankState(), ...window.__listState } : blankState();
    const remember = () => (window.__listState = JSON.parse(JSON.stringify(state)));
    let cat = null;
    let shown = 300;
    let colsOpen = false;

    container.innerHTML = `
      <h1>Lists</h1>
      <p class="subtitle">Any list of people, households or churches, on any field — to save as a spreadsheet, print, or keep for next time.</p>
      <div class="panel lists-build">
        <div class="row lists-top">
          <label class="lists-inline">List
            <select id="list-kind"></select>
          </label>
          <label class="lists-inline">Start from
            <select id="list-start"><option value="">Choose…</option></select>
          </label>
          <span class="toolbar-gap"></span>
          <button class="btn secondary" type="button" id="list-clear">Clear</button>
        </div>
        <div id="list-conds"></div>
        <div class="row lists-top">
          <button class="btn secondary" type="button" id="list-add">+ Add condition</button>
          <label class="lists-inline">Match
            <select id="list-match"><option value="all">all conditions</option><option value="any">any condition</option></select>
          </label>
          <label class="lists-inline" title="Offers “Miles from” this ZIP as a field and a column">Miles from ZIP
            <input type="text" id="list-zip" inputmode="numeric" maxlength="5" style="width:80px" placeholder="44691" />
          </label>
          <span class="hint" id="list-zip-note"></span>
        </div>
        <details id="list-cols-box"><summary>Columns</summary><div id="list-cols" class="list-cols"></div></details>
      </div>
      <div class="row lists-top">
        <strong id="list-count"></strong><span class="hint" id="list-title"></span>
        <span class="toolbar-gap"></span>
        <button class="btn secondary" type="button" id="list-save-as">Save list as…</button>
        <button class="btn secondary" type="button" id="list-print">Print</button>
        <button class="btn" type="button" id="list-export">Save as spreadsheet…</button>
      </div>
      <div class="lists-table-wrap"><table class="lists-table" id="list-table"></table></div>
      <div id="list-more"></div>`;

    const opsFor = (type) => cat.ops[type] || [];
    const fieldOf = (k) => cat.fields.find((f) => f.k === k) || null;

    function fieldOptions(selectedKey) {
      const groups = new Map();
      for (const f of cat.fields) {
        if (!groups.has(f.group)) groups.set(f.group, []);
        groups.get(f.group).push(f);
      }
      return [...groups]
        .map(([g, fs]) => `<optgroup label="${escapeHtml(g)}">${fs.map((f) => `<option value="${escapeHtml(f.k)}" ${f.k === selectedKey ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("")}</optgroup>`)
        .join("");
    }

    // The value box(es) a condition needs for its field and test.
    function valueInputs(f, c, i) {
      if (!f || ["blank", "set", "yes", "no"].includes(c.op)) return "";
      const input = (part, value, label) => {
        if (f.type === "date" && c.op === "month") {
          return `<select data-part="${part}" data-i="${i}" aria-label="${label}"><option value="">Month…</option>${MONTHS.map((m, n) => `<option value="${n + 1}" ${String(value) === String(n + 1) ? "selected" : ""}>${m}</option>`).join("")}</select>`;
        }
        if (f.type === "date" && c.op === "year") return `<input type="text" data-part="${part}" data-i="${i}" value="${escapeHtml(value)}" inputmode="numeric" maxlength="4" placeholder="2026" style="width:80px" aria-label="${label}" />`;
        if (f.type === "date") return `<input type="date" data-part="${part}" data-i="${i}" value="${escapeHtml(value)}" aria-label="${label}" />`;
        if (f.type === "num") return `<input type="number" data-part="${part}" data-i="${i}" value="${escapeHtml(value)}" style="width:100px" aria-label="${label}" />`;
        if (f.type === "enum" && f.opts && (c.op === "is" || c.op === "not")) {
          const options = f.opts.includes(value) || !value ? f.opts : [value, ...f.opts];
          return `<select data-part="${part}" data-i="${i}" aria-label="${label}"><option value="">Choose…</option>${options.map((o) => `<option ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
        }
        return `<input type="text" data-part="${part}" data-i="${i}" value="${escapeHtml(value)}" aria-label="${label}" />`;
      };
      return input("v", c.v || "", "Value") + (c.op === "bt" ? ` and ${input("v2", c.v2 || "", "Second value")}` : "");
    }

    function renderConds() {
      const box = qs("#list-conds", container);
      box.innerHTML = state.conds.length
        ? state.conds
            .map((c, i) => {
              const f = fieldOf(c.k);
              return `<div class="row list-cond">
                <span class="hint list-join">${i === 0 ? "Where" : state.match === "any" ? "or" : "and"}</span>
                <select data-part="k" data-i="${i}" aria-label="Field">${f ? "" : '<option value="">Choose a field…</option>'}${fieldOptions(c.k)}</select>
                <select data-part="op" data-i="${i}" aria-label="Test">${f ? opsFor(f.type).map(([v, label]) => `<option value="${v}" ${v === c.op ? "selected" : ""}>${label}</option>`).join("") : ""}</select>
                ${valueInputs(f, c, i)}
                <button type="button" class="btn secondary list-x" data-remove="${i}" aria-label="Remove this condition">×</button>
              </div>`;
            })
            .join("")
        : `<p class="hint">No conditions: the list has every one of them. Add a condition to narrow it.</p>`;
    }

    function renderColumns() {
      const cols = state.cols || cat.defaultColumns[state.kind];
      const groups = new Map();
      for (const f of cat.fields) {
        if (!groups.has(f.group)) groups.set(f.group, []);
        groups.get(f.group).push(f);
      }
      qs("#list-cols", container).innerHTML = [...groups]
        .map(
          ([g, fs]) => `<fieldset><legend>${escapeHtml(g)}</legend>${fs
            .map((f) => `<label class="check-label"><input type="checkbox" data-col="${escapeHtml(f.k)}" ${cols.includes(f.k) ? "checked" : ""} /> ${escapeHtml(f.label)}</label>`)
            .join("")}</fieldset>`
        )
        .join("");
      qs("#list-cols-box", container).open = colsOpen;
    }

    function renderStart() {
      const select = qs("#list-start", container);
      select.innerHTML =
        `<option value="">Choose…</option><optgroup label="Ready-made">${cat.presets.map((p, i) => `<option value="preset:${i}">${escapeHtml(p.name)}</option>`).join("")}</optgroup>` +
        (cat.saved.length
          ? `<optgroup label="Saved lists">${cat.saved.map((s) => `<option value="saved:${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")}</optgroup>
             <optgroup label="Remove a saved list">${cat.saved.map((s) => `<option value="delete:${escapeHtml(s.id)}">Remove “${escapeHtml(s.name)}”…</option>`).join("")}</optgroup>`
          : "");
    }

    async function loadCatalog() {
      cat = await window.api.listCatalog(state.kind, state.zip);
      qs("#list-kind", container).innerHTML = Object.entries(cat.kinds).map(([k, label]) => `<option value="${k}" ${k === state.kind ? "selected" : ""}>${label}</option>`).join("");
      qs("#list-match", container).value = state.match;
      qs("#list-zip", container).value = state.zip || "";
      qs("#list-zip-note", container).textContent = state.zip && !cat.zipKnown ? "That isn't a ZIP code with a known location." : state.zip ? `“Miles from ${state.zip}” is under Location.` : "";
      renderStart();
      renderConds();
      renderColumns();
    }

    let runRequest = 0;
    async function run() {
      remember();
      const request = ++runRequest;
      let r;
      try {
        r = await window.api.runList(state, shown);
      } catch (err) {
        toast(err.message, true);
        return;
      }
      if (request !== runRequest || !document.body.contains(container.querySelector("#list-table"))) return;
      qs("#list-count", container).textContent = plural(r.total, state.kind === "people" ? "person" : state.kind === "households" ? "household" : "church", state.kind === "people" ? "people" : state.kind === "households" ? "households" : "churches");
      qs("#list-title", container).textContent = r.title;
      const mark = (k) => (state.sort === k ? (state.dir === -1 ? " ▼" : " ▲") : "");
      qs("#list-table", container).innerHTML = `
        <thead><tr>${r.columns.map((c) => `<th data-sort="${escapeHtml(c.k)}" class="${c.type === "num" ? "num" : ""}" title="Sort by ${escapeHtml(c.label)}">${escapeHtml(c.label)}${mark(c.k)}</th>`).join("")}</tr></thead>
        <tbody>${r.rows
          .map((row) => `<tr data-k="${row.ref.k}" data-id="${escapeHtml(row.ref.id)}" title="Open on the Find page">${row.cells.map((cell, i) => `<td class="${r.columns[i].type === "num" ? "num" : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`;
      qs("#list-more", container).innerHTML =
        r.total > r.rows.length ? `<div class="row"><span class="hint">Showing ${r.rows.length.toLocaleString()} of ${r.total.toLocaleString()}.</span> <button class="btn secondary" type="button" id="list-show-more">Show more</button></div>` : "";
    }
    let runTimer = null;
    const runSoon = () => {
      clearTimeout(runTimer);
      runTimer = setTimeout(run, 200);
    };

    function apply(next) {
      Object.assign(state, blankState(next.kind || state.kind), JSON.parse(JSON.stringify(next)));
      shown = 300;
      return loadCatalog().then(run);
    }

    // ---- events ----

    qs("#list-kind", container).addEventListener("change", (e) => apply({ kind: e.target.value }));
    qs("#list-clear", container).addEventListener("click", () => apply({ kind: state.kind }));
    qs("#list-start", container).addEventListener("change", async (e) => {
      const [type, id] = e.target.value.split(":");
      e.target.value = "";
      if (type === "preset") await apply(cat.presets[Number(id)].state);
      else if (type === "saved") await apply(cat.saved.find((s) => s.id === id).state);
      else if (type === "delete") {
        const s = cat.saved.find((x) => x.id === id);
        if (s && (await confirmAction(`Remove the saved list “${s.name}”? Lists already saved as spreadsheets aren't affected.`, "Remove"))) {
          await window.api.deleteList(id);
          await loadCatalog();
        }
      }
    });
    qs("#list-add", container).addEventListener("click", () => {
      const first = cat.fields[0];
      state.conds.push({ k: first.k, op: cat.ops[first.type][0][0], v: "", v2: "" });
      renderConds();
      qsa("#list-conds select[data-part='k']", container).pop()?.focus();
    });
    qs("#list-match", container).addEventListener("change", (e) => {
      state.match = e.target.value;
      renderConds();
      run();
    });
    qs("#list-zip", container).addEventListener("change", async (e) => {
      state.zip = e.target.value.replace(/\D/g, "").slice(0, 5);
      await loadCatalog();
      run();
    });
    const conds = qs("#list-conds", container);
    const onCondChange = (e) => {
      const el = e.target.closest("[data-part]");
      if (!el) return;
      const c = state.conds[Number(el.dataset.i)];
      if (!c) return;
      c[el.dataset.part] = el.value;
      if (el.dataset.part === "k") {
        const f = fieldOf(c.k);
        c.op = f ? cat.ops[f.type][0][0] : "";
        c.v = "";
        c.v2 = "";
      }
      if (el.dataset.part === "k" || el.dataset.part === "op") {
        renderConds();
        run();
      } else runSoon();
    };
    conds.addEventListener("change", onCondChange);
    conds.addEventListener("input", (e) => e.target.matches("input") && onCondChange(e));
    conds.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove]");
      if (!remove) return;
      state.conds.splice(Number(remove.dataset.remove), 1);
      renderConds();
      run();
    });
    qs("#list-cols-box", container).addEventListener("toggle", (e) => (colsOpen = e.target.open));
    qs("#list-cols", container).addEventListener("change", () => {
      state.cols = qsa("[data-col]:checked", container).map((b) => b.dataset.col);
      run();
    });
    qs("#list-table", container).addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const k = th.dataset.sort;
        if (state.sort !== k) Object.assign(state, { sort: k, dir: 1 });
        else if (state.dir === 1) state.dir = -1;
        else Object.assign(state, { sort: null, dir: 1 });
        run();
        return;
      }
      const tr = e.target.closest("tr[data-k]");
      if (tr) {
        window.__findState = { ...(window.__findState || {}), open: { k: tr.dataset.k, id: tr.dataset.id } };
        navigate("find");
      }
    });
    qs("#list-more", container).addEventListener("click", (e) => {
      if (!e.target.closest("#list-show-more")) return;
      shown += 300;
      run();
    });
    qs("#list-export", container).addEventListener("click", async () => {
      try {
        const saved = await window.api.exportList(state);
        if (saved) toast(`Saved to ${saved}`);
      } catch (err) {
        toast(err.message, true);
      }
    });
    qs("#list-print", container).addEventListener("click", async () => {
      try {
        await window.api.printList(state);
      } catch (err) {
        toast(err.message, true);
      }
    });
    qs("#list-save-as", container).addEventListener("click", () => {
      const bar = qs("#list-more", container);
      bar.innerHTML = `<div class="row panel list-save-row"><label class="lists-inline">Name <input type="text" id="list-save-name" maxlength="80" placeholder="e.g. 65 and over in Ohio" /></label>
        <button class="btn" type="button" id="list-save-go">Save</button><span class="hint">Everyone using MemberManager sees it under Start from, and it runs on the list as it is then.</span></div>`;
      const nameBox = qs("#list-save-name", bar);
      nameBox.focus();
      const go = async () => {
        try {
          await window.api.saveList(nameBox.value, state);
          toast(`Saved “${nameBox.value.trim()}”.`);
          await loadCatalog();
          run();
        } catch (err) {
          toast(err.message, true);
        }
      };
      qs("#list-save-go", bar).addEventListener("click", go);
      nameBox.addEventListener("keydown", (e) => e.key === "Enter" && go());
    });

    await loadCatalog();
    await run();
  },
};
