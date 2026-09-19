import { store, subscribe, addIngrediens, updateIngrediens, deleteIngrediens } from "../state.js";
import { icon } from "../lib/icons.js";
import { escapeHtml, formatKcal, highlight, parseDecimal, parsePositive, searchByName, toInputValue } from "../lib/format.js";
import { formatKr, prisPer100g, toPrisInput } from "../lib/pris.js";
import { brandHtml, emptyStateHtml, macrosHtml } from "../lib/templates.js";
import { confirmDialog, openSheet, setBusy, showError, toast } from "../lib/ui.js";
import { setupScanner, startScanner } from "../scanner.js";

const $ = id => document.getElementById(id);
const FIELDS = { kcal: "ingrediens-kcal", protein: "ingrediens-protein", fedt: "ingrediens-fedt", kulhydrat: "ingrediens-kulhydrat" };
const PRIS = "ingrediens-pris";
const PRIS_MAENGDE = "ingrediens-pris-maengde";

let query = "";
let editingId = null;  // id på ingrediensen, der redigeres – null betyder ny ingrediens
let lookupSession = 0; // så et sent svar fra Open Food Facts ikke overskriver en nyere indtastning
let dishContext = null; // { onCreated(ingrediens, gram) }, når ingrediensen oprettes fra madret-byggeren
let scanContext = null; // samme, men husket mens scanneren er åben

export function setupIngredienser(){
  $("btn-scan").addEventListener("click", () => startScan());
  $("btn-add-ingrediens").addEventListener("click", () => openForm());
  setupScanner({
    onDetected: barcode => { openForm(null, scanContext); lookupBarcode(barcode); },
    onManual: () => openForm(null, scanContext),
  });

  const search = $("ingredienser-search");
  const clear = $("ingredienser-search-clear");
  search.addEventListener("input", () => {
    query = search.value;
    clear.hidden = !query;
    render();
  });
  clear.addEventListener("click", () => {
    search.value = query = "";
    clear.hidden = true;
    render();
    search.focus();
  });

  $("ingredienser-list").addEventListener("click", onListClick);
  $("ingrediens-form").addEventListener("submit", onSubmit);
  $("ingrediens-form").addEventListener("input", () => {
    updateDishAmountHint();
    updatePrisHint();
  });
  subscribe(render);
}

function startScan(context = null){
  scanContext = context;
  startScanner();
}

// Fra madret-byggeren: opret en ingrediens (evt. med navnet fra søgefeltet) og læg den direkte i retten
export function createIngredientForDish({ navn = "", onCreated }){
  openForm(null, { onCreated });
  $("ingrediens-navn").value = navn;
}

export function scanIngredientForDish({ onCreated }){
  startScan({ onCreated });
}

function updateDishAmountHint(){
  if (!dishContext) return;
  const gram = parsePositive($("ingrediens-maengde").value);
  const kcal100 = parseDecimal($(FIELDS.kcal).value);
  $("ingrediens-maengde-hint").textContent = gram && Number.isFinite(kcal100)
    ? `= ${formatKcal((gram / 100) * kcal100)} kcal i retten`
    : "Udfyld energi og mængde for at se kalorierne i retten";
}

// Viser kr/100 g, så man kan se hvad pakkeprisen bliver til i en madret
function updatePrisHint(){
  const pris = parseDecimal($(PRIS).value);
  const gram = parseDecimal($(PRIS_MAENGDE).value);
  const per100 = prisPer100g({ pris, pris_maengde_g: gram });
  const mangler = (pris !== null && gram === null) || (pris === null && gram !== null);
  $("ingrediens-pris-hint").textContent = per100 !== null
    ? `= ${formatKr(per100)} kr/100 g`
    : mangler
      ? "Udfyld både pris og pakkestørrelse – ellers kan prisen ikke regnes ud"
      : "Udfyld begge felter, så regnes prisen med i madretter og ugeplan";
}

