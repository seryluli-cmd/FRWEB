// ============================================================
// Fábrica compartida por Caja de IDEAS y Reportes de Mantenimiento — son
// la misma mecánica (pendientes ordenados por votos, tildar hecho, votar,
// borrar solo admin) sobre dos colecciones de Firestore separadas y sin
// relación entre sí. En vez de mantener esa lógica duplicada en ideas.js
// y reportes.js, cada uno arma acá un módulo con su propia configuración
// (colección, ids del DOM, textos) — ver esos dos archivos.
// ============================================================
import { state } from "./state.js";
import { $, showToast, escapeHtml, fechaDeRegistro, setSyncOffline, votosDe } from "./utils.js";

export function crearModuloChecklist(cfg) {
  function items() {
    return state[cfg.arrayKey];
  }

  function listen() {
    const q = state.fbSdk.query(state.fbSdk.collection(state.db, cfg.coleccion), state.fbSdk.orderBy("creadoEn", "desc"));
    state.fbSdk.onSnapshot(q, (snapshot) => {
      state[cfg.arrayKey] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
      setSyncOffline(false);
    }, (err) => {
      console.error(err);
      setSyncOffline(true);
    });
  }

  function card(item) {
    const done = item.estado === cfg.estadoHecho;
    const fecha = fechaDeRegistro(item);
    const votos = votosDe(item);
    const voteado = state.usuarioActual && votos.includes(state.usuarioActual);
    const el = document.createElement("div");
    el.className = "idea-card";
    el.dataset.id = item.id;
    const deleteBtn = state.esAdmin
      ? `<button type="button" class="icon-btn danger ${cfg.deleteBtnClass}" data-id="${item.id}" aria-label="${cfg.deleteAriaLabel}">🗑️</button>`
      : "";
    // Reportes agrega acá "Resuelto por X" cuando corresponde (ver
    // reportes.js) — Ideas no usa esto.
    const lineaExtra = cfg.lineaExtra ? cfg.lineaExtra(item, done) : "";
    el.innerHTML = `
      <div class="idea-check ${done ? "checked" : ""}">${done ? "✓" : ""}</div>
      <div class="idea-info">
        <div class="idea-texto ${done ? "done" : ""}">${escapeHtml(item.texto)}</div>
        <div class="idea-meta">${cfg.propuestoPorLabel} ${escapeHtml(item.propuestoPor || "?")} · ${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</div>
        ${lineaExtra}
      </div>
      <button type="button" class="idea-vote-btn ${voteado ? "voted" : ""}" data-id="${item.id}" aria-label="${cfg.voteAriaLabel}">🔥 ${votos.length}</button>
      ${deleteBtn}
    `;
    return el;
  }

  function render() {
    const total = items().length;
    const hechos = items().filter(i => i.estado === cfg.estadoHecho);
    // Pendientes ordenados por votos — así se ve de un vistazo qué le
    // interesa más al equipo, sin que nadie tenga que decidir solo.
    const pendientes = items()
      .filter(i => i.estado !== cfg.estadoHecho)
      .slice()
      .sort((a, b) => votosDe(b).length - votosDe(a).length);

    $(cfg.ids.empty).classList.toggle("hidden", total > 0);

    $(cfg.ids.progresoValor).textContent = `${hechos.length} de ${total}`;
    const pct = total ? Math.round((hechos.length / total) * 100) : 0;
    $(cfg.ids.progresoBar).style.width = pct + "%";

    $(cfg.ids.pendientesEmpty).classList.toggle("hidden", pendientes.length > 0 || total === 0);
    $(cfg.ids.hechosWrap).classList.toggle("hidden", hechos.length === 0);

    const pendientesEl = $(cfg.ids.pendientesList);
    pendientesEl.innerHTML = "";
    pendientes.forEach(i => pendientesEl.appendChild(card(i)));

    const hechosEl = $(cfg.ids.hechosList);
    hechosEl.innerHTML = "";
    hechos.forEach(i => hechosEl.appendChild(card(i)));
  }

  // Cualquiera puede votar/desvotar un item pendiente (no admin) — así se
  // ve qué le importa más al equipo sin que nadie tenga que decidir por otro.
  async function toggleVoto(id) {
    const item = items().find(i => i.id === id);
    if (!item || !state.usuarioActual) return;
    const yaVoto = votosDe(item).includes(state.usuarioActual);
    try {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, cfg.coleccion, id), {
        votos: yaVoto ? state.fbSdk.arrayRemove(state.usuarioActual) : state.fbSdk.arrayUnion(state.usuarioActual)
      });
    } catch (e) {
      console.error(e);
      showToast("No se pudo actualizar. Revisá tu conexión.");
    }
  }

  // Cualquiera puede marcar/desmarcar un item como hecho — sin admin, para
  // que sea tan liviano como tildar un check en una lista de tareas.
  async function toggleEstado(id) {
    const item = items().find(i => i.id === id);
    if (!item) return;
    const marcandoHecho = item.estado !== cfg.estadoHecho;
    const data = { estado: marcandoHecho ? cfg.estadoHecho : "pendiente" };
    if (cfg.trackResueltoPor) {
      // Queda registrado quién lo solucionó (ver reportes.js). Si se
      // reabre, se limpia — si se vuelve a resolver, se pisa con quien
      // corresponda en ese momento.
      data.resueltoPor = marcandoHecho ? state.usuarioActual : state.fbSdk.deleteField();
    }
    try {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, cfg.coleccion, id), data);
    } catch (e) {
      console.error(e);
      showToast("No se pudo actualizar. Revisá tu conexión.");
    }
  }

  // Solo admin (esAdmin) — ver botón 🗑️ en card().
  async function deleteItem(id) {
    if (!confirm(cfg.confirmBorrar)) return;
    try {
      await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, cfg.coleccion, id));
      showToast(cfg.toastBorrado);
    } catch (e) {
      console.error(e);
      showToast("No se pudo borrar. Revisá tu conexión.");
    }
  }

  function openModal() {
    $(cfg.ids.inputTexto).value = "";
    $(cfg.ids.modalError).classList.add("hidden");
    $(cfg.ids.modal).classList.add("active");
    setTimeout(() => $(cfg.ids.inputTexto).focus(), 150);
  }

  function closeModal() {
    $(cfg.ids.modal).classList.remove("active");
  }

  async function save() {
    const texto = $(cfg.ids.inputTexto).value.trim();
    const errEl = $(cfg.ids.modalError);
    if (!texto) {
      errEl.textContent = cfg.errorVacio;
      errEl.classList.remove("hidden");
      return;
    }

    const btn = $(cfg.ids.btnSave);
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      await state.fbSdk.addDoc(state.fbSdk.collection(state.db, cfg.coleccion), {
        texto,
        estado: "pendiente",
        votos: [],
        propuestoPor: state.usuarioActual,
        creadoEn: state.fbSdk.serverTimestamp()
      });
      closeModal();
      showToast(cfg.toastGuardado);
    } catch (e) {
      errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
      errEl.classList.remove("hidden");
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = cfg.btnGuardarLabel;
    }
  }

  return { listen, render, toggleVoto, toggleEstado, deleteItem, openModal, closeModal, save };
}
