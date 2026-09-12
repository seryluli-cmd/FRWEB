// ============================================================
// Ajustes — socios/colaboradores/admins, categorías de gasto, clave
// maestra, tema, historial de logeos, y "Desconectar este celular".
// ============================================================
import { state, LS_CONFIG_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE, LS_THEME_KEY } from "./state.js";
import { $, $$, showToast, escapeHtml, socioColorVar } from "./utils.js";
import { allPagadores, payerColorVar } from "./identidad.js";

// Historial de logeos: cuenta cuántas veces se identificó cada persona
// (tanto al tipear el PIN de nuevo como cuando el celular ya la recordaba
// — setUsuarioActual() en app.js es el único lugar por el que pasa
// cualquiera de las dos formas). Solo Sergio puede VER el resultado (ver
// renderAjustesSocios) pero se cuenta para todos por igual. Un doc por
// persona con un contador atómico, en vez de un doc por logeo, para no
// acumular una colección sin límite ni tener que leer miles de docs para
// mostrar un simple conteo.
export async function registrarLogin(nombre) {
  try {
    await state.fbSdk.setDoc(state.fbSdk.doc(state.db, "logins", nombre), { veces: state.fbSdk.increment(1) }, { merge: true });
  } catch (e) {
    console.error("No se pudo registrar el logeo:", e);
  }
}

export async function cargarHistorialLogins() {
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

export function renderAjustesSocios() {
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

export async function agregarCategoriaDesdeAjustes() {
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
export async function quitarCategoria(nombre) {
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
export async function agregarColaboradorDesdeAjustes() {
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

export async function quitarColaborador(nombre) {
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
export async function toggleAdminColaborador(nombre) {
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
export async function guardarClaveMaestra() {
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
export function seleccionarTema(tema) {
  localStorage.setItem(LS_THEME_KEY, tema);
  if (tema === "light" || tema === "dark") {
    document.documentElement.setAttribute("data-theme", tema);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  renderAjustesTema();
}

export function renderAjustesTema() {
  const tema = localStorage.getItem(LS_THEME_KEY) || "auto";
  $$("#tema-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.tema === tema));
}

// ---------- Reset ----------
export function resetLocalConfig() {
  if (!confirm("¿Desconectar este celular? No se borran los gastos.")) return;
  localStorage.removeItem(LS_CONFIG_KEY);
  localStorage.removeItem(LS_SOCIOS_CACHE);
  localStorage.removeItem(LS_COLAB_CACHE);
  location.reload();
}
