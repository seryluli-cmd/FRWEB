// ============================================================
// Gastos del Negocio — lógica de la app (PWA + Firebase)
// ============================================================

// El SDK de Firebase se importa de forma DINÁMICA (recién cuando hace
// falta conectar) para que la app nunca quede colgada en "Cargando…"
// si la red está lenta o falla al abrir la app.
const FB_VERSION = "10.12.2";
let fbSdk = null; // { initializeApp, getAuth, signInAnonymously, onAuthStateChanged, getFirestore, ... }

async function loadFirebaseSdk() {
  if (fbSdk) return fbSdk;
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
  fbSdk = {
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
    doc: fsMod.doc,
    getDoc: fsMod.getDoc,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
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
  return fbSdk;
}

// ---------- Estado ----------
const LS_CONFIG_KEY = "gn_firebaseConfig";
const LS_SOCIOS_CACHE = "gn_socios_cache";
const LS_COLAB_CACHE = "gn_colaboradores_cache";
const LS_USER_KEY = "gn_current_user"; // quién está identificado en este celular
const SERIES_VARS = ["--series-1", "--series-2", "--series-3"];
const NEUTRAL_VAR = "var(--text-muted)";

// Un solo negocio acá. Si algún día se suma un segundo negocio, alcanza con
// agregar otro objeto acá — el resto del código ya soporta N negocios; lo
// único que cambia es que goToNegocioOrHome() deja de saltear la pantalla
// de elegir negocio en cuanto el array tiene más de un elemento.
const NEGOCIOS = [
  { id: "gestionfr", nombre: "Gestion FR", emoji: "⌨️", color: "var(--series-1)" }
];

let fbApp = null, auth = null, db = null, storage = null;
let selectedFotoBlob = null; // foto comprimida, lista para subir (modal Nuevo gasto)
const FOTO_RETENCION_DIAS = 120; // ~4 meses — pasado esto, se borra sola la foto (no el gasto)
let fotosLimpiezaHecha = false;
let socios = [];           // ["Sergio"] — el/los dueño(s), entran en el reparto (acá siempre 1)
let colaboradores = [];    // ["Encargada"] — pueden pagar/cargar, NO entran en el reparto
let admins = [];           // subconjunto de nombres (normalmente socios) con permiso para editar/borrar
let pins = {};             // { "Sergio": "1234", ... } — PIN fijo de 4 dígitos por persona (ver README: no es seguridad real, solo identificación)
let claveMaestraAdmin = ""; // clave compartida entre los admins, solo para CREAR su PIN la primera vez
                             // en un celular nuevo (ver openPinModal/confirmPinModal) — evita que cualquiera
                             // tocando el nombre de un admin por primera vez se autoasigne ese PIN sin saberla.
                             // Si no está configurada (vacía), no se pide — no es seguridad real, ver README.
let gastos = [];           // TODOS los gastos — [{id, importe, descripcion, categoria, pagadoPor, fecha, negocio}]
let facturaciones = [];    // TODOS los cierres diarios — [{id, importe, registradoPor, fecha, negocio}]
let ideas = [];            // Ideas de mejora — [{id, texto, estado, propuestoPor, creadoEn}]
let reportes = [];         // Reportes de mantenimiento — [{id, texto, estado, propuestoPor, votos, creadoEn}]
let negocioActual = null;  // "gestionfr" (siempre — acá hay un solo negocio)
let seccionActual = null;  // "gastos" | "facturado" | "resumen"
let selectedPagador = null;
let selectedRegistrador = null;
let selectedTurno = null; // "mañana" | "tarde" | "noche" — turno del cierre que se está cargando
const TURNOS = ["mañana", "tarde", "noche"];
const TURNO_LABEL = { "mañana": "Mañana", "tarde": "Tarde", "noche": "Noche" };

// Mañana 06-14, Tarde 14-22, Noche 22-06 (cruza medianoche) — con 40 min de
// gracia: quien cierra el turno anterior tarda un rato en cargarlo, así que
// el turno saliente sigue siendo "el actual" hasta 40 min después de su
// hora nominal de cierre (ej: a las 6:20 todavía propone "noche", no
// "mañana", porque lo más probable es que estén cerrando la noche).
//
// EXCEPCIÓN: los domingos son distintos — solo 2 turnos de 12hs en vez de 3:
// "Mañana" pasa a durar 06-18 (absorbe lo que sería "Tarde") y "Noche" pasa
// a ser 18-06 del lunes. No existe "Tarde" los domingos. El sábado a la
// noche sigue siendo el turno normal 22-06 (termina el domingo a la
// mañana), eso no cambia.
const TURNO_GRACIA_MIN = 40;
function esDiaDomingo(date) {
  return date.getDay() === 0;
}

// Etiqueta legible de un turno según el día calendario al que pertenece:
// los domingos "mañana"/"noche" se muestran como "Domingo T1"/"Domingo T2"
// (Turno 1 = 06-18, Turno 2 = 18-06) en vez de "Mañana"/"Noche", porque ese
// día no son medios turnos de 8hs sino dos de 12hs — ver esDiaDomingo.
function turnoLabelParaFecha(fecha, turno) {
  if (esDiaDomingo(fecha)) {
    if (turno === "mañana") return "Domingo T1";
    if (turno === "noche") return "Domingo T2";
  }
  return TURNO_LABEL[turno] || turno;
}

function turnoActual() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const finManana = esDiaDomingo(now) ? 18 : 14; // domingo: "Mañana" dura hasta las 18, no las 14
  // > (no >=): a los 40 min exactos todavía es el turno saliente cerrando,
  // recién al minuto 41 se considera empezado el turno siguiente.
  if (mins > 6 * 60 + TURNO_GRACIA_MIN && mins <= finManana * 60 + TURNO_GRACIA_MIN) return "mañana";
  if (!esDiaDomingo(now) && mins > 14 * 60 + TURNO_GRACIA_MIN && mins <= 22 * 60 + TURNO_GRACIA_MIN) return "tarde";
  return "noche";
}

// Momento exacto en que un turno de un día calendario dado queda vencido
// (fin de su ventana + los mismos TURNO_GRACIA_MIN de arriba) — se usa para
// saber si YA debería estar cargado o todavía puede estar en curso. Noche
// cruza medianoche, por eso vence a las 06:xx del día SIGUIENTE al que
// arrancó (mismo criterio que fechaParaTurno()) — esto no cambia los
// domingos, porque tanto la noche normal como la del domingo terminan
// igual a las 06:00 del día siguiente, lo único que cambia es a qué hora
// arrancan.
function turnoVencimiento(diaBase, turno) {
  const d = new Date(diaBase);
  d.setHours(0, 0, 0, 0);
  if (turno === "mañana") {
    d.setHours(esDiaDomingo(d) ? 18 : 14, TURNO_GRACIA_MIN, 0, 0);
    return d;
  }
  if (turno === "tarde") { d.setHours(22, TURNO_GRACIA_MIN, 0, 0); return d; }
  d.setDate(d.getDate() + 1);
  d.setHours(6, TURNO_GRACIA_MIN, 0, 0);
  return d;
}

// Los turnos de cada día del MES EN CURSO, de día 1 a hoy — el mes
// completo, sin filtrar todavía por si cada turno ya venció. Domingo tiene
// solo 2 (Mañana, Noche); el resto de los días tiene los 3 de siempre.
// Quien arma la grilla (renderFacturado) decide caso por caso: con cierre
// real, se muestra tal cual (haya vencido o no su ventana); sin cierre
// real, recién se marca "faltante" si turnoVencimiento() ya pasó — así un
// cierre cargado apenas termina el turno (antes de la gracia) aparece en su
// lugar normal, en vez de quedar afuera de la grilla. No se extiende a
// meses anteriores: ahí ya no tiene sentido reconstruir la grilla
// retroactivamente.
// slots de un mes dado (base = cualquier fecha de ese mes). Si es el mes en
// curso, llega hasta hoy; si es un mes ya cerrado, llega hasta su último día
// — así la detección de "caja no cargada" también funciona navegando atrás.
function turnosDelMes(base) {
  const now = new Date();
  const esMesActual = base.getMonth() === now.getMonth() && base.getFullYear() === now.getFullYear();
  const dia = new Date(base.getFullYear(), base.getMonth(), 1);
  const fin = esMesActual ? now : new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const slots = [];
  while (dia <= fin) {
    const turnosDelDia = esDiaDomingo(dia) ? ["mañana", "noche"] : TURNOS;
    turnosDelDia.forEach(turno => slots.push({ fecha: new Date(dia), turno }));
    dia.setDate(dia.getDate() + 1);
  }
  return slots;
}

let resumenMesOffset = 0;  // 0 = mes actual, -1 = mes anterior, etc. (Resumen mensual)
let gastosMesOffset = 0;   // ídem, para la pantalla de Gastos — se reinicia a 0 cada vez que se entra
let facturadoMesOffset = 0; // ídem, para la pantalla de Facturado/Cierre de turno
let pendingFirebaseConfig = null; // config guardada entre el paso 1 y 2 del setup inicial
let usuarioActual = null;  // nombre con el que se identificó este celular (ver resumeSession)
let esAdmin = false;       // usuarioActual ∈ admins
let editingGastoId = null;      // id del gasto que se está editando en el modal, o null si es uno nuevo
let selectedFormaPago = "efectivo"; // "efectivo" | "digital" | "mixto" — elegido en el modal de gasto
let mixtoUltimoEditado = null;  // "efectivo" | "digital" | null — cuál de los 2 campos del desglose se tipeó a mano por última vez (el otro se recalcula solo)
let editingCierreId = null;     // id del cierre que se está editando en el modal, o null si es uno nuevo
let pinFlowNombre = null;  // nombre para el que está abierto el modal de PIN
let pinFlowMode = null;    // "create" (todavía no tiene PIN) | "verify" (ya tiene uno)

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- Utilidades ----------
function money(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
function mesLabel(date) {
  return `${MESES[date.getMonth()]} ${date.getFullYear()}`;
}
function fechaDeRegistro(item) {
  return item.fecha && item.fecha.toDate ? item.fecha.toDate() : new Date(item.fecha || Date.now());
}

// Arma un texto "YYYY-MM-DD" (el formato que usa <input type="date">) con
// el año/mes/día LOCALES del dispositivo. A propósito NO se usa
// date.toISOString() para esto: ese método convierte a UTC primero, y
// como Argentina está 3 horas atrás, entre las ~21:00 y la medianoche
// hora local ya es "mañana" en UTC — toISOString() se adelantaba un día
// justo en esas horas (pasaba tanto al cargar un Gasto como un Cierre).
function fechaLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Redimensiona y comprime la foto en el navegador antes de subirla, para que
// no pese varios MB (como sale de la cámara) sino unos cientos de KB.
function compressImage(file, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error("No se pudo procesar la imagen."));
      }, "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
}

function parseFirebaseConfig(raw) {
  if (!raw || !raw.trim()) throw new Error("Pegá la configuración de Firebase.");
  let block = raw;
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    block = raw.slice(braceStart, braceEnd + 1);
  }
  const config = {};
  const re = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    config[m[1]] = m[2];
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter(k => !config[k]);
  if (missing.length) {
    throw new Error("Faltan datos en la configuración: " + missing.join(", "));
  }
  return config;
}

function socioColorVar(index) {
  return `var(${SERIES_VARS[index % SERIES_VARS.length]})`;
}

