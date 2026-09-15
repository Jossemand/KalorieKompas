import { icon } from "./icons.js";
import { escapeHtml, formatGram } from "./format.js";

export function macrosHtml({ protein, fedt, kulhydrat }){
  return `<div class="macros">
    <span class="macro macro-p" title="Protein">P ${formatGram(protein)} g</span>
    <span class="macro macro-f" title="Fedt">F ${formatGram(fedt)} g</span>
    <span class="macro macro-k" title="Kulhydrat">K ${formatGram(kulhydrat)} g</span>
  </div>`;
}

export function emptyStateHtml({ tag = "div", iconName, title, text, action = "" }){
  return `<${tag} class="empty" style="grid-column: 1 / -1">
    <span class="empty-icon">${icon(iconName, 28)}</span>
    <p class="empty-title">${escapeHtml(title)}</p>
    <p>${escapeHtml(text)}</p>
    ${action}
  </${tag}>`;
}
