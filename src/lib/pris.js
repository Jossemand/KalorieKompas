// Pris på ingredienser og videre op gennem madretter og ugeplanen.
// En pris er altid { kr, kendte, ukendte }: ukendte er de ingredienser, der mangler en pris,
// så en delvis udregnet pris kan vises som et minimum i stedet for at se komplet ud
const kroner = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const heleKroner = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });

export const formatKr = value => kroner.format(Number(value) || 0);
export const formatKrRound = value => heleKroner.format(Math.round(Number(value) || 0));

// Kroner til et inputfelt med dansk decimalkomma. To decimaler, så ører ikke rundes væk
export function toPrisInput(value){
  if (value === null || value === undefined || value === "") return "";
  return String(Math.round(Number(value) * 100) / 100).replace(".", ",");
}

// Pakkeprisen omregnet til kr/100 g – samme enhed som næringsindholdet. null = ingen pris registreret
export function prisPer100g(ingrediens){
  const pris = Number(ingrediens?.pris);
  const gram = Number(ingrediens?.pris_maengde_g);
  if (!Number.isFinite(pris) || pris < 0 || !(gram > 0)) return null;
  return (pris / gram) * 100;
}

export const emptyPrice = () => ({ kr: 0, kendte: 0, ukendte: 0 });

// Summerer prisen for en liste af { ingrediens, maengde_g }
export function sumPrice(items){
  const total = emptyPrice();
  for (const { ingrediens, maengde_g } of items) {
    const gram = Number(maengde_g) || 0;
    if (!ingrediens || gram <= 0) continue;
    // En madret brugt som ingrediens: dens andel af prisen, og dens ingredienser med og uden pris tæller med
    if (ingrediens.madret_pris) {
      const { kr, kendte, ukendte } = ingrediens.madret_pris;
      if (ingrediens.madret_vaegt_g > 0) total.kr += (gram / ingrediens.madret_vaegt_g) * kr;
      total.kendte += kendte;
      total.ukendte += ukendte;
      continue;
    }
    const per100 = prisPer100g(ingrediens);
    if (per100 === null) total.ukendte++;
    else {
      total.kr += (gram / 100) * per100;
      total.kendte++;
    }
  }
  return total;
}

// Ganger en pris med en andel af retten (fx én portion)
export const scalePrice = (pris, fraction) => ({ ...emptyPrice(), ...pris, kr: (pris?.kr ?? 0) * fraction });

// Lægger flere priser sammen, fx alle måltider på en dag
export function addPrices(priser){
  return priser.reduce((sum, pris) => ({
    kr: sum.kr + (pris?.kr ?? 0),
    kendte: sum.kendte + (pris?.kendte ?? 0),
    ukendte: sum.ukendte + (pris?.ukendte ?? 0),
  }), emptyPrice());
}

// "24,50 kr", eller "24,50 kr+" når noget mangler pris. null når intet er prissat – så vises prisen slet ikke
export function formatPrice(pris, { round = false } = {}){
  if (!pris || pris.kendte === 0) return null;
  return `${round ? formatKrRound(pris.kr) : formatKr(pris.kr)} kr${pris.ukendte ? "+" : ""}`;
}

// Forklaring til "+"-tegnet
export function missingPriceText(pris){
  if (!pris?.ukendte) return "";
  return `${pris.ukendte} ${pris.ukendte === 1 ? "ingrediens mangler" : "ingredienser mangler"} pris`;
}
