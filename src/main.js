import "@fontsource-variable/plus-jakarta-sans";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/sheets.css";
import "./styles/views.css";

import { connect, currentUserId, loadAll, onSignedOut, signIn, signOut, store, subscribe } from "./state.js";
import { hydrateIcons } from "./lib/icons.js";
import { setupTabs } from "./lib/tabs.js";
import { setBusy, setupSheets, showError } from "./lib/ui.js";
import { setupIngredienser } from "./views/ingredienser.js";
import { setupMadretter } from "./views/madretter.js";
import { setupUgeplan } from "./views/ugeplan.js";

// Læses af Vite fra miljøvariabler (lokalt fra .env, se .env.example; på Vercel fra dashboardet)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const $ = id => document.getElementById(id);
let started = false;

async function init(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    $("setup-banner").hidden = false;
    return;
  }
  connect(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Vis uventede fejl på skærmen – på en telefon er konsollen ikke synlig
  window.addEventListener("error", event => showError(new Error(`Uventet fejl: ${event.message}`)));
  window.addEventListener("unhandledrejection", event => showError(new Error(`Uventet fejl: ${event.reason?.message ?? event.reason}`)));

  hydrateIcons();
  setupSheets();
  setupLogin();

  const brugerId = await currentUserId();
  if (brugerId) start(brugerId);
  else showLogin();
}

/* ---------- Login ---------- */
// En almindelig formular med e-mail og adgangskode, så browseren kan gemme og udfylde adgangskoden
function setupLogin(){
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    const error = $("login-error");
    error.hidden = true;
    if (!email || !password) {
      error.textContent = "Udfyld både e-mail og adgangskode";
      error.hidden = false;
      return;
    }

    const submit = $("login-submit");
    setBusy(submit, true);
    try {
      const brugerId = await signIn(email, password);
      $("login-password").value = "";
      start(brugerId);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      $("login-password").select();
    } finally {
      setBusy(submit, false);
    }
  });

  $("btn-logout").addEventListener("click", async () => {
    try {
      await signOut(); // onSignedOut genindlæser siden
    } catch (err) {
      showError(err);
    }
  });
  // Start forfra uden de forrige data i hukommelsen
  onSignedOut(() => {
    if (started) location.reload();
  });
}

function showLogin(){
  $("login").hidden = false;
  $("login-email").focus();
}

function start(brugerId){
  started = true;
  $("login").hidden = true;
  setupTabs();
  setupIngredienser();
  setupMadretter();
  setupUgeplan();
  subscribe(() => {
    $("bruger-navn").textContent = store.profiler.find(p => p.id === store.brugerId)?.navn ?? "";
  });

  $("app").hidden = false;
  loadAll(brugerId).catch(showError);
}

// Modul-scripts kører først, når HTML'en er indlæst, så appen kan startes direkte
init();