function render(){
  if (!store.loaded) return;
  const list = $("ingredienser-list");
  list.removeAttribute("aria-busy");

  const all = store.ingredienser;
  $("ingredienser-sub").textContent = all.length
    ? `${all.length} ${all.length === 1 ? "ingrediens" : "ingredienser"} · tryk for at redigere`
    : "Scan en vare eller tilføj den manuelt";

  if (all.length === 0) {
    list.innerHTML = emptyStateHtml({
      tag: "li",
      iconName: "carrot",
      title: "Ingen ingredienser endnu",
      text: "Scan stregkoden på en vare, så hentes næringsindholdet automatisk.",
    });
    return;
  }

  const items = searchByName(all, query);
  if (items.length === 0) {
    list.innerHTML = emptyStateHtml({ tag: "li", iconName: "search-x", title: "Ingen resultater", text: `Ingen ingredienser matcher "${query}".` });
    return;
  }

  list.innerHTML = items.map(ing => `
    <li class="item card" data-id="${ing.id}">
      <div class="item-main">
        <p class="item-title"><button type="button" class="item-open">${highlight(ing.navn, query)}</button>${brandHtml(ing)}</p>
        ${macrosHtml({ protein: ing.protein_100g, fedt: ing.fedt_100g, kulhydrat: ing.kulhydrat_100g })}
      </div>
      <div class="item-kcal"><strong>${formatKcal(ing.kcal_100g)}</strong><span>kcal/100 g</span></div>
      <button type="button" class="icon-btn icon-btn-danger" data-delete aria-label="Slet ${escapeHtml(ing.navn)}">${icon("trash")}</button>
    </li>`).join("");
}

async function onListClick(event){
  const row = event.target.closest("[data-id]");
  const ing = row && store.ingredienser.find(i => i.id === row.dataset.id);
  if (!ing) return;
  if (!event.target.closest("[data-delete]")) return openForm(ing);

  const usedIn = store.madretter.filter(m => m.madret_ingredienser.some(link => link.ingrediens_id === ing.id)).length;
  const confirmed = await confirmDialog({
    title: `Slet ${ing.navn}?`,
    message: usedIn
      ? `Ingrediensen bruges i ${usedIn} ${usedIn === 1 ? "madret" : "madretter"} og fjernes også derfra.`
      : "Ingrediensen slettes permanent.",
  });
  if (!confirmed) return;

  try {
    await deleteIngrediens(ing.id);
    toast(`${ing.navn} er slettet`);
  } catch (err) {
    showError(err);
  }
}

/* ---------- Formular: ny eller rediger ---------- */
function openForm(ing = null, context = null){
  lookupSession++;
  editingId = ing?.id ?? null;
  dishContext = ing ? null : context;
  const form = $("ingrediens-form");
  form.reset();
  form.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  $("ingrediens-barcode").value = ing?.barcode ?? ""; // skjulte felter nulstilles ikke af reset()
  $("ingrediens-dish-amount").hidden = !dishContext;
  $("ingrediens-sheet-title").textContent = ing ? "Rediger ingrediens" : dishContext ? "Ny ingrediens til retten" : "Ny ingrediens";
  $("ingrediens-submit").textContent = ing ? "Gem ændringer" : dishContext ? "Gem og tilføj til retten" : "Gem ingrediens";
  if (ing) {
    $("ingrediens-navn").value = ing.navn;
    $("ingrediens-producent").value = ing.producent ?? "";
    $(FIELDS.kcal).value = toInputValue(ing.kcal_100g);
    $(FIELDS.protein).value = toInputValue(ing.protein_100g);
    $(FIELDS.fedt).value = toInputValue(ing.fedt_100g);
    $(FIELDS.kulhydrat).value = toInputValue(ing.kulhydrat_100g);
    $(PRIS).value = toPrisInput(ing.pris);
    $(PRIS_MAENGDE).value = toInputValue(ing.pris_maengde_g);
  }
  setLookup(null);
  updateDishAmountHint();
  updatePrisHint();
  openSheet($("ingrediens-sheet"));
}

// Producenten: brand_owner, hvis Open Food Facts har den. Ellers det sidste i "brands", hvor
// mærket typisk står først og firmaet sidst ("Nutella, Ferrero" → Ferrero, "Arla, Arla Foods" → Arla Foods)
function producerFrom(product){
  if (product.brand_owner?.trim()) return product.brand_owner.trim();
  const brands = String(product.brands ?? "").split(",").map(brand => brand.trim()).filter(Boolean);
  return brands.at(-1) ?? "";
}

