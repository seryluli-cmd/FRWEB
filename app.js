// ============================================================
// Gastos del Negocio — lógica de la app (PWA + Firebase)
// ============================================================

// Primer paso de la separación en módulos: las funciones puras/DOM sin
// estado compartido viven en utils.js (ver ese archivo) — acá se importan
// de vuelta para no cambiar ninguna otra línea del código todavía.
import {
  $, $$, showToast, showScreen,
  money, parseMoneyInput, formatMoneyValue, wireMoneyInput,
  MESES, mesLabel, fechaDeRegistro, fechaLocalISO, fechaLimiteHistorial,
  fechaParaTurno,
  escapeHtml, conTimeout, compressImage,
  setSyncOffline
} from "./utils.js";

// Tercer paso: separar cada pantalla en su propio módulo — arrancando por
// las más chicas/autocontenidas (Ideas, Reportes, Inversión) para probar
// el patrón antes de mover pantallas más grandes (Gastos, Facturado).
import { listenIdeas, renderIdeas, toggleVoto, toggleIdeaEstado, deleteIdea, openModalIdea, closeModalIdea, saveIdea } from "./ideas.js";
import { listenReportes, renderReportes, toggleVotoReporte, toggleReporteEstado, deleteReporte, openModalReporte, closeModalReporte, saveReporte } from "./reportes.js";
import { listenInversion, renderInversion, openModalInversion, closeModalInversion, saveInversion, deleteInversion } from "./inversion.js";
import {
  listenGastos, renderGastos, renderGastosAdmin, fotosDeGasto,
  abrirVisorFotos, visorFotosMover, closeModalVisorFotos, wireVisorFotosZoom, verDetalleGasto, closeModalDetalleGasto,
  renderFotosGuardadas, renderPagadorChips, exportGastosCSV, setDefaultFecha,
  resetFotoField, renderFotoStrip, selectFormaPago, registrarEdicionMixto, calcularCampoMixtoFaltante,
  openModal, closeModal, saveGasto, deleteGasto, marcarAbonado
} from "./gastos.js";
import {
  listenFacturacion, renderFacturado, renderPagadorChipsFacturado,
  exportFacturacionCSV, resetFotoFieldFact, actualizarChipsTurnoPorFecha, registrarEdicionManualFacturado,
  openModalFacturado, closeModalFacturado, saveCierre, deleteCierre
} from "./facturado.js";
import { renderResumen, renderBalance } from "./resumen.js";
import {
  cargarHistorialLogins, renderAjustesSocios, agregarCategoriaDesdeAjustes, quitarCategoria,
  agregarColaboradorDesdeAjustes, quitarColaborador, toggleAdminColaborador, guardarClaveMaestra,
  seleccionarTema, renderAjustesTema, resetLocalConfig
} from "./ajustes.js";
import { connectAndBoot } from "./firebase.js";
import { renderNegocioCards, switchTab, volverASeccion } from "./navegacion.js";
import { resumeSession, cambiarUsuario, closePinModal, confirmPinModal, listenSocios, listenConnectivity } from "./sesion.js";
import { addColaboradorRow, handleSetupConnect, handleSetupGuardar } from "./setup.js";

// Segundo paso: el estado compartido entre pantallas (lo que ANTES eran
// variables `let` sueltas acá arriba) ahora vive en un objeto `state` en
// state.js — un módulo no puede reasignar una variable importada de otro
// archivo, así que en vez de `gastos = [...]` es `state.gastos = [...]`
// en todos lados. Los `const` de config fija se importan sueltos.
import {
  state,
  DEFAULT_FIREBASE_CONFIG, LS_CONFIG_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE,
  NEGOCIOS, MAX_FOTOS_GASTO
} from "./state.js";

// ---------- Boot principal (ya configurado) ----------
function bootApp() {
  // Con un solo negocio, "Cambiar negocio" no tiene a qué cambiar.
  if (NEGOCIOS.length === 1) {
    $("#btn-back-to-negocio").classList.add("hidden");
  }
  renderPagadorChips();
  renderPagadorChipsFacturado();
  renderAjustesSocios();
  renderNegocioCards();
  listenGastos(() => {
    renderBalance();
    if (state.negocioActual) renderResumen();
  });
  listenFacturacion(() => {
    if (state.negocioActual) renderResumen();
  });
  listenIdeas();
  listenReportes();
  listenInversion();
  listenSocios();
  listenConnectivity();
  setDefaultFecha();
  resumeSession();
}

