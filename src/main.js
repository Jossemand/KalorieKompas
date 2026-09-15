import { createClient } from "@supabase/supabase-js";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import "./style.css";

/* ============================================================
   1) KONFIGURATION – læses af Vite fra miljøvariabler
      (lokalt fra .env, se .env.example; på Vercel fra dashboardet)
   ============================================================ */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/* ============================================================
   2) OPSÆTNING
   ============================================================ */
let db; // Supabase-klienten
let ingredienserCache = [];
let madretterCache = []; // includes computed totalKcal

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
let barcodeDetector = null; // oprettes første gang der scannes, så WASM-filen kun hentes når den skal bruges
let cameraStream = null;    // aktiv kamerastrøm, mens scanneren er åben
let scanSession = 0;        // øges når scanneren åbnes/lukkes, så et forældet forløb kan se, at det skal stoppe

// Stregkode-dekoderen er zxing-cpp som WASM. Hent filen fra vores eget site i stedet for en CDN
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? zxingWasmUrl : prefix + path),
  },
});

const DAYS = ["Mandag","Tirsdag","Onsdag","Torsdag","Fredag","Lørdag","Søndag"];
const MEALS = ["Morgenmad","Frokost","Aftensmad","Snack"];
let ugeplanCache = {}; // key `${dag}|${maaltid}` -> madret_id
let kalorieMaal = 2000;

let pendingIngredienser = []; // rows being built for a new madret: {ingrediens_id, maengde_g}

function val(id){ return document.getElementById(id).value.trim(); }
function num(id){ const v = document.getElementById(id).value; return v === "" ? 0 : parseFloat(v); }

function init(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    document.getElementById("setup-banner").hidden = false;
    return;
  }
  db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  document.getElementById("app").hidden = false;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  document.getElementById("ingrediens-form").addEventListener("submit", saveIngrediens);
  document.getElementById("btn-scan").addEventListener("click", startScanner);
  document.getElementById("btn-cancel-scan").addEventListener("click", closeScanner);
  document.getElementById("btn-add-ingrediens").addEventListener("click", addIngrediensToMadret);
  document.getElementById("btn-save-madret").addEventListener("click", saveMadret);
  document.getElementById("kalorie-maal").addEventListener("change", saveKalorieMaal);

  loadAll();
}

function showTab(tab){
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("main section").forEach(s => s.classList.toggle("active", s.id === "tab-" + tab));
}

async function loadAll(){
  await loadIngredienser();
  await loadMadretter();
  await loadIndstillinger();
  await loadUgeplan();
}

/* ============================================================
   3) INGREDIENSER
   ============================================================ */
async function loadIngredienser(){
  const { data, error } = await db.from("ingredienser").select("*").order("navn");
  if (error) { console.error(error); return; }
  ingredienserCache = data;
  renderIngredienserList();
  renderIngrediensSelect();
}

