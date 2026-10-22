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
import { abrirComparar } from "./comparar.js";
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

  // Pantalla "Estadísticas" — badge del topbar
  $("#comparar-icon-badge").textContent = biz.emoji;
  $("#comparar-icon-badge").style.background = biz.color;

  // Pantalla "Resumen mensual" — badge del topbar
  $("#resumen-titulo").textContent = biz.nombre + " — Resumen";
  $("#resumen-icon-badge").textContent = biz.emoji;
  $("#resumen-icon-badge").style.background = biz.color;

  // Ajustes → tarjeta "Exportar datos"
  $("#export-negocio-nombre").textContent = biz.nombre;

  renderSeccionCards(biz);
  showScreen("screen-seccion");
}

// Íconos de línea (24×24) de cada sección. Van como SVG propio y no como
// emoji porque cada Android dibuja los emojis distinto.
const ICONOS_SECCION = {
  inversion: '<path d="M3 9.5L12 4l9 5.5H3z"/><path d="M6 12.5v5M10 12.5v5M14 12.5v5M18 12.5v5"/><path d="M3.5 20h17"/>',
  gastos: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9.5 8h5M9.5 11.5h5"/>',
  facturado: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 12h.01M17.5 12h.01"/>',
  resumen: '<rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="16" y="9" width="4" height="11" rx="1"/>',
  comparar: '<path d="M2.5 13l3 3 4-10H21"/><path d="M12.5 11l5 6M17.5 11l-5 6"/>',
  gastosadmin: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2"/>',
  ideas: '<path d="M9.5 18.5h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v.5h5v-.5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  mantenimiento: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
};

// Mini podio de la tecla Estadísticas (ver .tecla-podio en styles.css).
const PODIO_MINI = '<span class="tecla-podio" aria-hidden="true"><span></span><span></span><span></span></span>';

// El título "GESTION FR" y la frase quedaron fijos en el HTML (sin depender de
// biz.nombre/biz.emoji como el resto de las pantallas).
//
// Cada sección es una "tecla" (ver "Elegir sección" en styles.css). El orden
// es el de uso: las dos de todos los días (Gastos y Cierre de Turno) son
// teclas grandes, una al lado de la otra, y el resto son largas. La tecla
// "viva" (color de marca) es la de Cierre de Turno, la que el sistema reclama
// en cada turno.
function renderSeccionCards(biz) {

  const SECCIONES = [
    { id: "gastos", nombre: "Gastos", sub: "Cargar gastos y ver el balance", grande: true },
    { id: "facturado", nombre: "Cierre de Turno", sub: "Anotar efectivo y Digital", grande: true, viva: true },
    { id: "comparar", nombre: "Estadísticas", sub: "Meses, tramos y empleados", soloAdmin: true, podio: true },
    { id: "inversion", nombre: "Inversión Recuperada", sub: "Seguimiento del monto recuperado por Sergio", soloInversion: true },
    { id: "resumen", nombre: "Resumen mensual", sub: "Ver los totales de cada mes", soloAdmin: true },
    { id: "gastosadmin", nombre: "Gastos S/Admin", sub: "Alquiler y otros gastos privados", soloAdmin: true },
    { id: "ideas", nombre: "Caja de IDEAS", sub: "Aportar ideas para mejorar el negocio y el entorno laboral" },
    { id: "mantenimiento", nombre: "Reportes de Mantenimiento", sub: "Reportar roturas o cosas para arreglar" }
  ];

  const wrap = $("#seccion-cards");
  wrap.innerHTML = "";
  SECCIONES.filter(s => (!s.soloAdmin || state.esAdmin) && (!s.soloInversion || puedeVerInversion())).forEach(s => {
    const tecla = document.createElement("button");
    tecla.type = "button";
    tecla.className = "tecla " + (s.grande ? "tecla-grande" : "tecla-larga") + (s.viva ? " tecla-viva" : "");
    tecla.style.setProperty("--biz-color", biz.color);
    tecla.innerHTML = `
      <span class="tecla-icono"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS_SECCION[s.id]}</svg></span>
      <span class="tecla-texto">
        <span class="tecla-nombre">${s.nombre}</span>
        <span class="tecla-sub">${s.sub}</span>
      </span>
      ${s.podio ? PODIO_MINI : ""}
    `;
    tecla.addEventListener("click", () => selectSeccion(s.id));
    wrap.appendChild(tecla);
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
    state.resumenCategoriasAbiertas.clear(); // cada visita arranca con todas las categorías cerradas
    renderResumen();
    showScreen("screen-resumen");
  } else if (id === "comparar") {
    if (!state.esAdmin) return;
    showScreen("screen-comparar");
    abrirComparar();
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
