import "@fontsource-variable/plus-jakarta-sans";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/sheets.css";
import "./styles/views.css";

import { connect, loadAll } from "./state.js";
import { hydrateIcons } from "./lib/icons.js";
import { setupTabs } from "./lib/tabs.js";
import { setupSheets, showError } from "./lib/ui.js";
import { setupIngredienser } from "./views/ingredienser.js";
import { setupMadretter } from "./views/madretter.js";
import { setupUgeplan } from "./views/ugeplan.js";

// Læses af Vite fra miljøvariabler (lokalt fra .env, se .env.example; på Vercel fra dashboardet)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

function init(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    document.getElementById("setup-banner").hidden = false;
    return;
  }
  connect(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Vis uventede fejl på skærmen – på en telefon er konsollen ikke synlig
  window.addEventListener("error", event => showError(new Error(`Uventet fejl: ${event.message}`)));
  window.addEventListener("unhandledrejection", event => showError(new Error(`Uventet fejl: ${event.reason?.message ?? event.reason}`)));

  hydrateIcons();
  setupSheets();
  setupTabs();
  setupIngredienser();
  setupMadretter();
  setupUgeplan();

  document.getElementById("app").hidden = false;
  loadAll().catch(showError);
}

// Modul-scripts kører først, når HTML'en er indlæst, så appen kan startes direkte
init();
