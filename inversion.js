// ============================================================
// Inversión Recuperada — pantalla exclusiva para el inversor (ver
// puedeVerInversion/puedeCargarInversion en identidad.js).
// ============================================================
import { state, INVERSION_META } from "./state.js";
import { $, showToast, escapeHtml, fechaDeRegistro, money, parseMoneyInput, socioInitial, setSyncOffline } from "./utils.js";
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

// Cada doc de "inversion" guarda el TOTAL acumulado a esa fecha (no un
// incremento) — por eso "lo recuperado hasta ahora" es simplemente el
// monto del último doc (los más nuevos van primero, ver listenInversion).
function inversionActual() {
  return state.inversiones.length ? (Number(state.inversiones[0].monto) || 0) : 0;
}

// Pedido puntual de Sergio para esta pantalla: mostrar "Millones" al lado
// de cada monto (ej. "$27.000.000 Millones") — es solo un sufijo de texto
// sobre lo que ya arma money(), no una conversión de unidades.
function moneyMillones(n) {
  return money(n) + " Millones";
}

export function renderInversion() {
  const actual = inversionActual();
  $("#inversion-actual").textContent = moneyMillones(actual);
  $("#inversion-meta-sub").textContent = `de ${moneyMillones(INVERSION_META)} a recuperar`;
  const pct = INVERSION_META ? Math.min(100, Math.round((actual / INVERSION_META) * 100)) : 0;
  $("#inversion-bar").style.width = pct + "%";

  $("#fab-add-inversion").classList.toggle("hidden", !puedeCargarInversion());

  const list = $("#inversion-list");
  const empty = $("#inversion-empty");
  list.innerHTML = "";
  empty.classList.toggle("hidden", state.inversiones.length > 0);

  state.inversiones.forEach(inv => {
    const fecha = fechaDeRegistro(inv);
    const deleteBtn = puedeCargarInversion()
      ? `<button type="button" class="icon-btn danger inversion-delete-btn" data-id="${inv.id}" aria-label="Borrar esta actualización">🗑️</button>`
      : "";
    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `
      <div class="expense-item-top">
        <div class="avatar" style="background:${payerColorVar(inv.registradoPor)}">${socioInitial(inv.registradoPor)}</div>
        <div class="info">
          <div class="desc">${escapeHtml(inv.registradoPor || "?")} recuperó ${moneyMillones(inv.monto)}</div>
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
  if (!Number.isFinite(monto) || monto < 0) {
    errEl.textContent = "Ingresá un monto válido.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-inversion");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "inversion"), {
      monto,
      registradoPor: state.usuarioActual,
      creadoEn: state.fbSdk.serverTimestamp()
    });
    closeModalInversion();
    showToast("Actualización guardada ✅");
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
  if (!confirm("¿Borrar esta actualización del historial?")) return;
  try {
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "inversion", id));
    showToast("Actualización borrada");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}
