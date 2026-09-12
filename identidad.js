// ============================================================
// Identidad / permisos compartidos entre pantallas — quién es cada
// "pagador" (socio o colaborador) y su color, y permisos puntuales por
// nombre exacto (Inversión Recuperada). No incluye todavía el flujo de
// login (¿Quién sos? + PIN) — eso sigue en app.js por ahora.
// ============================================================
import { state, NEUTRAL_VAR } from "./state.js";
import { socioColorVar, colorDesdeNombre } from "./utils.js";

export function allPagadores() {
  return state.socios.concat(state.colaboradores);
}

// Color de identidad para cualquier "pagador": el dueño tiene su color
// categórico propio (el de siempre); cada colaborador tiene su propio
// color estable derivado de su nombre, para distinguirlos a simple vista
// igual que al dueño.
export function payerColorVar(name) {
  const idx = state.socios.indexOf(name);
  if (idx !== -1) return socioColorVar(idx);
  if (state.colaboradores.indexOf(name) !== -1) return colorDesdeNombre(name);
  return NEUTRAL_VAR;
}

// "Inversión Recuperada": pantalla de uso exclusivo para el inversor.
// Solo Sergio y Pola pueden ENTRAR (puedeVerInversion controla si aparece
// la tarjeta en screen-seccion); de esos dos, solo Sergio puede CARGAR
// actualizaciones y borrar (puedeCargarInversion controla el botón + y el
// 🗑️ del historial) — Pola solo mira. Comparación directa por nombre,
// mismo patrón que "esSergio" en renderAjustesSocios (ver historial de
// logeos) — no depende de esAdmin porque un colaborador podría llegar a
// ser admin (ver admin-toggle-btn) sin que eso deba darle acceso acá.
export function puedeVerInversion() {
  return state.usuarioActual === "Sergio" || state.usuarioActual === "Pola";
}
export function puedeCargarInversion() {
  return state.usuarioActual === "Sergio";
}
