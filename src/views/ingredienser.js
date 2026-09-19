import { store, subscribe, addIngrediens, updateIngrediens, deleteIngrediens } from "../state.js";
import { icon } from "../lib/icons.js";
import { escapeHtml, formatKcal, highlight, parseDecimal, parsePositive, searchByName, toInputValue } from "../lib/format.js";
import { formatKr, prisPer100g, toPrisInput } from "../lib/pris.js";
import { brandHtml, emptyStateHtml, macrosHtml } from "../lib/templates.js";
import { confirmDialog, openSheet, setBusy, showError, toast } from "../lib/ui.js";
import { setupScanner, startScanner } from "../scanner.js";

const $ = id => document.getElementById(id);
const FIELDS = { kcal: "ingrediens-kcal", protein: "ingrediens-protein", fedt: "ingrediens-fedt", kulhydrat: "ingrediens-kulhydrat" };
const PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/";
// "quantity" skal med: uden den udelader API'et product_quantity, når nutriments også hentes
const PRODUCT_FIELDS = "product_name,product_name_da,brands,brand_owner,nutriments,product_quantity,product_quantity_unit,quantity";
// Fritekstsøgningen ligger på sin egen server; world.openfoodfacts.org/api/v2/search er ofte overbelastet.
// Søgeindekset har ikke næringsindhold, så tallene hentes med et almindeligt produktopslag, når en vare vælges
const SEARCH_URL = "https://search.openfoodfacts.org/search";
const SEARCH_FIELDS = "code,product_name,product_name_da,brands,quantity";
const MAX_SEARCH_RESULTS = 8;
const PRIS = "ingrediens-pris";
const PRIS_MAENGDE = "ingrediens-pris-maengde";

let query = "";
let editingId = null;  // id på ingrediensen, der redigeres – null betyder ny ingrediens
let lookupSession = 0; // så et sent svar fra Open Food Facts ikke overskriver en nyere indtastning
let dishContext = null; // { onCreated(ingrediens, gram) }, når ingrediensen oprettes fra madret-byggeren
let scanContext = null; // samme, men husket mens scanneren er åben
let searchSession = 0;  // så et sent søgesvar ikke overskriver en nyere søgning

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

  const soeg = $("ingrediens-soeg");
  $("ingrediens-soeg-btn").addEventListener("click", () => searchProducts());
  soeg.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); // Enter i søgefeltet må ikke gemme ingrediensen
    searchProducts();
  });
  soeg.addEventListener("input", () => { $("ingrediens-soeg-clear").hidden = !soeg.value; });
  $("ingrediens-soeg-clear").addEventListener("click", () => {
    soeg.value = "";
    resetSearch();
    soeg.focus();
  });
  $("ingrediens-soeg-results").addEventListener("click", onSearchResultClick);

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
  resetSearch();
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

// Ét produkt fra Open Food Facts. null = ikke fundet
async function fetchProduct(code){
  const url = `${PRODUCT_URL}${encodeURIComponent(code)}.json?fields=${PRODUCT_FIELDS}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open Food Facts svarede ${response.status}`);
  const data = await response.json();
  return data.status === 1 ? data.product : null;
}

const productName = product => product.product_name_da || product.product_name || "";

// Udfylder et felt, men rydder det aldrig, fordi varen mangler oplysningen.
// keepFilled bevarer det, der allerede står – bruges når næringsindholdet hentes fra en anden vare
function fillField(id, value, keepFilled){
  const input = $(id);
  if (!value || (keepFilled && input.value.trim())) return;
  input.value = value;
}

// Skriver en vares oplysninger ind i formularen. Stregkoden røres ikke: den hører til den scannede vare
function applyProduct(product, { keepFilled = false } = {}){
  const n = product.nutriments || {};
  fillField("ingrediens-navn", productName(product), keepFilled);
  fillField("ingrediens-producent", producerFrom(product), keepFilled);
  fillField(PRIS_MAENGDE, toInputValue(packageGrams(product)), keepFilled);
  $(FIELDS.kcal).value = toInputValue(kcalPer100g(n));
  $(FIELDS.protein).value = toInputValue(n.proteins_100g);
  $(FIELDS.fedt).value = toInputValue(n.fat_100g);
  $(FIELDS.kulhydrat).value = toInputValue(n.carbohydrates_100g);
  updateDishAmountHint();
  updatePrisHint();
}

