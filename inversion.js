// ============================================================
// Inversión Recuperada — pantalla exclusiva para el inversor (ver
// puedeVerInversion/puedeCargarInversion en identidad.js).
// ============================================================
import { state, INVERSION_META } from "./state.js";
import { $, showToast, escapeHtml, money, parseMoneyInput, socioInitial, setSyncOffline } from "./utils.js";
import { payerColorVar, puedeCargarInversion } from "./identidad.js";

// Misma mecánica que Ideas (ver listenIdeas), colección aparte "inversion".
// Se sincroniza para cualquiera igual que el resto de las colecciones (ver
// README: no hay reglas de Firestore reales) — lo que restringe el acceso
// es solo que la tarjeta/pantalla no aparecen salvo para Sergio y Pola
// (ver puedeVerInversion).
export function listenInversion() {
  const q = state.fbSdk.query(state.fbSdk.collection(state.db, "inversion"), state.fbSdk.orderBy("creadoEn", "desc"));
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.inversiones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInversion();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// Cada doc nuevo de "inversion" es UN retiro suelto ({tipo: "retiro", monto})
// y "lo recuperado hasta ahora" es la suma de todos. Los docs viejos (sin
// `tipo`) guardaban el TOTAL acumulado a su fecha, no un retiro: el más
// reciente de ellos entra como base y los retiros nuevos se suman encima,
// así los datos que ya hay en Firestore siguen dando el mismo total sin
// migrarlos. Los más nuevos van primero (ver listenInversion), por eso
// `find` devuelve el último total viejo.
const TIPO_RETIRO = "retiro";

function esRetiro(inv) {
  return inv.tipo === TIPO_RETIRO;
}

function inversionActual() {
  const base = state.inversiones.find(inv => !esRetiro(inv));
  const retirado = state.inversiones.filter(esRetiro).reduce((suma, inv) => suma + (Number(inv.monto) || 0), 0);
  return (base ? Number(base.monto) || 0 : 0) + retirado;
}

// Los docs de "inversion" guardan la hora en `creadoEn`, no en `fecha`
// (que es lo que lee fechaDeRegistro de utils.js), así que acá se lee a mano.
// Mientras el servidor no confirma, serverTimestamp() llega en null: se usa
// la hora actual hasta que llegue la real.
function fechaDeInversion(inv) {
  return inv.creadoEn && inv.creadoEn.toDate ? inv.creadoEn.toDate() : new Date(inv.creadoEn || Date.now());
}

export function renderInversion() {
  const actual = inversionActual();
  $("#inversion-actual").textContent = money(actual);
  $("#inversion-meta-sub").textContent = `de ${money(INVERSION_META)} a recuperar`;
  const pct = INVERSION_META ? Math.min(100, Math.round((actual / INVERSION_META) * 100)) : 0;
  $("#inversion-bar").style.width = pct + "%";

  $("#fab-add-inversion").classList.toggle("hidden", !puedeCargarInversion());

  const list = $("#inversion-list");
  const empty = $("#inversion-empty");
  list.innerHTML = "";
  empty.classList.toggle("hidden", state.inversiones.length > 0);

  state.inversiones.forEach(inv => {
    const fecha = fechaDeInversion(inv);
    const deleteBtn = puedeCargarInversion()
      ? `<button type="button" class="icon-btn danger inversion-delete-btn" data-id="${inv.id}" aria-label="Borrar este retiro">🗑️</button>`
      : "";
    // Los registros viejos son totales, no retiros: se rotulan distinto para
    // que no se lean como algo que se suma (ver inversionActual).
    const desc = esRetiro(inv)
      ? `${escapeHtml(inv.registradoPor || "?")} retiró ${money(inv.monto)}`
      : `Total anterior: ${money(inv.monto)}`;
    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `
      <div class="expense-item-top">
        <div class="avatar" style="background:${payerColorVar(inv.registradoPor)}">${socioInitial(inv.registradoPor)}</div>
        <div class="info">
          <div class="desc">${desc}</div>
          <div class="meta">${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })} · ${fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</div>
        </div>
      </div>
      ${deleteBtn ? `<div class="expense-item-actions">${deleteBtn}</div>` : ""}
    `;
    list.appendChild(li);
  });
}

export function openModalInversion() {
  $("#input-monto-inversion").value = "";
  $("#modal-inversion-error").classList.add("hidden");
  $("#modal-add-inversion").classList.add("active");
  setTimeout(() => $("#input-monto-inversion").focus(), 150);
}

export function closeModalInversion() {
  $("#modal-add-inversion").classList.remove("active");
}

export async function saveInversion() {
  const monto = parseMoneyInput($("#input-monto-inversion").value);
  const errEl = $("#modal-inversion-error");
  if (!Number.isFinite(monto) || monto <= 0) {
    errEl.textContent = "Ingresá un monto válido.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-inversion");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "inversion"), {
      tipo: TIPO_RETIRO,
      monto,
      registradoPor: state.usuarioActual,
      creadoEn: state.fbSdk.serverTimestamp()
    });
    closeModalInversion();
    showToast("Retiro guardado ✅");
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// Solo Sergio (puedeCargarInversion) — ver botón 🗑️ en renderInversion().
export async function deleteInversion(id) {
  if (!confirm("¿Borrar este retiro del historial? El total recuperado se recalcula.")) return;
  try {
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "inversion", id));
    showToast("Retiro borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}
