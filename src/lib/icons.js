import {
  createElement,
  Camera, CalendarDays, Carrot, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Coffee, Compass, Cookie,
  CookingPot, ImagePlus, Keyboard, List, Minus, Plus, Sandwich, ScanBarcode, Search, SearchX, Soup, Target, Trash2, X,
} from "lucide";

// Kun de ikoner, appen bruger, kommer med i bundlen
const ICONS = {
  camera: Camera,
  "calendar-days": CalendarDays,
  "image-plus": ImagePlus,
  carrot: Carrot,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  coffee: Coffee,
  compass: Compass,
  cookie: Cookie,
  "cooking-pot": CookingPot,
  keyboard: Keyboard,
  list: List,
  minus: Minus,
  plus: Plus,
  sandwich: Sandwich,
  "scan-barcode": ScanBarcode,
  search: Search,
  "search-x": SearchX,
  soup: Soup,
  target: Target,
  trash: Trash2,
  x: X,
};

export const MEAL_ICONS = { Morgenmad: "coffee", Frokost: "sandwich", Aftensmad: "soup", Snack: "cookie" };

export function icon(name, size = 20){
  const svg = createElement(ICONS[name], { width: size, height: size, "aria-hidden": "true" });
  svg.classList.add("icon");
  return svg.outerHTML;
}

// Indsætter SVG-ikoner i elementer med data-icon="navn" i den statiske HTML
export function hydrateIcons(root = document){
  root.querySelectorAll("[data-icon]").forEach(el => {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.removeAttribute("data-icon");
  });
}