function renderIngredienserList(){
  const ul = document.getElementById("ingredienser-list");
  ul.innerHTML = "";
  if (ingredienserCache.length === 0) {
    ul.innerHTML = '<li class="empty">Ingen ingredienser endnu.</li>';
    return;
  }
  ingredienserCache.forEach(ing => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div class="name">${escapeHtml(ing.navn)}</div>
        <div class="meta">P ${ing.protein_100g ?? 0}g · F ${ing.fedt_100g ?? 0}g · K ${ing.kulhydrat_100g ?? 0}g</div>
      </div>
      <div class="kcal">${Math.round(ing.kcal_100g)} kcal</div>
      <button class="link" data-id="${ing.id}">Slet</button>
    `;
    li.querySelector("button.link").addEventListener("click", () => deleteIngrediens(ing.id));
    ul.appendChild(li);
  });
}

async function saveIngrediens(e){
  e.preventDefault();
  const row = {
    navn: val("ingrediens-navn"),
    barcode: val("ingrediens-barcode") || null,
    kcal_100g: num("ingrediens-kcal"),
    protein_100g: num("ingrediens-protein"),
    fedt_100g: num("ingrediens-fedt"),
    kulhydrat_100g: num("ingrediens-kulhydrat"),
  };
  if (!row.navn) return alert("Skriv et navn på ingrediensen.");
  const { error } = await db.from("ingredienser").insert([row]);
  if (error) return alert("Fejl ved gem: " + error.message);
  document.getElementById("ingrediens-form").reset();
  document.getElementById("ingrediens-barcode").value = "";
  await loadIngredienser();
}

async function deleteIngrediens(id){
  if (!confirm("Slet ingrediensen? Den fjernes også fra madretter, der bruger den.")) return;
  const { error } = await db.from("ingredienser").delete().eq("id", id);
  if (error) return alert("Fejl ved sletning: " + error.message);
  await loadAll();
}

/* --- Stregkode-scanning --- */
async function startScanner(){
  const session = ++scanSession;
  document.getElementById("scanner-modal").style.display = "flex";
  barcodeDetector ??= new BarcodeDetector({ formats: BARCODE_FORMATS });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "environment", // bagkameraet
        // Høj opløsning er afgørende for at kunne skelne de tynde streger i en stregkode
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (err) {
    if (session === scanSession) {
      alert("Kunne ikke starte kameraet: " + (err.message || err));
      closeScanner();
    }
    return;
  }

  // Brugeren kan have trykket "Annuller", mens kameraet startede
  if (session !== scanSession) {
    stream.getTracks().forEach(track => track.stop());
    return;
  }

  cameraStream = stream;
  enableContinuousFocus(stream);
  const video = document.getElementById("scanner-video");
  video.srcObject = stream;
  video.play().catch(() => {}); // afvises kun, hvis scanneren lukkes, før videoen når at starte
  scanLoop(video, session);
}

// Afkoder hele videobilledet i fuld opløsning, indtil der findes en stregkode eller scanneren lukkes
async function scanLoop(video, session){
  while (session === scanSession) {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      let barcodes;
      try {
        barcodes = await barcodeDetector.detect(video);
      } catch (err) {
        console.error(err);
        if (session === scanSession) {
          alert("Stregkodelæseren kunne ikke starte: " + (err.message || err));
          closeScanner();
        }
        return;
      }
      if (barcodes.length > 0 && session === scanSession) {
        closeScanner();
        showTab("ingredienser");
        lookupBarcode(barcodes[0].rawValue);
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // ca. 10 forsøg i sekundet
  }
}

// Bed om kontinuerlig autofokus, hvor browseren understøtter det (fx Chrome på Android)
function enableContinuousFocus(stream){
  const [track] = stream.getVideoTracks();
  const focusModes = track?.getCapabilities?.().focusMode ?? [];
  if (focusModes.includes("continuous")) {
    track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  }
}

function closeScanner(){
  scanSession++;
  document.getElementById("scanner-modal").style.display = "none";
  document.getElementById("scanner-video").srcObject = null;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
}

async function lookupBarcode(barcode){
  const setField = (id, value) => { document.getElementById(id).value = value ?? ""; };
  document.getElementById("ingrediens-form").reset(); // ryd værdier fra en tidligere indtastning
  setField("ingrediens-barcode", barcode);
  setField("ingrediens-navn", "Henter...");
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_da,nutriments`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 1) {
      const p = data.product;
      const n = p.nutriments || {};
      setField("ingrediens-navn", p.product_name_da || p.product_name);
      setField("ingrediens-kcal", kcalPer100g(n));
      setField("ingrediens-protein", n["proteins_100g"]);
      setField("ingrediens-fedt", n["fat_100g"]);
      setField("ingrediens-kulhydrat", n["carbohydrates_100g"]);
    } else {
      setField("ingrediens-navn", "");
      alert("Produktet findes ikke i Open Food Facts. Udfyld felterne manuelt — stregkoden gemmes stadig, så den kan slås op igen.");
    }
  } catch (e) {
    setField("ingrediens-navn", "");
    alert("Kunne ikke slå stregkoden op: " + e.message);
  }
}

// Nogle produkter har kun energi i kJ (energy_100g). 1 kcal = 4,184 kJ
function kcalPer100g(nutriments){
  if (nutriments["energy-kcal_100g"] != null) return nutriments["energy-kcal_100g"];
  if (nutriments["energy_100g"] != null) return Math.round(nutriments["energy_100g"] / 4.184 * 10) / 10;
  return "";
}

/* ============================================================
   4) MADRETTER
   ============================================================ */