// Color de identidad para cualquier "pagador": el dueño tiene su color
// categórico propio; cualquier otra persona (colaboradores) usa un color
// neutro, porque no participan del reparto y no deben leerse como una
// "serie" propia en el balance.
function payerColorVar(name) {
  const idx = socios.indexOf(name);
  return idx !== -1 ? socioColorVar(idx) : NEUTRAL_VAR;
}

function socioInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function allPagadores() {
  return socios.concat(colaboradores);
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

  fbApp = sdk.initializeApp(config);
  auth = sdk.getAuth(fbApp);
  db = sdk.getFirestore(fbApp);
  storage = sdk.getStorage(fbApp);
  try {
    await sdk.enableIndexedDbPersistence(db);
  } catch (e) {
    // persistence puede fallar en pestañas múltiples o navegadores viejos; no es crítico
    console.warn("Persistencia offline no disponible:", e.message);
  }
  await new Promise((resolve, reject) => {
    sdk.signInAnonymously(auth).catch(reject);
    sdk.onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
    });
  });
}

async function connectAndBoot(config, namesFromInput, colabFromInput) {
  await initFirebase(config);
  const sdk = fbSdk;

  const socioDocRef = sdk.doc(db, "config", "socios");
  const snap = await sdk.getDoc(socioDocRef);

  if (snap.exists() && Array.isArray(snap.data().socios) && snap.data().socios.length > 0) {
    const data = snap.data();
    socios = data.socios;
    colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
    admins = Array.isArray(data.admins) ? data.admins : [];
    pins = data.pins && typeof data.pins === "object" ? data.pins : {};
    claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
  } else {
    if (!namesFromInput || namesFromInput.some(n => !n.trim())) {
      throw new Error("Completá tu nombre.");
    }
    socios = namesFromInput.map(n => n.trim());
    colaboradores = (colabFromInput || []).map(n => n.trim()).filter(Boolean);
    admins = [];
    pins = {};
    claveMaestraAdmin = "llavez";
    await sdk.setDoc(socioDocRef, { socios, colaboradores, admins, pins, claveMaestraAdmin });
  }

  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(colaboradores));

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
  listenGastos();
  listenFacturacion();
  listenIdeas();
  listenReportes();
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
  usuarioActual = nombre;
  esAdmin = admins.includes(nombre);
  localStorage.setItem(LS_USER_KEY, nombre);
  renderAjustesSocios();
  renderGastos();
  renderFacturado();
  renderIdeas();
}

