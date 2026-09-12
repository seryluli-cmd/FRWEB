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
  socioColorVar, socioInitial,
  escapeHtml, conTimeout, compressImage, parseFirebaseConfig,
  setSyncOffline
} from "./utils.js";

// Tercer paso: separar cada pantalla en su propio módulo — arrancando por
// las más chicas/autocontenidas (Ideas, Reportes, Inversión) para probar
// el patrón antes de mover pantallas más grandes (Gastos, Facturado).
import { listenIdeas, renderIdeas, toggleVoto, toggleIdeaEstado, deleteIdea, openModalIdea, closeModalIdea, saveIdea } from "./ideas.js";
import { listenReportes, renderReportes, toggleVotoReporte, toggleReporteEstado, deleteReporte, openModalReporte, closeModalReporte, saveReporte } from "./reportes.js";
import { allPagadores, payerColorVar, puedeVerInversion } from "./identidad.js";
import { listenInversion, renderInversion, openModalInversion, closeModalInversion, saveInversion, deleteInversion } from "./inversion.js";
import {
  listenGastos, renderGastos, renderGastosAdmin, fotosDeGasto,
  abrirVisorFotos, visorFotosMover, closeModalVisorFotos, verDetalleGasto, closeModalDetalleGasto,
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

// Segundo paso: el estado compartido entre pantallas (lo que ANTES eran
// variables `let` sueltas acá arriba) ahora vive en un objeto `state` en
// state.js — un módulo no puede reasignar una variable importada de otro
// archivo, así que en vez de `gastos = [...]` es `state.gastos = [...]`
// en todos lados. Los `const` de config fija se importan sueltos.
import {
  state,
  DEFAULT_FIREBASE_CONFIG, LS_CONFIG_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE, LS_USER_KEY, LS_THEME_KEY,
  NEGOCIOS, CATEGORIAS_GASTOS_DEFAULT, MAX_FOTOS_GASTO
} from "./state.js";

// El SDK de Firebase se importa de forma DINÁMICA (recién cuando hace
// falta conectar) para que la app nunca quede colgada en "Cargando…"
// si la red está lenta o falla al abrir la app.
const FB_VERSION = "10.12.2";

async function loadFirebaseSdk() {
  if (state.fbSdk) return state.fbSdk;
  let appMod, authMod, fsMod, stMod;
  try {
    [appMod, authMod, fsMod, stMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-storage.js`)
    ]);
  } catch (e) {
    console.error("Error cargando SDK de Firebase:", e);
    throw new Error("No se pudo conectar a internet para cargar Firebase. Revisá tu conexión e intentá de nuevo.");
  }
  state.fbSdk = {
    initializeApp: appMod.initializeApp,
    getApps: appMod.getApps,
    deleteApp: appMod.deleteApp,
    getAuth: authMod.getAuth,
    signInAnonymously: authMod.signInAnonymously,
    onAuthStateChanged: authMod.onAuthStateChanged,
    getFirestore: fsMod.getFirestore,
    collection: fsMod.collection,
    addDoc: fsMod.addDoc,
    deleteDoc: fsMod.deleteDoc,
    onSnapshot: fsMod.onSnapshot,
    query: fsMod.query,
    orderBy: fsMod.orderBy,
    where: fsMod.where,
    doc: fsMod.doc,
    getDoc: fsMod.getDoc,
    getDocs: fsMod.getDocs,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
    increment: fsMod.increment,
    deleteField: fsMod.deleteField,
    arrayUnion: fsMod.arrayUnion,
    arrayRemove: fsMod.arrayRemove,
    serverTimestamp: fsMod.serverTimestamp,
    enableIndexedDbPersistence: fsMod.enableIndexedDbPersistence,
    getStorage: stMod.getStorage,
    ref: stMod.ref,
    uploadBytes: stMod.uploadBytes,
    getDownloadURL: stMod.getDownloadURL,
    deleteObject: stMod.deleteObject
  };
  return state.fbSdk;
}

// Convierte categorías del formato viejo {nombre, soloAdmin} (privacidad
// por categoría, commit 3273b8c, reemplazado horas después por el checkbox
// "Gasto Admin" por gasto — ver "Rediseñar gastos privados" en README) a
// simples nombres. Documentos de Firestore que quedaron con ese formato
// antes del rediseño llegan acá tal cual; filtra cualquier entrada que no
// se pueda recuperar.
function normalizarCategoriasGastos(raw) {
  return raw
    .map(c => typeof c === "string" ? c : (c && typeof c.nombre === "string" ? c.nombre : null))
    .filter(Boolean);
}

// ---------- Firebase init ----------
async function initFirebase(config) {
  const sdk = await loadFirebaseSdk();

  // Si un intento anterior (en esta misma carga de página) ya inicializó
  // Firebase y falló más adelante (ej. clave inválida), hay que limpiar
  // esa app antes de reintentar, o Firebase tira "app/duplicate-app".
  const existing = sdk.getApps();
  if (existing.length) {
    await Promise.all(existing.map(a => sdk.deleteApp(a).catch(() => {})));
  }

  state.fbApp = sdk.initializeApp(config);
  state.auth = sdk.getAuth(state.fbApp);
  state.db = sdk.getFirestore(state.fbApp);
  state.storage = sdk.getStorage(state.fbApp);
  try {
    await sdk.enableIndexedDbPersistence(state.db);
  } catch (e) {
    // persistence puede fallar en pestañas múltiples o navegadores viejos; no es crítico
    console.warn("Persistencia offline no disponible:", e.message);
  }
  await new Promise((resolve, reject) => {
    sdk.signInAnonymously(state.auth).catch(reject);
    sdk.onAuthStateChanged(state.auth, (user) => {
      if (user) resolve(user);
    });
  });
}

async function connectAndBoot(config, namesFromInput, colabFromInput) {
  await initFirebase(config);
  const sdk = state.fbSdk;

  const socioDocRef = sdk.doc(state.db, "config", "socios");
  const snap = await sdk.getDoc(socioDocRef);

  if (snap.exists() && Array.isArray(snap.data().socios) && snap.data().socios.length > 0) {
    const data = snap.data();
    state.socios = data.socios;
    state.colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
    state.admins = Array.isArray(data.admins) ? data.admins : [];
    state.pins = data.pins && typeof data.pins === "object" ? data.pins : {};
    state.claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
    if (Array.isArray(data.categoriasGastos)) {
      state.categoriasGastos = normalizarCategoriasGastos(data.categoriasGastos);
      if (data.categoriasGastos.some(c => typeof c !== "string")) {
        // Quedó guardado en el formato viejo {nombre, soloAdmin} — se
        // reescribe ya corregido para que no vuelva a pasar.
        await sdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
      }
    } else {
      // Instalación de antes de que existiera este campo — se siembra una
      // sola vez con el default, para que quede persistido en Firestore.
      state.categoriasGastosSembrado = true;
      state.categoriasGastos = CATEGORIAS_GASTOS_DEFAULT;
      await sdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
    }
  } else {
    if (!namesFromInput || namesFromInput.some(n => !n.trim())) {
      throw new Error("Completá tu nombre.");
    }
    state.socios = namesFromInput.map(n => n.trim());
    state.colaboradores = (colabFromInput || []).map(n => n.trim()).filter(Boolean);
    state.admins = [];
    state.pins = {};
    state.claveMaestraAdmin = "llavez";
    state.categoriasGastos = CATEGORIAS_GASTOS_DEFAULT;
    state.categoriasGastosSembrado = true;
    await sdk.setDoc(socioDocRef, { socios: state.socios, colaboradores: state.colaboradores, admins: state.admins, pins: state.pins, claveMaestraAdmin: state.claveMaestraAdmin, categoriasGastos: state.categoriasGastos });
  }

  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(state.socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(state.colaboradores));

  bootApp();
}

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

// ---------- Identidad del celular (¿Quién sos? + PIN) ----------
// Se pregunta una sola vez por celular (como el resto de la config) y se
// recuerda en localStorage hasta que se use "Cambiar de usuario" en Ajustes.
// OJO: esto NO es una capa de seguridad real — cualquier dispositivo con la
// config de Firebase ya puede leer/escribir todo en Firestore. Sirve solo
// para identificar quién usa cada celular y mostrar los botones de admin.
function resumeSession() {
  const savedUser = localStorage.getItem(LS_USER_KEY);
  if (savedUser && allPagadores().includes(savedUser)) {
    setUsuarioActual(savedUser);
    goToNegocioOrHome();
  } else {
    renderQuienSosCards();
    showScreen("screen-quien-sos");
  }
}

// Con un solo negocio no tiene sentido pedir que lo elijas — entra directo.
// Si algún día NEGOCIOS tiene más de uno, vuelve a mostrar el selector solo.
function goToNegocioOrHome() {
  if (NEGOCIOS.length === 1) {
    selectNegocio(NEGOCIOS[0].id);
  } else {
    showScreen("screen-negocio");
  }
}

function setUsuarioActual(nombre) {
  state.usuarioActual = nombre;
  state.esAdmin = state.admins.includes(nombre);
  localStorage.setItem(LS_USER_KEY, nombre);
  registrarLogin(nombre);
  renderAjustesSocios();
  renderGastos();
  renderFacturado();
  renderIdeas();
}

// Historial de logeos: cuenta cuántas veces se identificó cada persona
// (tanto al tipear el PIN de nuevo como cuando el celular ya la recordaba
// — setUsuarioActual() es el único lugar por el que pasa cualquiera de
// las dos formas). Solo Sergio puede VER el resultado (ver
// renderAjustesSocios) pero se cuenta para todos por igual. Un doc por
// persona con un contador atómico, en vez de un doc por logeo, para no
// acumular una colección sin límite ni tener que leer miles de docs para
// mostrar un simple conteo.
async function registrarLogin(nombre) {
  try {
    await state.fbSdk.setDoc(state.fbSdk.doc(state.db, "logins", nombre), { veces: state.fbSdk.increment(1) }, { merge: true });
  } catch (e) {
    console.error("No se pudo registrar el logeo:", e);
  }
}

async function cargarHistorialLogins() {
  const wrap = $("#historial-logins-list");
  const empty = $("#historial-logins-empty");
  wrap.innerHTML = "";
  try {
    const snap = await state.fbSdk.getDocs(state.fbSdk.collection(state.db, "logins"));
    const filas = [];
    snap.forEach(d => filas.push({ nombre: d.id, veces: d.data().veces || 0 }));
    filas.sort((a, b) => b.veces - a.veces);
    empty.classList.toggle("hidden", filas.length > 0);
    filas.forEach(f => {
      const row = document.createElement("div");
      row.className = "ajustes-socio-row";
      row.innerHTML = `<span class="socio-dot" style="background:${payerColorVar(f.nombre)}"></span> ${escapeHtml(f.nombre)}
        <span class="muted small" style="margin-left:auto;">${f.veces} ${f.veces === 1 ? "vez" : "veces"}</span>`;
      wrap.appendChild(row);
    });
  } catch (e) {
    console.error("No se pudo cargar el historial de logeos:", e);
    empty.textContent = "No se pudo cargar. Revisá tu conexión.";
    empty.classList.remove("hidden");
  }
}

function cambiarUsuario() {
  localStorage.removeItem(LS_USER_KEY);
  state.usuarioActual = null;
  state.esAdmin = false;
  renderQuienSosCards();
  showScreen("screen-quien-sos");
}

function renderQuienSosCards() {
  const wrap = $("#quien-sos-cards");
  wrap.innerHTML = "";
  allPagadores().forEach((nombre) => {
    const card = document.createElement("div");
    card.className = "negocio-card";
    card.style.setProperty("--biz-color", payerColorVar(nombre));
    card.innerHTML = `
      <div class="negocio-emoji">${socioInitial(nombre)}</div>
      <div class="negocio-info">
        <div class="negocio-nombre">${escapeHtml(nombre)}</div>
      </div>
    `;
    card.addEventListener("click", () => openPinModal(nombre));
    wrap.appendChild(card);
  });
}

function openPinModal(nombre) {
  state.pinFlowNombre = nombre;
  state.pinFlowMode = state.pins[nombre] ? "verify" : "create";
  $("#pin-input-1").value = "";
  $("#pin-input-2").value = "";
  $("#pin-input-clave-maestra").value = "";
  $("#pin-error").classList.add("hidden");

  // La clave maestra solo se pide la primera vez que un ADMIN crea su PIN
  // en un celular nuevo — no a colaboradores sin admin, y no de nuevo una
  // vez que ya tiene PIN (ahí entra por "verify" con su PIN de siempre).
  // Si no hay clave maestra configurada, no se pide (ver claveMaestraAdmin).
  const requiereClaveMaestra = state.pinFlowMode === "create" && state.admins.includes(nombre) && !!state.claveMaestraAdmin;
  $("#pin-field-clave-maestra").classList.toggle("hidden", !requiereClaveMaestra);

  if (state.pinFlowMode === "create") {
    $("#pin-modal-title").textContent = `Creá tu PIN, ${nombre}`;
    $("#pin-modal-sub").textContent = "Elegí un PIN de 4 números para identificarte la próxima vez en este celular.";
    $("#pin-field-2").classList.remove("hidden");
  } else {
    $("#pin-modal-title").textContent = "Ingresá tu PIN";
    $("#pin-modal-sub").textContent = nombre;
    $("#pin-field-2").classList.add("hidden");
  }

  $("#modal-pin").classList.add("active");
  setTimeout(() => $(requiereClaveMaestra ? "#pin-input-clave-maestra" : "#pin-input-1").focus(), 150);
}

function closePinModal() {
  $("#modal-pin").classList.remove("active");
  state.pinFlowNombre = null;
}

async function confirmPinModal() {
  const errEl = $("#pin-error");
  const pin1 = $("#pin-input-1").value.trim();
  errEl.classList.add("hidden");

  if (!/^\d{4}$/.test(pin1)) {
    errEl.textContent = "El PIN debe tener 4 números.";
    errEl.classList.remove("hidden");
    return;
  }

  if (state.pinFlowMode === "verify") {
    if (state.pins[state.pinFlowNombre] !== pin1) {
      errEl.textContent = "PIN incorrecto.";
      errEl.classList.remove("hidden");
      return;
    }
    // Ojo: closePinModal() pone pinFlowNombre en null, por eso hay que
    // guardarlo en una variable local ANTES de llamarla (mismo motivo por
    // el que el branch "create" ya lo hacía con `const nombre`).
    const nombre = state.pinFlowNombre;
    closePinModal();
    setUsuarioActual(nombre);
    goToNegocioOrHome();
    return;
  }

  // pinFlowMode === "create"
  const requiereClaveMaestra = state.admins.includes(state.pinFlowNombre) && !!state.claveMaestraAdmin;
  if (requiereClaveMaestra && $("#pin-input-clave-maestra").value !== state.claveMaestraAdmin) {
    errEl.textContent = "Clave maestra incorrecta. Pedísela a otro admin.";
    errEl.classList.remove("hidden");
    return;
  }

  const pin2 = $("#pin-input-2").value.trim();
  if (pin1 !== pin2) {
    errEl.textContent = "Los PIN no coinciden.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-pin-confirm");
  btn.disabled = true;
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), {
      [`pins.${state.pinFlowNombre}`]: pin1
    });
    state.pins[state.pinFlowNombre] = pin1;
    const nombre = state.pinFlowNombre;
    closePinModal();
    setUsuarioActual(nombre);
    goToNegocioOrHome();
  } catch (e) {
    console.error(e);
    errEl.textContent = "No se pudo guardar el PIN. Revisá tu conexión.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Selector de negocio ----------
function renderNegocioCards() {
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

function selectNegocio(id) {
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

// ---------- Selector de sección (Gastos / Facturado) ----------
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

function volverASeccion() {
  const biz = NEGOCIOS.find(n => n.id === state.negocioActual);
  if (biz) renderSeccionCards(biz);
  showScreen("screen-seccion");
}

// Gastos del negocio actualmente seleccionado (de la lista completa que
// ya sincronizamos con Firestore).
function listenSocios() {
  const socioDocRef = state.fbSdk.doc(state.db, "config", "socios");
  state.fbSdk.onSnapshot(socioDocRef, (snap) => {
    if (snap.exists() && Array.isArray(snap.data().socios)) {
      const data = snap.data();
      state.socios = data.socios;
      state.colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
      state.admins = Array.isArray(data.admins) ? data.admins : [];
      state.pins = data.pins && typeof data.pins === "object" ? data.pins : {};
      state.claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
      if (Array.isArray(data.categoriasGastos)) {
        state.categoriasGastos = normalizarCategoriasGastos(data.categoriasGastos);
        if (data.categoriasGastos.some(c => typeof c !== "string")) {
          // Quedó guardado en el formato viejo {nombre, soloAdmin} — se
          // reescribe ya corregido para que no vuelva a pasar.
          state.fbSdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
        }
      } else if (!state.categoriasGastosSembrado) {
        // Instalación de antes de que existiera este campo — se siembra una
        // sola vez con el default, para que quede persistido en Firestore.
        state.categoriasGastosSembrado = true;
        state.categoriasGastos = CATEGORIAS_GASTOS_DEFAULT;
        state.fbSdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
      }
      localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(state.socios));
      localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(state.colaboradores));
      state.esAdmin = state.usuarioActual ? state.admins.includes(state.usuarioActual) : false;
      renderPagadorChips();
      renderPagadorChipsFacturado();
      renderAjustesSocios();
      renderBalance();
      renderGastos();
      renderGastosAdmin();
      renderFacturado();
      renderIdeas();
    }
  });
}

function listenConnectivity() {
  const update = () => setSyncOffline(!navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// ---------- Render: Ajustes ----------
function renderAjustesSocios() {
  const wrap = $("#ajustes-socios-list");
  wrap.innerHTML = "";
  state.socios.forEach((nombre, idx) => {
    const row = document.createElement("div");
    row.className = "ajustes-socio-row";
    const badge = state.admins.includes(nombre) ? `<span class="admin-badge">Admin</span>` : "";
    row.innerHTML = `<span class="socio-dot" style="background:${socioColorVar(idx)}"></span> ${escapeHtml(nombre)} ${badge}`;
    wrap.appendChild(row);
  });

  const usuarioEl = $("#ajustes-usuario-actual");
  usuarioEl.innerHTML = state.usuarioActual
    ? `Ingresaste como <b>${escapeHtml(state.usuarioActual)}</b>${state.esAdmin ? ' <span class="admin-badge">Admin</span>' : ""}`
    : "Sin identificar";

  const colabWrap = $("#ajustes-colaboradores-list");
  const colabEmpty = $("#ajustes-colaboradores-empty");
  colabWrap.innerHTML = "";
  if (state.colaboradores.length) {
    colabEmpty.classList.add("hidden");
    state.colaboradores.forEach((nombre) => {
      const row = document.createElement("div");
      row.className = "ajustes-socio-row";
      const esAdminColab = state.admins.includes(nombre);
      const badge = esAdminColab ? `<span class="admin-badge">Admin</span>` : "";
      // Solo el admin puede volver admin (o sacarle el admin) a un
      // colaborador — permite que alguien que no es socio (ej. otro dueño
      // agregado como colaborador para no entrar al reparto) pueda editar
      // y borrar igual que un socio, sin tocar el cálculo de Balance.
      const adminToggleBtn = state.esAdmin
        ? `<button type="button" class="icon-btn admin-toggle-btn" data-nombre="${escapeHtml(nombre)}" aria-label="${esAdminColab ? "Quitar admin" : "Hacer admin"}" title="${esAdminColab ? "Quitar admin" : "Hacer admin"}">${esAdminColab ? "🛡️" : "🔓"}</button>`
        : "";
      const removeBtn = state.esAdmin
        ? `<button type="button" class="icon-btn danger colaborador-remove-btn" data-nombre="${escapeHtml(nombre)}" aria-label="Quitar colaborador">🗑️</button>`
        : "";
      row.innerHTML = `<span class="socio-dot" style="background:${payerColorVar(nombre)}"></span> ${escapeHtml(nombre)} ${badge}<span style="margin-left:auto;display:flex;gap:4px;">${adminToggleBtn}${removeBtn}</span>`;
      colabWrap.appendChild(row);
    });
  } else {
    colabEmpty.classList.remove("hidden");
  }
  $("#admin-add-colaborador-wrap").classList.toggle("hidden", !state.esAdmin);
  $("#ajustes-clave-maestra-card").classList.toggle("hidden", !state.esAdmin);
  renderAjustesCategorias();

  // Historial de logeos: escondido para todos salvo Sergio (ver
  // registrarLogin/cargarHistorialLogins) — acá puede haber más de un
  // admin (un colaborador ascendido, ver adminToggleBtn arriba), por eso se
  // chequea el nombre puntual y no esAdmin.
  const esSergio = state.usuarioActual === "Sergio";
  $("#ajustes-historial-logins-card").classList.toggle("hidden", !esSergio);
  if (esSergio) cargarHistorialLogins();

  $("#ajustes-conn-status").textContent = state.auth && state.auth.currentUser
    ? "✅ Conectado — los gastos se sincronizan entre todos los celulares."
    : "⚠️ No conectado.";

  // Con un solo dueño (socios.length === 1) el "balance entre socios" es
  // siempre trivial (100% para esa única persona) — no aporta nada, se oculta.
  $('.tabbtn[data-tab="balance"]').classList.toggle("hidden", state.socios.length <= 1);
}

// Lista de categorías de gasto en Ajustes — solo la ve/edita el admin
// (crear, borrar). Son simples nombres, sin noción de privacidad acá (ver
// categoriasGastos más arriba) — lo privado ahora es el checkbox "Gasto
// Admin" de cada gasto individual, no la categoría.
function renderAjustesCategorias() {
  $("#ajustes-categorias-card").classList.toggle("hidden", !state.esAdmin);
  if (!state.esAdmin) return;

  const wrap = $("#ajustes-categorias-list");
  wrap.innerHTML = "";
  state.categoriasGastos.forEach((nombre) => {
    const row = document.createElement("div");
    row.className = "ajustes-socio-row";
    row.innerHTML = `
      ${escapeHtml(nombre)}
      <button type="button" class="icon-btn danger categoria-remove-btn" data-nombre="${escapeHtml(nombre)}" aria-label="Borrar categoría" style="margin-left:auto;">🗑️</button>`;
    wrap.appendChild(row);
  });
}

async function agregarCategoriaDesdeAjustes() {
  const input = $("#input-nueva-categoria");
  const nombre = input.value.trim();
  if (!nombre) return;
  if (state.categoriasGastos.includes(nombre)) {
    showToast("Esa categoría ya existe.");
    return;
  }
  const nuevas = state.categoriasGastos.concat([nombre]);
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), { categoriasGastos: nuevas });
    input.value = "";
    showToast("Categoría agregada ✅");
  } catch (e) {
    console.error(e);
    showToast("No se pudo agregar. Revisá tu conexión.");
  }
}

// Borrar una categoría no toca los gastos que ya la tienen cargada (queda
// el nombre guardado tal cual, ver renderCategoriaOptions) — solo deja de
// poder elegirse para gastos nuevos.
async function quitarCategoria(nombre) {
  if (!confirm(`¿Borrar la categoría "${nombre}"? Los gastos que ya la tienen cargada no cambian, solo no se va a poder elegir de nuevo.`)) return;
  const nuevas = state.categoriasGastos.filter(c => c !== nombre);
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), { categoriasGastos: nuevas });
    showToast("Categoría borrada");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

// Alta/baja de colaboradores directo desde Ajustes — a diferencia de los
// socios (que se definen una única vez en el setup), la lista de
// colaboradores puede crecer o achicarse con el tiempo. Solo el admin.
async function agregarColaboradorDesdeAjustes() {
  const input = $("#input-nuevo-colaborador");
  const nombre = input.value.trim();
  if (!nombre) return;
  if (allPagadores().includes(nombre)) {
    showToast("Ese nombre ya existe.");
    return;
  }
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), {
      colaboradores: state.fbSdk.arrayUnion(nombre)
    });
    input.value = "";
    showToast("Colaborador agregado ✅");
  } catch (e) {
    console.error(e);
    showToast("No se pudo agregar. Revisá tu conexión.");
  }
}

async function quitarColaborador(nombre) {
  if (!confirm(`¿Quitar a ${nombre}? Los gastos que ya cargó quedan igual.`)) return;
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), {
      colaboradores: state.fbSdk.arrayRemove(nombre)
    });
    showToast("Colaborador quitado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo quitar. Revisá tu conexión.");
  }
}

// Hacer/sacar admin a un colaborador (no cambia si entra o no al reparto —
// eso depende solo de estar en "socios", no en "admins"). Sirve para dar
// permisos de editar/borrar a alguien sin sumarlo al cálculo de Balance
// (ej. otro dueño que se agrega como colaborador a propósito).
async function toggleAdminColaborador(nombre) {
  const yaEsAdmin = state.admins.includes(nombre);
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), {
      admins: yaEsAdmin ? state.fbSdk.arrayRemove(nombre) : state.fbSdk.arrayUnion(nombre)
    });
    showToast(yaEsAdmin ? `${nombre} ya no es admin` : `${nombre} ahora es admin ✅`);
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Cambiar la clave maestra de administradores (ver claveMaestraAdmin) —
// cualquier admin puede hacerlo desde acá. Solo afecta a quien todavía
// no creó su PIN en algún celular; no toca los PIN ya creados.
async function guardarClaveMaestra() {
  const nueva = $("#input-clave-maestra").value.trim();
  const errEl = $("#clave-maestra-error");
  errEl.classList.add("hidden");

  if (!nueva) {
    errEl.textContent = "Ingresá una clave.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-guardar-clave-maestra");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "config", "socios"), { claveMaestraAdmin: nueva });
    state.claveMaestraAdmin = nueva;
    $("#input-clave-maestra").value = "";
    showToast("Clave maestra actualizada ✅");
  } catch (e) {
    console.error(e);
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// ---------- Tema (Ajustes → Tema) ----------
// El tema "auto"/"light"/"dark" vive en localStorage (ver LS_THEME_KEY) y se
// aplica poniendo/sacando data-theme en <html> — el mismo atributo que ya
// lee styles.css (:root[data-theme="dark"] y el :not([data-theme="light"])
// dentro de la media query). El index.html tiene un script inline que hace
// esto mismo al cargar la página, ANTES que este archivo, para no mostrar
// un parpadeo con el tema del sistema y después el elegido.
function seleccionarTema(tema) {
  localStorage.setItem(LS_THEME_KEY, tema);
  if (tema === "light" || tema === "dark") {
    document.documentElement.setAttribute("data-theme", tema);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  renderAjustesTema();
}

function renderAjustesTema() {
  const tema = localStorage.getItem(LS_THEME_KEY) || "auto";
  $$("#tema-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.tema === tema));
}

// ---------- Tabs ----------
// OJO: el selector de acá adentro está limitado a #screen-app a propósito.
// Las pantallas de Facturado / Resumen / Fotos guardadas también usan la
// clase .tab (para heredar el mismo estilo de scroll/padding) pero no son
// parte de este tabbar — si se les sacara "active" con un $$(".tab") global,
// quedarían en blanco la primera vez que se toque cualquier pestaña.
function switchTab(name) {
  $("#screen-app").querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  $$(".tabbtn").forEach(b => b.classList.remove("active"));
  $("#tab-" + name).classList.add("active");
  $(`.tabbtn[data-tab="${name}"]`).classList.add("active");
  $("#fab-add").classList.toggle("hidden", name !== "gastos");
}

// ---------- Setup screen ----------
function addColaboradorRow(value) {
  const list = $("#colaboradores-list");
  const row = document.createElement("div");
  row.className = "colaborador-row";
  row.innerHTML = `
    <input type="text" class="colaborador-input" placeholder="Ej: Encargada" maxlength="30" value="${escapeHtml(value || "")}">
    <button type="button" class="colaborador-remove" aria-label="Quitar">×</button>
  `;
  row.querySelector(".colaborador-remove").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function getColaboradorInputs() {
  return Array.from($$(".colaborador-input"))
    .map(el => el.value.trim())
    .filter(Boolean);
}

// Guarda config + socios en este navegador y entra a la app.
async function finalizeSetup(config) {
  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(state.socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(state.colaboradores));
  bootApp();
}

// PASO 1: conectar con Firebase y ver si ya hay socios cargados (por otra
// persona, en otro navegador). Si ya existen, entra directo — nadie más
// tiene que volver a escribir los nombres. Si no existen, pasa al paso 2.
async function handleSetupConnect() {
  const raw = $("#firebase-config-input").value;
  const errEl = $("#setup-error");
  const statusEl = $("#setup-status");
  const btn = $("#btn-setup-connect");
  errEl.classList.add("hidden");

  try {
    const config = parseFirebaseConfig(raw);
    btn.disabled = true;
    statusEl.textContent = "Conectando…";
    await initFirebase(config);

    const socioDocRef = state.fbSdk.doc(state.db, "config", "socios");
    const snap = await state.fbSdk.getDoc(socioDocRef);

    if (snap.exists() && Array.isArray(snap.data().socios) && snap.data().socios.length > 0) {
      const data = snap.data();
      state.socios = data.socios;
      state.colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
      state.admins = Array.isArray(data.admins) ? data.admins : [];
      state.pins = data.pins && typeof data.pins === "object" ? data.pins : {};
      state.claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
      statusEl.textContent = "";
      await finalizeSetup(config);
    } else {
      state.pendingFirebaseConfig = config;
      statusEl.textContent = "";
      $("#setup-step-firebase").classList.add("hidden");
      $("#setup-step-socios").classList.remove("hidden");
      setTimeout(() => $("#socio1").focus(), 100);
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = e.message || "Ocurrió un error al conectar.";
    errEl.classList.remove("hidden");
    statusEl.textContent = "";
  } finally {
    btn.disabled = false;
  }
}

// PASO 2: solo se ve la primera vez que alguien conecta este negocio —
// crea los socios en Firebase y entra.
async function handleSetupGuardar() {
  const errEl = $("#setup-socios-error");
  const btn = $("#btn-setup-guardar");
  errEl.classList.add("hidden");

  const ownerName = $("#socio1").value.trim();
  if (!ownerName) {
    errEl.textContent = "Completá tu nombre.";
    errEl.classList.remove("hidden");
    return;
  }
  const colabNames = getColaboradorInputs();

  btn.disabled = true;
  try {
    const socioDocRef = state.fbSdk.doc(state.db, "config", "socios");
    state.socios = [ownerName];
    state.colaboradores = colabNames;
    state.admins = [ownerName]; // único dueño — siempre admin, no hace falta elegir
    state.pins = {};
    // Clave compartida para que los admins creen su PIN la primera vez
    // (ver openPinModal/confirmPinModal) — se puede cambiar después desde
    // Ajustes sin afectar los PIN ya creados. Importa sobre todo si más
    // adelante se suma otro admin además del dueño original.
    state.claveMaestraAdmin = "llavez";
    await state.fbSdk.setDoc(socioDocRef, { socios: state.socios, colaboradores: state.colaboradores, admins: state.admins, pins: state.pins, claveMaestraAdmin: state.claveMaestraAdmin });
    await finalizeSetup(state.pendingFirebaseConfig);
  } catch (e) {
    console.error(e);
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
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
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.warn);
  });
}

// ---------- Reset ----------
function resetLocalConfig() {
  if (!confirm("¿Desconectar este celular? No se borran los gastos.")) return;
  localStorage.removeItem(LS_CONFIG_KEY);
  localStorage.removeItem(LS_SOCIOS_CACHE);
  localStorage.removeItem(LS_COLAB_CACHE);
  location.reload();
}

// ---------- Listeners de UI ----------
function wireEvents() {
  $("#btn-setup-connect").addEventListener("click", handleSetupConnect);
  $("#btn-setup-guardar").addEventListener("click", handleSetupGuardar);
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
    await connectAndBoot(config, state.socios, state.colaboradores);
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
