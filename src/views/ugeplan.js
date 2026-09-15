import { DAYS, MEALS, store, subscribe, billedeUrl, saveKalorieMaal, setMadretOpdeling, setMeal } from "../state.js";
import { icon, MEAL_ICONS } from "../lib/icons.js";
import { escapeHtml, formatGram, formatKcal, parseDecimal, parsePositive, searchByName, toInputValue } from "../lib/format.js";
import { dishWeight, entryNutrition, formatAmount, formatPortionCount, formatPortions, kcalPerPortion } from "../lib/portion.js";
import { macrosHtml } from "../lib/templates.js";
import { openSheet, setBusy, showError, toast } from "../lib/ui.js";
import { showTab } from "../lib/tabs.js";
import { openBuilder } from "./madretter.js";

const $ = id => document.getElementById(id);
const SHORT_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const TODAY = DAYS[(new Date().getDay() + 6) % 7]; // getDay() starter om søndagen
const STEP = { g: 10, portion: 0.5 };

let selectedDay = TODAY; // mobil viser én dag ad gangen
let picker = null;       // det åbne valg-ark: { dag, maaltid, entry, dishId }

export function setupUgeplan(){
  $("day-strip").addEventListener("click", event => {
    const chip = event.target.closest("[data-day]");
    if (!chip) return;
    selectedDay = chip.dataset.day;
    render();
  });
  $("week").addEventListener("click", event => {
    const meal = event.target.closest("[data-meal]");
    if (meal) openPicker(meal.dataset.day, meal.dataset.meal);
  });

  $("meal-options").addEventListener("click", onOptionClick);
  $("meal-search").addEventListener("input", renderOptions);
  $("meal-back").addEventListener("click", showListStep);

  const amountForm = $("meal-step-amount");
  amountForm.addEventListener("submit", onAmountSubmit);
  amountForm.addEventListener("input", renderAmount);
  amountForm.addEventListener("change", event => {
    if (event.target.name === "enhed") onUnitChange();
  });
  amountForm.addEventListener("click", onAmountClick);
  $("amount-remove").addEventListener("click", onRemoveMeal);

  const goal = $("kalorie-maal");
  goal.addEventListener("change", onGoalChange);
  goal.addEventListener("keydown", event => {
    if (event.key === "Enter") goal.blur();
  });
  subscribe(render);
}

/* ---------- Ugeoversigt ---------- */
function dayStats(dag){
  let kcal = 0;
  const meals = MEALS.map(maaltid => {
    const entry = store.ugeplan[`${dag}|${maaltid}`];
    const dish = entry && store.madretter.find(d => d.id === entry.madret_id);
    const mealKcal = dish ? Math.round(entryNutrition(dish, entry).kcal) : 0; // afrund pr. måltid, så summen passer
    kcal += mealKcal;
    return { maaltid, dish, entry, kcal: mealKcal };
  });
  return { kcal, meals };
}

function render(){
  if (!store.loaded) return;
  const goal = store.kalorieMaal;
  const goalInput = $("kalorie-maal");
  if (document.activeElement !== goalInput) goalInput.value = goal ? String(goal) : "";

  const stats = Object.fromEntries(DAYS.map(dag => [dag, dayStats(dag)]));

  $("day-strip").innerHTML = DAYS.map((dag, index) => {
    const { kcal } = stats[dag];
    const classes = ["day-chip", dag === selectedDay && "is-active", dag === TODAY && "is-today"].filter(Boolean).join(" ");
    return `
      <button type="button" class="${classes}" data-day="${dag}" role="tab" aria-selected="${dag === selectedDay}" aria-label="${dag}, ${formatKcal(kcal)} kcal">
        <span>${SHORT_DAYS[index]}</span>
        <span class="day-chip-bar${goal > 0 && kcal > goal ? " is-over" : ""}"><span style="width:${progress(kcal, goal)}%"></span></span>
      </button>`;
  }).join("");

  $("week").innerHTML = DAYS.map(dag => dayCard(dag, stats[dag], goal)).join("") + weekSummaryHtml(stats, goal);
}

