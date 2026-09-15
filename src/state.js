import { createClient } from "@supabase/supabase-js";

export const DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
export const MEALS = ["Morgenmad", "Frokost", "Aftensmad", "Snack"];

// Fælles data for alle visninger. Ændres kun via funktionerne herunder
export const store = {
  loaded: false,
  ingredienser: [],
  madretter: [],   // inkl. beregnede totaler: kcal, protein, fedt, kulhydrat
  ugeplan: {},     // `${dag}|${maaltid}` -> madret_id
  kalorieMaal: 2000,
};

let db;
const listeners = new Set();

export function connect(url, key){
  db = createClient(url, key);
}

export function subscribe(listener){
  listeners.add(listener);
}

function notify(){
  listeners.forEach(listener => listener());
}

// Supabase returnerer { data, error }. Kast fejlen, så visningen kan vise den
function unwrap({ data, error }, message){
  if (error) throw new Error(`${message}: ${error.message}`);
  return data;
}

// Summerer næringsindhold for en liste af { ingrediens, maengde_g }
export function sumNutrition(items){
  const total = { kcal: 0, protein: 0, fedt: 0, kulhydrat: 0 };
  for (const { ingrediens, maengde_g } of items) {
    if (!ingrediens) continue;
    const factor = (Number(maengde_g) || 0) / 100;
    total.kcal += factor * (Number(ingrediens.kcal_100g) || 0);
    total.protein += factor * (Number(ingrediens.protein_100g) || 0);
    total.fedt += factor * (Number(ingrediens.fedt_100g) || 0);
    total.kulhydrat += factor * (Number(ingrediens.kulhydrat_100g) || 0);
  }
  return total;
}

export async function loadAll(){
  const results = await Promise.allSettled([loadIngredienser(), loadMadretter(), loadIndstillinger(), loadUgeplan()]);
  store.loaded = true;
  notify();
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
}

/* ---------- Ingredienser ---------- */
async function loadIngredienser(){
  store.ingredienser = unwrap(await db.from("ingredienser").select("*").order("navn"), "Kunne ikke hente ingredienser");
}

export async function addIngrediens(row){
  unwrap(await db.from("ingredienser").insert([row]), "Kunne ikke gemme ingrediensen");
  await loadIngredienser();
  notify();
}

export async function deleteIngrediens(id){
  unwrap(await db.from("ingredienser").delete().eq("id", id), "Kunne ikke slette ingrediensen");
  // Databasen fjerner også ingrediensen fra madretter, så de skal hentes igen
  await Promise.all([loadIngredienser(), loadMadretter()]);
  notify();
}

/* ---------- Madretter ---------- */
async function loadMadretter(){
  const data = unwrap(await db
    .from("madretter")
    .select(`
      id, navn, kategori, created_at,
      madret_ingredienser (
        maengde_g,
        ingrediens_id,
        ingredienser ( navn, kcal_100g, protein_100g, fedt_100g, kulhydrat_100g )
      )
    `)
    .order("created_at"), "Kunne ikke hente madretter");

  store.madretter = data.map(madret => ({
    ...madret,
    ...sumNutrition(madret.madret_ingredienser.map(row => ({ ingrediens: row.ingredienser, maengde_g: row.maengde_g }))),
  }));
}

export async function addMadret({ navn, kategori, items }){
  const [madret] = unwrap(await db.from("madretter").insert([{ navn, kategori }]).select(), "Kunne ikke gemme madretten");
  const rows = items.map(item => ({ madret_id: madret.id, ingrediens_id: item.ingrediens.id, maengde_g: item.maengde_g }));
  const { error } = await db.from("madret_ingredienser").insert(rows);
  if (error) {
    await db.from("madretter").delete().eq("id", madret.id); // efterlad ikke en madret uden ingredienser
    throw new Error(`Kunne ikke gemme ingredienserne: ${error.message}`);
  }
  await loadMadretter();
  notify();
}

export async function deleteMadret(id){
  unwrap(await db.from("madretter").delete().eq("id", id), "Kunne ikke slette madretten");
  // Databasen fjerner også retten fra ugeplanen
  await Promise.all([loadMadretter(), loadUgeplan()]);
  notify();
}

/* ---------- Ugeplan og kaloriemål ---------- */
async function loadIndstillinger(){
  const data = unwrap(await db.from("indstillinger").select("*").eq("id", 1).single(), "Kunne ikke hente kaloriemålet");
  store.kalorieMaal = Number(data.kalorie_maal) || 0;
}

export async function saveKalorieMaal(value){
  unwrap(await db.from("indstillinger").update({ kalorie_maal: value }).eq("id", 1), "Kunne ikke gemme kaloriemålet");
  store.kalorieMaal = value;
  notify();
}

async function loadUgeplan(){
  const data = unwrap(await db.from("ugeplan").select("*"), "Kunne ikke hente ugeplanen");
  store.ugeplan = Object.fromEntries(data.map(row => [`${row.dag}|${row.maaltid}`, row.madret_id]));
}

export async function setMeal(dag, maaltid, madretId){
  unwrap(await db
    .from("ugeplan")
    .upsert([{ dag, maaltid, madret_id: madretId }], { onConflict: "dag,maaltid" }), "Kunne ikke gemme ugeplanen");
  store.ugeplan[`${dag}|${maaltid}`] = madretId;
  notify();
}
