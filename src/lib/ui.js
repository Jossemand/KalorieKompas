import { icon } from "./icons.js";

// Luk sheets via lukkeknapper (data-close) eller ved tryk på baggrunden
export function setupSheets(){
  document.querySelectorAll("dialog.sheet").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
    });
  });
}

export function openSheet(dialog){
  dialog.querySelectorAll(".sheet-scroll").forEach(el => { el.scrollTop = 0; });
  if (!dialog.open) dialog.showModal();
}

export function setBusy(button, busy){
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

export function toast(message, { type = "success", duration } = {}){
  const region = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = type === "error" ? "toast is-error" : "toast";
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `${icon(type === "error" ? "circle-alert" : "circle-check")}<span></span>`;
  el.querySelector("span").textContent = message;
  region.append(el);

  // Som popover ligger toasts i browserens top layer og ses derfor også oven på åbne dialoger
  if (region.showPopover && !region.matches(":popover-open")) region.showPopover();

  setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => {
      el.remove();
      if (!region.children.length && region.matches?.(":popover-open")) region.hidePopover();
    }, { once: true });
  }, duration ?? (type === "error" ? 5000 : 2600));
}

export function showError(error){
  console.error(error);
  toast(error.message || String(error), { type: "error" });
}

// Bekræftelsesdialog, der returnerer true, hvis brugeren bekræfter
export function confirmDialog({ title, message, confirmLabel = "Slet" }){
  const dialog = document.getElementById("confirm-sheet");
  dialog.querySelector("#confirm-title").textContent = title;
  dialog.querySelector("#confirm-message").textContent = message;
  dialog.querySelector("#confirm-ok").textContent = confirmLabel;

  return new Promise(resolve => {
    const onClick = event => {
      const answer = event.target.closest("[data-answer]")?.dataset.answer;
      if (answer) dialog.close(answer);
    };
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", () => {
      dialog.removeEventListener("click", onClick);
      resolve(dialog.returnValue === "yes");
    }, { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
}
