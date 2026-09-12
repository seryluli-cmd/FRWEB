// ============================================================
// Pantalla de configuración inicial (screen-setup) — pegar la config de
// Firebase la primera vez en un celular nuevo, o para arrancar un
// negocio distinto desde cero. Respaldo manual: en el uso normal,
// DEFAULT_FIREBASE_CONFIG ya conecta solo (ver attemptReconnect en app.js).
// ============================================================
import { state, LS_CONFIG_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE } from "./state.js";
import { $, $$, escapeHtml, parseFirebaseConfig } from "./utils.js";
import { initFirebase } from "./firebase.js";

export function addColaboradorRow(value) {
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

// Guarda config + socios en este navegador y entra a la app. onBoot es
// bootApp() (app.js) pasado como callback para evitar una dependencia
// circular setup.js↔app.js — mismo patrón que connectAndBoot() en
// firebase.js.
async function finalizeSetup(config, onBoot) {
  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(state.socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(state.colaboradores));
  onBoot();
}

// PASO 1: conectar con Firebase y ver si ya hay socios cargados (por otra
// persona, en otro navegador). Si ya existen, entra directo — nadie más
// tiene que volver a escribir los nombres. Si no existen, pasa al paso 2.
export async function handleSetupConnect(onBoot) {
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
      await finalizeSetup(config, onBoot);
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
export async function handleSetupGuardar(onBoot) {
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
    await finalizeSetup(state.pendingFirebaseConfig, onBoot);
  } catch (e) {
    console.error(e);
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}