const progress = (kcal, goal) => (goal > 0 ? Math.min(kcal / goal, 1) * 100 : 0);

// Ugens total og gennemsnit pr. planlagt dag. Vises kun i gitteret med 2 eller 4 kolonner (se views.css)
function weekSummaryHtml(stats, goal){
  const planned = DAYS.filter(dag => stats[dag].kcal > 0);
  const total = planned.reduce((sum, dag) => sum + stats[dag].kcal, 0);
  const average = planned.length ? Math.round(total / planned.length) : 0;
  let diff = "";
  if (goal > 0 && planned.length) {
    const delta = average - goal;
    diff = `<p class="day-diff ${delta > 0 ? "is-over" : "is-under"}">${formatKcal(Math.abs(delta))} kcal ${delta > 0 ? "over" : "under"} målet i snit</p>`;
  }
  return `
    <article class="week-summary card" aria-label="Opsummering af ugen">
      <p class="week-summary-label">Hele ugen</p>
      <p class="week-summary-total"><strong>${formatKcal(total)}</strong> kcal</p>
      <p class="week-summary-avg">${planned.length ? `Gns. ${formatKcal(average)} kcal pr. planlagt dag` : "Ingen dage planlagt endnu"}</p>
      ${diff}
      <p class="week-summary-avg">${planned.length} af 7 dage planlagt</p>
    </article>`;
}

function dayCard(dag, { kcal, meals }, goal){
  const over = goal > 0 && kcal > goal;
  let diffText = "Intet kaloriemål sat";
  let diffClass = "";
  if (goal > 0 && kcal === 0) diffText = "Ingen måltider planlagt";
  else if (goal > 0) {
    diffText = over ? `${formatKcal(kcal - goal)} kcal over målet` : `${formatKcal(goal - kcal)} kcal tilbage`;
    diffClass = over ? " is-over" : " is-under";
  }
  const classes = ["day", "card", dag === selectedDay && "is-active", dag === TODAY && "is-today"].filter(Boolean).join(" ");

  return `
    <article class="${classes}">
      <header class="day-head">
        <div class="day-title-row">
          <h2 class="day-name">${dag}</h2>
          ${dag === TODAY ? '<span class="today-pill">I dag</span>' : ""}
        </div>
        <p class="day-total"><strong>${formatKcal(kcal)}</strong><span>/ ${formatKcal(goal)} kcal</span></p>
        <div class="progress${over ? " is-over" : ""}" role="progressbar" aria-label="Kalorier i forhold til målet"
          aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${kcal}"><span style="width:${progress(kcal, goal)}%"></span></div>
        <p class="day-diff${diffClass}">${diffText}</p>
      </header>
      <ul class="meals">
        ${meals.map(meal => mealHtml(dag, meal)).join("")}
      </ul>
    </article>`;
}

function mealHtml(dag, { maaltid, dish, entry, kcal }){
  return `
    <li>
      <button type="button" class="meal${dish ? "" : " is-empty"}" data-day="${dag}" data-meal="${maaltid}">
        ${mealIconHtml(maaltid, dish)}
        <span class="meal-text">
          <span class="meal-top">
            <span class="meal-label">${maaltid}</span>
            ${dish ? `<span class="meal-kcal">${formatKcal(kcal)} <small>kcal</small></span>` : ""}
          </span>
          <span class="meal-name">${dish ? escapeHtml(dish.navn) : "Vælg madret"}</span>
          ${dish ? `<span class="meal-amount-text">${formatAmount(entry)}</span>` : ""}
        </span>
        <span class="meal-chevron">${icon(dish ? "chevron-right" : "plus", 18)}</span>
      </button>
    </li>`;
}

