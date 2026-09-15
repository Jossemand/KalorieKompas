import { store, subscribe, addIngrediens, updateIngrediens, deleteIngrediens } from "../state.js";
import { icon } from "../lib/icons.js";
import { escapeHtml, formatKcal, highlight, parseDecimal, searchByName, toInputValue } from "../lib/format.js";
import { brandHtml, emptyStateHtml, macrosHtml } from "../lib/templates.js";
import { confirmDialog, openSheet, setBusy, showError, toast } from "../lib/ui.js";
import { setupScanner, startScanner } from "../scanner.js";

const $ = id => document.getElementById(id);
const FIELDS = { kcal: "ingrediens-kcal", protein: "ingrediens-protein", fedt: "ingrediens-fedt", kulhydrat: "ingrediens-kulhydrat" };

let query = "";
let editingId = null;  // id på ingrediensen, der redigeres – null betyder ny ingrediens
let lookupSession = 0; // så et sent svar fra Open Food Facts ikke overskriver en nyere indtastning

export function setupIngredienser(){
  $("btn-scan").addEventListener("click", startScanner);
  $("btn-add-ingrediens").addEventListener("click", () => openForm());
  setupScanner({
    onDetected: barcode => { openForm(); lookupBarcode(barcode); },
    onManual: () => openForm(),
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
  subscribe(render);
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
function openForm(ing = null){
  lookupSession++;
  editingId = ing?.id ?? null;
  const form = $("ingrediens-form");
  form.reset();
  form.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  $("ingrediens-barcode").value = ing?.barcode ?? ""; // skjulte felter nulstilles ikke af reset()
  $("ingrediens-sheet-title").textContent = ing ? "Rediger ingrediens" : "Ny ingrediens";
  $("ingrediens-submit").textContent = ing ? "Gem ændringer" : "Gem ingrediens";
  if (ing) {
    $("ingrediens-navn").value = ing.navn;
    $("ingrediens-producent").value = ing.producent ?? "";
    $(FIELDS.kcal).value = toInputValue(ing.kcal_100g);
    $(FIELDS.protein).value = toInputValue(ing.protein_100g);
    $(FIELDS.fedt).value = toInputValue(ing.fedt_100g);
    $(FIELDS.kulhydrat).value = toInputValue(ing.kulhydrat_100g);
  }
  setLookup(null);
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
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_da,brands,brand_owner,nutriments`;
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
    setLookup("found", "Fundet i Open Food Facts", barcode);
  } catch (err) {
    if (session !== lookupSession) return;
    console.error(err);
    setLookup("error", "Kunne ikke slå varen op – udfyld selv", barcode);
  }
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
  if (invalid.length) {
    invalid.forEach(id => $(id).closest(".field").classList.add("is-invalid"));
    $(invalid[0]).focus();
    toast("Udfyld navn og energi – værdier skal være tal", { type: "error" });
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
  };
  const submit = $("ingrediens-submit");
  setBusy(submit, true);
  try {
    if (editingId) await updateIngrediens(editingId, row);
    else await addIngrediens(row);
    $("ingrediens-sheet").close();
    toast(editingId ? `Ændringerne i ${navn} er gemt` : `${navn} er gemt`);
  } catch (err) {
    showError(err);
  } finally {
    setBusy(submit, false);
  }
}
