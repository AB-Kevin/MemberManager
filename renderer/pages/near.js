"use strict";

// Near ZIP: how many members live around a place -- a hospital the office
// is contracting with, say. Households and people within 10, 25, 50, 75 and
// 100 miles of a ZIP code, and a list of ZIP codes with their distance and
// counts. Counts only: no names, phones or addresses, so the printout and
// spreadsheet can go to the hospital. lib/nearZip.js does the counting.

window.Pages.near = {
  async render(container) {
    const state = { zip: "", maxMi: 100, plan: "", inactive: false, ...(window.__nearState || {}) };
    container.innerHTML = `
      <h1>Near ZIP</h1>
      <p class="subtitle">How many members live around a place. Counts only — no names, phones or addresses — so the printout and spreadsheet can be shared,
        with a hospital you're contracting with, say. Distances are straight-line miles between ZIP code centres (US Census Bureau data), not driving distance.</p>
      <div class="panel">
        <div class="row" style="align-items:flex-end">
          <div class="field"><label for="near-zip">ZIP code</label><input type="text" id="near-zip" inputmode="numeric" maxlength="5" style="width:110px" placeholder="44691" /></div>
          <div class="field"><label for="near-max">Up to</label><select id="near-max"></select></div>
          <div class="field"><label for="near-plan">Plan</label><select id="near-plan"><option value="">Any plan</option></select></div>
          <label class="check-label" style="margin-bottom:14px"><input type="checkbox" id="near-inactive" /> Include inactive households</label>
          <span class="toolbar-gap"></span>
          <button class="btn secondary" type="button" id="near-print" disabled>Print</button>
          <button class="btn" type="button" id="near-export" disabled>Save as spreadsheet…</button>
        </div>
      </div>
      <div id="near-out"></div>`;
    const out = qs("#near-out", container);
    qs("#near-zip", container).value = state.zip;
    qs("#near-inactive", container).checked = state.inactive;

    let request = 0;
    async function run() {
      window.__nearState = { ...state };
      const mine = ++request;
      const r = await window.api.nearReport(state);
      if (mine !== request || !document.body.contains(out)) return;
      const max = qs("#near-max", container);
      if (!max.options.length) max.innerHTML = r.maxChoices.map((m) => `<option value="${m}">${m} miles</option>`).join("");
      max.value = String(r.options.maxMi);
      const plan = qs("#near-plan", container);
      if (plan.options.length !== r.plans.length + 1) plan.innerHTML = `<option value="">Any plan</option>${r.plans.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}`;
      plan.value = state.plan;
      const ready = !!r.report;
      qs("#near-print", container).disabled = !ready;
      qs("#near-export", container).disabled = !ready;
      if (!state.zip) {
        out.innerHTML = `<p class="hint">Type a ZIP code to see how many members live around it.</p>`;
        return;
      }
      if (r.unknownZip) {
        out.innerHTML = `<p class="hint" style="color:var(--warn)">${escapeHtml(state.zip)} isn't a ZIP code with a known location. Check it, or try a ZIP nearby.</p>`;
        return;
      }
      const rep = r.report;
      out.innerHTML = `
        <div class="stat-row">${rep.bands
          .map((b) => `<div class="stat-card"><div class="num">${b.households.toLocaleString()}</div><div class="label">Households within ${b.to} miles</div><div class="hint">${plural(b.people, "person", "people")}</div></div>`)
          .join("")}</div>
        <p class="hint">${
          rep.nearest != null ? `The nearest household is ${rep.nearest.toFixed(1)} miles away. ` : "No households are that close. "
        }${rep.approx ? `${plural(rep.approx, "household")} ${rep.approx === 1 ? "has a PO-box ZIP placed" : "have PO-box ZIPs placed"} at the nearest ZIP in the same area (marked approx.). ` : ""}${
          rep.noZip ? `${plural(rep.noZip, "household")} with no usable ZIP ${rep.noZip === 1 ? "is" : "are"} left out.` : ""
        }</p>
        ${
          rep.zips.length
            ? `<table class="lists-table"><thead><tr><th>ZIP</th><th class="num">Miles</th><th>City</th><th>State</th><th class="num">Households</th><th class="num">People</th></tr></thead>
               <tbody>${rep.zips
                 .map((z) => `<tr><td>${z.zip}</td><td class="num">${z.miles.toFixed(1)}${z.approx ? " <span class='hint'>approx.</span>" : ""}</td><td>${escapeHtml(z.city)}</td><td>${escapeHtml(z.state)}</td><td class="num">${z.households.toLocaleString()}</td><td class="num">${z.people.toLocaleString()}</td></tr>`)
                 .join("")}</tbody></table>`
            : ""
        }`;
    }

    qs("#near-zip", container).addEventListener("input", (e) => {
      const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
      if (zip.length === 5 || !zip) {
        state.zip = zip;
        run();
      }
    });
    qs("#near-max", container).addEventListener("change", (e) => {
      state.maxMi = Number(e.target.value);
      run();
    });
    qs("#near-plan", container).addEventListener("change", (e) => {
      state.plan = e.target.value;
      run();
    });
    qs("#near-inactive", container).addEventListener("change", (e) => {
      state.inactive = e.target.checked;
      run();
    });
    qs("#near-export", container).addEventListener("click", async () => {
      try {
        const saved = await window.api.exportNear(state);
        if (saved) toast(`Saved to ${saved}`);
      } catch (err) {
        toast(err.message, true);
      }
    });
    qs("#near-print", container).addEventListener("click", async () => {
      try {
        await window.api.printNear(state);
      } catch (err) {
        toast(err.message, true);
      }
    });
    await run();
    qs("#near-zip", container).focus();
  },
};