// Rettens billede, hvis der er et – ellers kategoriens ikon
function mealIconHtml(maaltid, dish){
  const photo = dish && billedeUrl(dish.billede_sti);
  if (!photo) return `<span class="meal-icon" data-cat="${maaltid}">${icon(MEAL_ICONS[maaltid])}</span>`;
  return `<span class="meal-icon meal-photo"><img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async"></span>`;
}

/* ---------- Valg-ark: trin 1 – vælg ret ---------- */
function openPicker(dag, maaltid){
  const entry = store.ugeplan[`${dag}|${maaltid}`];
  const dish = entry && store.madretter.find(d => d.id === entry.madret_id);
  picker = { dag, maaltid, entry: dish ? entry : null, dishId: null };
  // Et udfyldt måltid åbner direkte på mængden – det er det, man oftest vil ændre
  if (dish) showAmountStep(dish, entry);
  else showListStep();
  openSheet($("meal-sheet"));
}

function showListStep(){
  const { dag, maaltid } = picker;
  $("meal-sheet-day").textContent = dag;
  $("meal-sheet-title").textContent = maaltid;
  $("meal-back").hidden = true;
  $("meal-step-amount").hidden = true;
  $("meal-step-list").hidden = false;
  $("meal-search").value = "";
  renderOptions();
  $("meal-step-list").scrollTop = 0;
}