// ---------- Instalación PWA ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  $("#btn-install").classList.remove("hidden");
});
$("#btn-install")?.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  $("#btn-install").classList.add("hidden");
});

// ---------- Service worker ----------
// Una PWA instalada casi nunca se cierra de verdad: se suspende y se
// retoma, así que puede quedarse semanas corriendo código viejo aunque el
// servidor ya tenga el nuevo, y no hay forma de pedirle a cada persona que
// la cierre a mano cada vez que se sube un cambio.
//
// Por eso acá se actualiza sola: se pregunta si hay versión nueva al abrir
// y cada vez que se vuelve a la app, y cuando el service worker nuevo toma
// el control se recarga la pantalla una sola vez. (Mismo bloque que ya
// tiene GESTIONEGOCIOS — ver ese repo si hace falta el detalle completo.)
if ("serviceWorker" in navigator) {
  // Un cambio de controlador significa "salió una versión nueva"... salvo
  // el primero de todos, que es la instalación inicial (ahí no hay nada
  // viejo que reemplazar, y recargar haría que la app se reinicie sola la
  // primera vez que alguien la abre).
  //
  // OJO: esto tiene que ser una variable que se ACTUALIZA, no una foto del
  // momento de cargar. En la primera visita todavía no hay controlador, así
  // que si se dejara fija en `false` nunca se recargaría por más versiones
  // que se publiquen.
  let controlada = !!navigator.serviceWorker.controller;
  let recargaPendiente = false;
  let recargando = false;

  // No cortar a alguien que está a medio cargar un gasto: si hay un modal
  // abierto se espera, y se reintenta cuando vuelve a la app. En el peor
  // caso la actualización entra la próxima vez que la abra.
  function recargarSiNoMolesta() {
    if (!recargaPendiente || recargando) return;
    if (document.querySelector(".modal-overlay.active")) return;
    recargando = true;
    location.reload();
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlada) {
      controlada = true;  // era la instalación inicial; de acá en más, sí
      return;
    }
    recargaPendiente = true;
    recargarSiNoMolesta();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((reg) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        reg.update();            // ¿hay versión nueva publicada?
        recargarSiNoMolesta();   // ¿quedó una pendiente de antes?
      });
    }).catch(console.warn);
  });
}

