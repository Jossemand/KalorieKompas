import { createClient } from "@supabase/supabase-js";
import { sumPrice } from "./lib/pris.js";

export const DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
export const MEALS = ["Morgenmad", "Frokost", "Aftensmad", "Snack"];

// Fælles data for alle visninger. Ændres kun via funktionerne herunder
export const store = {
  loaded: false,
  ingredienser: [],
  madretter: [],   // inkl. kladder og beregnede felter: kcal, protein, fedt, kulhydrat, raa_vaegt_g, pris
  ugeplan: {},     // `${dag}|${maaltid}` -> { madret_id, maengde, enhed }
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

// Supabase returnerer { data, error }. Kast fejlen (med Postgres-koden), så visningen kan vise den
function unwrap({ data, error }, message){
  if (error) throw Object.assign(new Error(`${message}: ${error.message}`), { code: error.code });
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
  if (!failed) return;
  // 42703 = ukendt kolonne: appen er nyere end databasen
  if (failed.reason.code === "42703") {
    throw new Error("Databasen skal opdateres: kør supabase/setup.sql igen i Supabase (SQL Editor) og genindlæs siden");
  }
  throw failed.reason;
}

/* ---------- Ingredienser ---------- */
async function loadIngredienser(){
  store.ingredienser = unwrap(await db.from("ingredienser").select("*").order("navn"), "Kunne ikke hente ingredienser");
}

// Returnerer den oprettede ingrediens, så den fx kan lægges direkte i en madret
export async function addIngrediens(row){
  const [created] = unwrap(await db.from("ingredienser").insert([row]).select(), "Kunne ikke gemme ingrediensen");
  await loadIngredienser();
  notify();
  return store.ingredienser.find(i => i.id === created.id) ?? created;
}

export async function updateIngrediens(id, row){
  unwrap(await db.from("ingredienser").update(row).eq("id", id), "Kunne ikke gemme ingrediensen");
  // Navn og næringsindhold indgår i madretterne, så de skal også hentes igen
  await Promise.all([loadIngredienser(), loadMadretter()]);
  notify();
}

export async function deleteIngrediens(id){
  unwrap(await db.from("ingredienser").delete().eq("id", id), "Kunne ikke slette ingrediensen");
  // Databasen fjerner også ingrediensen fra madretter, så de skal hentes igen
  await Promise.all([loadIngredienser(), loadMadretter()]);
  notify();
}

/* ---------- Madretter og kladder ---------- */
const MADRET_SELECT = `
  id, navn, created_at, kladde, billede_sti, portioner, faerdig_vaegt_g,
  madret_ingredienser (
    id,
    maengde_g,
    ingrediens_id,
    ingredienser ( navn, producent, kcal_100g, protein_100g, fedt_100g, kulhydrat_100g, pris, pris_maengde_g )
  )
`;

async function loadMadretter(){
  const data = unwrap(await db.from("madretter").select(MADRET_SELECT).order("created_at"), "Kunne ikke hente madretter");
  store.madretter = data.map(madret => {
    const items = madret.madret_ingredienser.map(row => ({ ingrediens: row.ingredienser, maengde_g: row.maengde_g }));
    return {
      ...madret,
      ...sumNutrition(items),
      pris: sumPrice(items), // { kr, kendte, ukendte } for hele retten
      raa_vaegt_g: items.reduce((sum, item) => sum + (Number(item.maengde_g) || 0), 0),
    };
  });
}

const linkRows = (madretId, items) =>
  items.map(item => ({ madret_id: madretId, ingrediens_id: item.ingrediens.id, maengde_g: item.maengde_g }));

// Erstat rettens ingredienser. De nye indsættes, før de gamle slettes, så retten aldrig står uden ingredienser, hvis noget fejler
async function replaceLinks(madretId, items){
  const keep = items.length
    ? unwrap(await db
      .from("madret_ingredienser")
      .insert(linkRows(madretId, items))
      .select("id"), "Kunne ikke gemme ingredienserne").map(row => row.id)
    : [];
  let query = db.from("madret_ingredienser").delete().eq("madret_id", madretId);
  if (keep.length) query = query.not("id", "in", `(${keep.join(",")})`);
  unwrap(await query, "Kunne ikke fjerne de gamle ingredienser");
}

// Billedet må ikke forhindre, at resten af retten bliver gemt – fejlen returneres i stedet
async function applyBillede(madretId, { billede, fjernBillede, oldSti }){
  try {
    if (billede) {
      await saveBillede(madretId, billede);
      await removeBilleder([oldSti]);
    } else if (fjernBillede && oldSti) {
      unwrap(await db.from("madretter").update({ billede_sti: null }).eq("id", madretId), "Kunne ikke fjerne billedet");
      await removeBilleder([oldSti]);
    }
    return null;
  } catch (err) {
    return err;
  }
}

// Ny madret eller kladde. Returnerer { id, billedeFejl }: retten gemmes, selvom billedet ikke kan uploades
export async function addMadret({ navn, portioner = null, faerdig_vaegt_g = null, items, billede = null, kladde = false }){
  const [madret] = unwrap(await db
    .from("madretter")
    .insert([{ navn, portioner, faerdig_vaegt_g, kladde }])
    .select(), "Kunne ikke gemme madretten");
  try {
    await replaceLinks(madret.id, items);
  } catch (err) {
    await db.from("madretter").delete().eq("id", madret.id); // efterlad ikke en halv madret
    throw err;
  }

  const billedeFejl = await applyBillede(madret.id, { billede });
  await loadMadretter();
  notify();
  return { id: madret.id, billedeFejl };
}

// Gemmer en eksisterende ret eller kladde. kladde: false gør en kladde til en rigtig madret
export async function updateMadret({ id, navn, portioner = null, faerdig_vaegt_g = null, items, billede = null, fjernBillede = false, kladde = false }){
  const oldSti = store.madretter.find(d => d.id === id)?.billede_sti;
  unwrap(await db
    .from("madretter")
    .update({ navn, portioner, faerdig_vaegt_g, kladde })
    .eq("id", id), "Kunne ikke gemme madretten");
  await replaceLinks(id, items);

  const billedeFejl = await applyBillede(id, { billede, fjernBillede, oldSti });
  await loadMadretter();
  notify();
  return { id, billedeFejl };
}

// Gem portioner og/eller færdigvægt på en ret (fx når de angives fra ugeplanen)
export async function setMadretOpdeling(id, fields){
  unwrap(await db.from("madretter").update(fields).eq("id", id), "Kunne ikke gemme rettens opdeling");
  await loadMadretter();
  notify();
}

export async function deleteMadret(id){
  const sti = store.madretter.find(d => d.id === id)?.billede_sti;
  unwrap(await db.from("madretter").delete().eq("id", id), "Kunne ikke slette madretten");
  await removeBilleder([sti]);
  // Databasen fjerner også retten fra ugeplanen
  await Promise.all([loadMadretter(), loadUgeplan()]);
  notify();
}

/* ---------- Billeder af madretter (Supabase Storage) ---------- */
const BILLEDE_BUCKET = "madret-billeder";

export function billedeUrl(sti){
  return sti ? db.storage.from(BILLEDE_BUCKET).getPublicUrl(sti).data.publicUrl : null;
}

// Uploader billedet og peger retten på det. Ny sti ved hver upload, så et gammelt billede aldrig vises fra cache
async function saveBillede(madretId, blob){
  const sti = `${madretId}/${Date.now()}.jpg`;
  const upload = await db.storage.from(BILLEDE_BUCKET).upload(sti, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (upload.error) throw new Error(`Kunne ikke uploade billedet: ${upload.error.message}`);

  const { error } = await db.from("madretter").update({ billede_sti: sti }).eq("id", madretId);
  if (error) {
    await removeBilleder([sti]);
    throw new Error(`Kunne ikke gemme billedet: ${error.message}`);
  }
}

// Oprydning af gamle filer må ikke stoppe brugeren, hvis den fejler
async function removeBilleder(stier){
  const valid = stier.filter(Boolean);
  if (valid.length === 0) return;
  const { error } = await db.storage.from(BILLEDE_BUCKET).remove(valid);
  if (error) console.warn("Kunne ikke slette gamle billeder", error);
}

export async function setMadretBillede(madretId, blob){
  const oldSti = store.madretter.find(d => d.id === madretId)?.billede_sti;
  await saveBillede(madretId, blob);
  await removeBilleder([oldSti]);
  await loadMadretter();
  notify();
}

export async function removeMadretBillede(madretId){
  const oldSti = store.madretter.find(d => d.id === madretId)?.billede_sti;
  unwrap(await db.from("madretter").update({ billede_sti: null }).eq("id", madretId), "Kunne ikke fjerne billedet");
  await removeBilleder([oldSti]);
  await loadMadretter();
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
  store.ugeplan = Object.fromEntries(data
    .filter(row => row.madret_id)
    .map(row => [`${row.dag}|${row.maaltid}`, { madret_id: row.madret_id, maengde: row.maengde, enhed: row.enhed }]));
}

// entry = { madret_id, maengde, enhed } eller null for at tømme måltidet
export async function setMeal(dag, maaltid, entry){
  const row = { dag, maaltid, madret_id: entry?.madret_id ?? null, maengde: entry?.maengde ?? null, enhed: entry?.enhed ?? null };
  unwrap(await db.from("ugeplan").upsert([row], { onConflict: "dag,maaltid" }), "Kunne ikke gemme ugeplanen");
  if (entry) store.ugeplan[`${dag}|${maaltid}`] = { madret_id: row.madret_id, maengde: row.maengde, enhed: row.enhed };
  else delete store.ugeplan[`${dag}|${maaltid}`];
  notify();
}