async function lookupBarcode(barcode){
  const session = ++lookupSession;
  $("ingrediens-barcode").value = barcode;
  setLookup("loading", "Henter produkt fra Open Food Facts…", barcode);
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_da,brands,brand_owner,nutriments,product_quantity,product_quantity_unit`;
    const data = await (await fetch(url)).json();
    if (session !== lookupSession) return;

    if (data.status !== 1) {
      setLookup("missing", "Ikke fundet – udfyld selv", barcode);
      $("ingrediens-navn").focus();
      return;
    }
    const product = data.product;
    const n = product.nutriments || {};
    $("ingrediens-navn").value = product.product_name_da || product.product_name || "";
    $("ingrediens-producent").value = producerFrom(product);
    $(FIELDS.kcal).value = toInputValue(kcalPer100g(n));
    $(FIELDS.protein).value = toInputValue(n.proteins_100g);
    $(FIELDS.fedt).value = toInputValue(n.fat_100g);
    $(FIELDS.kulhydrat).value = toInputValue(n.carbohydrates_100g);
    $(PRIS_MAENGDE).value = toInputValue(packageGrams(product));
    setLookup("found", "Fundet i Open Food Facts", barcode);
    updateDishAmountHint();
    updatePrisHint();
  } catch (err) {
    if (session !== lookupSession) return;
    console.error(err);
    setLookup("error", "Kunne ikke slå varen op – udfyld selv", barcode);
  }
}

// Pakkens nettovægt, hvis Open Food Facts har den i gram. Så mangler der kun prisen at taste
function packageGrams(product){
  const gram = Number(product.product_quantity);
  const unit = String(product.product_quantity_unit ?? "g").toLowerCase();
  return gram > 0 && unit === "g" ? gram : null;
}

// Nogle produkter har kun energi i kJ (energy_100g). 1 kcal = 4,184 kJ
function kcalPer100g(nutriments){
  if (nutriments["energy-kcal_100g"] != null) return nutriments["energy-kcal_100g"];
  if (nutriments.energy_100g != null) return nutriments.energy_100g / 4.184;
  return null;
}

function setLookup(state, text = "", barcode = ""){
  const el = $("lookup-status");
  el.hidden = !state;
  if (!state) return;
  el.dataset.state = state;
  const lead = state === "loading" ? '<span class="spinner"></span>' : icon(state === "found" ? "circle-check" : "circle-alert", 18);
  el.innerHTML = `${lead}<span>${escapeHtml(text)}</span><span class="lookup-code">${escapeHtml(barcode)}</span>`;
}

async function onSubmit(event){
  event.preventDefault();
  const form = event.currentTarget;
  form.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));

  const navn = $("ingrediens-navn").value.trim();
  const values = Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, parseDecimal($(id).value)]));

  const invalid = [];
  if (!navn) invalid.push("ingrediens-navn");
  if (values.kcal === null || Number.isNaN(values.kcal) || values.kcal < 0) invalid.push(FIELDS.kcal);
  for (const key of ["protein", "fedt", "kulhydrat"]) {
    if (Number.isNaN(values[key]) || values[key] < 0) invalid.push(FIELDS[key]);
  }
  const gram = dishContext ? parsePositive($("ingrediens-maengde").value) : null;
  if (dishContext && !gram) invalid.push("ingrediens-maengde");

  // Prisen er valgfri, men den kan kun bruges, hvis både beløb og pakkestørrelse er udfyldt
  const pris = parseDecimal($(PRIS).value);
  const prisMaengde = parsePositive($(PRIS_MAENGDE).value);
  const prisTom = pris === null && $(PRIS_MAENGDE).value.trim() === "";
  if (!prisTom) {
    if (pris === null || Number.isNaN(pris) || pris < 0) invalid.push(PRIS);
    if (!prisMaengde) invalid.push(PRIS_MAENGDE);
  }
  if (invalid.length) {
    invalid.forEach(id => $(id).closest(".field").classList.add("is-invalid"));
    $(invalid[0]).focus();
    const prisFejl = invalid.includes(PRIS) || invalid.includes(PRIS_MAENGDE);
    toast(prisFejl
      ? "Prisen kræver både et beløb og en pakkestørrelse – eller lad begge felter stå tomme"
      : dishContext
        ? "Udfyld navn, energi og mængde i retten – værdier skal være tal"
        : "Udfyld navn og energi – værdier skal være tal", { type: "error" });
    return;
  }

  const row = {
    navn,
    producent: $("ingrediens-producent").value.trim() || null,
    barcode: $("ingrediens-barcode").value || null,
    kcal_100g: values.kcal,
    protein_100g: values.protein ?? 0,
    fedt_100g: values.fedt ?? 0,
    kulhydrat_100g: values.kulhydrat ?? 0,
    pris: prisTom ? null : pris,
    pris_maengde_g: prisTom ? null : prisMaengde,
  };
  const submit = $("ingrediens-submit");
  setBusy(submit, true);
  try {
    if (editingId) {
      await updateIngrediens(editingId, row);
      $("ingrediens-sheet").close();
      toast(`Ændringerne i ${navn} er gemt`);
    } else {
      const created = await addIngrediens(row);
      const context = dishContext;
      $("ingrediens-sheet").close();
      context?.onCreated(created, gram);
      toast(context ? `${navn} er gemt og lagt i retten` : `${navn} er gemt`);
    }
  } catch (err) {
    showError(err);
  } finally {
    setBusy(submit, false);
  }
}
