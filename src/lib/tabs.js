const STORAGE_KEY = "kaloriekompas:fane";

export function setupTabs(){
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });

  // Vis en kant under topbaren, når indholdet er scrollet ind under den
  const topbar = document.getElementById("topbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Åbn den fane, der sidst var valgt (kun en bekvemmelighed – kan være utilgængeligt)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && document.getElementById(`view-${saved}`)) showTab(saved, { scroll: false });
  } catch {
    // ignorér: fx privat browsing
  }
}

export function showTab(name, { scroll = true } = {}){
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("is-active", view.id === `view-${name}`);
  });
  if (scroll) window.scrollTo({ top: 0 });
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // ignorér
  }
}