// Alle færdige retter kan vælges til alle måltider; kladder vises ikke
function renderOptions(){
  const { entry } = picker;
  const all = store.madretter
    .filter(d => !d.kladde)
    .sort((a, b) => a.navn.localeCompare(b.navn, "da"));
  const query = $("meal-search").value;
  $("meal-search-wrap").hidden = all.length <= 5;
  const dishes = searchByName(all, query);

  const options = dishes.map(dish => {
    const selected = entry?.madret_id === dish.id;
    const photo = billedeUrl(dish.billede_sti);
    const meta = Number(dish.portioner) > 0
      ? `${formatPortions(Number(dish.portioner))} · ${formatKcal(kcalPerPortion(dish))} kcal/stk.`
      : dish.madret_ingredienser.map(row => row.ingredienser?.navn).filter(Boolean).join(", ");
    return `
      <li>
        <button type="button" class="option${selected ? " is-selected" : ""}" data-option="${dish.id}" aria-pressed="${selected}">
          <span class="option-radio"></span>
          ${photo ? `<span class="option-photo"><img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async"></span>` : ""}
          <span class="option-text">
            <span class="option-name">${escapeHtml(dish.navn)}</span>
            ${meta ? `<span class="option-meta">${escapeHtml(meta)}</span>` : ""}
          </span>
          <span class="option-kcal">${formatKcal(dish.kcal)} kcal</span>
        </button>
      </li>`;
  });

  let empty = "";
  if (all.length === 0) {
    empty = `
      <li class="empty">
        <span class="empty-icon">${icon("cooking-pot", 28)}</span>
        <p class="empty-title">Ingen madretter endnu</p>
        <p>Opret en madret, så kan du vælge den her.</p>
        <button type="button" class="btn btn-primary" data-create>${icon("plus")}Opret madret</button>
      </li>`;
  } else if (dishes.length === 0) {
    empty = `<li class="results-empty">Ingen madretter matcher "${escapeHtml(query)}".</li>`;
  }

  $("meal-options").innerHTML = options.join("") + empty;
}

function onOptionClick(event){
  if (event.target.closest("[data-create]")) {
    $("meal-sheet").close();
    showTab("madretter");
    openBuilder();
    return;
  }
  const button = event.target.closest("[data-option]");
  const dish = button && store.madretter.find(d => d.id === button.dataset.option);
  if (!dish) return;
  showAmountStep(dish, picker.entry?.madret_id === dish.id ? picker.entry : null);
}

/* ---------- Valg-ark: trin 2 – hvor meget spiser du? ---------- */
const currentDish = () => store.madretter.find(d => d.id === picker?.dishId);
const currentUnit = () => $("meal-step-amount").elements.enhed.value;

// Retten med de portioner/færdigvægt, der er tastet i arket, men endnu ikke gemt
function effectiveDish(dish){
  return {
    ...dish,
    portioner: Number(dish.portioner) > 0 ? dish.portioner : parsePositive($("amount-portioner").value),
    faerdig_vaegt_g: Number(dish.faerdig_vaegt_g) > 0 ? dish.faerdig_vaegt_g : parsePositive($("amount-weight").value),
  };
}

// Forslag i gram: en portion, hvis retten er delt op – ellers 250 g (dog højst hele retten)
function defaultGrams(dish){
  const weight = dishWeight(dish);
  const portion = Number(dish.portioner) > 0 ? weight / dish.portioner : 250;
  return Math.max(10, Math.round(Math.min(portion, weight || portion) / 10) * 10);
}

function showAmountStep(dish, entry){
  picker.dishId = dish.id;
  const { dag, maaltid } = picker;
  $("meal-sheet-day").textContent = `${dag} · ${maaltid}`;
  $("meal-sheet-title").textContent = dish.navn;
  $("meal-back").hidden = false;
  $("meal-step-list").hidden = true;
  $("meal-step-amount").hidden = false;
  $("amount-remove").hidden = !picker.entry;
  $("amount-submit").textContent = picker.entry ? "Gem" : "Tilføj";

  const form = $("meal-step-amount");
  form.reset();
  form.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  const unit = entry?.enhed ?? (Number(dish.portioner) > 0 ? "portion" : "g");
  form.querySelector(`input[name="enhed"][value="${unit}"]`).checked = true;

  let amount;
  if (entry?.enhed) amount = entry.maengde;
  else if (entry) amount = unit === "g" ? dishWeight(dish) : Number(dish.portioner); // gammel post uden mængde = hele retten
  else amount = unit === "g" ? defaultGrams(dish) : 1;
  $("amount-value").value = toInputValue(amount);

  renderAmount();
  form.querySelector(".sheet-scroll").scrollTop = 0;
}

function onUnitChange(){
  const dish = currentDish();
  if (!dish) return;
  $("amount-value").value = toInputValue(currentUnit() === "g" ? defaultGrams(effectiveDish(dish)) : 1);
  renderAmount();
}

function renderAmount(){
  const base = currentDish();
  if (!base) return;
  const dish = effectiveDish(base);
  const unit = currentUnit();
  const amount = parsePositive($("amount-value").value);
  const weight = dishWeight(dish);

  // Mangler retten portioner/færdigvægt, kan de angives her
  $("amount-portioner-field").hidden = !(unit === "portion" && !(Number(base.portioner) > 0));
  $("amount-weight-field").hidden = !(unit === "g" && !(Number(base.faerdig_vaegt_g) > 0));
  $("amount-weight").placeholder = formatGram(base.raa_vaegt_g);
  $("amount-weight-hint").textContent =
    `Tom = ingrediensernes vægt (${formatGram(base.raa_vaegt_g)} g). Kogt pasta og ris vejer mere – vej gerne gryden.`;
  $("amount-unit").textContent = unit === "g" ? "g" : "portioner";

  const summary = [`Hele retten: ${formatKcal(dish.kcal)} kcal`];
  if (Number(dish.portioner) > 0) summary.push(formatPortions(Number(dish.portioner)));
  summary.push(`${formatGram(weight)} g${Number(dish.faerdig_vaegt_g) > 0 ? "" : " (ingredienser)"}`);
  $("amount-dish").textContent = summary.join(" · ");

  $("amount-presets").innerHTML = presetsFor(dish, unit).map(preset => `
    <button type="button" class="chip${amount === preset.value ? " is-active" : ""}" data-preset="${preset.value}">${preset.label}</button>`).join("");

  const canCalculate = amount && (unit === "g" || Number(dish.portioner) > 0);
  const nutrition = canCalculate ? entryNutrition(dish, { maengde: amount, enhed: unit }) : null;
  $("amount-kcal").textContent = nutrition ? formatKcal(nutrition.kcal) : "–";
  $("amount-macros").innerHTML = nutrition ? macrosHtml(nutrition) : "";
}

function presetsFor(dish, unit){
  const portioner = Number(dish.portioner);
  const weight = dishWeight(dish);
  if (unit === "portion") {
    const presets = [0.5, 1, 1.5, 2].map(value => ({ value, label: formatPortionCount(value) }));
    if (portioner > 0 && !presets.some(p => p.value === portioner)) presets.push({ value: portioner, label: "Hele retten" });
    return presets;
  }
  const presets = [100, 200, 300, 400].map(value => ({ value, label: `${value} g` }));
  if (portioner > 0 && weight > 0) {
    const portionGrams = Math.round(weight / portioner);
    presets.unshift({ value: portionGrams, label: `1 portion (${formatGram(portionGrams)} g)` });
  }
  if (weight > 0) presets.push({ value: Math.round(weight), label: "Hele retten" });
  return presets;
}

function onAmountClick(event){
  const input = $("amount-value");
  const preset = event.target.closest("[data-preset]");
  if (preset) {
    input.value = toInputValue(Number(preset.dataset.preset));
    renderAmount();
    return;
  }
  const step = event.target.closest("[data-amount-step]");
  if (step) {
    const unit = currentUnit();
    const current = parseDecimal(input.value) || 0;
    const next = current + Number(step.dataset.amountStep) * STEP[unit];
    input.value = toInputValue(Math.max(STEP[unit], next));
    renderAmount();
  }
}

function markInvalid(id, message){
  const input = $(id);
  input.closest(".field").classList.add("is-invalid");
  input.focus();
  toast(message, { type: "error" });
}

async function onAmountSubmit(event){
  event.preventDefault();
  const form = event.currentTarget;
  form.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
  const dish = currentDish();
  if (!dish) return;
  const unit = currentUnit();

  const opdeling = {};
  if (unit === "portion" && !(Number(dish.portioner) > 0)) {
    const portioner = parsePositive($("amount-portioner").value);
    if (!portioner) return markInvalid("amount-portioner", "Angiv hvor mange portioner hele retten giver");
    opdeling.portioner = portioner;
  }
  if (unit === "g" && !(Number(dish.faerdig_vaegt_g) > 0) && $("amount-weight").value.trim()) {
    const vaegt = parsePositive($("amount-weight").value);
    if (!vaegt) return markInvalid("amount-weight", "Færdigvægten skal være et tal over 0");
    opdeling.faerdig_vaegt_g = vaegt;
  }
  const maengde = parsePositive($("amount-value").value);
  if (!maengde) return markInvalid("amount-value", "Angiv hvor meget du spiser");

  const { dag, maaltid } = picker;
  const submit = $("amount-submit");
  setBusy(submit, true);
  try {
    if (Object.keys(opdeling).length) await setMadretOpdeling(dish.id, opdeling);
    await setMeal(dag, maaltid, { madret_id: dish.id, maengde, enhed: unit });
    $("meal-sheet").close();
  } catch (err) {
    showError(err);
  } finally {
    setBusy(submit, false);
  }
}

async function onRemoveMeal(){
  const { dag, maaltid } = picker;
  $("meal-sheet").close();
  try {
    await setMeal(dag, maaltid, null);
  } catch (err) {
    showError(err);
  }
}

/* ---------- Kaloriemål ---------- */
async function onGoalChange(event){
  const input = event.target;
  const value = parseDecimal(input.value);
  if (value === null || Number.isNaN(value) || value < 0) {
    input.value = store.kalorieMaal || "";
    return toast("Kaloriemålet skal være et tal", { type: "error" });
  }
  const rounded = Math.round(value);
  if (rounded === store.kalorieMaal) return;

  try {
    await saveKalorieMaal(rounded);
    toast("Kaloriemålet er gemt");
  } catch (err) {
    input.value = store.kalorieMaal || "";
    showError(err);
  }
}
