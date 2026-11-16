"use strict";

// The "Print card…" panel on Find and "Print cards…" on Lists: which card
// design (one made for households or for people, to match), which side, and
// then a PDF preview or the card printer. A list's cards print in the list's
// order; "Reverse order" is for feeding the same stack back in for the other
// side, if the printer turns it over.
//
//   openCardPrint(host, { cardFor: "household" | "person", refs } | { cardFor, listState, count })

window.openCardPrint = async function openCardPrint(host, job) {
  const designs = (await window.api.listCardDesigns()).filter((d) => d.cardFor === job.cardFor);
  const many = job.listState ? job.count : (job.refs || []).length;
  if (!designs.length) {
    host.innerHTML = `<div class="panel card-print">There's no card design for each ${job.cardFor} yet. <a href="#" data-go-cards>Make one on the Cards page.</a></div>`;
    host.querySelector("[data-go-cards]").addEventListener("click", (e) => {
      e.preventDefault();
      navigate("cards");
    });
    return;
  }
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem("cardPrint.last") || "{}");
    } catch {
      return {};
    }
  })();
  host.innerHTML = `
    <div class="panel card-print">
      <div class="row">
        <strong>Print ${plural(many, "card")}</strong>
        <label class="lists-inline">Design <select data-cp="design">${designs.map((d) => `<option value="${d.id}" ${d.id === last.design ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}</select></label>
        <label class="lists-inline">Side <select data-cp="side"><option value="front">Front</option><option value="back" ${last.side === "back" ? "selected" : ""}>Back</option></select></label>
        ${many > 1 ? `<label class="check-label"><input type="checkbox" data-cp="reverse" /> Reverse order</label>` : ""}
        <span class="toolbar-gap"></span>
        <button class="btn secondary" type="button" data-cp="pdf">Preview as PDF</button>
        <button class="btn" type="button" data-cp="print">Print</button>
        <button class="btn secondary" type="button" data-cp="close" aria-label="Close">×</button>
      </div>
      <p class="hint" style="margin:6px 0 0">Load ${many > 1 ? "the cards" : "a card"} with the preprinted side facing the way the printer prints. The preview shows the template image; the printer gets only what the design prints.</p>
    </div>`;
  const get = (name) => host.querySelector(`[data-cp="${name}"]`);
  const run = (pdf) => async (e) => {
    const btn = e.target;
    const settings = { design: get("design").value, side: get("side").value };
    try {
      localStorage.setItem("cardPrint.last", JSON.stringify(settings));
    } catch {
      // nothing to remember it in
    }
    btn.disabled = true;
    try {
      const r = await window.api.printCards({ designId: settings.design, side: settings.side, refs: job.refs, listState: job.listState, pdf, reverse: !!get("reverse")?.checked });
      if (!pdf) toast(r.cards ? `Sent ${plural(r.cards, "card")} to the printer.` : "Nothing was printed.");
    } catch (err) {
      toast(err.message, true);
    }
    btn.disabled = false;
  };
  get("pdf").addEventListener("click", run(true));
  get("print").addEventListener("click", run(false));
  get("close").addEventListener("click", () => (host.innerHTML = ""));
};
