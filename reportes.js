// ============================================================
// Reportes de Mantenimiento — misma estructura que Ideas (pendientes/
// resueltos, votos, borrar solo admin), colección Firestore aparte. Toda
// la mecánica vive en checklist.js (compartida con Ideas) — acá solo se
// configura la colección, los ids del DOM y los textos puntuales.
// ============================================================
import { crearModuloChecklist } from "./checklist.js";
import { escapeHtml } from "./utils.js";

const mod = crearModuloChecklist({
  coleccion: "reportes",
  arrayKey: "reportes",
  estadoHecho: "resuelto",
  propuestoPorLabel: "Reportado por",
  voteAriaLabel: "Me interesa este reporte",
  deleteBtnClass: "reporte-delete-btn",
  deleteAriaLabel: "Borrar reporte",
  confirmBorrar: "¿Borrar este reporte?",
  toastBorrado: "Reporte borrado",
  toastGuardado: "Reporte guardado ✅",
  errorVacio: "Escribí el reporte antes de guardar.",
  btnGuardarLabel: "Guardar reporte",
  trackResueltoPor: true,
  // "Resuelto por" solo se muestra si ya está marcado como resuelto y
  // quedó guardado quién lo tildó (ver toggleEstado en checklist.js).
  lineaExtra: (item, done) => (done && item.resueltoPor)
    ? `<div class="idea-meta">Resuelto por ${escapeHtml(item.resueltoPor)}</div>`
    : "",
  ids: {
    empty: "#reportes-empty",
    progresoValor: "#reportes-progreso-valor",
    progresoBar: "#reportes-progreso-bar",
    pendientesEmpty: "#reportes-pendientes-empty",
    hechosWrap: "#reportes-resueltos-wrap",
    pendientesList: "#reportes-pendientes-list",
    hechosList: "#reportes-resueltos-list",
    modal: "#modal-add-reporte",
    modalError: "#modal-reporte-error",
    inputTexto: "#input-reporte-texto",
    btnSave: "#btn-save-reporte"
  }
});

export const listenReportes = mod.listen;
export const renderReportes = mod.render;
export const toggleVotoReporte = mod.toggleVoto;
export const toggleReporteEstado = mod.toggleEstado;
export const deleteReporte = mod.deleteItem;
export const openModalReporte = mod.openModal;
export const closeModalReporte = mod.closeModal;
export const saveReporte = mod.save;