async function lookupBarcode(barcode){
  const session = ++lookupSession;
  $("ingrediens-barcode").value = barcode;
  setLookup("loading", "Henter produkt fra Open Food Facts…", barcode);
  try {
    const product = await fetchProduct(barcode);
    if (session !== lookupSession) return;

    if (!product) {
      setLookup("missing", "Ikke fundet – søg efter varen eller udfyld selv", barcode);
      $("ingrediens-soeg").focus();
      return;
    }
    applyProduct(product);

    // Mange varer er registreret med navn og mærke, men uden næringsindhold. Læg navnet i
    // søgefeltet, så en lignende vare kan levere tallene med ét tryk
    if (kcalPer100g(product.nutriments || {}) === null) {
      $("ingrediens-soeg").value = productName(product);
      $("ingrediens-soeg-clear").hidden = !$("ingrediens-soeg").value;
      setLookup("partial", "Fundet, men uden næringsindhold – søg efter en lignende vare", barcode);
      setSearchHint("Tryk Søg for at hente næringsindholdet fra en lignende vare");
      return;
    }
    setLookup("found", "Fundet i Open Food Facts", barcode);
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
  if (gram > 0 && unit === "g") return gram;
  return gramsFromText(product.quantity); // fx "1kg" eller "400 g e", når det udregnede felt mangler
}

// Tekst som "1 kg", "500g" eller "455 gr" til gram. Rumfang (ml/l) springes over – det er ikke vægt
function gramsFromText(text){
  const match = String(text ?? "").replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(kg|gram|gr|g)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!(value > 0)) return null;
  return match[2].toLowerCase() === "kg" ? value * 1000 : value;
}

// Nogle produkter har kun energi i kJ (energy_100g). 1 kcal = 4,184 kJ
function kcalPer100g(nutriments){
  if (nutriments["energy-kcal_100g"] != null) return nutriments["energy-kcal_100g"];
  if (nutriments.energy_100g != null) return nutriments.energy_100g / 4.184;
  return null;
}

/* ---------- Søg efter en vare i Open Food Facts ---------- */
const SEARCH_HINT = "Søg i Open Food Facts, når du ikke har stregkoden, eller varen er registreret uden næringsindhold";

function setSearchHint(text){
  $("ingrediens-soeg-hint").textContent = text || SEARCH_HINT;
}

function resetSearch(){
  searchSession++;
  $("ingrediens-soeg-clear").hidden = !$("ingrediens-soeg").value;
  const results = $("ingrediens-soeg-results");
  results.hidden = true;
  results.innerHTML = "";
  setSearchHint(null);
}

// Søgeindekset kender ikke næringsindhold, men ved hvilke varer der har det:
// states_tags filtrerer de tomme registreringer fra, så alle resultater kan udfylde formularen
async function fetchSearchHits(query, danishOnly){
  const terms = [query, 'states_tags:"en:nutrition-facts-completed"'];
  if (danishOnly) terms.push('countries_tags:"en:denmark"');
  const url = `${SEARCH_URL}?q=${encodeURIComponent(terms.join(" "))}&page_size=${MAX_SEARCH_RESULTS}&fields=${SEARCH_FIELDS}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Søgningen svarede ${response.status}`);
  const data = await response.json();
  return data.hits ?? [];
}