// ---------- Listeners de UI ----------
function wireEvents() {
  $("#btn-setup-connect").addEventListener("click", () => handleSetupConnect(bootApp));
  $("#btn-setup-guardar").addEventListener("click", () => handleSetupGuardar(bootApp));
  $("#btn-add-colaborador").addEventListener("click", () => addColaboradorRow());
  addColaboradorRow(); // arranca con una fila vacía disponible
  $("#fab-add").addEventListener("click", () => openModal());
  $("#btn-cancel-add").addEventListener("click", closeModal);
  $("#btn-cambiar-usuario").addEventListener("click", cambiarUsuario);
  $$("#tema-options .pagador-chip").forEach(chip => {
    chip.addEventListener("click", () => seleccionarTema(chip.dataset.tema));
  });
  renderAjustesTema();
  $("#btn-ajustes-shortcut").addEventListener("click", () => {
    switchTab("ajustes");
    showScreen("screen-app");
  });
  $("#btn-agregar-colaborador-ajustes").addEventListener("click", agregarColaboradorDesdeAjustes);
  $("#ajustes-colaboradores-list").addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".colaborador-remove-btn");
    if (removeBtn) { quitarColaborador(removeBtn.dataset.nombre); return; }
    const adminBtn = e.target.closest(".admin-toggle-btn");
    if (adminBtn) toggleAdminColaborador(adminBtn.dataset.nombre);
  });
  $("#btn-agregar-categoria").addEventListener("click", agregarCategoriaDesdeAjustes);
  $("#ajustes-categorias-list").addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".categoria-remove-btn");
    if (removeBtn) quitarCategoria(removeBtn.dataset.nombre);
  });
  $("#btn-guardar-clave-maestra").addEventListener("click", guardarClaveMaestra);
  $("#btn-pin-cancel").addEventListener("click", closePinModal);
  $("#btn-pin-confirm").addEventListener("click", confirmPinModal);
  $("#modal-pin").addEventListener("click", (e) => {
    if (e.target.id === "modal-pin") closePinModal();
  });
  $("#pin-input-1").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (state.pinFlowMode === "create") $("#pin-input-2").focus();
    else confirmPinModal();
  });
  $("#pin-input-2").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmPinModal();
  });
  $("#btn-save-add").addEventListener("click", saveGasto);
  $("#modal-add").addEventListener("click", (e) => {
    if (e.target.id === "modal-add") closeModal();
  });
  $$("#forma-pago-options .pagador-chip").forEach(chip => {
    chip.addEventListener("click", () => selectFormaPago(chip.dataset.forma));
  });
  // Punto de miles mientras se tipea en los 6 campos de plata de la app
  // (ver formatMoneyInputMientrasTipea) — Gastos (Importe, Mixto) y Cierre
  // de Turno (Total, Efectivo, Digital).
  ["#input-importe", "#input-mixto-efectivo", "#input-mixto-digital",
   "#input-importe-fact", "#input-efectivo-fact", "#input-digital-fact",
   "#input-monto-inversion"].forEach(wireMoneyInput);
  // "change" (al salir del campo), no "input" (cada tecla) — si no, un
  // solo dígito ya dispara el cálculo con el valor a medio tipear (ver
  // calcularCampoMixtoFaltante).
  $("#input-mixto-efectivo").addEventListener("change", () => registrarEdicionMixto("efectivo"));
  $("#input-mixto-digital").addEventListener("change", () => registrarEdicionMixto("digital"));
  $("#input-importe").addEventListener("change", calcularCampoMixtoFaltante);
  $("#btn-gastos-mes-anterior").addEventListener("click", () => {
    state.gastosMesOffset--;
    renderGastos();
  });
  $("#btn-gastos-mes-siguiente").addEventListener("click", () => {
    if (state.gastosMesOffset >= 0) return;
    state.gastosMesOffset++;
    renderGastos();
  });
  $("#btn-facturado-mes-anterior").addEventListener("click", () => {
    state.facturadoMesOffset--;
    renderFacturado();
  });
  $("#btn-facturado-mes-siguiente").addEventListener("click", () => {
    if (state.facturadoMesOffset >= 0) return;
    state.facturadoMesOffset++;
    renderFacturado();
  });
  $("#btn-export-gastos").addEventListener("click", exportGastosCSV);
  $("#btn-export-facturacion").addEventListener("click", exportFacturacionCSV);
  $("#btn-refrescar-historial-logins").addEventListener("click", cargarHistorialLogins);
  $("#btn-reset").addEventListener("click", resetLocalConfig);
  $("#btn-switch-negocio").addEventListener("click", volverASeccion);
  $("#btn-back-to-seccion-fact").addEventListener("click", volverASeccion);
  $("#btn-back-to-negocio").addEventListener("click", () => showScreen("screen-negocio"));
  $("#btn-back-to-seccion-resumen").addEventListener("click", volverASeccion);
  $("#btn-mes-anterior").addEventListener("click", () => {
    state.resumenMesOffset--;
    renderResumen();
  });
  $("#btn-mes-siguiente").addEventListener("click", () => {
    if (state.resumenMesOffset >= 0) return;
    state.resumenMesOffset++;
    renderResumen();
  });
  $("#btn-back-to-seccion-gastosadmin").addEventListener("click", volverASeccion);
  $("#btn-gastos-admin-mes-anterior").addEventListener("click", () => {
    state.gastosAdminMesOffset--;
    renderGastosAdmin();
  });
  $("#btn-gastos-admin-mes-siguiente").addEventListener("click", () => {
    if (state.gastosAdminMesOffset >= 0) return;
    state.gastosAdminMesOffset++;
    renderGastosAdmin();
  });
  $("#fab-add-gastos-admin").addEventListener("click", () => openModal(null, { soloAdmin: true }));
  $("#fab-add-facturado").addEventListener("click", () => openModalFacturado());
  $("#turno-options").addEventListener("click", (e) => {
    const chip = e.target.closest(".pagador-chip");
    if (!chip) return;
    state.selectedTurno = chip.dataset.turno;
    $$("#turno-options .pagador-chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    // Solo en un cierre NUEVO (no al editar uno existente): si se cambia
    // a mano el turno, la fecha propuesta se reajusta sola (ver
    // fechaParaTurno) — elegir "Noche" antes de las 22hs de hoy se
    // refiere a la noche de AYER, no a una de esta noche que ni empezó.
    if (!state.editingCierreId) {
      $("#input-fecha-fact").value = fechaLocalISO(fechaParaTurno(state.selectedTurno));
    }
  });
  $("#input-fecha-fact").addEventListener("change", actualizarChipsTurnoPorFecha);
  $("#btn-cancel-add-facturado").addEventListener("click", closeModalFacturado);
  $("#btn-save-facturado").addEventListener("click", saveCierre);
  $("#modal-add-facturado").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-facturado") closeModalFacturado();
  });
  // "change" (al salir del campo), no "input" (cada tecla) — si no,
  // apenas se tipea el primer dígito de un campo ya calcula el tercero
  // con ese valor a medio terminar (ej. tipear "50000" en Efectivo
  // calculaba Digital ni bien se apretaba el "5").
  $("#input-importe-fact").addEventListener("change", () => registrarEdicionManualFacturado("total"));
  $("#input-efectivo-fact").addEventListener("change", () => registrarEdicionManualFacturado("efectivo"));
  $("#input-digital-fact").addEventListener("change", () => registrarEdicionManualFacturado("digital"));

  $("#btn-ideas-main").addEventListener("click", () => {
    state.seccionActual = "ideas";
    renderIdeas();
    showScreen("screen-ideas");
  });
  $("#btn-back-from-ideas").addEventListener("click", () => {
    if (state.seccionActual === "ideas") volverASeccion();
    else showScreen("screen-negocio");
  });
  $("#fab-add-idea").addEventListener("click", () => openModalIdea());
  $("#btn-cancel-add-idea").addEventListener("click", closeModalIdea);
  $("#btn-save-idea").addEventListener("click", saveIdea);
  $("#modal-add-idea").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-idea") closeModalIdea();
  });
  // Toggle pendiente/concretada tocando la tarjeta; borrar solo con el 🗑️ (admin)
  const handleIdeaListClick = (e) => {
    const delBtn = e.target.closest(".idea-delete-btn");
    if (delBtn) { deleteIdea(delBtn.dataset.id); return; }
    const voteBtn = e.target.closest(".idea-vote-btn");
    if (voteBtn) { toggleVoto(voteBtn.dataset.id); return; }
    const card = e.target.closest(".idea-card");
    if (card) toggleIdeaEstado(card.dataset.id);
  };
  $("#ideas-pendientes-list").addEventListener("click", handleIdeaListClick);
  $("#ideas-concretadas-list").addEventListener("click", handleIdeaListClick);

  // Reportes de Mantenimiento — mismo wiring que Ideas, ver handleIdeaListClick.
  $("#btn-back-from-reportes").addEventListener("click", () => {
    if (state.seccionActual === "mantenimiento") volverASeccion();
    else showScreen("screen-negocio");
  });
  $("#fab-add-reporte").addEventListener("click", () => openModalReporte());
  $("#btn-cancel-add-reporte").addEventListener("click", closeModalReporte);
  $("#btn-save-reporte").addEventListener("click", saveReporte);
  $("#modal-add-reporte").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-reporte") closeModalReporte();
  });
  const handleReporteListClick = (e) => {
    const delBtn = e.target.closest(".reporte-delete-btn");
    if (delBtn) { deleteReporte(delBtn.dataset.id); return; }
    const voteBtn = e.target.closest(".idea-vote-btn");
    if (voteBtn) { toggleVotoReporte(voteBtn.dataset.id); return; }
    const card = e.target.closest(".idea-card");
    if (card) toggleReporteEstado(card.dataset.id);
  };
  $("#reportes-pendientes-list").addEventListener("click", handleReporteListClick);

  // Inversión Recuperada — mismo wiring que Ideas/Reportes, pero sin votos
  // ni toggle de estado: es solo un historial con alta y borrado.
  $("#btn-back-to-seccion-inversion").addEventListener("click", volverASeccion);
  $("#fab-add-inversion").addEventListener("click", openModalInversion);
  $("#btn-cancel-add-inversion").addEventListener("click", closeModalInversion);
  $("#btn-save-inversion").addEventListener("click", saveInversion);
  $("#modal-add-inversion").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-inversion") closeModalInversion();
  });
  $("#inversion-list").addEventListener("click", (e) => {
    const delBtn = e.target.closest(".inversion-delete-btn");
    if (delBtn) deleteInversion(delBtn.dataset.id);
  });
  $("#reportes-resueltos-list").addEventListener("click", handleReporteListClick);

  $$(".tabbtn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // Foto de factura (modal Nuevo gasto): "Tomar foto" fuerza la cámara
  // trasera con el atributo capture; "Elegir de galería" lo saca para que
  // el navegador ofrezca el selector de archivos/fotos normal. Ambos
  // botones disparan el mismo <input type="file">.
  $("#btn-tomar-foto").addEventListener("click", () => {
    $("#input-foto").setAttribute("capture", "environment");
    $("#input-foto").click();
  });
  $("#btn-elegir-foto").addEventListener("click", () => {
    $("#input-foto").removeAttribute("capture");
    $("#input-foto").click();
  });
  $("#input-foto").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite elegir el mismo archivo de nuevo más adelante si hace falta
    if (!files.length) return;
    const espacio = MAX_FOTOS_GASTO - state.fotosGastoModal.length;
    const aProcesar = files.slice(0, Math.max(0, espacio));
    if (files.length > aProcesar.length) {
      showToast(`Máximo ${MAX_FOTOS_GASTO} fotos por gasto.`);
    }
    for (const file of aProcesar) {
      try {
        const blob = await compressImage(file);
        state.fotosGastoModal.push({ tipo: "nueva", blob, previewUrl: URL.createObjectURL(blob) });
      } catch (err) {
        console.error(err);
        showToast("No se pudo procesar una de las fotos.");
      }
    }
    renderFotoStrip();
  });
  // Quitar una foto de la tira (delegado — la tira se re-dibuja seguido).
  // Si era "existente" (ya guardada), se marca para borrar del Storage
  // recién al confirmar "Guardar" (ver saveGasto) — cancelar el modal no
  // borra nada.
  $("#foto-strip").addEventListener("click", (e) => {
    const btn = e.target.closest(".foto-remove-btn");
    if (!btn) return;
    const [removida] = state.fotosGastoModal.splice(Number(btn.dataset.idx), 1);
    if (removida.tipo === "existente" && removida.path) state.fotosGastoABorrar.push(removida.path);
    if (removida.tipo === "nueva") URL.revokeObjectURL(removida.previewUrl);
    renderFotoStrip();
  });

  // Foto del cierre (modal Cierre de Turno) — mismo patrón que la de
  // Nuevo gasto, arriba, pero con sus propios elementos e input.
  $("#btn-tomar-foto-fact").addEventListener("click", () => {
    $("#input-foto-fact").setAttribute("capture", "environment");
    $("#input-foto-fact").click();
  });
  $("#btn-elegir-foto-fact").addEventListener("click", () => {
    $("#input-foto-fact").removeAttribute("capture");
    $("#input-foto-fact").click();
  });
  $("#input-foto-fact").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state.selectedFotoFacturadoBlob = await compressImage(file);
      $("#foto-preview-img-fact").src = URL.createObjectURL(state.selectedFotoFacturadoBlob);
      $("#foto-preview-wrap-fact").classList.remove("hidden");
      $("#foto-btns-row-fact").classList.add("hidden");
    } catch (err) {
      console.error(err);
      showToast("No se pudo procesar la foto.");
    }
  });
  $("#btn-quitar-foto-fact").addEventListener("click", resetFotoFieldFact);

  // Foto, editar y borrar de un gasto ya cargado (delegado, la lista se
  // re-dibuja seguido) — mismo handler para la lista de Gastos común y la
  // de Gastos S/Admin (ver renderGastosAdmin), son la misma colección.
  function onGastoListClick(e) {
    const fotoBtn = e.target.closest(".foto-link");
    if (fotoBtn) {
      const g = state.gastos.find(x => x.id === fotoBtn.dataset.id);
      if (g) abrirVisorFotos(fotosDeGasto(g));
      return;
    }
    const editBtn = e.target.closest(".gasto-edit-btn");
    if (editBtn) {
      const g = state.gastos.find(x => x.id === editBtn.dataset.id);
      if (g) openModal(g);
      return;
    }
    const delBtn = e.target.closest(".gasto-delete-btn");
    if (delBtn) { deleteGasto(delBtn.dataset.id); return; }
    const abonarBtn = e.target.closest(".meta-falta-abonar");
    if (abonarBtn) { marcarAbonado(abonarBtn.dataset.id); return; }
    const verDetalleBtn = e.target.closest(".ver-detalle-btn");
    if (verDetalleBtn) verDetalleGasto(verDetalleBtn.dataset.id);
  }
  $("#expenses-list").addEventListener("click", onGastoListClick);
  $("#expenses-admin-list").addEventListener("click", onGastoListClick);
  $("#btn-cerrar-detalle-gasto").addEventListener("click", closeModalDetalleGasto);
  $("#modal-detalle-gasto").addEventListener("click", (e) => {
    if (e.target.id === "modal-detalle-gasto") closeModalDetalleGasto();
  });
  $("#btn-cerrar-visor-fotos").addEventListener("click", closeModalVisorFotos);
  $("#btn-visor-anterior").addEventListener("click", () => visorFotosMover(-1));
  $("#btn-visor-siguiente").addEventListener("click", () => visorFotosMover(1));
  $("#modal-visor-fotos").addEventListener("click", (e) => {
    if (e.target.id === "modal-visor-fotos") closeModalVisorFotos();
  });
  wireVisorFotosZoom();

  // Editar y borrar de un cierre ya cargado (delegado, admin)
  $("#facturado-list").addEventListener("click", (e) => {
    const fotoBtn = e.target.closest(".foto-link");
    if (fotoBtn) { window.open(fotoBtn.dataset.url, "_blank", "noopener"); return; }
    const editBtn = e.target.closest(".cierre-edit-btn");
    if (editBtn) {
      const c = state.facturaciones.find(x => x.id === editBtn.dataset.id);
      if (c) openModalFacturado(c);
      return;
    }
    const delBtn = e.target.closest(".cierre-delete-btn");
    if (delBtn) { deleteCierre(delBtn.dataset.id); return; }
    const cargarBtn = e.target.closest(".btn-cargar-faltante");
    if (cargarBtn) openModalFacturado(null, { fecha: cargarBtn.dataset.fecha, turno: cargarBtn.dataset.turno });
  });

  // Pantalla "Fotos guardadas" — cada miniatura es una foto puntual de un
  // gasto; tocarla abre el visor en esa foto, con las demás del mismo
  // gasto al lado si tenía varias.
  $("#fotos-grupos").addEventListener("click", (e) => {
    const thumb = e.target.closest(".foto-thumb-link");
    if (!thumb) return;
    const g = state.gastos.find(x => x.id === thumb.dataset.id);
    if (g) abrirVisorFotos(fotosDeGasto(g), Number(thumb.dataset.idx));
  });
  $("#btn-ver-fotos").addEventListener("click", () => {
    renderFotosGuardadas();
    showScreen("screen-fotos");
  });
  $("#btn-back-to-ajustes").addEventListener("click", () => {
    switchTab("ajustes");
    showScreen("screen-app");
  });
}

