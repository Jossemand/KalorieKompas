const integer = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 });

export const formatKcal = value => integer.format(Math.round(Number(value) || 0));
export const formatGram = value => decimal.format(Number(value) || 0);

// Accepterer både komma og punktum som decimaltegn. Tomt felt giver null, ugyldigt giver NaN
export function parseDecimal(value){
  const text = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

// Et tal over 0 fra et inputfelt, ellers null (tomt eller ugyldigt)
export function parsePositive(value){
  const number = parseDecimal(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Tal til et inputfelt med dansk decimalkomma
export function toInputValue(value){
  if (value === null || value === undefined || value === "") return "";
  return String(Math.round(Number(value) * 10) / 10).replace(".", ",");
}

export function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

// Små bogstaver og uden accenter, så "creme" også finder "Crème fraiche"
export function normalize(value){
  return String(value ?? "").toLocaleLowerCase("da").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Alle søgeord skal indgå i navnet. Navne der starter med søgningen sorteres først
export function searchByName(items, query){
  const q = normalize(query).trim();
  if (!q) return items;
  const terms = q.split(/\s+/);
  const rank = name => (name.startsWith(q) ? 0 : name.includes(` ${q}`) ? 1 : 2);
  return items
    .map(item => ({ item, name: normalize(item.navn) }))
    .filter(({ name }) => terms.every(term => name.includes(term)))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.item.navn.localeCompare(b.item.navn, "da"))
    .map(({ item }) => item);
}

// Escaper teksten og markerer den del, der matcher søgningen, med <mark>
export function highlight(text, query){
  const q = normalize(query).trim();
  if (!q) return escapeHtml(text);
  // Normaliser tegn for tegn, så et match kan føres tilbage til placeringen i originalteksten
  let normalized = "";
  const origin = [];
  for (let i = 0; i < text.length; i++) {
    const part = normalize(text[i]);
    normalized += part;
    for (let k = 0; k < part.length; k++) origin.push(i);
  }
  const start = normalized.indexOf(q);
  if (start === -1) return escapeHtml(text);
  const from = origin[start];
  const to = origin[start + q.length - 1] + 1;
  return `${escapeHtml(text.slice(0, from))}<mark>${escapeHtml(text.slice(from, to))}</mark>${escapeHtml(text.slice(to))}`;
}
