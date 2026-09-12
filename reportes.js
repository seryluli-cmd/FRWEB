// ============================================================
// Reportes de Mantenimiento — misma estructura que Ideas (pendientes/
// resueltos, votos, borrar solo admin), colección Firestore aparte.
// ============================================================
import { state } from "./state.js";
import { $, showToast, escapeHtml, fechaDeRegistro, setSyncOffline, votosDe } from "./utils.js";

// Misma mecánica que Ideas (ver listenIdeas), colección aparte "reportes".
export function listenReportes() {
  const q = state.fbSdk.query(state.fbSdk.collection(state.db, "reportes"), state.fbSdk.orderBy("creadoEn", "desc"));
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.reportes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportes();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

export function renderReportes() {
  const total = state.reportes.length;
  const resueltos = state.reportes.filter(r => r.estado === "resuelto");
  const pendientes = state.reportes
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
  const voteado = state.usuarioActual && votos.includes(state.usuarioActual);
  const card = document.createElement("div");
  card.className = "idea-card";
  card.dataset.id = reporte.id;
  const deleteBtn = state.esAdmin
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
export async function toggleVotoReporte(id) {
  const reporte = state.reportes.find(r => r.id === id);
  if (!reporte || !state.usuarioActual) return;
  const yaVoto = votosDe(reporte).includes(state.usuarioActual);
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "reportes", id), {
      votos: yaVoto ? state.fbSdk.arrayRemove(state.usuarioActual) : state.fbSdk.arrayUnion(state.usuarioActual)
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Cualquiera puede marcar/desmarcar un reporte como resuelto — sin admin,
// igual que toggleIdeaEstado() en Ideas.
export async function toggleReporteEstado(id) {
  const reporte = state.reportes.find(r => r.id === id);
  if (!reporte) return;
  const marcandoResuelto = reporte.estado !== "resuelto";
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "reportes", id), {
      estado: marcandoResuelto ? "resuelto" : "pendiente",
      // Queda registrado quién lo solucionó (ver reporteCard). Si se
      // reabre, se limpia — si se vuelve a resolver, se pisa con quien
      // corresponda en ese momento.
      resueltoPor: marcandoResuelto ? state.usuarioActual : state.fbSdk.deleteField()
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Solo admin (esAdmin) — ver botón 🗑️ en reporteCard().
export async function deleteReporte(id) {
  if (!confirm("¿Borrar este reporte?")) return;
  try {
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "reportes", id));
    showToast("Reporte borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

export function openModalReporte() {
  $("#input-reporte-texto").value = "";
  $("#modal-reporte-error").classList.add("hidden");
  $("#modal-add-reporte").classList.add("active");
  setTimeout(() => $("#input-reporte-texto").focus(), 150);
}

export function closeModalReporte() {
  $("#modal-add-reporte").classList.remove("active");
}

export async function saveReporte() {
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
    await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "reportes"), {
      texto,
      estado: "pendiente",
      votos: [],
      propuestoPor: state.usuarioActual,
      creadoEn: state.fbSdk.serverTimestamp()
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
