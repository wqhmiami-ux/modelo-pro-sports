
(() => {
"use strict";
const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll("[data-hof-tab]")];
const panels = [...document.querySelectorAll("[data-hof-panel]")];
tabs.forEach(tab => tab.addEventListener("click", () => {
  tabs.forEach(item => item.setAttribute("aria-pressed", String(item === tab)));
  panels.forEach(panel => panel.hidden = panel.dataset.hofPanel !== tab.dataset.hofTab);
}));
let legCount = 0;
function addLeg(name="", odds="", probability="") {
  if (legCount >= 8) { $("hof-parlay-status").textContent = "Máximo de 8 selecciones por combinada."; return; }
  const id = ++legCount;
  const row = document.createElement("div");
  row.className = "hof-leg";
  row.dataset.leg = String(id);
  row.innerHTML = `
    <div class="hof-leg-name"><label>Selección ${id}</label><input class="hof-name" maxlength="120" placeholder="Evento / selección" value="${escapeAttr(name)}"></div>
    <div><label>Cuota americana</label><input class="hof-odds" type="number" step="1" placeholder="-110" value="${escapeAttr(odds)}"></div>
    <div><label>Prob. propia (%)</label><input class="hof-prob" type="number" min="0.1" max="99.9" step="0.1" placeholder="55" value="${escapeAttr(probability)}"></div>
    <button type="button" class="hof-remove" aria-label="Eliminar selección">Quitar</button>`;
  $("hof-legs").appendChild(row);
}
function escapeAttr(value) { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function americanToDecimal(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n/100 : 1 + 100/Math.abs(n);
}
$("hof-add-leg")?.addEventListener("click", () => addLeg());
$("hof-legs")?.addEventListener("click", event => {
  const button = event.target.closest(".hof-remove");
  if (button) button.closest(".hof-leg")?.remove();
});
$("hof-calc-parlay")?.addEventListener("click", () => {
  const rows = [...$("hof-legs").querySelectorAll(".hof-leg")];
  if (rows.length < 2) { $("hof-parlay-result").textContent = "Agrega al menos 2 selecciones."; return; }
  let decimal = 1, estimated = 1, valid = true;
  const names = [];
  for (const row of rows) {
    const name = row.querySelector(".hof-name").value.trim();
    const d = americanToDecimal(row.querySelector(".hof-odds").value);
    const pRaw = row.querySelector(".hof-prob").value.trim();
    const p = Number(pRaw);
    if (!name || d === null || !pRaw || !Number.isFinite(p) || p <= 0 || p >= 100) { valid = false; break; }
    names.push(name); decimal *= d; estimated *= p/100;
  }
  if (!valid) { $("hof-parlay-result").textContent = "Completa cada selección con nombre, cuota americana válida y probabilidad propia entre 0.1% y 99.9%. No se rellenan datos automáticamente."; return; }
  const implied = 1/decimal*100;
  const estimate = estimated*100;
  const edge = estimate-implied;
  const american = decimal >= 2 ? "+"+Math.round((decimal-1)*100) : "-"+Math.round(100/(decimal-1));
  const decision = edge > 0 ? "REVISIÓN MANUAL — NO ES RECOMENDACIÓN AUTOMÁTICA" : "NO APOSTAR: EDGE CONJUNTO NO POSITIVO";
  $("hof-parlay-result").innerHTML = `
    <b>Resultado matemático de la combinada</b>
    <div>Selecciones: ${rows.length}</div>
    <div>Cuota combinada aproximada: <b>${american} (decimal ${decimal.toFixed(3)})</b></div>
    <div>Probabilidad implícita: <b>${implied.toFixed(2)}%</b></div>
    <div>Probabilidad conjunta introducida: <b>${estimate.toFixed(2)}%</b></div>
    <div>EDGE calculado: <b>${edge.toFixed(2)} puntos</b></div>
    <p><b>${decision}</b></p>
    <p class="hof-small">Cálculo multiplicativo que supone independencia entre selecciones. Si existe correlación (mismo partido, jugador, equipo o guion de juego), esta probabilidad puede ser incorrecta. Las probabilidades de cada pierna son introducidas por el usuario, no generadas por un modelo estadístico. No incluye margen de la casa ni garantiza valor real.</p>
    <ul>${names.map(n=>"<li>"+escapeHTML(n)+"</li>").join("")}</ul>`;
});
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
addLeg(); addLeg();
})();
