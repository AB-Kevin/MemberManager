"use strict";

// Cards: designing member cards for the card printer (lib/cards.js). A design
// has a front and a back; each side has an SVG of the preprinted card to place
// fields on, and the fields. Drag a field to move it, drag its right edge to
// make it wider or narrower, or use the arrow keys (Shift for bigger steps).
// Changes save as they're made. The values shown are a real member's: pick
// whose under the card.

window.Pages.cards = {
  async render(container) {
    const MM_PER_PT = 0.3528;
    let designs = await window.api.listCardDesigns();
    let design = null;
    let images = {};
    let fonts = [];
    let side = window.__cardSide || "front";
    let fieldChoices = [];
    let selectedId = null;
    let previewRef = null;
    let preview = { name: "", values: {} };
    let scale = 7; // px per mm on screen
    let cardDpiSetting = 300;
    let size = { w: 85.6, h: 53.98 };

    container.innerHTML = `
      <h1>Cards</h1>
      <p class="subtitle">Member cards for the card printer. Choose an SVG of the preprinted card for each side, put the fields where they belong, and print —
        one side at a time. Only the fields print, unless a side is set to print its image too (for blank cards). Print cards for one member from Find, or for a whole list from Lists.</p>
      <div class="row cards-top">
        <label class="lists-inline">Design <select id="card-design"></select></label>
        <button class="btn secondary" type="button" id="card-new">New design…</button>
        <span id="card-design-acts"></span>
      </div>
      <div id="card-body"></div>`;

    const body = qs("#card-body", container);
    const side_ = () => design.sides[side];
    const el = (id) => side_().elements.find((e) => e.id === id) || null;
    const fieldLabel = (key) => fieldChoices.find((f) => f.k === key)?.label || key;
    const round = (v) => Math.round(v * 10) / 10;

    function renderDesignSelect() {
      const select = qs("#card-design", container);
      select.innerHTML = designs.length ? designs.map((d) => `<option value="${d.id}" ${design?.id === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("") : `<option value="">No designs yet</option>`;
      qs("#card-design-acts", container).innerHTML = design
        ? `<button class="btn secondary" type="button" id="card-rename">Rename…</button> <button class="btn danger" type="button" id="card-delete">Delete…</button>`
        : "";
    }

    async function openDesign(id) {
      if (!id) {
        design = null;
        renderDesignSelect();
        body.innerHTML = `<div class="empty">No card designs yet. <strong>New design…</strong> starts one.</div>`;
        return;
      }
      const got = await window.api.getCardDesign(id);
      design = got.design;
      images = got.images;
      fonts = got.fonts;
      cardDpiSetting = got.dpi;
      size = got.size;
      window.__cardDesign = id;
      fieldChoices = await window.api.cardFields(design.cardFor);
      selectedId = null;
      previewRef = null;
      renderDesignSelect();
      renderBody(got.printer);
      await refreshValues();
    }

    // ---- saving ----

    let saveTimer = null;
    let saving = Promise.resolve();
    function saveSoon() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const id = design.id;
        const patch = { sides: { [side]: side_() } };
        saving = window.api
          .updateCardDesign(id, patch)
          .then((saved) => {
            if (design?.id === id) design.sides = { ...design.sides, [side]: { ...saved.sides[side], elements: design.sides[side].elements } };
            return refreshValues();
          })
          .catch((err) => toast(`Couldn't save: ${err.message}`, true));
      }, 350);
    }
    async function saveSettings(patch) {
      try {
        design = { ...design, ...(await window.api.updateCardDesign(design.id, patch)) };
        designs = await window.api.listCardDesigns();
        renderDesignSelect();
      } catch (err) {
        toast(err.message, true);
      }
    }

    async function refreshValues() {
      if (!design) return;
      preview = await window.api.cardValues(design.id, side, previewRef);
      previewRef = preview.ref || previewRef;
      const who = qs("#card-who", container);
      if (who) who.textContent = preview.name ? `Showing ${preview.name}` : "No one on the list to show yet";
      renderCanvas();
    }

    // ---- the page ----

    function renderBody(printer) {
      size = design.orientation === "portrait" ? { w: 53.98, h: 85.6 } : { w: 85.6, h: 53.98 };
      body.innerHTML = `
        <div class="cards-layout">
          <div class="cards-main">
            <div class="row cards-top">
              <label class="lists-inline">A card for
                <select id="card-for"><option value="household">each household</option><option value="person">each person</option></select></label>
              <label class="lists-inline">Orientation
                <select id="card-orient"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
              <span class="toolbar-gap"></span>
              <div class="tabs card-sides">
                <button class="tab" type="button" data-side="front">Front</button>
                <button class="tab" type="button" data-side="back">Back</button>
              </div>
            </div>
            <div class="row cards-top">
              <span id="card-image-name" class="hint"></span>
              <button class="btn secondary" type="button" id="card-image">Choose template SVG…</button>
              <button class="btn secondary" type="button" id="card-image-clear">Remove image</button>
              <label class="check-label"><input type="checkbox" id="card-print-image" /> Print the image too (blank cards)</label>
            </div>
            <div class="card-stage" id="card-stage"><div class="card-canvas" id="card-canvas" tabindex="0"></div></div>
            <div class="row cards-top">
              <span class="hint" id="card-who"></span>
              <input type="search" id="card-who-q" placeholder="Show someone else…" autocomplete="off" style="width:220px" />
              <div class="card-who-results" id="card-who-results" hidden></div>
            </div>
            <div class="row cards-top">
              <label class="lists-inline" title="Moves everything on this side, for a printer that prints a little off">Adjust position
                ← → <input type="number" id="card-off-x" step="0.1" style="width:70px" /> mm
                ↑ ↓ <input type="number" id="card-off-y" step="0.1" style="width:70px" /> mm</label>
            </div>
            <div class="row cards-top">
              <button class="btn secondary" type="button" id="card-pdf">Preview as PDF</button>
              <button class="btn secondary" type="button" id="card-test">Print a test card</button>
              <label class="lists-inline">Card printer <select id="card-printer"><option value="">Ask each time</option></select></label>
              <label class="lists-inline" title="What MemberManager asks the printer for. The SMART-51 prints colour at 300 dpi, and black at up to 1200 dpi with a black resin (K) ribbon panel.">Print resolution
                <select id="card-dpi">
                  <option value="300">300 dpi (colour)</option>
                  <option value="600">600 dpi (black resin)</option>
                  <option value="1200">1200 dpi (black resin)</option>
                  <option value="0">The printer's default</option>
                </select></label>
            </div>
            <p class="hint">Preview as PDF shows the card with its template image, to check where everything lands without using a card. The test card is the person shown,
              on the side shown. Print cards for a list on the Lists page, or for one member from their card on Find.</p>
          </div>
          <div class="cards-side panel">
            <h2 style="margin-top:0">Add to the ${side}</h2>
            <select id="card-add-field" aria-label="Field to add"></select>
            <div class="row" style="margin-top:6px"><button class="btn" type="button" id="card-add">Add field</button><button class="btn secondary" type="button" id="card-add-text">Add text</button></div>
            <div id="card-props"></div>
            <h2>On the ${side}</h2>
            <div id="card-elements"></div>
          </div>
        </div>`;
      qs("#card-for", body).value = design.cardFor;
      qs("#card-orient", body).value = design.orientation;
      qs("#card-print-image", body).checked = !!side_().printImage;
      qs("#card-off-x", body).value = side_().offset?.x ?? 0;
      qs("#card-off-y", body).value = side_().offset?.y ?? 0;
      qsa(".card-sides .tab", body).forEach((t) => t.classList.toggle("active", t.dataset.side === side));
      qs("#card-image-name", body).textContent = side_().image ? `Template: ${side_().imageName || "SVG"}` : `No template image for the ${side} yet.`;
      qs("#card-image-clear", body).hidden = !side_().image;
      const groups = new Map();
      for (const f of fieldChoices) {
        if (!groups.has(f.group)) groups.set(f.group, []);
        groups.get(f.group).push(f);
      }
      qs("#card-add-field", body).innerHTML = [...groups].map(([g, fs]) => `<optgroup label="${escapeHtml(g)}">${fs.map((f) => `<option value="${escapeHtml(f.k)}">${escapeHtml(f.label)}</option>`).join("")}</optgroup>`).join("");
      window.api.cardPrinters().then((names) => {
        const select = qs("#card-printer", body);
        if (!select) return;
        select.innerHTML = `<option value="">Ask each time</option>${names.map((n) => `<option ${n === printer ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}`;
        if (printer && !names.includes(printer)) select.innerHTML += `<option selected>${escapeHtml(printer)}</option>`;
      });
      // Scale the card to the space there is.
      const room = qs("#card-stage", body).clientWidth - 24;
      scale = Math.max(4, Math.min(10, room / size.w));
      wireBody();
      renderCanvas();
    }

    function elementStyle(e) {
      return [
        `left:${e.x * scale}px`,
        `top:${e.y * scale}px`,
        `width:${e.w * scale}px`,
        e.h ? `height:${e.h * scale}px` : "",
        `font-family:'${e.font}',Arial,sans-serif`,
        `font-size:${e.size * MM_PER_PT * scale}px`,
        e.bold ? "font-weight:700" : "",
        e.italic ? "font-style:italic" : "",
        `text-align:${e.align}`,
        `color:${e.color}`,
      ]
        .filter(Boolean)
        .join(";");
    }

    function renderCanvas() {
      const canvas = qs("#card-canvas", body);
      if (!canvas) return;
      canvas.style.width = `${size.w * scale}px`;
      canvas.style.height = `${size.h * scale}px`;
      canvas.innerHTML =
        (images[side] ? `<img class="card-bg" src="${images[side]}" alt="" draggable="false" />` : `<div class="card-nobg">No template image — choose an SVG of the ${side}</div>`) +
        side_()
          .elements.map((e) => {
            const value = preview.values?.[e.id];
            const shown = value || (e.kind === "text" ? e.text : `‹${fieldLabel(e.key)}›`);
            return `<div class="card-el${e.id === selectedId ? " sel" : ""}${value ? "" : " empty"}" data-el="${e.id}" style="${elementStyle(e)}">${escapeHtml(value ? shown : e.case === "upper" ? shown.toUpperCase() : shown)}<span class="card-handle" data-handle="${e.id}"></span></div>`;
          })
          .join("");
      // Shrink to fit, as it will print.
      for (const div of qsa(".card-el", canvas)) {
        const e = el(div.dataset.el);
        if (!e?.fit) continue;
        let px = parseFloat(div.style.fontSize);
        const min = 4 * MM_PER_PT * scale;
        while (px > min && (div.scrollWidth > div.clientWidth + 1 || div.scrollHeight > div.clientHeight + 1)) {
          px -= 0.25 * MM_PER_PT * scale;
          div.style.fontSize = `${px}px`;
        }
      }
      renderProps();
      renderElementList();
    }

    function renderElementList() {
      const box = qs("#card-elements", body);
      if (!box) return;
      box.innerHTML = side_().elements.length
        ? side_()
            .elements.map((e) => `<div class="card-list-item${e.id === selectedId ? " sel" : ""}" data-pick="${e.id}">${escapeHtml(e.kind === "text" ? `“${e.text || "Text"}”` : fieldLabel(e.key))}</div>`)
            .join("")
        : `<p class="hint">Nothing yet. Add a field, then drag it into place.</p>`;
    }

    function renderProps() {
      const box = qs("#card-props", body);
      if (!box) return;
      const e = el(selectedId);
      if (!e) {
        box.innerHTML = `<p class="hint">Click something on the card to change it.</p>`;
        return;
      }
      const num = (prop, label, step = 0.5) => `<label>${label} <input type="number" data-prop="${prop}" value="${e[prop] ?? ""}" step="${step}" /></label>`;
      box.innerHTML = `
        <h2>${escapeHtml(e.kind === "text" ? "Text" : fieldLabel(e.key))}</h2>
        <div class="card-props">
          ${
            e.kind === "text"
              ? `<label class="wide">Text <textarea data-prop="text" rows="2">${escapeHtml(e.text)}</textarea></label>`
              : `<label class="wide">Field <select data-prop="key">${fieldChoices.map((f) => `<option value="${escapeHtml(f.k)}" ${f.k === e.key ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("")}</select></label>
                 <label class="wide">Before it <input type="text" data-prop="prefix" value="${escapeHtml(e.prefix)}" placeholder="e.g. ID: " /></label>`
          }
          ${num("x", "Left (mm)")}${num("y", "Top (mm)")}${num("w", "Width (mm)")}${num("h", "Height (mm, blank = 1 line)")}
          <label>Font <select data-prop="font">${fonts.map((f) => `<option value="${escapeHtml(f.family)}" ${f.family === e.font ? "selected" : ""}>${escapeHtml(f.family)}${f.note ? ` (${escapeHtml(f.note)})` : ""}</option>`).join("")}</select></label>
          ${num("size", "Size (pt)")}
          <label>Align <select data-prop="align">${["left", "center", "right"].map((a) => `<option value="${a}" ${a === e.align ? "selected" : ""}>${a[0].toUpperCase() + a.slice(1)}</option>`).join("")}</select></label>
          <label>Colour <input type="color" data-prop="color" value="${escapeHtml(e.color.length === 7 ? e.color : "#000000")}" /></label>
          <label class="check-label"><input type="checkbox" data-prop="bold" ${e.bold ? "checked" : ""} /> Bold</label>
          <label class="check-label"><input type="checkbox" data-prop="italic" ${e.italic ? "checked" : ""} /> Italic</label>
          <label class="wide">Capitals <select data-prop="case">${[
            ["asis", "As entered"],
            ["name", "Names: First Letters (“Bruce L Graber”)"],
            ["upper", "ALL CAPITALS"],
          ]
            .map(([v, label]) => `<option value="${v}" ${v === (e.case || "asis") ? "selected" : ""}>${label}</option>`)
            .join("")}</select></label>
          <label class="check-label" title="Smaller type when it doesn't fit, rather than cut off"><input type="checkbox" data-prop="fit" ${e.fit ? "checked" : ""} /> Shrink to fit</label>
        </div>
        <button class="btn danger" type="button" data-remove-el>Remove</button>`;
    }

    // ---- editing ----

    const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    function addElement(kind, key) {
      const f = fieldChoices.find((x) => x.k === key);
      const e = {
        id: newId(),
        kind,
        key: kind === "field" ? key : "",
        text: kind === "text" ? "Text" : "",
        prefix: "",
        x: 5,
        y: 5 + (side_().elements.length % 8) * 5,
        w: Math.min(50, size.w - 10),
        h: f?.lines ? 12 : null,
        font: "Arial",
        size: 9,
        bold: false,
        italic: false,
        align: "left",
        color: "#000000",
        // Names come in capitals; a name field starts out printed as "Bruce L Graber".
        case: kind === "field" && f?.name ? "name" : "asis",
        fit: true,
      };
      side_().elements.push(e);
      selectedId = e.id;
      saveSoon();
      renderCanvas();
    }

    function setProp(prop, value) {
      const e = el(selectedId);
      if (!e) return;
      if (["x", "y", "w", "size"].includes(prop)) e[prop] = Number(value) || 0;
      else if (prop === "h") e.h = value === "" ? null : Number(value) || null;
      else e[prop] = value;
      saveSoon();
      const div = qs(`[data-el="${e.id}"]`, body);
      if (div && prop !== "key" && prop !== "text" && prop !== "prefix" && prop !== "case") {
        div.setAttribute("style", elementStyle(e));
        if (e.fit) renderCanvas();
      } else renderCanvas();
    }

    function wireBody() {
      qs("#card-for", body).addEventListener("change", async (e) => {
        await saveSettings({ cardFor: e.target.value });
        await openDesign(design.id);
      });
      qs("#card-orient", body).addEventListener("change", async (e) => {
        await saveSettings({ orientation: e.target.value });
        await openDesign(design.id);
      });
      qsa(".card-sides .tab", body).forEach((t) =>
        t.addEventListener("click", async () => {
          await saving;
          side = window.__cardSide = t.dataset.side;
          selectedId = null;
          renderBody(qs("#card-printer", body)?.value || "");
          await refreshValues();
        })
      );
      qs("#card-image", body).addEventListener("click", async () => {
        try {
          const r = await window.api.setCardImage(design.id, side);
          if (!r) return;
          design = r.design;
          images[side] = r.image;
          if (r.warning) toast(r.warning, true);
          renderBody(qs("#card-printer", body)?.value || "");
          await refreshValues();
        } catch (err) {
          toast(err.message, true);
        }
      });
      qs("#card-image-clear", body).addEventListener("click", async () => {
        if (!(await confirmAction(`Remove the ${side}'s template image? The fields stay where they are.`, "Remove"))) return;
        design = await window.api.clearCardImage(design.id, side);
        images[side] = null;
        renderBody(qs("#card-printer", body)?.value || "");
        await refreshValues();
      });
      qs("#card-print-image", body).addEventListener("change", (e) => {
        side_().printImage = e.target.checked;
        saveSoon();
      });
      for (const axis of ["x", "y"]) {
        qs(`#card-off-${axis}`, body).addEventListener("change", (e) => {
          side_().offset = { ...(side_().offset || { x: 0, y: 0 }), [axis]: Number(e.target.value) || 0 };
          saveSoon();
        });
      }
      qs("#card-printer", body).addEventListener("change", (e) => window.api.setCardPrinter(e.target.value));
      qs("#card-dpi", body).value = String(cardDpiSetting);
      qs("#card-dpi", body).addEventListener("change", async (e) => (cardDpiSetting = await window.api.setCardDpi(Number(e.target.value))));
      qs("#card-add", body).addEventListener("click", () => addElement("field", qs("#card-add-field", body).value));
      qs("#card-add-text", body).addEventListener("click", () => addElement("text"));
      const job = (pdf) => async () => {
        await saving;
        try {
          if (!previewRef) throw new Error("There's no one on the list to make a card for yet.");
          await window.api.printCards({ designId: design.id, side, refs: [previewRef], pdf });
        } catch (err) {
          toast(err.message, true);
        }
      };
      qs("#card-pdf", body).addEventListener("click", job(true));
      qs("#card-test", body).addEventListener("click", job(false));

      // Whose values are shown.
      const whoQ = qs("#card-who-q", body);
      const whoResults = qs("#card-who-results", body);
      let whoTimer = null;
      whoQ.addEventListener("input", () => {
        clearTimeout(whoTimer);
        whoTimer = setTimeout(async () => {
          if (!whoQ.value.trim()) {
            whoResults.hidden = true;
            return;
          }
          const r = await window.api.findSearch(whoQ.value, { kind: design.cardFor === "person" ? "p" : "h", inactive: true, limit: 8 });
          whoResults.innerHTML = r.results.map((x) => `<div class="card-who-item" data-ref="${escapeHtml(x.id)}">${escapeHtml(x.title)} <span class="hint">${escapeHtml(x.sub)}</span></div>`).join("") || `<div class="hint">No one found.</div>`;
          whoResults.hidden = false;
        }, 150);
      });
      whoResults.addEventListener("click", async (e) => {
        const item = e.target.closest("[data-ref]");
        if (!item) return;
        previewRef = { k: design.cardFor === "person" ? "p" : "h", id: item.dataset.ref };
        whoResults.hidden = true;
        whoQ.value = "";
        await refreshValues();
      });

      // Moving and sizing on the card.
      const canvas = qs("#card-canvas", body);
      canvas.addEventListener("pointerdown", (e) => {
        const handle = e.target.closest("[data-handle]");
        const div = e.target.closest("[data-el]");
        if (!div) {
          selectedId = null;
          renderCanvas();
          return;
        }
        const item = el(div.dataset.el);
        selectedId = item.id;
        qsa(".card-el", canvas).forEach((d) => d.classList.toggle("sel", d === div));
        renderProps();
        renderElementList();
        canvas.focus();
        const start = { px: e.clientX, py: e.clientY, x: item.x, y: item.y, w: item.w };
        div.setPointerCapture(e.pointerId);
        const move = (m) => {
          const dx = (m.clientX - start.px) / scale;
          const dy = (m.clientY - start.py) / scale;
          if (handle) item.w = Math.max(2, round(start.w + dx));
          else {
            item.x = round(start.x + dx);
            item.y = round(start.y + dy);
          }
          div.setAttribute("style", elementStyle(item));
        };
        const up = () => {
          div.removeEventListener("pointermove", move);
          div.removeEventListener("pointerup", up);
          if (item.x !== start.x || item.y !== start.y || item.w !== start.w) {
            saveSoon();
            renderCanvas();
          }
        };
        div.addEventListener("pointermove", move);
        div.addEventListener("pointerup", up);
        e.preventDefault();
      });
      canvas.addEventListener("keydown", (e) => {
        const item = el(selectedId);
        if (!item) return;
        const step = e.shiftKey ? 2 : 0.5;
        const moves = { ArrowLeft: ["x", -step], ArrowRight: ["x", step], ArrowUp: ["y", -step], ArrowDown: ["y", step] };
        if (moves[e.key]) {
          e.preventDefault();
          const [prop, by] = moves[e.key];
          item[prop] = round(item[prop] + by);
          saveSoon();
          renderCanvas();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          side_().elements = side_().elements.filter((x) => x.id !== item.id);
          selectedId = null;
          saveSoon();
          renderCanvas();
        }
      });
      const panel = qs(".cards-side", body);
      panel.addEventListener("click", (e) => {
        const pick = e.target.closest("[data-pick]");
        if (pick) {
          selectedId = pick.dataset.pick;
          renderCanvas();
        }
        if (e.target.closest("[data-remove-el]")) {
          side_().elements = side_().elements.filter((x) => x.id !== selectedId);
          selectedId = null;
          saveSoon();
          renderCanvas();
        }
      });
      const onProp = (e) => {
        const input = e.target.closest("[data-prop]");
        if (!input) return;
        setProp(input.dataset.prop, input.type === "checkbox" ? input.checked : input.value);
      };
      panel.addEventListener("change", onProp);
      panel.addEventListener("input", (e) => e.target.matches("input[type=text], textarea") && onProp(e));
    }

    // ---- designs ----

    qs("#card-design", container).addEventListener("change", (e) => openDesign(e.target.value));
    qs("#card-new", container).addEventListener("click", async () => {
      const made = await window.api.createCardDesign({ name: designs.length ? `Member card ${designs.length + 1}` : "Member card", cardFor: "household", orientation: "landscape" });
      designs = await window.api.listCardDesigns();
      side = window.__cardSide = "front";
      await openDesign(made.id);
      toast("Started a new design. Choose an SVG of the card's front, then add fields.");
    });
    qs("#card-design-acts", container).addEventListener("click", async (e) => {
      if (e.target.closest("#card-rename")) {
        const acts = qs("#card-design-acts", container);
        acts.innerHTML = `<input type="text" id="card-name" value="${escapeHtml(design.name)}" maxlength="80" /> <button class="btn" type="button" id="card-name-save">Save</button>`;
        const input = qs("#card-name", acts);
        input.select();
        const save = () => saveSettings({ name: input.value });
        qs("#card-name-save", acts).addEventListener("click", save);
        input.addEventListener("keydown", (k) => k.key === "Enter" && save());
      }
      if (e.target.closest("#card-delete")) {
        if (!(await confirmAction(`Delete the card design “${design.name}”, front and back? Cards already printed aren't affected.`, "Delete"))) return;
        await window.api.deleteCardDesign(design.id);
        designs = await window.api.listCardDesigns();
        await openDesign(designs[0]?.id || null);
      }
    });

    await openDesign(designs.find((d) => d.id === window.__cardDesign)?.id || designs[0]?.id || null);
    // A change still waiting to be saved is saved before another page opens.
    window.__beforeNavigate = () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      if (design) window.api.updateCardDesign(design.id, { sides: { [side]: side_() } });
    };
  },
};