function renderIngrediensSelect(){
  const sel = document.getElementById("madret-ingrediens-select");
  sel.innerHTML = ingredienserCache.map(i => `<option value="${i.id}">${escapeHtml(i.navn)}</option>`).join("");
}

function addIngrediensToMadret(){
  const id = document.getElementById("madret-ingrediens-select").value;
  const maengde = parseFloat(document.getElementById("madret-maengde").value) || 0;
  if (!id || maengde <= 0) return;
  const ing = ingredienserCache.find(i => i.id === id);
  if (!ing) return;
  pendingIngredienser.push({ ingrediens_id: id, navn: ing.navn, kcal_100g: ing.kcal_100g, maengde_g: maengde });
  renderPendingIngredienser();
}

function renderPendingIngredienser(){
  const box = document.getElementById("madret-added-list");
  box.innerHTML = "";
  let total = 0;
  pendingIngredienser.forEach((row, idx) => {
    const kcal = Math.round((row.maengde_g / 100) * row.kcal_100g);
    total += kcal;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<span>${escapeHtml(row.navn)} — ${row.maengde_g}g (${kcal} kcal)</span><span class="rm" data-idx="${idx}">Fjern</span>`;
    div.querySelector(".rm").addEventListener("click", () => {
      pendingIngredienser.splice(idx, 1);
      renderPendingIngredienser();
    });
    box.appendChild(div);
  });
  document.getElementById("madret-total-line").textContent = `Total: ${total} kcal`;
}

async function saveMadret(){
  const navn = val("madret-navn");
  const kategori = val("madret-kategori");
  if (!navn) return alert("Giv madretten et navn.");
  if (pendingIngredienser.length === 0) return alert("Tilføj mindst én ingrediens.");

  const { data: madretRows, error: madretErr } = await db
    .from("madretter")
    .insert([{ navn, kategori }])
    .select();
  if (madretErr) return alert("Fejl ved gem af madret: " + madretErr.message);
  const madretId = madretRows[0].id;

  const childRows = pendingIngredienser.map(r => ({
    madret_id: madretId,
    ingrediens_id: r.ingrediens_id,
    maengde_g: r.maengde_g
  }));
  const { error: childErr } = await db.from("madret_ingredienser").insert(childRows);
  if (childErr) {
    await db.from("madretter").delete().eq("id", madretId); // efterlad ikke en madret uden ingredienser
    return alert("Fejl ved gem af ingredienser: " + childErr.message);
  }

  document.getElementById("madret-navn").value = "";
  pendingIngredienser = [];
  renderPendingIngredienser();
  await loadMadretter();
  await loadUgeplan();
}

async function loadMadretter(){
  const { data, error } = await db
    .from("madretter")
    .select(`
      id, navn, kategori, created_at,
      madret_ingredienser (
        maengde_g,
        ingredienser ( navn, kcal_100g )
      )
    `)
    .order("created_at");
  if (error) { console.error(error); return; }

  madretterCache = data.map(m => {
    const totalKcal = m.madret_ingredienser.reduce((sum, ri) => {
      const kcal100 = ri.ingredienser ? ri.ingredienser.kcal_100g : 0;
      return sum + (ri.maengde_g / 100) * kcal100;
    }, 0);
    return { ...m, totalKcal: Math.round(totalKcal) };
  });

  renderMadretterList();
  renderUgeplanTable();
}

function renderMadretterList(){
  const box = document.getElementById("madretter-list");
  if (madretterCache.length === 0) {
    box.innerHTML = '<p class="empty">Ingen madretter endnu.</p>';
    return;
  }
  box.innerHTML = "";
  MEALS.forEach(kategori => {
    const items = madretterCache.filter(m => m.kategori === kategori);
    if (items.length === 0) return;
    const h = document.createElement("h3");
    h.style.fontSize = "0.95rem";
    h.style.margin = "16px 0 6px";
    h.textContent = kategori;
    box.appendChild(h);
    const ul = document.createElement("ul");
    ul.className = "list";
    items.forEach(m => {
      const li = document.createElement("li");
      const ingredientNames = m.madret_ingredienser.map(ri => ri.ingredienser ? ri.ingredienser.navn : "?").join(", ");
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(m.navn)}</div>
          <div class="meta">${escapeHtml(ingredientNames)}</div>
        </div>
        <div class="kcal">${m.totalKcal} kcal</div>
        <button class="link" data-id="${m.id}">Slet</button>
      `;
      li.querySelector("button.link").addEventListener("click", () => deleteMadret(m.id));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  });
}