// Open Food Facts tillader kun 10 søgninger i minuttet pr. IP, så der søges på tryk – aldrig mens der tastes
async function searchProducts(){
  const query = $("ingrediens-soeg").value.trim();
  if (query.length < 2) {
    setSearchHint("Skriv mindst to bogstaver – fx havregryn");
    $("ingrediens-soeg").focus();
    return;
  }

  const session = ++searchSession;
  const button = $("ingrediens-soeg-btn");
  setBusy(button, true);
  setSearchHint("Søger i Open Food Facts…");
  try {
    // Danske varer først; giver det ingenting, søges der i hele databasen
    let hits = await fetchSearchHits(query, true);
    const danish = hits.length > 0;
    if (!danish) hits = await fetchSearchHits(query, false);
    if (session !== searchSession) return;
    renderSearchResults(hits, { query, danish });
  } catch (err) {
    if (session !== searchSession) return;
    console.error(err);
    $("ingrediens-soeg-results").hidden = true;
    setSearchHint("Kunne ikke søge lige nu – prøv igen om lidt, eller udfyld felterne selv");
  } finally {
    if (session === searchSession) setBusy(button, false);
  }
}

// Mærket kommer som liste fra søgeindekset og som kommasepareret tekst fra produktopslaget
function hitBrand(hit){
  const brands = Array.isArray(hit.brands) ? hit.brands : String(hit.brands ?? "").split(",");
  return brands.map(brand => String(brand).trim()).filter(Boolean).join(", ");
}

function renderSearchResults(hits, { query, danish }){
  const results = $("ingrediens-soeg-results");
  results.hidden = false;

  if (hits.length === 0) {
    results.innerHTML = `<li class="results-empty">Ingen varer med næringsindhold matcher "${escapeHtml(query)}". Prøv et kortere søgeord, eller udfyld felterne selv.</li>`;
    setSearchHint(null);
    return;
  }

  results.innerHTML = hits.map(hit => {
    const navn = hit.product_name_da || hit.product_name || "Uden navn";
    const brand = hitBrand(hit);
    return `
      <li>
        <button type="button" class="result" data-code="${escapeHtml(hit.code)}">
          <span class="result-name">${highlight(navn, query)}${brand ? `<span class="brand-text">${escapeHtml(brand)}</span>` : ""}</span>
          ${hit.quantity ? `<span class="result-kcal">${escapeHtml(String(hit.quantity))}</span>` : ""}
          <span class="result-add">${icon("plus", 18)}</span>
        </button>
      </li>`;
  }).join("");
  setSearchHint(danish
    ? "Tryk på en vare for at hente dens næringsindhold"
    : "Ingen danske varer matchede – viser resultater fra hele databasen");
}

// Næringsindholdet hentes med et almindeligt produktopslag. Navn, producent og pakkestørrelse,
// du allerede har udfyldt, bevares – det er kun tallene, der kommer fra den valgte vare
async function onSearchResultClick(event){
  const button = event.target.closest("[data-code]");
  if (!button) return;

  const session = ++lookupSession;
  setBusy(button, true);
  setLookup("loading", "Henter næringsindhold…", button.dataset.code);
  try {
    const product = await fetchProduct(button.dataset.code);
    if (session !== lookupSession) return;
    if (!product) {
      setLookup("missing", "Varen kunne ikke hentes – vælg en anden, eller udfyld selv", button.dataset.code);
      return;
    }
    applyProduct(product, { keepFilled: true });
    const navn = productName(product) || button.querySelector(".result-name").textContent.trim();
    setLookup("found", `Næringsindhold fra ${navn}`, button.dataset.code);

    // Markér den valgte, så man kan se hvor tallene kom fra – og prøve en anden
    $("ingrediens-soeg-results").querySelectorAll(".result").forEach(el => {
      const chosen = el === button;
      el.classList.toggle("is-added", chosen);
      el.querySelector(".result-add").innerHTML = icon(chosen ? "check" : "plus", 18);
    });
    if (!$("ingrediens-navn").value.trim()) $("ingrediens-navn").focus();
  } catch (err) {
    if (session !== lookupSession) return;
    console.error(err);
    setLookup("error", "Kunne ikke hente varen – prøv igen, eller udfyld selv", button.dataset.code);
  } finally {
    setBusy(button, false);
  }
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