function cambiarUsuario() {
  localStorage.removeItem(LS_USER_KEY);
  usuarioActual = null;
  esAdmin = false;
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
  pinFlowNombre = nombre;
  pinFlowMode = pins[nombre] ? "verify" : "create";
  $("#pin-input-1").value = "";
  $("#pin-input-2").value = "";
  $("#pin-input-clave-maestra").value = "";
  $("#pin-error").classList.add("hidden");

  // La clave maestra solo se pide la primera vez que un ADMIN crea su PIN
  // en un celular nuevo — no a colaboradores sin admin, y no de nuevo una
  // vez que ya tiene PIN (ahí entra por "verify" con su PIN de siempre).
  // Si no hay clave maestra configurada, no se pide (ver claveMaestraAdmin).
  const requiereClaveMaestra = pinFlowMode === "create" && admins.includes(nombre) && !!claveMaestraAdmin;
  $("#pin-field-clave-maestra").classList.toggle("hidden", !requiereClaveMaestra);

  if (pinFlowMode === "create") {
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
  pinFlowNombre = null;
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

  if (pinFlowMode === "verify") {
    if (pins[pinFlowNombre] !== pin1) {
      errEl.textContent = "PIN incorrecto.";
      errEl.classList.remove("hidden");
      return;
    }
    // Ojo: closePinModal() pone pinFlowNombre en null, por eso hay que
    // guardarlo en una variable local ANTES de llamarla (mismo motivo por
    // el que el branch "create" ya lo hacía con `const nombre`).
    const nombre = pinFlowNombre;
    closePinModal();
    setUsuarioActual(nombre);
    goToNegocioOrHome();
    return;
  }

  // pinFlowMode === "create"
  const requiereClaveMaestra = admins.includes(pinFlowNombre) && !!claveMaestraAdmin;
  if (requiereClaveMaestra && $("#pin-input-clave-maestra").value !== claveMaestraAdmin) {
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
    await fbSdk.updateDoc(fbSdk.doc(db, "config", "socios"), {
      [`pins.${pinFlowNombre}`]: pin1
    });
    pins[pinFlowNombre] = pin1;
    const nombre = pinFlowNombre;
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
  negocioActual = id;

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
    { id: "gastos", emoji: "🧾", nombre: "Gastos", sub: "Cargar gastos y ver el balance entre socios" },
    { id: "facturado", emoji: "💰", nombre: "Cierre de Turno", sub: "Anotar efectivo y Digital" },
    { id: "resumen", emoji: "📊", nombre: "Resumen mensual", sub: "Ver los totales de cada mes", soloAdmin: true },
    { id: "ideas", emoji: "💡", nombre: "Caja de IDEAS", sub: "Aportar ideas para mejorar el negocio y el entorno laboral" },
    { id: "mantenimiento", emoji: "🔨", nombre: "Reportes de Mantenimiento", sub: "Reportar roturas o cosas para arreglar" }
  ];

  const wrap = $("#seccion-cards");
  wrap.innerHTML = "";
  SECCIONES.filter(s => !s.soloAdmin || esAdmin).forEach(s => {
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
  seccionActual = id;
  if (id === "gastos") {
    switchTab("gastos");
    gastosMesOffset = 0; // siempre arranca en el mes actual al entrar
    renderGastos();
    renderBalance();
    showScreen("screen-app");
  } else if (id === "facturado") {
    facturadoMesOffset = 0; // siempre arranca en el mes actual al entrar
    renderFacturado();
    showScreen("screen-facturado");
  } else if (id === "resumen") {
    resumenMesOffset = 0;
    renderResumen();
    showScreen("screen-resumen");
  } else if (id === "ideas") {
    renderIdeas();
    showScreen("screen-ideas");
  } else if (id === "mantenimiento") {
    renderReportes();
    showScreen("screen-mantenimiento");
  }
}

function volverASeccion() {
  const biz = NEGOCIOS.find(n => n.id === negocioActual);
  if (biz) renderSeccionCards(biz);
  showScreen("screen-seccion");
}

// Gastos del negocio actualmente seleccionado (de la lista completa que
// ya sincronizamos con Firestore).
function gastosDelNegocio() {
  return gastos.filter(g => g.negocio === negocioActual);
}

// Cierres de facturación del negocio actualmente seleccionado.
function facturacionesDelNegocio() {
  return facturaciones.filter(f => f.negocio === negocioActual);
}

function listenSocios() {
  const socioDocRef = fbSdk.doc(db, "config", "socios");
  fbSdk.onSnapshot(socioDocRef, (snap) => {
    if (snap.exists() && Array.isArray(snap.data().socios)) {
      const data = snap.data();
      socios = data.socios;
      colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
      admins = Array.isArray(data.admins) ? data.admins : [];
      pins = data.pins && typeof data.pins === "object" ? data.pins : {};
      claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
      localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(socios));
      localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(colaboradores));
      esAdmin = usuarioActual ? admins.includes(usuarioActual) : false;
      renderPagadorChips();
      renderPagadorChipsFacturado();
      renderAjustesSocios();
      renderBalance();
      renderGastos();
      renderFacturado();
      renderIdeas();
    }
  });
}

function listenGastos() {
  const q = fbSdk.query(fbSdk.collection(db, "gastos"), fbSdk.orderBy("fecha", "desc"));
  fbSdk.onSnapshot(q, (snapshot) => {
    gastos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGastos();
    renderBalance();
    if (negocioActual) renderResumen();
    setSyncOffline(false);
    if (!fotosLimpiezaHecha) {
      fotosLimpiezaHecha = true;
      limpiarFotosVencidas();
    }
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

function listenFacturacion() {
  const q = fbSdk.query(fbSdk.collection(db, "facturacion"), fbSdk.orderBy("fecha", "desc"));
  fbSdk.onSnapshot(q, (snapshot) => {
    facturaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFacturado();
    if (negocioActual) renderResumen();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// No se filtran por "negocio" (acá hay un solo negocio, no hace falta).
function listenIdeas() {
  const q = fbSdk.query(fbSdk.collection(db, "ideas"), fbSdk.orderBy("creadoEn", "desc"));
  fbSdk.onSnapshot(q, (snapshot) => {
    ideas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderIdeas();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// Misma mecánica que Ideas (ver listenIdeas), colección aparte "reportes".
function listenReportes() {
  const q = fbSdk.query(fbSdk.collection(db, "reportes"), fbSdk.orderBy("creadoEn", "desc"));
  fbSdk.onSnapshot(q, (snapshot) => {
    reportes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportes();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

function setSyncOffline(isOffline) {
  $$(".sync-dot").forEach(d => d.classList.toggle("offline", isOffline));
}

function listenConnectivity() {
  const update = () => setSyncOffline(!navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// Fecha base del mes elegido en la pantalla de Gastos (ver
// gastosMesOffset) — mismo patrón que resumenFechaBase() para Resumen
// mensual, pero independiente: son dos navegadores de mes separados.
function gastosFechaBase() {
  const d = new Date();
  d.setDate(1); // evita saltos raros de mes al sumar/restar meses
  d.setMonth(d.getMonth() + gastosMesOffset);
  return d;
}

// Antes mostraba TODOS los gastos sin importar el mes (solo el total de
// arriba estaba filtrado por mes actual, lo cual era inconsistente e
// iba acumulando meses viejos mezclados en la lista). Ahora, igual que
// Resumen mensual, se ve un mes a la vez — por defecto el actual (ver
// selectSeccion()) — con flechas para ir a uno anterior si hace falta
// editar o borrar algo viejo.
function renderGastos() {
  const list = $("#expenses-list");
  const empty = $("#expenses-empty");
  list.innerHTML = "";

  const base = gastosFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#gastos-mes-label").textContent = mesLabel(base);
  const now = new Date();
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-gastos-mes-siguiente").disabled = esMesActual;

  const gastosMes = gastosDelNegocio().filter(g => {
    const f = fechaDeRegistro(g);
    return f.getMonth() === targetMonth && f.getFullYear() === targetYear;
  });

  if (!gastosMes.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
  }

  let totalMes = 0;

  gastosMes.forEach(g => {
    const fecha = fechaDeRegistro(g);
    totalMes += Number(g.importe) || 0;

    const fotoBtn = g.fotoUrl
      ? `<button type="button" class="foto-link" data-url="${escapeHtml(g.fotoUrl)}" aria-label="Ver foto de la factura">📷</button>`
      : "";

    // Editar/borrar solo para el admin — el resto solo puede cargar y ver.
    const adminBtns = esAdmin
      ? `<button type="button" class="icon-btn gasto-edit-btn" data-id="${g.id}" aria-label="Editar gasto">✏️</button>
         <button type="button" class="icon-btn danger gasto-delete-btn" data-id="${g.id}" aria-label="Borrar gasto">🗑️</button>`
      : "";

    const notaHtml = g.nota ? `<div class="meta gasto-nota">📝 ${escapeHtml(g.nota)}</div>` : "";

    // Falta abonar: se tildó porque todavía no se le pagó a quien
    // trajo la mercadería (ej. te dejan pagar unos días después) — la
    // fila queda en rojo. Tocar el aviso lo marca como pagado al toque
    // (guarda directo, sin pasar por el modal de Editar).
    const metaFaltaAbonar = g.faltaAbonar
      ? ` · <button type="button" class="meta-falta-abonar" data-id="${g.id}">⚠️ Falta abonar</button>`
      : "";

    const li = document.createElement("li");
    li.className = "expense-item" + (g.faltaAbonar ? " falta-abonar" : "");
    li.innerHTML = `
      <div class="avatar" style="background:${payerColorVar(g.pagadoPor)}">${socioInitial(g.pagadoPor)}</div>
      <div class="info">
        <div class="desc">${escapeHtml(g.descripcion || "Sin descripción")}</div>
        <div class="meta">${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} · ${escapeHtml(g.categoria || "Otros")} · Pagó ${escapeHtml(g.pagadoPor || "?")} · ${formaPagoLabel(g)}${metaFaltaAbonar}</div>
        ${notaHtml}
      </div>
      <div class="amount">${money(g.importe)}</div>
      ${fotoBtn}
      ${adminBtns}
    `;
    list.appendChild(li);
  });

  $("#total-mes").textContent = money(totalMes);
}

// Gastos cargados antes de que existiera "forma de pago" no tienen el
// campo — se muestran como Efectivo por default.
function formaPagoLabel(g) {
  if (g.formaPago === "digital") return "💳 Digital";
  if (g.formaPago === "mixto") return `🔀 ${money(g.montoDigital)} digital · ${money(g.montoEfectivo)} efectivo`;
  return "💵 Efectivo";
}

// Todo texto que viene de Firestore (descripción, nombres) pasa por acá antes
// de insertarse con innerHTML, para evitar XSS. Cualquier campo de texto
// nuevo que se agregue a un template debe escaparse igual.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Render: Facturado ----------
// Fila de un cierre YA cargado (id real en Firestore).
function renderCierreItem(f) {
  const fecha = fechaDeRegistro(f);
  const adminBtns = esAdmin
    ? `<button type="button" class="icon-btn cierre-edit-btn" data-id="${f.id}" aria-label="Editar cierre">✏️</button>
       <button type="button" class="icon-btn danger cierre-delete-btn" data-id="${f.id}" aria-label="Borrar cierre">🗑️</button>`
    : "";
  const turnoLabel = turnoLabelParaFecha(fecha, f.turno);

  // "creadoEn" es la hora REAL en que se guardó el cierre (a diferencia
  // de "fecha", que es solo el día elegido, guardado siempre al
  // mediodía — ver saveCierre). Los cierres de antes de este cambio no
  // tienen "creadoEn", por eso el chequeo: en esos casos no se muestra
  // ninguna hora en vez de mostrar una incorrecta.
  const horaCarga = f.creadoEn && f.creadoEn.toDate
    ? f.creadoEn.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  const li = document.createElement("li");
  li.className = "expense-item";
  li.innerHTML = `
    <div class="avatar" style="background:${payerColorVar(f.registradoPor)}">${socioInitial(f.registradoPor)}</div>
    <div class="info">
      <div class="desc">${turnoLabel ? escapeHtml(turnoLabel) + " — " : ""}${fecha.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })}</div>
      <div class="meta">Cargado por ${escapeHtml(f.registradoPor || "?")}${horaCarga ? " a las " + horaCarga : ""}</div>
    </div>
    <div class="amount">${money(f.importe)}</div>
    ${adminBtns}
  `;
  return li;
}

// Fila de un turno del mes en curso ya vencido (ver turnosDelMesActual)
// que todavía no tiene cierre cargado. El botón "Cargar" abre el modal de
// Nuevo cierre con esa fecha y turno ya preseleccionados — cualquiera puede
// tocarlo (admin o empleado), igual que cualquiera puede cargar un cierre
// nuevo con el +.
function renderCierreFaltante(fecha, turno) {
  const li = document.createElement("li");
  li.className = "expense-item expense-item-faltante";
  li.innerHTML = `
    <div class="info">
      <div class="desc falta-desc">⚠️ CAJA NO CARGADA</div>
      <div class="meta">${escapeHtml(turnoLabelParaFecha(fecha, turno))} — ${fecha.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })}</div>
    </div>
    <button type="button" class="btn-secondary btn-cargar-faltante" data-fecha="${fechaLocalISO(fecha)}" data-turno="${turno}">Cargar</button>
  `;
  return li;
}

// Fecha base del mes elegido en la pantalla de Facturado (ver
// facturadoMesOffset) — mismo patrón que gastosFechaBase().
function facturadoFechaBase() {
  const d = new Date();
  d.setDate(1); // evita saltos raros de mes al sumar/restar meses
  d.setMonth(d.getMonth() + facturadoMesOffset);
  return d;
}

// Antes la grilla de turnos era siempre la del mes en curso, y todo el
// historial de meses anteriores se listaba entero debajo, sin agrupar —
// con el tiempo se iba acumulando y quedaba todo mezclado. Ahora, igual
// que Gastos, se navega un mes a la vez (con flechas ‹ ›), y la grilla de
// "caja no cargada" se recalcula para el mes que se esté mirando.
function renderFacturado() {
  const list = $("#facturado-list");
  const empty = $("#facturado-empty");
  list.innerHTML = "";

  const items = facturacionesDelNegocio();
  const now = new Date();

  // "Hoy" es siempre el día real, sin importar qué mes se esté navegando.
  let totalHoy = 0;
  const turnosHoy = new Set();
  items.forEach(f => {
    const fecha = fechaDeRegistro(f);
    if (fecha.toDateString() === now.toDateString()) {
      totalHoy += Number(f.importe) || 0;
      if (TURNOS.includes(f.turno)) turnosHoy.add(f.turno);
    }
  });

  const base = facturadoFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#facturado-mes-label").textContent = mesLabel(base);
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-facturado-mes-siguiente").disabled = esMesActual;

  const itemsMes = items.filter(f => {
    const fecha = fechaDeRegistro(f);
    return fecha.getMonth() === targetMonth && fecha.getFullYear() === targetYear;
  });
  const totalMes = itemsMes.reduce((sum, f) => sum + (Number(f.importe) || 0), 0);

  // Mapa "año-mes-día-turno" -> cierre real, para cruzarlo contra la
  // grilla de turnos esperados del mes y saber cuáles faltan.
  const porSlot = new Map();
  itemsMes.forEach(f => {
    const fecha = fechaDeRegistro(f);
    porSlot.set(`${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}-${f.turno}`, f);
  });

  // Grilla del mes elegido: día 1 hasta hoy (o hasta fin de mes si ya
  // pasó), más reciente primero, y dentro de cada día en orden Mañana →
  // Tarde → Noche. Cada slot ya vencido sale como cierre real o faltante.
  const porDia = new Map(); // "año-mes-día" -> { fecha, turnos: [{turno, real}] }
  turnosDelMes(base).forEach(({ fecha, turno }) => {
    const diaKey = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
    if (!porDia.has(diaKey)) porDia.set(diaKey, { fecha, turnos: [] });
    porDia.get(diaKey).turnos.push({ turno, real: porSlot.get(`${diaKey}-${turno}`) || null });
  });
  const diasDelMes = Array.from(porDia.values()).sort((a, b) => b.fecha - a.fecha);

  const idsEnGrilla = new Set();
  diasDelMes.forEach(dia => dia.turnos.forEach(t => { if (t.real) idsEnGrilla.add(t.real.id); }));

  // Cierres del mes que no encajaron en la grilla (ej. turno con valor
  // no estándar por datos viejos) — se listan igual, para no perderlos.
  const restoDelMes = itemsMes
    .filter(f => !idsEnGrilla.has(f.id))
    .slice()
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a));

  diasDelMes.forEach(dia => {
    dia.turnos.forEach(({ turno, real }) => {
      if (real) {
        list.appendChild(renderCierreItem(real));
      } else if (turnoVencimiento(dia.fecha, turno) <= now) {
        list.appendChild(renderCierreFaltante(dia.fecha, turno));
      }
      // si no venció y no hay cierre real, todavía está en curso: no se muestra nada.
    });
  });
  restoDelMes.forEach(f => list.appendChild(renderCierreItem(f)));

  empty.classList.toggle("hidden", list.children.length > 0);

  $("#facturado-total-mes-wrap").classList.toggle("hidden", !esAdmin);
  $("#facturado-total-mes").textContent = money(totalMes);
  $("#facturado-total-hoy").textContent = money(totalHoy);
  const turnosEsperadosHoy = esDiaDomingo(now) ? 2 : TURNOS.length; // domingo: solo 2 turnos de 12hs
  $("#facturado-turnos-hoy").textContent = `${turnosHoy.size} de ${turnosEsperadosHoy} turnos cargados`;
}

// ---------- Render: Ideas (checklist compartido) ----------
function renderIdeas() {
  const total = ideas.length;
  const concretadas = ideas.filter(i => i.estado === "concretada");
  // Pendientes ordenadas por votos — así se ve de un vistazo qué le
  // interesa más al equipo, sin que nadie tenga que decidir solo.
  const pendientes = ideas
    .filter(i => i.estado !== "concretada")
    .slice()
    .sort((a, b) => votosDe(b).length - votosDe(a).length);

  $("#ideas-empty").classList.toggle("hidden", total > 0);

  $("#ideas-progreso-valor").textContent = `${concretadas.length} de ${total}`;
  const pct = total ? Math.round((concretadas.length / total) * 100) : 0;
  $("#ideas-progreso-bar").style.width = pct + "%";

  $("#ideas-pendientes-empty").classList.toggle("hidden", pendientes.length > 0 || total === 0);
  $("#ideas-concretadas-wrap").classList.toggle("hidden", concretadas.length === 0);

  const pendientesEl = $("#ideas-pendientes-list");
  pendientesEl.innerHTML = "";
  pendientes.forEach(i => pendientesEl.appendChild(ideaCard(i)));

  const concretadasEl = $("#ideas-concretadas-list");
  concretadasEl.innerHTML = "";
  concretadas.forEach(i => concretadasEl.appendChild(ideaCard(i)));
}

function votosDe(idea) {
  return Array.isArray(idea.votos) ? idea.votos : [];
}

function ideaCard(idea) {
  const done = idea.estado === "concretada";
  const fecha = fechaDeRegistro(idea);
  const votos = votosDe(idea);
  const voteado = usuarioActual && votos.includes(usuarioActual);
  const card = document.createElement("div");
  card.className = "idea-card";
  card.dataset.id = idea.id;
  const deleteBtn = esAdmin
    ? `<button type="button" class="icon-btn danger idea-delete-btn" data-id="${idea.id}" aria-label="Borrar idea">🗑️</button>`
    : "";
  card.innerHTML = `
    <div class="idea-check ${done ? "checked" : ""}">${done ? "✓" : ""}</div>
    <div class="idea-info">
      <div class="idea-texto ${done ? "done" : ""}">${escapeHtml(idea.texto)}</div>
      <div class="idea-meta">Propuesto por ${escapeHtml(idea.propuestoPor || "?")} · ${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</div>
    </div>
    <button type="button" class="idea-vote-btn ${voteado ? "voted" : ""}" data-id="${idea.id}" aria-label="Me interesa esta idea">🔥 ${votos.length}</button>
    ${deleteBtn}
  `;
  return card;
}

// Cualquiera puede votar/desvotar una idea pendiente (no admin) — así se ve
// qué le importa más al equipo sin que nadie tenga que decidir por otro.
async function toggleVoto(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea || !usuarioActual) return;
  const yaVoto = votosDe(idea).includes(usuarioActual);
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "ideas", id), {
      votos: yaVoto ? fbSdk.arrayRemove(usuarioActual) : fbSdk.arrayUnion(usuarioActual)
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Cualquiera puede marcar/desmarcar una idea como concretada — sin admin,
// para que sea tan liviano como tildar un check en una lista de tareas.
async function toggleIdeaEstado(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;
  const nuevoEstado = idea.estado === "concretada" ? "pendiente" : "concretada";
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "ideas", id), { estado: nuevoEstado });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Solo admin (esAdmin) — ver botón 🗑️ en ideaCard().
async function deleteIdea(id) {
  if (!confirm("¿Borrar esta idea?")) return;
  try {
    await fbSdk.deleteDoc(fbSdk.doc(db, "ideas", id));
    showToast("Idea borrada");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

function openModalIdea() {
  $("#input-idea-texto").value = "";
  $("#modal-idea-error").classList.add("hidden");
  $("#modal-add-idea").classList.add("active");
  setTimeout(() => $("#input-idea-texto").focus(), 150);
}

function closeModalIdea() {
  $("#modal-add-idea").classList.remove("active");
}

async function saveIdea() {
  const texto = $("#input-idea-texto").value.trim();
  const errEl = $("#modal-idea-error");
  if (!texto) {
    errEl.textContent = "Escribí la idea antes de guardar.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-idea");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await fbSdk.addDoc(fbSdk.collection(db, "ideas"), {
      texto,
      estado: "pendiente",
      votos: [],
      propuestoPor: usuarioActual,
      creadoEn: fbSdk.serverTimestamp()
    });
    closeModalIdea();
    showToast("Idea guardada ✅");
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar idea";
  }
}

// ---------- Render: Reportes de Mantenimiento ----------
// Misma estructura que Ideas (pendientes/resueltos, votos, borrar solo
// admin), colección Firestore aparte ("reportes") — ver listenReportes.
function renderReportes() {
  const total = reportes.length;
  const resueltos = reportes.filter(r => r.estado === "resuelto");
  const pendientes = reportes
    .filter(r => r.estado !== "resuelto")
    .slice()
    .sort((a, b) => votosDe(b).length - votosDe(a).length);

  $("#reportes-empty").classList.toggle("hidden", total > 0);

  $("#reportes-progreso-valor").textContent = `${resueltos.length} de ${total}`;
  const pct = total ? Math.round((resueltos.length / total) * 100) : 0;
  $("#reportes-progreso-bar").style.width = pct + "%";

  $("#reportes-pendientes-empty").classList.toggle("hidden", pendientes.length > 0 || total === 0);
  $("#reportes-resueltos-wrap").classList.toggle("hidden", resueltos.length === 0);

  const pendientesEl = $("#reportes-pendientes-list");
  pendientesEl.innerHTML = "";
  pendientes.forEach(r => pendientesEl.appendChild(reporteCard(r)));

  const resueltosEl = $("#reportes-resueltos-list");
  resueltosEl.innerHTML = "";
  resueltos.forEach(r => resueltosEl.appendChild(reporteCard(r)));
}

function reporteCard(reporte) {
  const done = reporte.estado === "resuelto";
  const fecha = fechaDeRegistro(reporte);
  const votos = votosDe(reporte);
  const voteado = usuarioActual && votos.includes(usuarioActual);
  const card = document.createElement("div");
  card.className = "idea-card";
  card.dataset.id = reporte.id;
  const deleteBtn = esAdmin
    ? `<button type="button" class="icon-btn danger reporte-delete-btn" data-id="${reporte.id}" aria-label="Borrar reporte">🗑️</button>`
    : "";
  // "Resuelto por" solo se muestra si ya está marcado como resuelto y quedó
  // guardado quién lo tildó (ver toggleReporteEstado).
  const resueltoLinea = (done && reporte.resueltoPor)
    ? `<div class="idea-meta">Resuelto por ${escapeHtml(reporte.resueltoPor)}</div>`
    : "";
  card.innerHTML = `
    <div class="idea-check ${done ? "checked" : ""}">${done ? "✓" : ""}</div>
    <div class="idea-info">
      <div class="idea-texto ${done ? "done" : ""}">${escapeHtml(reporte.texto)}</div>
      <div class="idea-meta">Reportado por ${escapeHtml(reporte.propuestoPor || "?")} · ${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</div>
      ${resueltoLinea}
    </div>
    <button type="button" class="idea-vote-btn ${voteado ? "voted" : ""}" data-id="${reporte.id}" aria-label="Me interesa este reporte">🔥 ${votos.length}</button>
    ${deleteBtn}
  `;
  return card;
}

// Cualquiera puede votar/desvotar un reporte pendiente — igual criterio que
// toggleVoto() en Ideas: sirve para priorizar qué arreglar primero.
async function toggleVotoReporte(id) {
  const reporte = reportes.find(r => r.id === id);
  if (!reporte || !usuarioActual) return;
  const yaVoto = votosDe(reporte).includes(usuarioActual);
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "reportes", id), {
      votos: yaVoto ? fbSdk.arrayRemove(usuarioActual) : fbSdk.arrayUnion(usuarioActual)
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Cualquiera puede marcar/desmarcar un reporte como resuelto — sin admin,
// igual que toggleIdeaEstado() en Ideas.
async function toggleReporteEstado(id) {
  const reporte = reportes.find(r => r.id === id);
  if (!reporte) return;
  const marcandoResuelto = reporte.estado !== "resuelto";
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "reportes", id), {
      estado: marcandoResuelto ? "resuelto" : "pendiente",
      // Queda registrado quién lo solucionó (ver reporteCard). Si se
      // reabre, se limpia — si se vuelve a resolver, se pisa con quien
      // corresponda en ese momento.
      resueltoPor: marcandoResuelto ? usuarioActual : fbSdk.deleteField()
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Solo admin (esAdmin) — ver botón 🗑️ en reporteCard().
async function deleteReporte(id) {
  if (!confirm("¿Borrar este reporte?")) return;
  try {
    await fbSdk.deleteDoc(fbSdk.doc(db, "reportes", id));
    showToast("Reporte borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

function openModalReporte() {
  $("#input-reporte-texto").value = "";
  $("#modal-reporte-error").classList.add("hidden");
  $("#modal-add-reporte").classList.add("active");
  setTimeout(() => $("#input-reporte-texto").focus(), 150);
}

function closeModalReporte() {
  $("#modal-add-reporte").classList.remove("active");
}

async function saveReporte() {
  const texto = $("#input-reporte-texto").value.trim();
  const errEl = $("#modal-reporte-error");
  if (!texto) {
    errEl.textContent = "Escribí el reporte antes de guardar.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-reporte");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await fbSdk.addDoc(fbSdk.collection(db, "reportes"), {
      texto,
      estado: "pendiente",
      votos: [],
      propuestoPor: usuarioActual,
      creadoEn: fbSdk.serverTimestamp()
    });
    closeModalReporte();
    showToast("Reporte guardado ✅");
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar reporte";
  }
}

// ---------- Render: Resumen mensual ----------
// Muestra, para el mes elegido (navegable con ‹ ›), el total de Facturado
// y el total de Gastos por separado — sin restar uno del otro. No borra ni
// mueve ningún dato: es solo una vista calculada sobre lo que ya está
// guardado en Firestore.
function resumenFechaBase() {
  const d = new Date();
  d.setDate(1); // evita saltos raros de mes al sumar/restar meses
  d.setMonth(d.getMonth() + resumenMesOffset);
  return d;
}

function renderResumen() {
  const base = resumenFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();

  $("#resumen-mes-label").textContent = mesLabel(base);

  const now = new Date();
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-mes-siguiente").disabled = esMesActual;

  const gastosMes = gastosDelNegocio().filter(g => {
    const f = fechaDeRegistro(g);
    return f.getMonth() === targetMonth && f.getFullYear() === targetYear;
  });
  const factMes = facturacionesDelNegocio().filter(f => {
    const d = fechaDeRegistro(f);
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });

  const totalGastos = gastosMes.reduce((sum, g) => sum + (Number(g.importe) || 0), 0);
  const totalFact = factMes.reduce((sum, f) => sum + (Number(f.importe) || 0), 0);
  // Cierres cargados ANTES del desglose Efectivo/Digital no tienen esos
  // campos — no suman acá (por eso Efectivo+Digital puede no coincidir
  // exactamente con el Total Facturado en meses con cierres viejos).
  const totalEfectivo = factMes.reduce((sum, f) => sum + (Number(f.efectivo) || 0), 0);
  const totalDigital = factMes.reduce((sum, f) => sum + (Number(f.digital) || 0), 0);

  $("#resumen-total-facturado").textContent = money(totalFact);
  $("#resumen-cant-facturado").textContent = factMes.length === 1 ? "1 cierre cargado" : `${factMes.length} cierres cargados`;
  $("#resumen-total-efectivo").textContent = money(totalEfectivo);
  $("#resumen-total-digital").textContent = money(totalDigital);
  const maxEfectDigital = Math.max(1, totalEfectivo, totalDigital);
  $("#resumen-bar-efectivo").style.width = Math.round((totalEfectivo / maxEfectDigital) * 100) + "%";
  $("#resumen-bar-digital").style.width = Math.round((totalDigital / maxEfectDigital) * 100) + "%";
  $("#resumen-total-gastos").textContent = money(totalGastos);
  $("#resumen-cant-gastos").textContent = gastosMes.length === 1 ? "1 gasto cargado" : `${gastosMes.length} gastos cargados`;

  // Mismo desglose Efectivo/Digital que Facturado, pero para Gastos —
  // usa el campo "formaPago" de cada gasto (ver openModal/saveGasto).
  // Gastos sin ese campo (cargados antes de que existiera) cuentan como
  // Efectivo, igual que en la lista de Gastos (ver formaPagoLabel()).
  let totalGastosEfectivo = 0, totalGastosDigital = 0;
  gastosMes.forEach(g => {
    const importe = Number(g.importe) || 0;
    if (g.formaPago === "digital") {
      totalGastosDigital += importe;
    } else if (g.formaPago === "mixto") {
      totalGastosEfectivo += Number(g.montoEfectivo) || 0;
      totalGastosDigital += Number(g.montoDigital) || 0;
    } else {
      totalGastosEfectivo += importe;
    }
  });
  $("#resumen-gastos-efectivo").textContent = money(totalGastosEfectivo);
  $("#resumen-gastos-digital").textContent = money(totalGastosDigital);
  const maxGastosEfectDigital = Math.max(1, totalGastosEfectivo, totalGastosDigital);
  $("#resumen-gastos-bar-efectivo").style.width = Math.round((totalGastosEfectivo / maxGastosEfectDigital) * 100) + "%";
  $("#resumen-gastos-bar-digital").style.width = Math.round((totalGastosDigital / maxGastosEfectDigital) * 100) + "%";

  // Agrupa los cierres del mes por día calendario, y dentro de cada día
  // por turno — para ver de un vistazo cuánto se trabajó cada día y cómo
  // se repartió entre Mañana/Tarde/Noche.
  const porDiaMap = new Map();
  factMes.forEach(f => {
    const d = fechaDeRegistro(f);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!porDiaMap.has(key)) {
      porDiaMap.set(key, { fecha: d, total: 0, turnos: { "mañana": 0, "tarde": 0, "noche": 0 } });
    }
    const entry = porDiaMap.get(key);
    const importe = Number(f.importe) || 0;
    entry.total += importe;
    if (TURNOS.includes(f.turno)) entry.turnos[f.turno] += importe;
  });
  const dias = Array.from(porDiaMap.values()).sort((a, b) => b.fecha - a.fecha);

  const diaWrap = $("#resumen-por-dia");
  const diaEmptyEl = $("#resumen-por-dia-empty");
  diaWrap.innerHTML = "";
  if (!dias.length) {
    diaEmptyEl.classList.remove("hidden");
  } else {
    diaEmptyEl.classList.add("hidden");
    dias.forEach(dia => {
      const esHoy = dia.fecha.toDateString() === now.toDateString();
      const card = document.createElement("div");
      card.className = "socio-total-card";
      const turnosDelDia = esDiaDomingo(dia.fecha) ? ["mañana", "noche"] : TURNOS; // domingo: sin "Tarde"
      const turnosHtml = turnosDelDia.map(t =>
        `<span>${turnoLabelParaFecha(dia.fecha, t)}: ${money(dia.turnos[t])}</span>`
      ).join("");
      card.innerHTML = `
        <div class="socio-total-row">
          <div class="socio-total-name">${esHoy ? "Hoy" : dia.fecha.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })}</div>
          <div class="socio-total-amount">${money(dia.total)}</div>
        </div>
        <div class="resumen-turnos-row">${turnosHtml}</div>
      `;
      diaWrap.appendChild(card);
    });
  }

  const porCategoria = {};
  gastosMes.forEach(g => {
    const cat = g.categoria || "Otros";
    porCategoria[cat] = (porCategoria[cat] || 0) + (Number(g.importe) || 0);
  });
  const categorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

  const wrap = $("#resumen-categorias");
  const emptyEl = $("#resumen-categorias-empty");
  wrap.innerHTML = "";
  if (!categorias.length) {
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
    const maxVal = Math.max(1, ...categorias.map(c => c[1]));
    categorias.forEach(([cat, val]) => {
      const pct = Math.round((val / maxVal) * 100);
      const card = document.createElement("div");
      card.className = "socio-total-card";
      card.innerHTML = `
        <div class="socio-total-row">
          <div class="socio-total-name">${escapeHtml(cat)}</div>
          <div class="socio-total-amount">${money(val)}</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--text-muted)"></div></div>
      `;
      wrap.appendChild(card);
    });
  }
}

// ---------- Fotos de facturas: limpieza automática y pantalla de descarga ----------
// Se ejecuta una vez por apertura de la app (ver listenGastos). Borra del
// Storage y del gasto la foto de cualquier gasto con más de 4 meses — el
// gasto en sí (importe, descripción, etc.) NUNCA se toca ni se borra.
async function limpiarFotosVencidas() {
  const limite = Date.now() - FOTO_RETENCION_DIAS * 24 * 60 * 60 * 1000;
  const vencidos = gastos.filter(g => g.fotoPath && fechaDeRegistro(g).getTime() < limite);

  for (const g of vencidos) {
    try {
      await fbSdk.deleteObject(fbSdk.ref(storage, g.fotoPath));
    } catch (e) {
      console.warn("No se pudo borrar la foto vencida (puede que ya no exista):", e.message);
    }
    try {
      await fbSdk.updateDoc(fbSdk.doc(db, "gastos", g.id), {
        fotoUrl: fbSdk.deleteField(),
        fotoPath: fbSdk.deleteField()
      });
    } catch (e) {
      console.warn("No se pudo limpiar la referencia de la foto:", e.message);
    }
  }
}

// Pantalla "Fotos guardadas": agrupa por mes todos los gastos del negocio
// actual que todavía tienen una foto (los que ya se limpiaron por vencidos
// simplemente no aparecen más, sin necesidad de filtrar por fecha acá).
function renderFotosGuardadas() {
  const conFoto = gastosDelNegocio()
    .filter(g => g.fotoUrl)
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a));

  const empty = $("#fotos-empty");
  const wrap = $("#fotos-grupos");
  wrap.innerHTML = "";

  if (!conFoto.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const grupos = new Map(); // "2026-8" -> { label, items: [] }
  conFoto.forEach(g => {
    const f = fechaDeRegistro(g);
    const key = `${f.getFullYear()}-${f.getMonth()}`;
    if (!grupos.has(key)) grupos.set(key, { label: mesLabel(f), items: [] });
    grupos.get(key).items.push(g);
  });

  grupos.forEach(grupo => {
    const section = document.createElement("div");
    section.className = "fotos-grupo";
    const grid = grupo.items.map(g => `
      <a class="foto-thumb-link" href="${escapeHtml(g.fotoUrl)}" target="_blank" rel="noopener" aria-label="Ver foto: ${escapeHtml(g.descripcion || "")}">
        <img class="foto-thumb" src="${escapeHtml(g.fotoUrl)}" alt="Factura: ${escapeHtml(g.descripcion || "")}" loading="lazy">
      </a>
    `).join("");
    section.innerHTML = `
      <div class="fotos-grupo-titulo">${escapeHtml(grupo.label)} — ${grupo.items.length} foto${grupo.items.length === 1 ? "" : "s"}</div>
      <div class="fotos-grid">${grid}</div>
    `;
    wrap.appendChild(section);
  });
}

// ---------- Render: Balance ----------
function renderBalance() {
  if (!socios.length) return;

  const gastosNegocio = gastosDelNegocio();
  const total = gastosNegocio.reduce((sum, g) => sum + (Number(g.importe) || 0), 0);
  $("#total-historico").textContent = money(total);

  const porSocio = socios.map(() => 0);
  gastosNegocio.forEach(g => {
    const idx = socios.indexOf(g.pagadoPor);
    if (idx !== -1) porSocio[idx] += Number(g.importe) || 0;
  });

  const maxPorSocio = Math.max(1, ...porSocio);
  const totalesEl = $("#socios-totales");
  totalesEl.innerHTML = "";
  socios.forEach((nombre, idx) => {
    const pct = Math.round((porSocio[idx] / maxPorSocio) * 100);
    const card = document.createElement("div");
    card.className = "socio-total-card";
    card.innerHTML = `
      <div class="socio-total-row">
        <div class="socio-total-name">
          <span class="socio-dot" style="background:${socioColorVar(idx)}"></span>
          ${escapeHtml(nombre)}
        </div>
        <div class="socio-total-amount">${money(porSocio[idx])}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${socioColorVar(idx)}"></div></div>
    `;
    totalesEl.appendChild(card);
  });

  // Deudas: cada socio "debería" haber puesto total/n
  const fairShare = total / socios.length;
  const balances = socios.map((nombre, idx) => ({
    nombre, idx, balance: porSocio[idx] - fairShare
  }));

  const settlements = computeSettlements(balances);
  const settlementsEl = $("#settlements");
  settlementsEl.innerHTML = "";

  if (!total) {
    settlementsEl.innerHTML = `<p class="settlements-empty">Todavía no hay gastos para calcular.</p>`;
  } else if (!settlements.length) {
    settlementsEl.innerHTML = `<p class="settlements-empty">✅ Las cuentas están parejas entre los 3.</p>`;
  } else {
    settlements.forEach(s => {
      const item = document.createElement("div");
      item.className = "settlement-item";
      item.innerHTML = `
        <b>${escapeHtml(s.from)}</b>
        <span class="arrow">le debe a</span>
        <b>${escapeHtml(s.to)}</b>
        <span class="amt">${money(s.amount)}</span>
      `;
      settlementsEl.appendChild(item);
    });
  }

  renderColaboradoresTotales();
}

// Pagos hechos por colaboradores (ej. la encargada): se muestran a modo
// informativo, pero NUNCA entran en el cálculo de "quién le debe a quién"
// entre los socios.
function renderColaboradoresTotales() {
  const section = $("#colaboradores-section");
  if (!colaboradores.length) {
    section.classList.add("hidden");
    return;
  }

  const porColaborador = colaboradores.map(() => 0);
  gastosDelNegocio().forEach(g => {
    const idx = colaboradores.indexOf(g.pagadoPor);
    if (idx !== -1) porColaborador[idx] += Number(g.importe) || 0;
  });

  const total = porColaborador.reduce((a, b) => a + b, 0);
  if (!total) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const maxVal = Math.max(1, ...porColaborador);
  const wrap = $("#colaboradores-totales");
  wrap.innerHTML = "";
  colaboradores.forEach((nombre, idx) => {
    const pct = Math.round((porColaborador[idx] / maxVal) * 100);
    if (!porColaborador[idx]) return;
    const card = document.createElement("div");
    card.className = "socio-total-card";
    card.innerHTML = `
      <div class="socio-total-row">
        <div class="socio-total-name">
          <span class="socio-dot" style="background:${NEUTRAL_VAR}"></span>
          ${escapeHtml(nombre)}
        </div>
        <div class="socio-total-amount">${money(porColaborador[idx])}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${NEUTRAL_VAR}"></div></div>
    `;
    wrap.appendChild(card);
  });
}

// Algoritmo simple de liquidación de deudas (minimiza transacciones)
function computeSettlements(balances) {
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, balance: -b.balance }));
  const creditors = balances.filter(b => b.balance > 0.01).map(b => ({ ...b }));
  debtors.sort((a, b) => b.balance - a.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  const result = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const amount = Math.min(d.balance, c.balance);
    if (amount > 0.01) {
      result.push({ from: d.nombre, to: c.nombre, amount });
    }
    d.balance -= amount;
    c.balance -= amount;
    if (d.balance <= 0.01) i++;
    if (c.balance <= 0.01) j++;
  }
  return result;
}

// ---------- Render: chips de pagador (modal) ----------
function renderPagadorChips() {
  const wrap = $("#pagador-options");
  wrap.innerHTML = "";
  allPagadores().forEach((nombre) => {
    const chip = document.createElement("div");
    chip.className = "pagador-chip";
    chip.textContent = nombre;
    chip.style.setProperty("--chip-color", payerColorVar(nombre));
    chip.addEventListener("click", () => {
      selectedPagador = nombre;
      wrap.querySelectorAll(".pagador-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    wrap.appendChild(chip);
  });
}

// Chips de "¿Quién lo cargó?" en el modal de Facturado.
function renderPagadorChipsFacturado() {
  const wrap = $("#pagador-options-fact");
  wrap.innerHTML = "";
  allPagadores().forEach((nombre) => {
    const chip = document.createElement("div");
    chip.className = "pagador-chip";
    chip.textContent = nombre;
    chip.style.setProperty("--chip-color", payerColorVar(nombre));
    chip.addEventListener("click", () => {
      selectedRegistrador = nombre;
      wrap.querySelectorAll(".pagador-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    wrap.appendChild(chip);
  });
}

// ---------- Render: Ajustes ----------
function renderAjustesSocios() {
  const wrap = $("#ajustes-socios-list");
  wrap.innerHTML = "";
  socios.forEach((nombre, idx) => {
    const row = document.createElement("div");
    row.className = "ajustes-socio-row";
    const badge = admins.includes(nombre) ? `<span class="admin-badge">Admin</span>` : "";
    row.innerHTML = `<span class="socio-dot" style="background:${socioColorVar(idx)}"></span> ${escapeHtml(nombre)} ${badge}`;
    wrap.appendChild(row);
  });

  const usuarioEl = $("#ajustes-usuario-actual");
  usuarioEl.innerHTML = usuarioActual
    ? `Ingresaste como <b>${escapeHtml(usuarioActual)}</b>${esAdmin ? ' <span class="admin-badge">Admin</span>' : ""}`
    : "Sin identificar";

  const colabWrap = $("#ajustes-colaboradores-list");
  const colabEmpty = $("#ajustes-colaboradores-empty");
  colabWrap.innerHTML = "";
  if (colaboradores.length) {
    colabEmpty.classList.add("hidden");
    colaboradores.forEach((nombre) => {
      const row = document.createElement("div");
      row.className = "ajustes-socio-row";
      const esAdminColab = admins.includes(nombre);
      const badge = esAdminColab ? `<span class="admin-badge">Admin</span>` : "";
      // Solo el admin puede volver admin (o sacarle el admin) a un
      // empleado — permite que alguien que no es socio (ej. otro dueño
      // agregado como empleado para no entrar al reparto) pueda editar
      // y borrar igual que un socio, sin tocar el cálculo de Balance.
      const adminToggleBtn = esAdmin
        ? `<button type="button" class="icon-btn admin-toggle-btn" data-nombre="${escapeHtml(nombre)}" aria-label="${esAdminColab ? "Quitar admin" : "Hacer admin"}" title="${esAdminColab ? "Quitar admin" : "Hacer admin"}">${esAdminColab ? "🛡️" : "🔓"}</button>`
        : "";
      const removeBtn = esAdmin
        ? `<button type="button" class="icon-btn danger colaborador-remove-btn" data-nombre="${escapeHtml(nombre)}" aria-label="Quitar empleado">🗑️</button>`
        : "";
      row.innerHTML = `<span class="socio-dot" style="background:${NEUTRAL_VAR}"></span> ${escapeHtml(nombre)} ${badge}<span style="margin-left:auto;display:flex;gap:4px;">${adminToggleBtn}${removeBtn}</span>`;
      colabWrap.appendChild(row);
    });
  } else {
    colabEmpty.classList.remove("hidden");
  }
  $("#admin-add-colaborador-wrap").classList.toggle("hidden", !esAdmin);
  $("#ajustes-clave-maestra-card").classList.toggle("hidden", !esAdmin);

  $("#ajustes-conn-status").textContent = auth && auth.currentUser
    ? "✅ Conectado — los gastos se sincronizan entre todos los celulares."
    : "⚠️ No conectado.";

  // Con un solo dueño (socios.length === 1) el "balance entre socios" es
  // siempre trivial (100% para esa única persona) — no aporta nada, se oculta.
  $('.tabbtn[data-tab="balance"]').classList.toggle("hidden", socios.length <= 1);
}

// Alta/baja de empleados directo desde Ajustes — a diferencia de los
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
    await fbSdk.updateDoc(fbSdk.doc(db, "config", "socios"), {
      colaboradores: fbSdk.arrayUnion(nombre)
    });
    input.value = "";
    showToast("Empleado agregado ✅");
  } catch (e) {
    console.error(e);
    showToast("No se pudo agregar. Revisá tu conexión.");
  }
}

async function quitarColaborador(nombre) {
  if (!confirm(`¿Quitar a ${nombre}? Los gastos que ya cargó quedan igual.`)) return;
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "config", "socios"), {
      colaboradores: fbSdk.arrayRemove(nombre)
    });
    showToast("Empleado quitado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo quitar. Revisá tu conexión.");
  }
}

// Hacer/sacar admin a un empleado (no cambia si entra o no al reparto —
// eso depende solo de estar en "socios", no en "admins"). Sirve para dar
// permisos de editar/borrar a alguien sin sumarlo al cálculo de Balance
// (ej. otro dueño que se agrega como empleado a propósito).
async function toggleAdminColaborador(nombre) {
  const yaEsAdmin = admins.includes(nombre);
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "config", "socios"), {
      admins: yaEsAdmin ? fbSdk.arrayRemove(nombre) : fbSdk.arrayUnion(nombre)
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
    await fbSdk.updateDoc(fbSdk.doc(db, "config", "socios"), { claveMaestraAdmin: nueva });
    claveMaestraAdmin = nueva;
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

// ---------- Exportar datos (CSV) ----------
function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
  // BOM al principio para que Excel detecte UTF-8 y no rompa los acentos.
  const BOM = String.fromCharCode(0xFEFF);
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportGastosCSV() {
  const rows = [["Fecha", "Categoría", "Descripción", "Importe", "Pagado por", "Forma de pago", "Efectivo", "Digital", "Nota"]];
  gastosDelNegocio()
    .slice()
    .sort((a, b) => fechaDeRegistro(a) - fechaDeRegistro(b))
    .forEach(g => {
      rows.push([
        fechaDeRegistro(g).toLocaleDateString("es-AR"),
        g.categoria || "Otros",
        g.descripcion || "",
        Number(g.importe) || 0,
        g.pagadoPor || "",
        g.formaPago || "efectivo",
        g.formaPago === "mixto" ? Number(g.montoEfectivo) || 0 : "",
        g.formaPago === "mixto" ? Number(g.montoDigital) || 0 : "",
        g.nota || ""
      ]);
    });
  downloadCSV(`gastos-${negocioActual}-${fechaLocalISO(new Date())}.csv`, rows);
}

function exportFacturacionCSV() {
  const rows = [["Fecha", "Importe", "Registrado por"]];
  facturacionesDelNegocio()
    .slice()
    .sort((a, b) => fechaDeRegistro(a) - fechaDeRegistro(b))
    .forEach(f => {
      rows.push([
        fechaDeRegistro(f).toLocaleDateString("es-AR"),
        Number(f.importe) || 0,
        f.registradoPor || ""
      ]);
    });
  downloadCSV(`facturacion-${negocioActual}-${fechaLocalISO(new Date())}.csv`, rows);
}

function setDefaultFecha() {
  const el = $("#input-fecha");
  const today = new Date();
  el.value = fechaLocalISO(today);
}

// ---------- Modal: agregar gasto ----------
// Si Storage no responde (bucket no activado, reglas, red que ni siquiera
// llega a fallar), uploadBytes/getDownloadURL pueden quedar la promesa
// colgada para siempre — el botón "Subiendo foto…" no volvía nunca y no
// había forma de reintentar. Este timeout garantiza que siempre termine.
function conTimeout(promise, ms, mensajeTimeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensajeTimeout)), ms))
  ]);
}

function resetFotoField() {
  selectedFotoBlob = null;
  $("#input-foto").value = "";
  $("#foto-preview-wrap").classList.add("hidden");
  $("#foto-btns-row").classList.remove("hidden");
}

// Sin argumento: alta de un gasto nuevo. Con un gasto existente: edición
// (solo accesible para el admin, ver botón ✏️ en renderGastos).
// Forma de pago del gasto: Efectivo, Digital, o Mixto. Solo Mixto muestra
// el desglose Efectivo/Digital, que debe sumar el Importe total.
function selectFormaPago(forma) {
  selectedFormaPago = forma;
  $$("#forma-pago-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.forma === forma));
  $("#campo-mixto").classList.toggle("hidden", forma !== "mixto");
  if (forma !== "mixto") mixtoUltimoEditado = null;
}

// Cálculo cruzado del desglose Mixto: al tipear en Efectivo o Digital, el
// otro se completa solo para que sume el Importe (mismo criterio que el
// desglose Total/Efectivo/Digital de Facturado en GESTIONEGOCIOS, pero acá
// el "total" ya es el campo Importe que está siempre visible arriba).
function registrarEdicionMixto(campo) {
  mixtoUltimoEditado = campo;
  calcularCampoMixtoFaltante();
}

function calcularCampoMixtoFaltante() {
  if (!mixtoUltimoEditado) return;
  const importe = parseFloat($("#input-importe").value);
  if (!Number.isFinite(importe)) return;
  if (mixtoUltimoEditado === "efectivo") {
    const efectivo = parseFloat($("#input-mixto-efectivo").value);
    if (!Number.isFinite(efectivo)) return;
    $("#input-mixto-digital").value = Math.round((importe - efectivo) * 100) / 100;
  } else {
    const digital = parseFloat($("#input-mixto-digital").value);
    if (!Number.isFinite(digital)) return;
    $("#input-mixto-efectivo").value = Math.round((importe - digital) * 100) / 100;
  }
}

function openModal(gasto) {
  editingGastoId = gasto ? gasto.id : null;
  // Un gasto nuevo queda a nombre de quien está identificado en este
  // celular — no hace falta preguntar, si ya se identificó al entrar. Al
  // EDITAR uno existente sí se muestra el selector, por si hay que
  // reasignarlo (ver #campo-pagador más abajo).
  selectedPagador = gasto ? gasto.pagadoPor : usuarioActual;

  $("#input-importe").value = gasto ? gasto.importe : "";
  $("#input-descripcion").value = gasto ? (gasto.descripcion || "") : "";
  $("#input-categoria").value = gasto ? (gasto.categoria || "Kiosko") : "Kiosko";
  $("#input-falta-abonar").checked = gasto ? !!gasto.faltaAbonar : false;
  $("#input-nota").value = gasto ? (gasto.nota || "") : "";

  // Gastos cargados antes de que existiera "forma de pago" no tienen el
  // campo guardado — se muestran como Efectivo por default (no se puede
  // inventar cómo se pagaron los viejos).
  mixtoUltimoEditado = null;
  $("#input-mixto-efectivo").value = gasto && gasto.montoEfectivo != null ? gasto.montoEfectivo : "";
  $("#input-mixto-digital").value = gasto && gasto.montoDigital != null ? gasto.montoDigital : "";
  selectFormaPago(gasto ? (gasto.formaPago || "efectivo") : "efectivo");

  if (gasto) {
    $("#input-fecha").value = fechaLocalISO(fechaDeRegistro(gasto));
  } else {
    setDefaultFecha();
  }
  resetFotoField(); // editar un gasto no toca su foto salvo que se elija una nueva

  $("#modal-add-title").textContent = gasto ? "Editar gasto" : "Nuevo gasto";
  $("#btn-save-add").textContent = gasto ? "Guardar cambios" : "Guardar gasto";
  $("#campo-pagador").classList.toggle("hidden", !gasto);
  $$("#pagador-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.textContent === selectedPagador));
  $("#modal-error").classList.add("hidden");
  $("#modal-add").classList.add("active");
  setTimeout(() => $("#input-importe").focus(), 150);
}

function closeModal() {
  $("#modal-add").classList.remove("active");
  editingGastoId = null;
}

async function saveGasto() {
  const importe = parseFloat($("#input-importe").value);
  const descripcion = $("#input-descripcion").value.trim();
  const categoria = $("#input-categoria").value;
  const nota = $("#input-nota").value.trim();
  const fechaStr = $("#input-fecha").value;
  const errEl = $("#modal-error");

  if (!importe || importe <= 0) {
    errEl.textContent = "Ingresá un importe válido.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!descripcion) {
    errEl.textContent = "Contanos en qué se gastó.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!selectedPagador) {
    errEl.textContent = "Elegí quién pagó.";
    errEl.classList.remove("hidden");
    return;
  }

  let montoEfectivo = null, montoDigital = null;
  if (selectedFormaPago === "mixto") {
    montoEfectivo = parseFloat($("#input-mixto-efectivo").value);
    montoDigital = parseFloat($("#input-mixto-digital").value);
    if (!Number.isFinite(montoEfectivo) || !Number.isFinite(montoDigital) || montoEfectivo < 0 || montoDigital < 0) {
      errEl.textContent = "Completá el desglose Efectivo y Digital.";
      errEl.classList.remove("hidden");
      return;
    }
    if (Math.abs((montoEfectivo + montoDigital) - importe) > 0.01) {
      errEl.textContent = "Efectivo + Digital debe sumar el Importe total.";
      errEl.classList.remove("hidden");
      return;
    }
  }

  const btn = $("#btn-save-add");
  const isEdit = !!editingGastoId;
  btn.disabled = true;
  btn.textContent = selectedFotoBlob ? "Subiendo foto…" : "Guardando…";

  try {
    let fotoUrl = null, fotoPath = null, fotoFallo = false;
    if (selectedFotoBlob) {
      // Si la subida falla o tarda demasiado, no bloqueamos el gasto entero
      // por eso — se guarda igual sin la foto y se avisa con el toast de
      // abajo. Mejor un gasto sin foto que un gasto perdido.
      try {
        fotoPath = `recibos/${negocioActual}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const storageRef = fbSdk.ref(storage, fotoPath);
        const TIMEOUT_MSG = "La subida de la foto tardó demasiado.";
        await conTimeout(
          fbSdk.uploadBytes(storageRef, selectedFotoBlob, { contentType: "image/jpeg" }),
          25000,
          TIMEOUT_MSG
        );
        fotoUrl = await conTimeout(fbSdk.getDownloadURL(storageRef), 15000, TIMEOUT_MSG);
      } catch (fotoErr) {
        console.error("No se pudo subir la foto, se guarda el gasto sin ella:", fotoErr);
        fotoFallo = true;
        fotoPath = null;
      }
      btn.textContent = "Guardando…";
    }

    const gastoData = {
      importe,
      descripcion,
      categoria,
      nota,
      pagadoPor: selectedPagador,
      negocio: negocioActual,
      faltaAbonar: $("#input-falta-abonar").checked,
      fecha: fechaStr ? new Date(fechaStr + "T12:00:00") : fbSdk.serverTimestamp(),
      formaPago: selectedFormaPago
    };
    // Solo se tocan fotoUrl/fotoPath si se eligió una foto nueva — al editar,
    // updateDoc no toca los campos que no se le pasan, así que la foto
    // existente queda intacta si no se cambia.
    if (fotoUrl) {
      gastoData.fotoUrl = fotoUrl;
      gastoData.fotoPath = fotoPath;
    }
    // montoEfectivo/montoDigital solo existen si es Mixto — si se edita un
    // gasto y se cambia a Efectivo/Digital "puro", hay que borrar el
    // desglose viejo explícitamente (updateDoc no toca campos que no se
    // le pasan, así que quedaría un desglose stale sin esto).
    if (selectedFormaPago === "mixto") {
      gastoData.montoEfectivo = montoEfectivo;
      gastoData.montoDigital = montoDigital;
    } else if (isEdit) {
      gastoData.montoEfectivo = fbSdk.deleteField();
      gastoData.montoDigital = fbSdk.deleteField();
    }

    if (isEdit) {
      await fbSdk.updateDoc(fbSdk.doc(db, "gastos", editingGastoId), gastoData);
    } else {
      gastoData.creadoEn = fbSdk.serverTimestamp();
      await fbSdk.addDoc(fbSdk.collection(db, "gastos"), gastoData);
    }
    closeModal();
    if (fotoFallo) {
      showToast(isEdit ? "Gasto actualizado, pero no se pudo subir la foto ⚠️" : "Gasto guardado sin la foto (no se pudo subir) ⚠️");
    } else {
      showToast(isEdit ? "Gasto actualizado ✅" : "Gasto guardado ✅");
    }
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Guardar cambios" : "Guardar gasto";
  }
}

// Solo accesible desde el botón 🗑️ (esAdmin). Borra también la foto en
// Storage si tenía una — el gasto en Firestore se elimina por completo
// (a diferencia de limpiarFotosVencidas, que solo borra la foto).
async function deleteGasto(id) {
  if (!confirm("¿Borrar este gasto? No se puede deshacer.")) return;
  const gasto = gastos.find(g => g.id === id);
  try {
    if (gasto && gasto.fotoPath) {
      try {
        await fbSdk.deleteObject(fbSdk.ref(storage, gasto.fotoPath));
      } catch (e) {
        console.warn("No se pudo borrar la foto del gasto:", e.message);
      }
    }
    await fbSdk.deleteDoc(fbSdk.doc(db, "gastos", id));
    showToast("Gasto borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

// Tocar el aviso "⚠️ Falta abonar" en la lista lo marca como pagado
// directo, sin pasar por el modal de Editar.
async function marcarAbonado(id) {
  try {
    await fbSdk.updateDoc(fbSdk.doc(db, "gastos", id), { faltaAbonar: false });
    showToast("Gasto marcado como pagado ✅");
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// ---------- Modal: agregar cierre de Facturado ----------

// Fecha "natural" (de calendario) de un turno, para proponerla por
// defecto. Noche es especial porque cruza la medianoche: si todavía no
// arrancó la Noche de HOY, el turno Noche más reciente es el de ANOCHE
// (arrancó ayer) — recién a partir de esa hora pasa a ser el de esta
// noche. Sin este ajuste, cerrar el turno Noche después de medianoche
// quedaba fechado al día (y a veces al MES) siguiente, en vez del día en
// que realmente arrancó. La Noche arranca a las 22hs, salvo los domingos
// que arranca a las 18hs (ver esDiaDomingo / turnoActual).
function fechaParaTurno(turno) {
  const hoy = new Date();
  const inicioNoche = esDiaDomingo(hoy) ? 18 : 22;
  if (turno === "noche" && hoy.getHours() < inicioNoche) {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    return ayer;
  }
  return hoy;
}

function setDefaultFechaFact() {
  $("#input-fecha-fact").value = fechaLocalISO(fechaParaTurno(turnoActual()));
}

// Oculta el chip "Tarde" cuando la fecha del cierre cae domingo (ver
// esDiaDomingo / turnoActual): ese día no existe ese turno, son 2 de 12hs
// en vez de 3. Si el turno ya elegido era "Tarde" y la fecha pasa a ser
// domingo, se limpia la selección para forzar a elegir de nuevo entre
// Mañana/Noche. Se llama al abrir el modal y cada vez que se cambia la
// fecha a mano.
function actualizarChipsTurnoPorFecha() {
  const fechaStr = $("#input-fecha-fact").value;
  const fecha = fechaStr ? new Date(fechaStr + "T12:00:00") : new Date();
  const domingo = esDiaDomingo(fecha);
  $('#turno-options .pagador-chip[data-turno="tarde"]').classList.toggle("hidden", domingo);
  $('#turno-options .pagador-chip[data-turno="mañana"]').textContent = turnoLabelParaFecha(fecha, "mañana");
  $('#turno-options .pagador-chip[data-turno="noche"]').textContent = turnoLabelParaFecha(fecha, "noche");
  if (domingo && selectedTurno === "tarde") {
    selectedTurno = null;
  }
  $$("#turno-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.turno === selectedTurno));
}

// Sin argumento: alta de un cierre nuevo (usa el turno/fecha "actuales").
// Con un cierre existente: edición (solo admin, ver botón ✏️ en
// renderFacturado). Con "preset" ({fecha, turno}): alta de un cierre para
// una caja marcada como faltante — ver botón "Cargar" en
// renderCierreFaltante, cualquiera puede usarlo en cualquier momento.
// Cálculo cruzado Total/Efectivo/Digital: se pueden completar 2
// cualquiera de los 3 campos y el que falta se calcula solo (mismo
// patrón que GESTIONEGOCIOS). facturadoUltimosEditados guarda, en
// orden, los últimos 2 campos que se tipearon A MANO (no los que ya se
// autocompletaron) — con esos 2 se sabe cuál es el tercero a calcular.
// Se reinicia cada vez que se abre el modal (ver openModalFacturado()).
let facturadoUltimosEditados = [];

const FACTURADO_CAMPO_ID = {
  total: "input-importe-fact",
  efectivo: "input-efectivo-fact",
  digital: "input-digital-fact",
};

function registrarEdicionManualFacturado(campo) {
  facturadoUltimosEditados = facturadoUltimosEditados.filter(c => c !== campo);
  facturadoUltimosEditados.push(campo);
  if (facturadoUltimosEditados.length > 2) facturadoUltimosEditados.shift();
  calcularCampoFaltanteFacturado();
}

function calcularCampoFaltanteFacturado() {
  if (facturadoUltimosEditados.length < 2) return; // todavía no hay 2 campos como para deducir el tercero
  const valores = {
    total: parseFloat($("#input-importe-fact").value),
    efectivo: parseFloat($("#input-efectivo-fact").value),
    digital: parseFloat($("#input-digital-fact").value),
  };
  const [a, b] = facturadoUltimosEditados;
  if (!Number.isFinite(valores[a]) || !Number.isFinite(valores[b])) return;

  const faltante = ["total", "efectivo", "digital"].find(c => c !== a && c !== b);
  const resultado = faltante === "total" ? valores.efectivo + valores.digital
    : faltante === "efectivo" ? valores.total - valores.digital
    : valores.total - valores.efectivo;

  // Se muestra el resultado tal cual, incluso si da negativo (ej.
  // pusiste más Efectivo que Total) — así se nota el error a simple
  // vista en vez de desaparecer solo; saveCierre() lo bloquea al guardar.
  $("#" + FACTURADO_CAMPO_ID[faltante]).value = Math.round(resultado * 100) / 100;
}

function openModalFacturado(cierre, preset) {
  editingCierreId = cierre ? cierre.id : null;
  // Mismo criterio que en Nuevo gasto (ver openModal): un cierre nuevo
  // queda a nombre de quien está identificado en este celular, sin
  // preguntar. Al editar uno existente sí se puede reasignar.
  selectedRegistrador = cierre ? cierre.registradoPor : usuarioActual;
  selectedTurno = cierre ? (cierre.turno || null) : (preset ? preset.turno : turnoActual());

  $("#input-importe-fact").value = cierre ? cierre.importe : "";
  // Cierres cargados ANTES de que existiera el desglose Efectivo/Digital
  // no tienen esos campos guardados — quedan en blanco para que se
  // completen de nuevo (no se puede inventar cómo se repartía antes).
  $("#input-efectivo-fact").value = cierre && cierre.efectivo != null ? cierre.efectivo : "";
  $("#input-digital-fact").value = cierre && cierre.digital != null ? cierre.digital : "";
  facturadoUltimosEditados = [];
  if (cierre) {
    $("#input-fecha-fact").value = fechaLocalISO(fechaDeRegistro(cierre));
  } else if (preset) {
    $("#input-fecha-fact").value = preset.fecha;
  } else {
    setDefaultFechaFact();
  }

  $("#modal-fact-title").textContent = cierre ? "Editar cierre" : "Nuevo cierre";
  $("#btn-save-facturado").textContent = cierre ? "Guardar cambios" : "Guardar";
  $("#campo-pagador-fact").classList.toggle("hidden", !cierre);
  $$("#pagador-options-fact .pagador-chip").forEach(c => c.classList.toggle("selected", c.textContent === selectedRegistrador));
  actualizarChipsTurnoPorFecha();
  $("#modal-fact-error").classList.add("hidden");
  $("#modal-add-facturado").classList.add("active");
  setTimeout(() => $("#input-importe-fact").focus(), 150);
}

function closeModalFacturado() {
  $("#modal-add-facturado").classList.remove("active");
  editingCierreId = null;
}

async function saveCierre() {
  const importe = parseFloat($("#input-importe-fact").value);
  const efectivo = parseFloat($("#input-efectivo-fact").value);
  const digital = parseFloat($("#input-digital-fact").value);
  const fechaStr = $("#input-fecha-fact").value;
  const errEl = $("#modal-fact-error");

  if (!importe || importe <= 0) {
    errEl.textContent = "Ingresá un importe válido.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!Number.isFinite(efectivo) || !Number.isFinite(digital) || efectivo < 0 || digital < 0) {
    errEl.textContent = "Completá Efectivo y Digital (el que falta se calcula solo con el otro y el Total).";
    errEl.classList.remove("hidden");
    return;
  }
  // Por las dudas se hayan tipeado los 3 campos a mano sin dejar que se
  // autocompletara ninguno: se valida que sumen el total antes de
  // guardar, en vez de confiar ciegamente en el cálculo cruzado.
  if (Math.abs(efectivo + digital - importe) > 0.01) {
    errEl.textContent = "Efectivo + Digital no coincide con el Total. Revisá los montos.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!selectedTurno) {
    errEl.textContent = "Elegí el turno.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!selectedRegistrador) {
    errEl.textContent = "Elegí quién lo cargó.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-facturado");
  const isEdit = !!editingCierreId;
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    const data = {
      importe,
      efectivo,
      digital,
      turno: selectedTurno,
      registradoPor: selectedRegistrador,
      negocio: negocioActual,
      fecha: fechaStr ? new Date(fechaStr + "T12:00:00") : fbSdk.serverTimestamp()
    };
    if (isEdit) {
      await fbSdk.updateDoc(fbSdk.doc(db, "facturacion", editingCierreId), data);
    } else {
      data.creadoEn = fbSdk.serverTimestamp();
      await fbSdk.addDoc(fbSdk.collection(db, "facturacion"), data);
    }
    closeModalFacturado();
    showToast(isEdit ? "Cierre actualizado ✅" : "Cierre guardado ✅");
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Guardar cambios" : "Guardar";
  }
}

// Solo accesible desde el botón 🗑️ (esAdmin).
async function deleteCierre(id) {
  if (!confirm("¿Borrar este cierre? No se puede deshacer.")) return;
  try {
    await fbSdk.deleteDoc(fbSdk.doc(db, "facturacion", id));
    showToast("Cierre borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
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
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(colaboradores));
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

    const socioDocRef = fbSdk.doc(db, "config", "socios");
    const snap = await fbSdk.getDoc(socioDocRef);

    if (snap.exists() && Array.isArray(snap.data().socios) && snap.data().socios.length > 0) {
      const data = snap.data();
      socios = data.socios;
      colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
      admins = Array.isArray(data.admins) ? data.admins : [];
      pins = data.pins && typeof data.pins === "object" ? data.pins : {};
      claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
      statusEl.textContent = "";
      await finalizeSetup(config);
    } else {
      pendingFirebaseConfig = config;
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
    const socioDocRef = fbSdk.doc(db, "config", "socios");
    socios = [ownerName];
    colaboradores = colabNames;
    admins = [ownerName]; // único dueño — siempre admin, no hace falta elegir
    pins = {};
    // Clave compartida para que los admins creen su PIN la primera vez
    // (ver openPinModal/confirmPinModal) — se puede cambiar después desde
    // Ajustes sin afectar los PIN ya creados. Importa sobre todo si más
    // adelante se suma otro admin además del dueño original.
    claveMaestraAdmin = "llavez";
    await fbSdk.setDoc(socioDocRef, { socios, colaboradores, admins, pins, claveMaestraAdmin });
    await finalizeSetup(pendingFirebaseConfig);
  } catch (e) {
    console.error(e);
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Instalación PWA ----------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $("#btn-install").classList.remove("hidden");
});
$("#btn-install")?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
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
  $("#btn-agregar-colaborador-ajustes").addEventListener("click", agregarColaboradorDesdeAjustes);
  $("#ajustes-colaboradores-list").addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".colaborador-remove-btn");
    if (removeBtn) { quitarColaborador(removeBtn.dataset.nombre); return; }
    const adminBtn = e.target.closest(".admin-toggle-btn");
    if (adminBtn) toggleAdminColaborador(adminBtn.dataset.nombre);
  });
  $("#btn-guardar-clave-maestra").addEventListener("click", guardarClaveMaestra);
  $("#btn-pin-cancel").addEventListener("click", closePinModal);
  $("#btn-pin-confirm").addEventListener("click", confirmPinModal);
  $("#modal-pin").addEventListener("click", (e) => {
    if (e.target.id === "modal-pin") closePinModal();
  });
  $("#pin-input-1").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (pinFlowMode === "create") $("#pin-input-2").focus();
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
  $("#input-mixto-efectivo").addEventListener("input", () => registrarEdicionMixto("efectivo"));
  $("#input-mixto-digital").addEventListener("input", () => registrarEdicionMixto("digital"));
  $("#input-importe").addEventListener("input", calcularCampoMixtoFaltante);
  $("#btn-gastos-mes-anterior").addEventListener("click", () => {
    gastosMesOffset--;
    renderGastos();
  });
  $("#btn-gastos-mes-siguiente").addEventListener("click", () => {
    if (gastosMesOffset >= 0) return;
    gastosMesOffset++;
    renderGastos();
  });
  $("#btn-facturado-mes-anterior").addEventListener("click", () => {
    facturadoMesOffset--;
    renderFacturado();
  });
  $("#btn-facturado-mes-siguiente").addEventListener("click", () => {
    if (facturadoMesOffset >= 0) return;
    facturadoMesOffset++;
    renderFacturado();
  });
  $("#btn-export-gastos").addEventListener("click", exportGastosCSV);
  $("#btn-export-facturacion").addEventListener("click", exportFacturacionCSV);
  $("#btn-reset").addEventListener("click", resetLocalConfig);
  $("#btn-switch-negocio").addEventListener("click", volverASeccion);
  $("#btn-back-to-seccion-fact").addEventListener("click", volverASeccion);
  $("#btn-back-to-negocio").addEventListener("click", () => showScreen("screen-negocio"));
  $("#btn-back-to-seccion-resumen").addEventListener("click", volverASeccion);
  $("#btn-mes-anterior").addEventListener("click", () => {
    resumenMesOffset--;
    renderResumen();
  });
  $("#btn-mes-siguiente").addEventListener("click", () => {
    if (resumenMesOffset >= 0) return;
    resumenMesOffset++;
    renderResumen();
  });
  $("#fab-add-facturado").addEventListener("click", () => openModalFacturado());
  $("#turno-options").addEventListener("click", (e) => {
    const chip = e.target.closest(".pagador-chip");
    if (!chip) return;
    selectedTurno = chip.dataset.turno;
    $$("#turno-options .pagador-chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    // Solo en un cierre NUEVO (no al editar uno existente): si se cambia
    // a mano el turno, la fecha propuesta se reajusta sola (ver
    // fechaParaTurno) — elegir "Noche" antes de las 22hs de hoy se
    // refiere a la noche de AYER, no a una de esta noche que ni empezó.
    if (!editingCierreId) {
      $("#input-fecha-fact").value = fechaLocalISO(fechaParaTurno(selectedTurno));
    }
  });
  // Si cambian la fecha a mano, "Tarde" se oculta/muestra según si cayó domingo.
  $("#input-fecha-fact").addEventListener("change", actualizarChipsTurnoPorFecha);
  $("#btn-cancel-add-facturado").addEventListener("click", closeModalFacturado);
  $("#btn-save-facturado").addEventListener("click", saveCierre);
  $("#modal-add-facturado").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-facturado") closeModalFacturado();
  });
  $("#input-importe-fact").addEventListener("input", () => registrarEdicionManualFacturado("total"));
  $("#input-efectivo-fact").addEventListener("input", () => registrarEdicionManualFacturado("efectivo"));
  $("#input-digital-fact").addEventListener("input", () => registrarEdicionManualFacturado("digital"));

  $("#btn-ideas-main").addEventListener("click", () => {
    seccionActual = "ideas";
    renderIdeas();
    showScreen("screen-ideas");
  });
  $("#btn-back-from-ideas").addEventListener("click", () => {
    if (seccionActual === "ideas") volverASeccion();
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
    if (seccionActual === "mantenimiento") volverASeccion();
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
    const file = e.target.files[0];
    if (!file) return;
    try {
      selectedFotoBlob = await compressImage(file);
      $("#foto-preview-img").src = URL.createObjectURL(selectedFotoBlob);
      $("#foto-preview-wrap").classList.remove("hidden");
      $("#foto-btns-row").classList.add("hidden");
    } catch (err) {
      console.error(err);
      showToast("No se pudo procesar la foto.");
    }
  });
  $("#btn-quitar-foto").addEventListener("click", resetFotoField);

  // Foto, editar y borrar de un gasto ya cargado (delegado, la lista se re-dibuja seguido)
  $("#expenses-list").addEventListener("click", (e) => {
    const fotoBtn = e.target.closest(".foto-link");
    if (fotoBtn) { window.open(fotoBtn.dataset.url, "_blank", "noopener"); return; }
    const editBtn = e.target.closest(".gasto-edit-btn");
    if (editBtn) {
      const g = gastos.find(x => x.id === editBtn.dataset.id);
      if (g) openModal(g);
      return;
    }
    const delBtn = e.target.closest(".gasto-delete-btn");
    if (delBtn) { deleteGasto(delBtn.dataset.id); return; }
    const abonarBtn = e.target.closest(".meta-falta-abonar");
    if (abonarBtn) marcarAbonado(abonarBtn.dataset.id);
  });

  // Editar y borrar de un cierre ya cargado (delegado, admin)
  $("#facturado-list").addEventListener("click", (e) => {
    const editBtn = e.target.closest(".cierre-edit-btn");
    if (editBtn) {
      const c = facturaciones.find(x => x.id === editBtn.dataset.id);
      if (c) openModalFacturado(c);
      return;
    }
    const delBtn = e.target.closest(".cierre-delete-btn");
    if (delBtn) { deleteCierre(delBtn.dataset.id); return; }
    const cargarBtn = e.target.closest(".btn-cargar-faltante");
    if (cargarBtn) openModalFacturado(null, { fecha: cargarBtn.dataset.fecha, turno: cargarBtn.dataset.turno });
  });

  // Pantalla "Fotos guardadas"
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

  if (!savedConfig) {
    showScreen("screen-setup");
    return;
  }

  if (cachedSocios) {
    try { socios = JSON.parse(cachedSocios); } catch (_) {}
  }
  if (cachedColab) {
    try { colaboradores = JSON.parse(cachedColab); } catch (_) {}
  }

  $("#loading-msg").textContent = "Cargando…";
  $("#btn-retry-boot").classList.add("hidden");
  $("#btn-reconfigure-boot").classList.add("hidden");
  showScreen("screen-loading");

  try {
    const config = JSON.parse(savedConfig);
    await connectAndBoot(config, socios, colaboradores);
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
