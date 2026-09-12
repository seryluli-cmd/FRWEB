// ============================================================
// Caja de IDEAS — checklist compartido de ideas de mejora del negocio.
// Cualquiera crea/vota/tilda; solo el admin borra.
// ============================================================
import { state } from "./state.js";
import { $, showToast, escapeHtml, fechaDeRegistro, setSyncOffline, votosDe } from "./utils.js";

// No se filtran por "negocio" (acá hay un solo negocio, no hace falta).
export function listenIdeas() {
  const q = state.fbSdk.query(state.fbSdk.collection(state.db, "ideas"), state.fbSdk.orderBy("creadoEn", "desc"));
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.ideas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderIdeas();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

export function renderIdeas() {
  const total = state.ideas.length;
  const concretadas = state.ideas.filter(i => i.estado === "concretada");
  // Pendientes ordenadas por votos — así se ve de un vistazo qué le
  // interesa más al equipo, sin que nadie tenga que decidir solo.
  const pendientes = state.ideas
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

function ideaCard(idea) {
  const done = idea.estado === "concretada";
  const fecha = fechaDeRegistro(idea);
  const votos = votosDe(idea);
  const voteado = state.usuarioActual && votos.includes(state.usuarioActual);
  const card = document.createElement("div");
  card.className = "idea-card";
  card.dataset.id = idea.id;
  const deleteBtn = state.esAdmin
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
export async function toggleVoto(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea || !state.usuarioActual) return;
  const yaVoto = votosDe(idea).includes(state.usuarioActual);
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "ideas", id), {
      votos: yaVoto ? state.fbSdk.arrayRemove(state.usuarioActual) : state.fbSdk.arrayUnion(state.usuarioActual)
    });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Cualquiera puede marcar/desmarcar una idea como concretada — sin admin,
// para que sea tan liviano como tildar un check en una lista de tareas.
export async function toggleIdeaEstado(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea) return;
  const nuevoEstado = idea.estado === "concretada" ? "pendiente" : "concretada";
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "ideas", id), { estado: nuevoEstado });
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}

// Solo admin (esAdmin) — ver botón 🗑️ en ideaCard().
export async function deleteIdea(id) {
  if (!confirm("¿Borrar esta idea?")) return;
  try {
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "ideas", id));
    showToast("Idea borrada");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

export function openModalIdea() {
  $("#input-idea-texto").value = "";
  $("#modal-idea-error").classList.add("hidden");
  $("#modal-add-idea").classList.add("active");
  setTimeout(() => $("#input-idea-texto").focus(), 150);
}

export function closeModalIdea() {
  $("#modal-add-idea").classList.remove("active");
}

export async function saveIdea() {
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
    await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "ideas"), {
      texto,
      estado: "pendiente",
      votos: [],
      propuestoPor: state.usuarioActual,
      creadoEn: state.fbSdk.serverTimestamp()
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
