"use strict";

// Find: anyone, quickly. Type a name (any member of a household), a phone
// number (any format, or its last 4 digits), an email, a birth date, a Member
// ID, a church, a city or a ZIP; narrow to households, people or churches, a
// plan, or include inactive ones. Results are best first; open one to see its
// card. The search itself is lib/search.js, in the main process.
//
// Keys: / to search, 1-4 for the tabs, Down or j/k to move through the
// results, Enter to open, Esc to go back to the search box.

window.Pages.find = {
  fill: true,
  async render(container) {
    const saved = window.__findState || {};
    const state = { q: "", kind: "", plan: "", inactive: false, open: null, ...saved };
    const remember = () => (window.__findState = { ...state });
    let results = [];
    let selected = -1;
    const history = []; // cards opened from other cards, for Back

    const TABS = [
      ["", "All"],
      ["h", "Households"],
      ["p", "People"],
      ["c", "Churches"],
    ];
    const KIND_LABEL = { h: "Household", p: "Person", c: "Church" };

    container.innerHTML = `
      <div class="find-page">
        <div class="find-left">
          <h1>Find</h1>
          <input type="search" id="find-q" class="find-q" autocomplete="off" spellcheck="false"
            placeholder="Name, phone, email, birth date, Member ID, church, city or ZIP…" aria-label="Search" />
          <div class="find-tabs" role="tablist">
            ${TABS.map(([k, label], i) => `<button type="button" class="tab find-tab" role="tab" data-kind="${k}">${label} <kbd>${i + 1}</kbd></button>`).join("")}
          </div>
          <div class="find-filters">
            <select id="find-plan" aria-label="Plan"><option value="">Any plan</option></select>
            <label class="check-label"><input type="checkbox" id="find-inactive" /> Include inactive</label>
            <span class="hint" id="find-count"></span>
          </div>
          <div class="find-results" id="find-results" role="listbox" tabindex="-1"></div>
        </div>
        <div class="find-card" id="find-card"></div>
      </div>`;
    const q = qs("#find-q", container);
    const list = qs("#find-results", container);
    const card = qs("#find-card", container);
    q.value = state.q;
    qs("#find-inactive", container).checked = state.inactive;

    function renderTabs() {
      qsa(".find-tab", container).forEach((b) => {
        b.classList.toggle("active", b.dataset.kind === state.kind);
        b.setAttribute("aria-selected", b.dataset.kind === state.kind);
      });
    }

    let searchRequest = 0;
    async function runSearch() {
      const request = ++searchRequest;
      const r = await window.api.findSearch(state.q, { kind: state.kind, plan: state.plan, inactive: state.inactive });
      if (request !== searchRequest || !document.body.contains(list)) return;
      const planSelect = qs("#find-plan", container);
      const plans = ["", ...r.plans];
      if (planSelect.options.length !== plans.length) {
        planSelect.innerHTML = plans.map((p) => `<option value="${escapeHtml(p)}">${p ? escapeHtml(p) : "Any plan"}</option>`).join("");
      }
      planSelect.value = state.plan;
      results = r.results;
      selected = results.length ? Math.min(Math.max(selected, 0), results.length - 1) : -1;
      qs("#find-count", container).textContent = r.total ? `${plural(r.total, "result")}${r.total > results.length ? ` · first ${results.length}` : ""}` : "";
      if (r.empty) {
        list.innerHTML = `<div class="empty">The list is empty. <a href="#" data-go="import">Bring in FundTrack's exports</a> on the Import page to find anyone in any household.</div>`;
      } else if (!results.length) {
        list.innerHTML = `<div class="empty">No matches${state.inactive ? "" : " — try “Include inactive”"}.</div>`;
      } else {
        list.innerHTML =
          results
            .map(
              (e, i) => `<div class="find-row${i === selected ? " sel" : ""}${state.open?.k === e.k && state.open?.id === e.id ? " open" : ""}" role="option" data-i="${i}">
                <span class="find-t1"><span class="find-title">${escapeHtml(e.title)}${e.active ? "" : ' <span class="chip warn">Inactive</span>'}</span><span class="find-kind k-${e.k}">${KIND_LABEL[e.k]}</span></span>
                ${e.sub ? `<span class="find-sub">${escapeHtml(e.sub)}</span>` : ""}${e.meta ? `<span class="find-meta">${escapeHtml(e.meta)}</span>` : ""}
              </div>`
            )
            .join("") + (r.total > results.length ? `<div class="hint find-more">Showing the first ${results.length}; type more to narrow it down.</div>` : "");
      }
    }
    let searchTimer = null;
    const searchSoon = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 120);
    };

    function moveSelection(by) {
      if (!results.length) return;
      selected = Math.min(results.length - 1, Math.max(0, selected + by));
      qsa(".find-row", list).forEach((row) => row.classList.toggle("sel", Number(row.dataset.i) === selected));
      qs(`.find-row[data-i="${selected}"]`, list)?.scrollIntoView({ block: "nearest" });
    }

    // ---- cards ----

    // (717) 555-1234 for a 10-digit number; anything else as it was typed.
    const phone = (v) => {
      const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
    };
    const copyButton = (value, label) => (value ? `<button type="button" class="copy-btn" data-copy="${escapeHtml(value)}" title="Copy ${escapeHtml(label)}">Copy</button>` : "");
    const box = (label, value, { copy = true, html } = {}) =>
      `<div class="kv"><div class="k">${escapeHtml(label)}</div><div class="v">${html ?? (value ? escapeHtml(value) : '<span class="none">—</span>')}${copy && value ? ` ${copyButton(value, label)}` : ""}</div></div>`;
    const link = (k, id, text) => `<a href="#" data-open-k="${k}" data-open-id="${escapeHtml(id)}">${escapeHtml(text)}</a>`;
    const fieldBoxes = (fields) => fields.map((f) => box(f.label, f.value, { copy: false })).join("");
    const detailsBlock = (details) => {
      const entries = Object.entries(details || {});
      if (!entries.length) return "";
      return `<details class="find-details"><summary>FundTrack details (${entries.length})</summary>
        <div class="kv-grid">${entries.map(([k, v]) => box(k, v, { copy: false })).join("")}</div></details>`;
    };
    const newsletterBlock = (items, none) =>
      `<section class="find-sec"><h2>Newsletters</h2>${
        items.length ? `<ul class="find-pubs">${items.map((n) => `<li><strong>${escapeHtml(n.name)}</strong> ${escapeHtml(n.how)}</li>`).join("")}</ul>` : `<p class="hint">${none}</p>`
      }</section>`;
    const statusChip = (status) => (status === "Inactive" ? '<span class="chip warn">Inactive</span>' : status ? `<span class="chip">${escapeHtml(status)}</span>` : "");

    function householdCard(c) {
      return `
        <div class="find-head">
          <div><div class="find-kind k-h">Household${c.fundTrack ? "" : " (address)"}</div><h2 class="find-name">${escapeHtml(c.name)} ${statusChip(c.status)}</h2>
            <div class="hint">${[c.memberId && `Member ID ${escapeHtml(c.memberId)}`, c.plan && escapeHtml(c.plan), c.type && escapeHtml(c.type)].filter(Boolean).join(" · ")}</div></div>
          <div class="find-acts"><button class="btn secondary" type="button" data-members="${escapeHtml(c.memberId || (c.head?.name ?? c.name))}">Show on Members page</button></div>
        </div>
        <div class="kv-grid">
          ${box("Phone", phone(c.phone))}
          ${box("Email", c.email)}
          ${box("Address", c.address.join(", "), { html: c.address.length ? c.address.map(escapeHtml).join("<br/>") + ` ${copyButton(c.address.join(", "), "address")}` : undefined, copy: false })}
          ${box("Church", c.church?.name, { html: c.church ? link("c", c.church.id, c.church.name) : undefined, copy: false })}
          ${fieldBoxes(c.fields)}
        </div>
        ${c.sharing.length ? `<p class="hint">Shares its mailing address with ${c.sharing.map((s) => link("h", s.key, s.name)).join(", ")}: one bundle of each newsletter goes there.</p>` : ""}
        <section class="find-sec"><h2>Household (${c.members.length})</h2>
          <table class="find-table"><thead><tr><th>Name</th><th>Role</th><th>Born</th><th class="num">Age</th><th>Status</th></tr></thead>
          <tbody>${c.members
            .map(
              (m) => `<tr><td>${link("p", m.id, m.name)}</td><td>${escapeHtml(m.role)}</td><td>${escapeHtml(m.birth)}${m.birthCheck ? ' <span class="chip warn" title="This birth date can\'t be right; check it in FundTrack">Check</span>' : ""}</td>
                <td class="num">${m.age ?? ""}</td><td>${m.status === "Inactive" ? '<span class="chip warn">Inactive</span>' : ""}</td></tr>`
            )
            .join("")}</tbody></table></section>
        ${newsletterBlock(c.newsletters, "Gets no newsletters.")}
        ${detailsBlock(c.details)}`;
    }

    function personCard(c) {
      return `
        <div class="find-head">
          <div><div class="find-kind k-p">Person</div><h2 class="find-name">${escapeHtml(c.name)} ${statusChip(c.status === "Inactive" ? "Inactive" : "")}</h2>
            <div class="hint">${[c.role, c.memberId && `Member ID ${c.memberId}`].filter(Boolean).map(escapeHtml).join(" · ")}</div></div>
          <div class="find-acts"><button class="btn secondary" type="button" data-members="${escapeHtml(c.name)}">Show on Members page</button></div>
        </div>
        <div class="kv-grid">
          ${box("Born", c.birth ? `${c.birth}${c.age != null ? ` (age ${c.age})` : ""}` : "", { copy: false })}
          ${box("Gender", c.gender, { copy: false })}
          ${box("Email", c.email)}
          ${box("Phone", phone(c.phone))}
          ${box("Household", c.household?.name, { html: c.household ? link("h", c.household.key, c.household.name) : undefined, copy: false })}
          ${box("Address", c.address.join(", "), { html: c.address.length ? c.address.map(escapeHtml).join("<br/>") + ` ${copyButton(c.address.join(", "), "address")}` : undefined, copy: false })}
          ${box("Church", c.church?.name, { html: c.church ? link("c", c.church.id, c.church.name) : undefined, copy: false })}
          ${fieldBoxes(c.fields)}
        </div>
        ${c.birthCheck ? '<p class="hint" style="color:var(--warn)">This birth date can\'t be right, so no age is worked out. Check it in FundTrack.</p>' : ""}
        ${newsletterBlock(c.newsletters, "Gets no newsletters.")}
        ${detailsBlock(c.details)}`;
    }

    function churchCard(c) {
      return `
        <div class="find-head">
          <div><div class="find-kind k-c">Church</div><h2 class="find-name">${escapeHtml(c.name)} ${statusChip(c.status === "Inactive" ? "Inactive" : "")}</h2>
            <div class="hint">${[c.code && `Code ${c.code}`, c.type, c.denomination].filter(Boolean).map(escapeHtml).join(" · ")}</div></div>
          <div class="find-acts">
            <button class="btn secondary" type="button" data-print-church="${escapeHtml(c.id)}" ${c.households.length ? "" : "disabled"}>Print household list</button>
            <button class="btn secondary" type="button" data-members-org="${escapeHtml(c.name)}">Show on Members page</button>
          </div>
        </div>
        <div class="kv-grid">
          ${box("Attention", c.attn)}
          ${box("Phone", phone(c.phone))}
          ${box("Email", c.email)}
          ${box("Address", c.address.join(", "), { html: c.address.length ? c.address.map(escapeHtml).join("<br/>") + ` ${copyButton(c.address.join(", "), "address")}` : undefined, copy: false })}
          ${fieldBoxes(c.fields)}
        </div>
        ${
          c.contacts.length
            ? `<section class="find-sec"><h2>Contacts (${c.contacts.length})</h2><table class="find-table"><thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Email</th></tr></thead>
               <tbody>${c.contacts
                 .map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.type)}</td><td>${escapeHtml(phone(x.phone))} ${copyButton(phone(x.phone), "phone")}</td><td>${escapeHtml(x.email)} ${copyButton(x.email, "email")}</td></tr>`)
                 .join("")}</tbody></table></section>`
            : ""
        }
        <section class="find-sec"><h2>Households (${c.households.length}) · ${plural(c.people, "person", "people")}</h2>
          ${
            c.households.length
              ? `<table class="find-table"><tbody>${c.households
                  .map((h) => `<tr><td>${link("h", h.key, h.name)}${h.active ? "" : ' <span class="chip warn">Inactive</span>'}</td><td>${escapeHtml(h.place)}</td><td class="num">${h.size}</td></tr>`)
                  .join("")}</tbody></table>`
              : '<p class="hint">No households belong to it.</p>'
          }</section>
        ${newsletterBlock(c.newsletters, "Gets no newsletters as a batch.")}
        ${detailsBlock(c.details)}`;
    }

    async function openCard(k, id, { fromCard = false } = {}) {
      if (fromCard && state.open) history.push(state.open);
      state.open = { k, id };
      remember();
      const c = await window.api.findCard(k, id);
      if (!document.body.contains(card)) return;
      if (!c) {
        card.innerHTML = `<div class="empty">That's no longer on the list.</div>`;
        return;
      }
      card.innerHTML =
        (history.length ? `<button type="button" class="btn secondary find-back" data-back>← Back</button>` : "") +
        (k === "h" ? householdCard(c) : k === "p" ? personCard(c) : churchCard(c));
      card.scrollTop = 0;
      qsa(".find-row", list).forEach((row) => {
        const e = results[Number(row.dataset.i)];
        row.classList.toggle("open", !!e && e.k === k && e.id === id);
      });
    }

    function showEmptyCard() {
      card.innerHTML = `<div class="find-hint">
        <p>Type part of a name, a phone number (any format, or the last 4 digits), an email, a birth date, a Member ID, a church, a city or a ZIP.
        Every word has to match, in any order.</p>
        <p class="hint"><kbd>/</kbd> search · <kbd>1</kbd>–<kbd>4</kbd> tabs · <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> back to the search box</p>
        <p class="hint">For lists — everyone 65 and over, households near a ZIP, birthdays this month — use <a href="#" data-go="lists">Lists</a> and <a href="#" data-go="near">Near ZIP</a>.</p>
      </div>`;
    }

    // ---- events ----

    q.addEventListener("input", () => {
      state.q = q.value;
      selected = 0;
      remember();
      searchSoon();
    });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list.focus();
        moveSelection(selected < 0 ? 0 : 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const e0 = results[Math.max(selected, 0)];
        if (e0) openCard(e0.k, e0.id);
      }
    });
    qsa(".find-tab", container).forEach((b) =>
      b.addEventListener("click", () => {
        state.kind = b.dataset.kind;
        selected = 0;
        remember();
        renderTabs();
        runSearch();
      })
    );
    qs("#find-plan", container).addEventListener("change", (e) => {
      state.plan = e.target.value;
      remember();
      runSearch();
    });
    qs("#find-inactive", container).addEventListener("change", (e) => {
      state.inactive = e.target.checked;
      remember();
      runSearch();
    });
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".find-row");
      if (!row) return;
      selected = Number(row.dataset.i);
      moveSelection(0);
      const r = results[selected];
      if (r) openCard(r.k, r.id);
    });
    container.addEventListener("click", async (e) => {
      const go = e.target.closest("[data-go]");
      if (go) {
        e.preventDefault();
        navigate(go.dataset.go);
        return;
      }
      const open = e.target.closest("[data-open-k]");
      if (open) {
        e.preventDefault();
        openCard(open.dataset.openK, open.dataset.openId, { fromCard: true });
        return;
      }
      if (e.target.closest("[data-back]")) {
        const prev = history.pop();
        if (prev) openCard(prev.k, prev.id);
        return;
      }
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        await window.api.copyText(copy.dataset.copy);
        toast("Copied.");
        return;
      }
      const members = e.target.closest("[data-members]");
      if (members) {
        window.__contactsView = { tab: "people", searchTerm: members.dataset.members };
        navigate("contacts");
        return;
      }
      const membersOrg = e.target.closest("[data-members-org]");
      if (membersOrg) {
        window.__contactsView = { tab: "orgs", searchTerm: membersOrg.dataset.membersOrg };
        navigate("contacts");
        return;
      }
      const print = e.target.closest("[data-print-church]");
      if (print) {
        try {
          await window.api.printChurch(print.dataset.printChurch);
        } catch (err) {
          toast(err.message, true);
        }
      }
    });

    // Shortcuts outside the search box (and not while typing elsewhere).
    const onKey = (e) => {
      if (!document.body.contains(container) || !qs(".find-page", container)) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const typing = e.target.matches?.("input, select, textarea, [contenteditable]");
      // Esc goes back to the card this one was opened from, or else to the search box.
      if (e.key === "Escape") {
        if (history.length) {
          const prev = history.pop();
          openCard(prev.k, prev.id);
        } else {
          q.focus();
          q.select();
        }
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        q.focus();
        q.select();
      } else if (/^[1-4]$/.test(e.key)) {
        qsa(".find-tab", container)[Number(e.key) - 1]?.click();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === "Enter" && selected >= 0 && results[selected]) {
        openCard(results[selected].k, results[selected].id);
      }
    };
    document.addEventListener("keydown", onKey);

    renderTabs();
    await runSearch();
    if (state.open) await openCard(state.open.k, state.open.id);
    else showEmptyCard();
    q.focus();
    // Another computer's changes: the same search, and the open card, again.
    window.__refreshPage = async () => {
      await runSearch();
      if (state.open) await openCard(state.open.k, state.open.id);
    };
  },
};