// ---------- Arranque ----------
// Se llama SIEMPRE al abrir la app (ver start()). Es uno de 3 caminos de
// arranque posibles junto con handleSetupConnect/handleSetupGuardar (ver
// README, sección "Flujo de arranque") — este es el único que no requiere
// tipear nada: usa la config y el caché de socios ya guardados de una vez
// anterior.
async function attemptReconnect() {
  const savedConfig = localStorage.getItem(LS_CONFIG_KEY);
  const cachedSocios = localStorage.getItem(LS_SOCIOS_CACHE);
  const cachedColab = localStorage.getItem(LS_COLAB_CACHE);

  if (!savedConfig && !DEFAULT_FIREBASE_CONFIG.apiKey) {
    showScreen("screen-setup");
    return;
  }

  if (cachedSocios) {
    try { state.socios = JSON.parse(cachedSocios); } catch (_) {}
  }
  if (cachedColab) {
    try { state.colaboradores = JSON.parse(cachedColab); } catch (_) {}
  }

  $("#loading-msg").textContent = "Cargando…";
  $("#btn-retry-boot").classList.add("hidden");
  $("#btn-reconfigure-boot").classList.add("hidden");
  showScreen("screen-loading");

  try {
    const config = savedConfig ? JSON.parse(savedConfig) : DEFAULT_FIREBASE_CONFIG;
    await connectAndBoot(config, state.socios, state.colaboradores, bootApp);
    if (!savedConfig) localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Error reconectando:", e);
    $("#loading-msg").textContent = e.message && e.message.includes("conectar")
      ? e.message
      : "No se pudo conectar. Revisá tu internet.";
    $("#btn-retry-boot").classList.remove("hidden");
    $("#btn-reconfigure-boot").classList.remove("hidden");
  }
}

async function start() {
  wireEvents();
  $("#btn-retry-boot").addEventListener("click", attemptReconnect);
  $("#btn-reconfigure-boot").addEventListener("click", () => {
    showScreen("screen-setup");
  });
  await attemptReconnect();
}

start();
