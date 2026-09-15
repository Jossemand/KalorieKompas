import {
  MEALS, store, subscribe, addMadret, deleteMadret, sumNutrition, billedeUrl, setMadretBillede, removeMadretBillede,
} from "../state.js";
import { prepareImage } from "../lib/image.js";
import { icon, MEAL_ICONS } from "../lib/icons.js";
import { escapeHtml, formatKcal, highlight, parseDecimal, searchByName, toInputValue } from "../lib/format.js";
import { emptyStateHtml, macrosHtml } from "../lib/templates.js";
import { confirmDialog, openSheet, setBusy, showError, toast } from "../lib/ui.js";

const $ = id => document.getElementById(id);
const MAX_RESULTS = 20;
const STEP_G = 10;
const finePointer = matchMedia("(pointer: fine)"); // mus/trackpad – på touch skal Enter ikke tilføje noget

let filter = "Alle";
let pending = [];    // kladde til ny madret: [{ ingrediens, maengde_g }]
let highlighted = 0; // valgt søgeresultat ved piletaster
let draftPhoto = null;  // kladdens billede: { blob, url }
let photoDishId = null; // madretten, der vises i billede-arket

export function setupMadretter(){
  $("btn-new-madret").addEventListener("click", () => openBuilder());
  $("madret-filter").addEventListener("click", event => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    filter = chip.dataset.filter;
    render();
  });
  $("madretter-list").addEventListener("click", onListClick);

  const search = $("madret-search");
  search.addEventListener("input", renderResults);
  search.addEventListener("keydown", onSearchKeydown);
  $("madret-search-clear").addEventListener("click", () => {
    search.value = "";
    renderResults();
    search.focus();
  });
  $("madret-results").addEventListener("click", event => {
    const result = event.target.closest("[data-id]");
    if (result) addPending(result.dataset.id);
  });
  $("madret-pending").addEventListener("click", onPendingClick);
  $("madret-pending").addEventListener("input", onPendingInput);
  $("madret-form").addEventListener("submit", onSubmit);
  setupPhotos();
  subscribe(render);
}

