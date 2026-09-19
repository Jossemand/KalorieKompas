// Beregninger for mængder i ugeplanen: hvor stor en del af en madret spiser man?
import { formatGram } from "./format.js";
import { scalePrice } from "./pris.js";

// Vægten af hele den færdige ret. Uden indtastet færdigvægt bruges ingrediensernes rå vægt
export const dishWeight = dish => Number(dish.faerdig_vaegt_g) || dish.raa_vaegt_g || 0;

// Andel af hele retten for en post i ugeplanen ({ maengde, enhed }). Uden mængde = hele retten
export function dishFraction(dish, entry){
  const amount = Number(entry?.maengde);
  if (!entry?.enhed || !(amount > 0)) return 1;
  if (entry.enhed === "g") {
    const weight = dishWeight(dish);
    return weight > 0 ? amount / weight : 0;
  }
  return amount / (Number(dish.portioner) || 1);
}

export function entryNutrition(dish, entry){
  const fraction = dishFraction(dish, entry);
  return {
    kcal: dish.kcal * fraction,
    protein: dish.protein * fraction,
    fedt: dish.fedt * fraction,
    kulhydrat: dish.kulhydrat * fraction,
  };
}

// Prisen for den del af retten, man spiser. Antallet af ingredienser uden pris følger med uændret
export function entryPrice(dish, entry){
  return scalePrice(dish.pris, dishFraction(dish, entry));
}

export const pricePerPortion = dish => (Number(dish.portioner) > 0 ? scalePrice(dish.pris, 1 / dish.portioner) : null);

export const kcalPerPortion = dish => (Number(dish.portioner) > 0 ? dish.kcal / dish.portioner : null);

export function kcalPer100gDish(dish){
  const weight = dishWeight(dish);
  return weight > 0 ? (dish.kcal / weight) * 100 : null;
}

// 0,5 → "½", 1,5 → "1½", 2 → "2", 1,3 → "1,3"
export function formatPortionCount(value){
  const whole = Math.floor(value);
  const fraction = Math.round((value - whole) * 100) / 100;
  const symbol = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[fraction];
  if (fraction === 0) return String(whole);
  if (symbol) return whole ? `${whole}${symbol}` : symbol;
  return formatGram(value);
}

export function formatPortions(value){
  return `${formatPortionCount(value)} ${value <= 1 ? "portion" : "portioner"}`;
}

export function formatAmount(entry){
  const amount = Number(entry?.maengde);
  if (!entry?.enhed || !(amount > 0)) return "Hele retten";
  return entry.enhed === "g" ? `${formatGram(amount)} g` : formatPortions(amount);
}
