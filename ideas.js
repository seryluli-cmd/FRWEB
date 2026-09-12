// ============================================================
// Caja de IDEAS — checklist compartido de ideas de mejora del negocio.
// Cualquiera crea/vota/tilda; solo el admin borra. Toda la mecánica vive
// en checklist.js (compartida con Reportes de Mantenimiento) — acá solo
// se configura la colección, los ids del DOM y los textos puntuales.
// ============================================================
import { crearModuloChecklist } from "./checklist.js";

const mod = crearModuloChecklist({
  coleccion: "ideas",
  arrayKey: "ideas",
  estadoHecho: "concretada",
  propuestoPorLabel: "Propuesto por",
  voteAriaLabel: "Me interesa esta idea",
  deleteBtnClass: "idea-delete-btn",
  deleteAriaLabel: "Borrar idea",
  confirmBorrar: "¿Borrar esta idea?",
  toastBorrado: "Idea borrada",
  toastGuardado: "Idea guardada ✅",
  errorVacio: "Escribí la idea antes de guardar.",
  btnGuardarLabel: "Guardar idea",
  trackResueltoPor: false,
  ids: {
    empty: "#ideas-empty",
    progresoValor: "#ideas-progreso-valor",
    progresoBar: "#ideas-progreso-bar",
    pendientesEmpty: "#ideas-pendientes-empty",
    hechosWrap: "#ideas-concretadas-wrap",
    pendientesList: "#ideas-pendientes-list",
    hechosList: "#ideas-concretadas-list",
    modal: "#modal-add-idea",
    modalError: "#modal-idea-error",
    inputTexto: "#input-idea-texto",
    btnSave: "#btn-save-idea"
  }
});

export const listenIdeas = mod.listen;
export const renderIdeas = mod.render;
export const toggleVoto = mod.toggleVoto;
export const toggleIdeaEstado = mod.toggleEstado;
export const deleteIdea = mod.deleteItem;
export const openModalIdea = mod.openModal;
export const closeModalIdea = mod.closeModal;
export const saveIdea = mod.save;