/* ---------- Oversigt ---------- */
function render(){
  if (!store.loaded) return;
  const all = store.madretter;
  $("madretter-sub").textContent = all.length
    ? `${all.length} ${all.length === 1 ? "madret" : "madretter"}`
    : "Retter bygget af dine ingredienser";

  const filterBar = $("madret-filter");
  filterBar.hidden = all.length === 0;
  filterBar.innerHTML = ["Alle", ...MEALS].map(name => {
    const count = name === "Alle" ? all.length : all.filter(d => d.kategori === name).length;
    const active = filter === name;
    return `<button type="button" class="chip${active ? " is-active" : ""}" data-filter="${name}" aria-pressed="${active}">${name}<span class="chip-count">${count}</span></button>`;
  }).join("");

  const list = $("madretter-list");
  list.removeAttribute("aria-busy");

  if (all.length === 0) {
    const hasIngredients = store.ingredienser.length > 0;
    list.innerHTML = emptyStateHtml({
      iconName: "cooking-pot",
      title: "Ingen madretter endnu",
      text: hasIngredients
        ? "Sæt dine ingredienser sammen til en ret, så beregnes kalorierne automatisk."
        : "Tilføj først nogle ingredienser, og byg dem derefter sammen til retter.",
      action: hasIngredients ? `<button type="button" class="btn btn-primary" data-new>${icon("plus")}Ny madret</button>` : "",
    });
    return;
  }

  const dishes = filter === "Alle" ? all : all.filter(d => d.kategori === filter);
  if (dishes.length === 0) {
    list.innerHTML = emptyStateHtml({
      iconName: MEAL_ICONS[filter],
      title: `Ingen retter under ${filter.toLowerCase()}`,
      text: "Opret en ny madret i denne kategori.",
      action: `<button type="button" class="btn btn-primary" data-new="${filter}">${icon("plus")}Ny madret</button>`,
    });
    return;
  }

  list.innerHTML = dishes.map(dish => {
    const names = dish.madret_ingredienser.map(row => row.ingredienser?.navn).filter(Boolean).join(", ");
    const name = escapeHtml(dish.navn);
    const photo = billedeUrl(dish.billede_sti);
    const photoButton = store.billederKlar
      ? `<button type="button" class="icon-btn" data-photo aria-label="${photo ? "Skift billede af" : "Tilføj billede til"} ${name}">${icon(photo ? "camera" : "image-plus")}</button>`
      : "";
    return `
      <article class="dish card" data-id="${dish.id}">
        ${photo ? `<button type="button" class="dish-photo" data-photo aria-label="Billede af ${name}"><img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async"></button>` : ""}
        <div class="dish-top">
          <span class="badge" data-cat="${dish.kategori}">${icon(MEAL_ICONS[dish.kategori], 14)}${dish.kategori}</span>
          <div class="dish-actions">
            ${photoButton}
            <button type="button" class="icon-btn icon-btn-danger" data-delete aria-label="Slet ${name}">${icon("trash")}</button>
          </div>
        </div>
        <h3 class="dish-title">${escapeHtml(dish.navn)}</h3>
        <p class="dish-ingredients">${escapeHtml(names || "Ingen ingredienser")}</p>
        <div class="dish-foot">
          <p class="dish-kcal"><strong>${formatKcal(dish.kcal)}</strong> kcal</p>
          ${macrosHtml(dish)}
        </div>
      </article>`;
  }).join("");
}

async function onListClick(event){
  const newButton = event.target.closest("[data-new]");
  if (newButton) return openBuilder(newButton.dataset.new);

  const photoButton = event.target.closest("[data-photo]");
  if (photoButton) return openPhotoSheet(photoButton.closest("[data-id]").dataset.id);

  const deleteButton = event.target.closest("[data-delete]");
  if (!deleteButton) return;
  const dish = store.madretter.find(d => d.id === deleteButton.closest("[data-id]").dataset.id);
  const plannedCount = Object.values(store.ugeplan).filter(id => id === dish.id).length;

  const confirmed = await confirmDialog({
    title: `Slet ${dish.navn}?`,
    message: plannedCount
      ? `Retten står ${plannedCount} ${plannedCount === 1 ? "gang" : "gange"} i ugeplanen og fjernes også derfra.`
      : "Madretten slettes permanent.",
  });
  if (!confirmed) return;

  try {
    await deleteMadret(dish.id);
    toast(`${dish.navn} er slettet`);
  } catch (err) {
    showError(err);
  }
}

/* ---------- Byg ny madret ---------- */
// Kladden bevares, hvis arket lukkes uden at gemme, så et fejltryk ikke sletter arbejdet
export function openBuilder(kategori){
  const form = $("madret-form");
  const isEmptyDraft = pending.length === 0 && !$("madret-navn").value.trim() && !draftPhoto;
  if (isEmptyDraft) {
    form.reset();
    const preset = MEALS.includes(kategori) ? kategori : "Morgenmad";
    form.querySelector(`input[name="kategori"][value="${preset}"]`).checked = true;
  }
  $("madret-search").value = "";
  renderResults();
  renderPending();
  renderDraftPhoto();
  openSheet($("madret-sheet"));
}

function renderResults(){
  const query = $("madret-search").value;
  const box = $("madret-results");
  $("madret-search-clear").hidden = !query;
  highlighted = 0;

  if (!query.trim()) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  box.hidden = false;
  const matches = searchByName(store.ingredienser, query).slice(0, MAX_RESULTS);
  if (matches.length === 0) {
    box.innerHTML = `<li class="results-empty">Ingen ingredienser matcher "${escapeHtml(query)}". Tilføj den under Ingredienser først.</li>`;
    return;
  }

  box.innerHTML = matches.map((ing, index) => {
    const added = pending.some(p => p.ingrediens.id === ing.id);
    const classes = ["result", added && "is-added", index === 0 && finePointer.matches && "is-highlighted"].filter(Boolean).join(" ");
    return `
      <li>
        <button type="button" class="${classes}" data-id="${ing.id}">
          <span class="result-name">${highlight(ing.navn, query)}</span>
          <span class="result-kcal">${formatKcal(ing.kcal_100g)} kcal/100 g</span>
          <span class="result-add">${icon(added ? "check" : "plus", 18)}</span>
        </button>
      </li>`;
  }).join("");
}

function onSearchKeydown(event){
  if (event.key === "Enter") event.preventDefault(); // Enter i søgefeltet må ikke gemme retten
  const buttons = [...$("madret-results").querySelectorAll(".result")];
  if (buttons.length === 0) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlighted = (highlighted + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.classList.toggle("is-highlighted", index === highlighted));
    buttons[highlighted].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && finePointer.matches) {
    addPending(buttons[highlighted].dataset.id);
  }
}

function addPending(id){
  const ing = store.ingredienser.find(i => i.id === id);
  if (!ing) return;

  if (!pending.some(p => p.ingrediens.id === id)) {
    pending.push({ ingrediens: ing, maengde_g: 100 });
    renderPending();
  }
  const row = $("madret-pending").querySelector(`[data-id="${id}"]`);
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  const search = $("madret-search");
  search.value = "";
  renderResults();
  if (finePointer.matches) search.focus();
}

const rowKcal = item => (item.maengde_g / 100) * (Number(item.ingrediens.kcal_100g) || 0);

function renderPending(){
  $("madret-pending").innerHTML = pending.map(item => {
    const name = escapeHtml(item.ingrediens.navn);
    return `
      <li class="pending" data-id="${item.ingrediens.id}">
        <div class="pending-info">
          <p class="pending-name">${name}</p>
          <p class="pending-kcal"><span data-kcal>${formatKcal(rowKcal(item))}</span> kcal</p>
        </div>
        <div class="stepper">
          <button type="button" class="icon-btn icon-btn-soft" data-step="-${STEP_G}" aria-label="${STEP_G} g mindre">${icon("minus", 18)}</button>
          <label class="input-unit input-unit-sm">
            <input value="${toInputValue(item.maengde_g)}" inputmode="decimal" autocomplete="off" aria-label="Mængde af ${name} i gram"><span>g</span>
          </label>
          <button type="button" class="icon-btn icon-btn-soft" data-step="${STEP_G}" aria-label="${STEP_G} g mere">${icon("plus", 18)}</button>
        </div>
        <button type="button" class="icon-btn icon-btn-danger" data-remove aria-label="Fjern ${name}">${icon("x")}</button>
      </li>`;
  }).join("");

  $("madret-pending-empty").hidden = pending.length > 0;
  $("madret-count").textContent = pending.length
    ? `${pending.length} ${pending.length === 1 ? "ingrediens" : "ingredienser"}`
    : "";
  updateTotals();
}

function updateTotals(){
  const total = sumNutrition(pending);
  $("madret-total-kcal").textContent = formatKcal(total.kcal);
  $("madret-total-macros").innerHTML = macrosHtml(total);
}

function pendingItemFor(target){
  const row = target.closest(".pending");
  return row && { row, item: pending.find(p => p.ingrediens.id === row.dataset.id) };
}

function onPendingClick(event){
  const found = pendingItemFor(event.target);
  if (!found) return;
  const { row, item } = found;

  if (event.target.closest("[data-remove]")) {
    pending = pending.filter(p => p !== item);
    renderPending();
    return;
  }
  const step = event.target.closest("[data-step]");
  if (step) {
    item.maengde_g = Math.max(0, item.maengde_g + Number(step.dataset.step));
    row.querySelector("input").value = toInputValue(item.maengde_g);
    updateRow(row, item);
  }
}

// Opdater kalorier mens der tastes – uden at gentegne rækken, så fokus og tastatur bevares
function onPendingInput(event){
  if (event.target.tagName !== "INPUT") return;
  const found = pendingItemFor(event.target);
  if (!found) return;
  const value = parseDecimal(event.target.value);
  found.item.maengde_g = Number.isFinite(value) && value > 0 ? value : 0;
  updateRow(found.row, found.item);
}

function updateRow(row, item){
  row.querySelector("[data-kcal]").textContent = formatKcal(rowKcal(item));
  updateTotals();
}

async function onSubmit(event){
  event.preventDefault();
  const form = event.currentTarget;
  const nameInput = $("madret-navn");
  const nameField = nameInput.closest(".field");
  nameField.classList.remove("is-invalid");

  const navn = nameInput.value.trim();
  const kategori = form.elements.kategori.value;
  if (!navn) {
    nameField.classList.add("is-invalid");
    nameInput.focus();
    return toast("Giv madretten et navn", { type: "error" });
  }
  if (pending.length === 0) {
    $("madret-search").focus();
    return toast("Tilføj mindst én ingrediens", { type: "error" });
  }
  if (pending.some(item => !(item.maengde_g > 0))) {
    return toast("Alle ingredienser skal have en mængde over 0 g", { type: "error" });
  }

  const submit = $("madret-submit");
  setBusy(submit, true);
  try {
    const { billedeFejl } = await addMadret({ navn, kategori, items: pending, billede: draftPhoto?.blob });
    pending = [];
    setDraftPhoto(null);
    form.reset();
    $("madret-sheet").close();
    if (filter !== "Alle" && filter !== kategori) {
      filter = "Alle"; // vis den nye ret, selvom et andet filter var valgt
      render();
    }
    if (billedeFejl) showError(new Error(`${navn} er gemt, men billedet kom ikke med. ${billedeFejl.message}`));
    else toast(`${navn} er gemt`);
  } catch (err) {
    showError(err);
  } finally {
    setBusy(submit, false);
  }
}

/* ---------- Billeder ---------- */
function setupPhotos(){
  // Billede i byggeren til en ny ret
  const pickDraft = () => { if (billederKlar()) $("madret-photo-input").click(); };
  $("madret-photo-pick").addEventListener("click", pickDraft);
  $("madret-photo-change").addEventListener("click", pickDraft);
  $("madret-photo-remove").addEventListener("click", () => setDraftPhoto(null));
  $("madret-photo-input").addEventListener("change", async event => {
    const file = takeFile(event.target);
    if (!file) return;
    try {
      setDraftPhoto(await prepareImage(file));
    } catch (err) {
      showError(err);
    }
  });

  // Billede af en eksisterende ret
  $("billede-sheet-pick").addEventListener("click", () => $("billede-sheet-input").click());
  $("billede-sheet-input").addEventListener("change", event => {
    const file = takeFile(event.target);
    if (!file) return;
    updatePhoto(async () => {
      await setMadretBillede(photoDishId, await prepareImage(file));
      return "Billedet er gemt";
    });
  });
  $("billede-sheet-remove").addEventListener("click", () => updatePhoto(async () => {
    await removeMadretBillede(photoDishId);
    return "Billedet er fjernet";
  }));
}

// Læs den valgte fil og nulstil feltet, så den samme fil kan vælges igen
function takeFile(input){
  const [file] = input.files;
  input.value = "";
  return file;
}

function billederKlar(){
  if (store.billederKlar) return true;
  toast("Billeder er ikke slået til endnu – kør supabase/setup.sql igen i Supabase", { type: "error" });
  return false;
}

function setDraftPhoto(blob){
  if (draftPhoto) URL.revokeObjectURL(draftPhoto.url);
  draftPhoto = blob ? { blob, url: URL.createObjectURL(blob) } : null;
  renderDraftPhoto();
}

function renderDraftPhoto(){
  const img = $("madret-photo-img");
  $("madret-photo-pick").hidden = Boolean(draftPhoto);
  $("madret-photo-preview").hidden = !draftPhoto;
  if (draftPhoto) img.src = draftPhoto.url;
  else img.removeAttribute("src");
}

function openPhotoSheet(dishId){
  photoDishId = dishId;
  renderPhotoSheet();
  openSheet($("billede-sheet"));
}

function renderPhotoSheet(busy = false){
  const dish = store.madretter.find(d => d.id === photoDishId);
  if (!dish) return;
  const url = billedeUrl(dish.billede_sti);
  $("billede-sheet-title").textContent = dish.navn;
  $("billede-sheet-preview").innerHTML = `
    ${url
      ? `<img src="${escapeHtml(url)}" alt="Billede af ${escapeHtml(dish.navn)}">`
      : `<span class="photo-empty">${icon("image-plus", 40)}Intet billede endnu</span>`}
    ${busy ? '<span class="photo-busy"><span class="spinner"></span></span>' : ""}`;
  $("billede-sheet-remove").hidden = !url;
  $("billede-sheet-pick-label").textContent = url ? "Vælg nyt billede" : "Vælg billede";
  $("billede-sheet-pick").disabled = busy;
  $("billede-sheet-remove").disabled = busy;
}

async function updatePhoto(action){
  renderPhotoSheet(true);
  try {
    const message = await action();
    $("billede-sheet").close();
    toast(message);
  } catch (err) {
    showError(err);
    renderPhotoSheet(false);
  }
}
