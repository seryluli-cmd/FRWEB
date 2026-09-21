// ============================================================
// Identidad del celular (¿Quién sos? + PIN) — se pregunta una sola vez
// por celular y se recuerda en localStorage hasta "Cambiar de usuario"
// en Ajustes. OJO: esto NO es una capa de seguridad real — cualquier
// dispositivo con la config de Firebase ya puede leer/escribir todo en
// Firestore. Sirve solo para identificar quién usa cada celular y
// mostrar los botones de admin.
// ============================================================
import { state, LS_USER_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE, CATEGORIAS_GASTOS_DEFAULT, NEGOCIOS } from "./state.js";
import { $, escapeHtml, showScreen, socioInitial, setSyncOffline } from "./utils.js";
import { allPagadores, payerColorVar } from "./identidad.js";
import { normalizarCategoriasGastos } from "./firebase.js";
import { selectNegocio } from "./navegacion.js";
import { registrarLogin, renderAjustesSocios } from "./ajustes.js";
import { renderGastos, renderGastosAdmin } from "./gastos.js";
import { renderFacturado, renderPagadorChipsFacturado } from "./facturado.js";
import { renderIdeas } from "./ideas.js";
import { renderBalance } from "./resumen.js";
import { renderPagadorChips } from "./gastos.js";

export function resumeSession() {
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

export function setUsuarioActual(nombre) {
  state.usuarioActual = nombre;
  state.esAdmin = state.admins.includes(nombre);
  localStorage.setItem(LS_USER_KEY, nombre);
  registrarLogin(nombre);
  renderAjustesSocios();
  renderGastos();
  renderFacturado();
  renderIdeas();
}

export function cambiarUsuario() {
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

export function closePinModal() {
  $("#modal-pin").classList.remove("active");
  state.pinFlowNombre = null;
}

export async function confirmPinModal() {
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

// Sincroniza en tiempo real config/socios (socios, colaboradores, admins,
// pins, categorías de gasto) y refresca todas las pantallas que dependen
// de esos datos — se llama una sola vez al bootear (ver bootApp en
// app.js).
export function listenSocios() {
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

export function listenConnectivity() {
  const update = () => setSyncOffline(!navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}
