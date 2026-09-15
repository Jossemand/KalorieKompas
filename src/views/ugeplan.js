import { DAYS, MEALS, store, subscribe, billedeUrl, saveKalorieMaal, setMeal } from "../state.js";
import { icon, MEAL_ICONS } from "../lib/icons.js";
import { escapeHtml, formatKcal, parseDecimal } from "../lib/format.js";
import { openSheet, showError, toast } from "../lib/ui.js";
import { showTab } from "../lib/tabs.js";
import { openBuilder } from "./madretter.js";

const $ = id => document.getElementById(id);
const SHORT_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const TODAY = DAYS[(new Date().getDay() + 6) % 7]; // getDay() starter om søndagen

let selectedDay = TODAY; // mobil viser én dag ad gangen
let picker = null;       // { dag, maaltid } for det åbne valg-ark

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

  const goal = $("kalorie-maal");
  goal.addEventListener("change", onGoalChange);
  goal.addEventListener("keydown", event => {
    if (event.key === "Enter") goal.blur();
  });
  subscribe(render);
}

function dayStats(dag){
  let kcal = 0;
  const meals = MEALS.map(maaltid => {
    const dish = store.madretter.find(d => d.id === store.ugeplan[`${dag}|${maaltid}`]);
    if (dish) kcal += Math.round(dish.kcal); // afrund pr. ret, så summen passer med de viste tal
    return { maaltid, dish };
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

  $("week").innerHTML = DAYS.map(dag => dayCard(dag, stats[dag], goal)).join("");
}

const progress = (kcal, goal) => (goal > 0 ? Math.min(kcal / goal, 1) * 100 : 0);

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
        ${meals.map(({ maaltid, dish }) => `
          <li>
            <button type="button" class="meal${dish ? "" : " is-empty"}" data-day="${dag}" data-meal="${maaltid}">
              ${mealIconHtml(maaltid, dish)}
              <span class="meal-text">
                <span class="meal-top">
                  <span class="meal-label">${maaltid}</span>
                  ${dish ? `<span class="meal-kcal">${formatKcal(dish.kcal)} <small>kcal</small></span>` : ""}
                </span>
                <span class="meal-name">${dish ? escapeHtml(dish.navn) : "Vælg madret"}</span>
              </span>
              <span class="meal-chevron">${icon(dish ? "chevron-right" : "plus", 18)}</span>
            </button>
          </li>`).join("")}
      </ul>
    </article>`;
}

// Rettens billede, hvis der er et – ellers kategoriens ikon
function mealIconHtml(maaltid, dish){
  const photo = dish && billedeUrl(dish.billede_sti);
  if (!photo) return `<span class="meal-icon" data-cat="${maaltid}">${icon(MEAL_ICONS[maaltid])}</span>`;
  return `<span class="meal-icon meal-photo"><img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async"></span>`;
}

/* ---------- Vælg madret til et måltid ---------- */
function openPicker(dag, maaltid){
  picker = { dag, maaltid };
  $("meal-sheet-day").textContent = dag;
  $("meal-sheet-title").textContent = maaltid;
  renderOptions();
  openSheet($("meal-sheet"));
}

function renderOptions(){
  const { dag, maaltid } = picker;
  const selectedId = store.ugeplan[`${dag}|${maaltid}`] ?? null;
  const dishes = store.madretter.filter(d => d.kategori === maaltid);

  const option = ({ id, name, meta = "", kcal = null, photo = null }) => `
    <li>
      <button type="button" class="option${id === selectedId ? " is-selected" : ""}" data-option="${id ?? ""}" aria-pressed="${id === selectedId}">
        <span class="option-radio"></span>
        ${photo ? `<span class="option-photo"><img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async"></span>` : ""}
        <span class="option-text">
          <span class="option-name">${escapeHtml(name)}</span>
          ${meta ? `<span class="option-meta">${escapeHtml(meta)}</span>` : ""}
        </span>
        ${kcal === null ? "" : `<span class="option-kcal">${formatKcal(kcal)} kcal</span>`}
      </button>
    </li>`;

  const options = dishes.map(dish => option({
    id: dish.id,
    name: dish.navn,
    meta: dish.madret_ingredienser.map(row => row.ingredienser?.navn).filter(Boolean).join(", "),
    kcal: dish.kcal,
    photo: billedeUrl(dish.billede_sti),
  }));

  const empty = dishes.length ? "" : `
    <li class="empty">
      <span class="empty-icon">${icon(MEAL_ICONS[maaltid], 28)}</span>
      <p class="empty-title">Ingen retter under ${maaltid.toLowerCase()}</p>
      <p>Opret en madret i kategorien, så kan du vælge den her.</p>
      <button type="button" class="btn btn-primary" data-create>${icon("plus")}Opret madret</button>
    </li>`;

  $("meal-options").innerHTML = option({ id: null, name: "Ingen madret" }) + options.join("") + empty;
}

async function onOptionClick(event){
  if (event.target.closest("[data-create]")) {
    $("meal-sheet").close();
    showTab("madretter");
    openBuilder(picker.maaltid);
    return;
  }

  const button = event.target.closest("[data-option]");
  if (!button) return;
  const madretId = button.dataset.option || null;
  const { dag, maaltid } = picker;
  $("meal-sheet").close();
  if ((store.ugeplan[`${dag}|${maaltid}`] ?? null) === madretId) return;

  try {
    await setMeal(dag, maaltid, madretId);
  } catch (err) {
    showError(err);
  }
}

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