async function deleteMadret(id){
  if (!confirm("Slet madretten? Den fjernes også fra ugeplanen, hvor den er brugt.")) return;
  const { error } = await db.from("madretter").delete().eq("id", id);
  if (error) return alert("Fejl ved sletning: " + error.message);
  await loadMadretter();
  await loadUgeplan();
}

/* ============================================================
   5) UGEPLAN
   ============================================================ */
async function loadIndstillinger(){
  const { data, error } = await db.from("indstillinger").select("*").eq("id", 1).single();
  if (error) { console.error(error); return; }
  kalorieMaal = data.kalorie_maal;
  document.getElementById("kalorie-maal").value = kalorieMaal;
}

async function saveKalorieMaal(){
  kalorieMaal = parseFloat(document.getElementById("kalorie-maal").value) || 0;
  const { error } = await db.from("indstillinger").update({ kalorie_maal: kalorieMaal }).eq("id", 1);
  if (error) return alert("Fejl ved gem af kaloriemål: " + error.message);
  renderUgeplanTable();
}

async function loadUgeplan(){
  const { data, error } = await db.from("ugeplan").select("*");
  if (error) { console.error(error); return; }
  ugeplanCache = {};
  data.forEach(row => {
    ugeplanCache[`${row.dag}|${row.maaltid}`] = row.madret_id;
  });
  renderUgeplanTable();
}

function renderUgeplanTable(){
  const table = document.getElementById("ugeplan-table");
  let html = "<tr><th>Måltid</th>";
  DAYS.forEach(d => html += `<th>${d}</th>`);
  html += "</tr>";

  MEALS.forEach(meal => {
    html += `<tr><td class="meal-label">${meal}</td>`;
    DAYS.forEach(day => {
      const key = `${day}|${meal}`;
      const selectedId = ugeplanCache[key] || "";
      const options = madretterCache
        .filter(m => m.kategori === meal)
        .map(m => `<option value="${m.id}" ${m.id === selectedId ? "selected" : ""}>${escapeHtml(m.navn)}</option>`)
        .join("");
      html += `<td>
        <select data-day="${day}" data-meal="${meal}">
          <option value="">–</option>
          ${options}
        </select>
      </td>`;
    });
    html += "</tr>";
    html += `<tr><td class="meal-label kcal-cell">kcal</td>`;
    DAYS.forEach(day => {
      const key = `${day}|${meal}`;
      const madretId = ugeplanCache[key];
      const m = madretterCache.find(x => x.id === madretId);
      html += `<td class="kcal-cell">${m ? m.totalKcal : "–"}</td>`;
    });
    html += "</tr>";
  });

  html += `<tr class="total-row"><td class="meal-label">Total</td>`;
  const dayTotals = {};
  DAYS.forEach(day => {
    let total = 0;
    MEALS.forEach(meal => {
      const madretId = ugeplanCache[`${day}|${meal}`];
      const m = madretterCache.find(x => x.id === madretId);
      if (m) total += m.totalKcal;
    });
    dayTotals[day] = total;
    html += `<td>${total}</td>`;
  });
  html += "</tr>";

  html += `<tr class="diff-row"><td class="meal-label">Mål: ${kalorieMaal}</td>`;
  DAYS.forEach(day => {
    const diff = kalorieMaal - dayTotals[day];
    html += `<td>${diff >= 0 ? "+" : ""}${diff}</td>`;
  });
  html += "</tr>";

  table.innerHTML = html;

  table.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const day = sel.dataset.day;
      const meal = sel.dataset.meal;
      const madretId = sel.value || null;
      const { error } = await db
        .from("ugeplan")
        .upsert([{ dag: day, maaltid: meal, madret_id: madretId }], { onConflict: "dag,maaltid" });
      if (error) return alert("Fejl ved gem af ugeplan: " + error.message);
      ugeplanCache[`${day}|${meal}`] = madretId;
      renderUgeplanTable();
    });
  });
}

/* ============================================================
   6) HJÆLPEFUNKTIONER
   ============================================================ */
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Modul-scripts kører først, når HTML'en er indlæst, så appen kan startes direkte
init();
