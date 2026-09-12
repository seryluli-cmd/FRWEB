// ============================================================
// Navegación entre pantallas — selector de negocio, selector de
// sección (Gastos/Facturado/Ideas/...), y las tabs de screen-app.
// ============================================================
import { state, NEGOCIOS } from "./state.js";
import { $, $$, escapeHtml, showScreen } from "./utils.js";
import { puedeVerInversion } from "./identidad.js";
import { renderGastos, renderGastosAdmin } from "./gastos.js";
import { renderFacturado } from "./facturado.js";
import { renderResumen, renderBalance } from "./resumen.js";
import { renderIdeas } from "./ideas.js";
import { renderReportes } from "./reportes.js";
import { renderInversion } from "./inversion.js";

export function renderNegocioCards() {
  const wrap = $("#negocio-cards");
  wrap.innerHTML = "";
  NEGOCIOS.forEach(biz => {
    const card = document.createElement("div");
    card.className = "negocio-card";
    card.style.setProperty("--biz-color", biz.color);
    card.innerHTML = `
      <div class="negocio-emoji">${biz.emoji}</div>
      <div class="negocio-info">
        <div class="negocio-nombre">${escapeHtml(biz.nombre)}</div>
        <div class="negocio-sub">Ver gastos y facturado</div>
      </div>
    `;
    card.addEventListener("click", () => selectNegocio(biz.id));
    wrap.appendChild(card);
  });
}

export function selectNegocio(id) {
  const biz = NEGOCIOS.find(n => n.id === id);
  if (!biz) return;
  state.negocioActual = id;

  // Pantalla "app" (Gastos/Balance/Ajustes) — badge del topbar
  $("#negocio-titulo").textContent = biz.nombre;
  $("#negocio-icon-badge").textContent = biz.emoji;
  $("#negocio-icon-badge").style.background = biz.color;

  // Pantalla "Cierre de Turno" — badge del topbar
  $("#facturado-titulo").textContent = biz.nombre + " — Cierre de Turno";
  $("#facturado-icon-badge").textContent = biz.emoji;
  $("#facturado-icon-badge").style.background = biz.color;

  // Pantalla "Resumen mensual" — badge del topbar
  $("#resumen-titulo").textContent = biz.nombre + " — Resumen";
  $("#resumen-icon-badge").textContent = biz.emoji;
  $("#resumen-icon-badge").style.background = biz.color;

  // Ajustes → tarjeta "Exportar datos"
  $("#export-negocio-nombre").textContent = biz.nombre;

  renderSeccionCards(biz);
  showScreen("screen-seccion");
}

// El título "GESTION FR" y la bajada quedaron fijos en el HTML (sin ícono,
// para ganar espacio vertical y que entren todas las tarjetas) — ya no
// dependen de biz.nombre/biz.emoji como el resto de las pantallas.
function renderSeccionCards(biz) {

  const SECCIONES = [
    { id: "inversion", emoji: "🏦", nombre: "Inversión Recuperada", sub: "Seguimiento del monto recuperado por Sergio", soloInversion: true },
    { id: "gastos", emoji: "🧾", nombre: "Gastos", sub: "Cargar gastos y ver el balance entre socios" },
    { id: "facturado", emoji: "💰", nombre: "Cierre de Turno", sub: "Anotar efectivo y Digital" },
    { id: "resumen", emoji: "📊", nombre: "Resumen mensual", sub: "Ver los totales de cada mes", soloAdmin: true },
    { id: "gastosadmin", emoji: "🔒", nombre: "Gastos S/Admin", sub: "Alquiler y otros gastos privados", soloAdmin: true },
    { id: "ideas", emoji: "💡", nombre: "Caja de IDEAS", sub: "Aportar ideas para mejorar el negocio y el entorno laboral" },
    { id: "mantenimiento", emoji: "🔨", nombre: "Reportes de Mantenimiento", sub: "Reportar roturas o cosas para arreglar" }
  ];

  const wrap = $("#seccion-cards");
  wrap.innerHTML = "";
  SECCIONES.filter(s => (!s.soloAdmin || state.esAdmin) && (!s.soloInversion || puedeVerInversion())).forEach(s => {
    const card = document.createElement("div");
    card.className = "negocio-card";
    card.style.setProperty("--biz-color", biz.color);
    card.innerHTML = `
      <div class="negocio-emoji">${s.emoji}</div>
      <div class="negocio-info">
        <div class="negocio-nombre">${s.nombre}</div>
        <div class="negocio-sub">${s.sub}</div>
      </div>
    `;
    card.addEventListener("click", () => selectSeccion(s.id));
    wrap.appendChild(card);
  });
}

function selectSeccion(id) {
  state.seccionActual = id;
  if (id === "gastos") {
    switchTab("gastos");
    state.gastosMesOffset = 0; // siempre arranca en el mes actual al entrar
    renderGastos();
    renderBalance();
    showScreen("screen-app");
  } else if (id === "facturado") {
    state.facturadoMesOffset = 0; // siempre arranca en el mes actual al entrar
    renderFacturado();
    showScreen("screen-facturado");
  } else if (id === "resumen") {
    state.resumenMesOffset = 0;
    renderResumen();
    showScreen("screen-resumen");
  } else if (id === "gastosadmin") {
    state.gastosAdminMesOffset = 0;
    renderGastosAdmin();
    showScreen("screen-gastos-admin");
  } else if (id === "ideas") {
    renderIdeas();
    showScreen("screen-ideas");
  } else if (id === "mantenimiento") {
    renderReportes();
    showScreen("screen-mantenimiento");
  } else if (id === "inversion") {
    renderInversion();
    showScreen("screen-inversion");
  }
}

export function volverASeccion() {
  const biz = NEGOCIOS.find(n => n.id === state.negocioActual);
  if (biz) renderSeccionCards(biz);
  showScreen("screen-seccion");
}

// OJO: el selector de acá adentro está limitado a #screen-app a propósito.
// Las pantallas de Facturado / Resumen / Fotos guardadas también usan la
// clase .tab (para heredar el mismo estilo de scroll/padding) pero no son
// parte de este tabbar — si se les sacara "active" con un $$(".tab") global,
// quedarían en blanco la primera vez que se toque cualquier pestaña.
export function switchTab(name) {
  $("#screen-app").querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  $$(".tabbtn").forEach(b => b.classList.remove("active"));
  $("#tab-" + name).classList.add("active");
  $(`.tabbtn[data-tab="${name}"]`).classList.add("active");
  $("#fab-add").classList.toggle("hidden", name !== "gastos");
}
