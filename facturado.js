// ============================================================
// Facturado / Cierre de Turno — carga de cajas por turno, detección de
// turnos faltantes, foto opcional del cierre, exportar CSV.
// ============================================================
import { state } from "./state.js";
import {
  $, $$, showToast, escapeHtml, fechaDeRegistro, fechaLocalISO, fechaLimiteHistorial, fechaBaseMes, mesLabel,
  money, parseMoneyInput, formatMoneyValue, socioInitial, setSyncOffline, conTimeout, downloadCSV,
  TURNOS, turnoLabelParaFecha, turnoActual, turnoVencimiento, turnosDelMes, fechaParaTurno
} from "./utils.js";
import { payerColorVar, renderPagadorChipsEn } from "./identidad.js";

export function facturacionesDelNegocio() {
  return state.facturaciones.filter(f => f.negocio === state.negocioActual);
}

// onCambio se llama después de cada snapshot con datos nuevos — hoy
// dispara renderResumen(), que vive en resumen.js (mismo patrón que
// listenGastos() en gastos.js, ver ese comentario).
export function listenFacturacion(onCambio) {
  const q = state.fbSdk.query(
    state.fbSdk.collection(state.db, "facturacion"),
    state.fbSdk.where("fecha", ">=", fechaLimiteHistorial()),
    state.fbSdk.orderBy("fecha", "desc")
  );
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.facturaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFacturado();
    if (onCambio) onCambio();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// Fila de un cierre YA cargado (id real en Firestore).
function renderCierreItem(f) {
  const fecha = fechaDeRegistro(f);
  const fotoBtn = f.fotoUrl
    ? `<button type="button" class="foto-link" data-url="${escapeHtml(f.fotoUrl)}" aria-label="Ver foto del cierre">📷</button>`
    : "";
  const adminBtns = state.esAdmin
    ? `<button type="button" class="icon-btn cierre-edit-btn" data-id="${f.id}" aria-label="Editar cierre">✏️</button>
       <button type="button" class="icon-btn danger cierre-delete-btn" data-id="${f.id}" aria-label="Borrar cierre">🗑️</button>`
    : "";
  const turnoLabel = turnoLabelParaFecha(fecha, f.turno);

  // "creadoEn" es la hora REAL en que se guardó el cierre (a diferencia
  // de "fecha", que es solo el día elegido, guardado siempre al
  // mediodía — ver saveCierre). Los cierres de antes de este cambio no
  // tienen "creadoEn", por eso el chequeo: en esos casos no se muestra
  // ninguna hora en vez de mostrar una incorrecta.
  const horaCarga = f.creadoEn && f.creadoEn.toDate
    ? f.creadoEn.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  const li = document.createElement("li");
  li.className = "expense-item";
  // Tocar la tarjeta abre el detalle del cierre (ver openDetalleCierre); los
  // botones de adentro siguen haciendo lo suyo (app.js los mira primero).
  li.dataset.cierreId = f.id;
  // Los que manda FRKiosko (el programa del mostrador) llevan una marquita:
  // esos traen el desglose completo en el detalle.
  const marcaAuto = f.origen === "frkiosko"
    ? ` <span class="cierre-auto" title="Mandado por FRKiosko">🖥️</span>`
    : "";
  // El texto (turno, quién y a qué hora) va en su propia fila arriba, con
  // todo el ancho de la tarjeta para él solo — si compartiera fila con el
  // avatar, el monto y los íconos (como antes) no entra ni la versión más
  // corta en un celular real. Avatar/monto/íconos quedan abajo, mismo
  // patrón que .expense-item-actions en Gastos.
  li.innerHTML = `
    <div class="desc">${turnoLabel ? escapeHtml(turnoLabel) + ", " : ""}${escapeHtml(f.registradoPor || "?")}${horaCarga ? " " + horaCarga + " hs" : ""} · ${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}${marcaAuto}</div>
    <div class="expense-item-top">
      <div class="avatar" style="background:${payerColorVar(f.registradoPor)}">${socioInitial(f.registradoPor)}</div>
      <div class="amount">${money(f.importe)}</div>
      ${fotoBtn}
      ${adminBtns}
    </div>
  `;
  return li;
}

// Fila de un turno del mes en curso ya vencido (ver turnosDelMesActual)
// que todavía no tiene cierre cargado. El botón "Cargar" abre el modal de
// Nuevo cierre con esa fecha y turno ya preseleccionados — cualquiera puede
// tocarlo (admin o colaborador), igual que cualquiera puede cargar un cierre
// nuevo con el +.
function renderCierreFaltante(fecha, turno) {
  const li = document.createElement("li");
  li.className = "expense-item expense-item-faltante";
  li.innerHTML = `
    <div class="expense-item-top">
      <div class="info">
        <div class="desc falta-desc">⚠️ CAJA NO CARGADA</div>
        <div class="meta">${escapeHtml(turnoLabelParaFecha(fecha, turno))} — ${fecha.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })}</div>
      </div>
      <button type="button" class="btn-secondary btn-cargar-faltante" data-fecha="${fechaLocalISO(fecha)}" data-turno="${turno}">Cargar</button>
    </div>
  `;
  return li;
}

// Antes la grilla de turnos era siempre la del mes en curso, y todo el
// historial de meses anteriores se listaba entero debajo, sin agrupar —
// con el tiempo se iba acumulando y quedaba todo mezclado. Ahora, igual
// que Gastos, se navega un mes a la vez (con flechas ‹ ›), y la grilla de
// "caja no cargada" se recalcula para el mes que se esté mirando.
export function renderFacturado() {
  const list = $("#facturado-list");
  const empty = $("#facturado-empty");
  list.innerHTML = "";

  const items = facturacionesDelNegocio();
  const now = new Date();

  // "Hoy" es siempre el día real, sin importar qué mes se esté navegando.
  let totalHoy = 0;
  const turnosHoy = new Set();
  items.forEach(f => {
    const fecha = fechaDeRegistro(f);
    if (fecha.toDateString() === now.toDateString()) {
      totalHoy += Number(f.importe) || 0;
      if (TURNOS.includes(f.turno)) turnosHoy.add(f.turno);
    }
  });

  const base = fechaBaseMes(state.facturadoMesOffset);
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#facturado-mes-label").textContent = mesLabel(base);
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-facturado-mes-siguiente").disabled = esMesActual;

  const itemsMes = items.filter(f => {
    const fecha = fechaDeRegistro(f);
    return fecha.getMonth() === targetMonth && fecha.getFullYear() === targetYear;
  });
  const totalMes = itemsMes.reduce((sum, f) => sum + (Number(f.importe) || 0), 0);

  // Mapa "año-mes-día-turno" -> cierre real, para cruzarlo contra la
  // grilla de turnos esperados del mes y saber cuáles faltan.
  const porSlot = new Map();
  itemsMes.forEach(f => {
    const fecha = fechaDeRegistro(f);
    porSlot.set(`${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}-${f.turno}`, f);
  });

  // Grilla del mes elegido: día 1 hasta hoy (o hasta fin de mes si ya
  // pasó), más reciente primero, y dentro de cada día en orden Mañana →
  // Tarde → Noche. Cada slot ya vencido sale como cierre real o faltante.
  const porDia = new Map(); // "año-mes-día" -> { fecha, turnos: [{turno, real}] }
  turnosDelMes(base).forEach(({ fecha, turno }) => {
    const diaKey = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
    if (!porDia.has(diaKey)) porDia.set(diaKey, { fecha, turnos: [] });
    porDia.get(diaKey).turnos.push({ turno, real: porSlot.get(`${diaKey}-${turno}`) || null });
  });
  const diasDelMes = Array.from(porDia.values()).sort((a, b) => b.fecha - a.fecha);

  const idsEnGrilla = new Set();
  diasDelMes.forEach(dia => dia.turnos.forEach(t => { if (t.real) idsEnGrilla.add(t.real.id); }));

  // Cierres del mes que no encajaron en la grilla (ej. turno con valor
  // no estándar por datos viejos) — se listan igual, para no perderlos.
  const restoDelMes = itemsMes
    .filter(f => !idsEnGrilla.has(f.id))
    .slice()
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a));

  diasDelMes.forEach(dia => {
    dia.turnos.forEach(({ turno, real }) => {
      if (real) {
        list.appendChild(renderCierreItem(real));
      } else if (turnoVencimiento(dia.fecha, turno) <= now) {
        list.appendChild(renderCierreFaltante(dia.fecha, turno));
      }
      // si no venció y no hay cierre real, todavía está en curso: no se muestra nada.
    });
  });
  restoDelMes.forEach(f => list.appendChild(renderCierreItem(f)));

  empty.classList.toggle("hidden", list.children.length > 0);

  $("#facturado-total-mes-wrap").classList.toggle("hidden", !state.esAdmin);
  $("#facturado-total-mes").textContent = money(totalMes);
  $("#facturado-total-hoy").textContent = money(totalHoy);
  $("#facturado-turnos-hoy").textContent = `${turnosHoy.size} de ${TURNOS.length} turnos cargados`;
}

// Chips de "¿Quién lo cargó?" en el modal de Facturado.
export function renderPagadorChipsFacturado() {
  renderPagadorChipsEn("#pagador-options-fact", (nombre) => { state.selectedRegistrador = nombre; });
}

export function exportFacturacionCSV() {
  const rows = [["Fecha", "Importe", "Registrado por"]];
  facturacionesDelNegocio()
    .slice()
    .sort((a, b) => fechaDeRegistro(a) - fechaDeRegistro(b))
    .forEach(f => {
      rows.push([
        fechaDeRegistro(f).toLocaleDateString("es-AR"),
        Number(f.importe) || 0,
        f.registradoPor || ""
      ]);
    });
  downloadCSV(`facturacion-${state.negocioActual}-${fechaLocalISO(new Date())}.csv`, rows);
}

export function resetFotoFieldFact() {
  state.selectedFotoFacturadoBlob = null;
  $("#input-foto-fact").value = "";
  $("#foto-preview-wrap-fact").classList.add("hidden");
  $("#foto-btns-row-fact").classList.remove("hidden");
}

export function setDefaultFechaFact() {
  $("#input-fecha-fact").value = fechaLocalISO(fechaParaTurno(turnoActual()));
}

// Sincroniza qué chip de turno queda marcado como seleccionado según
// selectedTurno. Se llama al abrir el modal y cada vez que se cambia la
// fecha a mano.
export function actualizarChipsTurnoPorFecha() {
  $$("#turno-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.turno === state.selectedTurno));
}

// Sin argumento: alta de un cierre nuevo (usa el turno/fecha "actuales").
// Con un cierre existente: edición (solo admin, ver botón ✏️ en
// renderFacturado). Con "preset" ({fecha, turno}): alta de un cierre para
// una caja marcada como faltante — ver botón "Cargar" en
// renderCierreFaltante, cualquiera puede usarlo en cualquier momento.
// Cálculo cruzado Total/Efectivo/Digital: se pueden completar 2
// cualquiera de los 3 campos y el que falta se calcula solo (mismo
// patrón que GESTIONEGOCIOS). facturadoUltimosEditados guarda, en
// orden, los últimos 2 campos que se tipearon A MANO (no los que ya se
// autocompletaron) — con esos 2 se sabe cuál es el tercero a calcular.
// Se reinicia cada vez que se abre el modal (ver openModalFacturado()).

const FACTURADO_CAMPO_ID = {
  total: "input-importe-fact",
  efectivo: "input-efectivo-fact",
  digital: "input-digital-fact",
};

export function registrarEdicionManualFacturado(campo) {
  state.facturadoUltimosEditados = state.facturadoUltimosEditados.filter(c => c !== campo);
  state.facturadoUltimosEditados.push(campo);
  if (state.facturadoUltimosEditados.length > 2) state.facturadoUltimosEditados.shift();
  calcularCampoFaltanteFacturado();
}

function calcularCampoFaltanteFacturado() {
  if (state.facturadoUltimosEditados.length < 2) return; // todavía no hay 2 campos como para deducir el tercero
  const valores = {
    total: parseMoneyInput($("#input-importe-fact").value),
    efectivo: parseMoneyInput($("#input-efectivo-fact").value),
    digital: parseMoneyInput($("#input-digital-fact").value),
  };
  const [a, b] = state.facturadoUltimosEditados;
  if (!Number.isFinite(valores[a]) || !Number.isFinite(valores[b])) return;

  const faltante = ["total", "efectivo", "digital"].find(c => c !== a && c !== b);
  const resultado = faltante === "total" ? valores.efectivo + valores.digital
    : faltante === "efectivo" ? valores.total - valores.digital
    : valores.total - valores.efectivo;

  // Se muestra el resultado tal cual, incluso si da negativo (ej.
  // pusiste más Efectivo que Total) — así se nota el error a simple
  // vista en vez de desaparecer solo; saveCierre() lo bloquea al guardar.
  $("#" + FACTURADO_CAMPO_ID[faltante]).value = formatMoneyValue(Math.round(resultado * 100) / 100);
}

export function openModalFacturado(cierre, preset) {
  state.editingCierreId = cierre ? cierre.id : null;
  // Mismo criterio que en Nuevo gasto (ver openModal): un cierre nuevo
  // queda a nombre de quien está identificado en este celular, sin
  // preguntar. Al editar uno existente sí se puede reasignar.
  state.selectedRegistrador = cierre ? cierre.registradoPor : state.usuarioActual;
  state.selectedTurno = cierre ? (cierre.turno || null) : (preset ? preset.turno : turnoActual());

  $("#input-importe-fact").value = cierre ? formatMoneyValue(cierre.importe) : "";
  // Cierres cargados ANTES de que existiera el desglose Efectivo/Digital
  // no tienen esos campos guardados — quedan en blanco para que se
  // completen de nuevo (no se puede inventar cómo se repartía antes).
  $("#input-efectivo-fact").value = cierre && cierre.efectivo != null ? formatMoneyValue(cierre.efectivo) : "";
  $("#input-digital-fact").value = cierre && cierre.digital != null ? formatMoneyValue(cierre.digital) : "";
  state.facturadoUltimosEditados = [];
  if (cierre) {
    $("#input-fecha-fact").value = fechaLocalISO(fechaDeRegistro(cierre));
  } else if (preset) {
    $("#input-fecha-fact").value = preset.fecha;
  } else {
    setDefaultFechaFact();
  }

  $("#modal-fact-title").textContent = cierre ? "Editar cierre" : "Nuevo cierre";
  $("#btn-save-facturado").textContent = cierre ? "Guardar cambios" : "Guardar";
  $("#campo-pagador-fact").classList.toggle("hidden", !cierre);
  $$("#pagador-options-fact .pagador-chip").forEach(c => c.classList.toggle("selected", c.textContent === state.selectedRegistrador));
  actualizarChipsTurnoPorFecha();
  resetFotoFieldFact(); // editar un cierre no toca su foto salvo que se elija una nueva
  $("#modal-fact-error").classList.add("hidden");
  $("#modal-add-facturado").classList.add("active");
  setTimeout(() => $("#input-importe-fact").focus(), 150);
}

export function closeModalFacturado() {
  $("#modal-add-facturado").classList.remove("active");
  state.editingCierreId = null;
}

export async function saveCierre() {
  const totalStr = $("#input-importe-fact").value.trim();
  const efectivoStr = $("#input-efectivo-fact").value.trim();
  const digitalStr = $("#input-digital-fact").value.trim();
  const importe = parseMoneyInput(totalStr);
  const efectivo = parseMoneyInput(efectivoStr);
  const digital = parseMoneyInput(digitalStr);
  const fechaStr = $("#input-fecha-fact").value;
  const errEl = $("#modal-fact-error");

  // Los 3 campos se autocompletan entre sí (ver calcularCampoFaltanteFacturado)
  // pero igual hay que exigir que terminen los 3 con un valor antes de
  // guardar (ej. si se borra uno a mano después de que se completó solo).
  if (totalStr === "") {
    errEl.textContent = "Falta llenar el Total.";
    errEl.classList.remove("hidden");
    return;
  }
  if (efectivoStr === "") {
    errEl.textContent = "Falta llenar el Efectivo.";
    errEl.classList.remove("hidden");
    return;
  }
  if (digitalStr === "") {
    errEl.textContent = "Falta llenar el Digital.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!importe || importe <= 0) {
    errEl.textContent = "Ingresá un importe válido.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!Number.isFinite(efectivo) || !Number.isFinite(digital) || efectivo < 0 || digital < 0) {
    errEl.textContent = "Efectivo y Digital tienen que ser números válidos (0 o más).";
    errEl.classList.remove("hidden");
    return;
  }
  // Por las dudas se hayan tipeado los 3 campos a mano sin dejar que se
  // autocompletara ninguno: se valida que sumen el total antes de
  // guardar, en vez de confiar ciegamente en el cálculo cruzado.
  if (Math.abs(efectivo + digital - importe) > 0.01) {
    errEl.textContent = "Efectivo + Digital no coincide con el Total. Revisá los montos.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!state.selectedTurno) {
    errEl.textContent = "Elegí el turno.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!state.selectedRegistrador) {
    errEl.textContent = "Elegí quién lo cargó.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-facturado");
  const isEdit = !!state.editingCierreId;
  btn.disabled = true;
  btn.textContent = state.selectedFotoFacturadoBlob ? "Subiendo foto…" : "Guardando…";

  try {
    // Mismo criterio que saveGasto(): si la foto falla o tarda demasiado,
    // el cierre se guarda igual sin ella — mejor un cierre sin foto que
    // un cierre perdido.
    let fotoUrl = null, fotoPath = null, fotoFallo = false;
    if (state.selectedFotoFacturadoBlob) {
      try {
        fotoPath = `cierres/${state.negocioActual}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const storageRef = state.fbSdk.ref(state.storage, fotoPath);
        const TIMEOUT_MSG = "La subida de la foto tardó demasiado.";
        await conTimeout(
          state.fbSdk.uploadBytes(storageRef, state.selectedFotoFacturadoBlob, { contentType: "image/jpeg" }),
          25000,
          TIMEOUT_MSG
        );
        fotoUrl = await conTimeout(state.fbSdk.getDownloadURL(storageRef), 15000, TIMEOUT_MSG);
      } catch (fotoErr) {
        console.error("No se pudo subir la foto, se guarda el cierre sin ella:", fotoErr);
        fotoFallo = true;
        fotoPath = null;
      }
      btn.textContent = "Guardando…";
    }

    const data = {
      importe,
      efectivo,
      digital,
      turno: state.selectedTurno,
      registradoPor: state.selectedRegistrador,
      negocio: state.negocioActual,
      fecha: fechaStr ? new Date(fechaStr + "T12:00:00") : state.fbSdk.serverTimestamp()
    };
    // Solo se tocan fotoUrl/fotoPath si se eligió una foto nueva — al
    // editar, updateDoc no toca los campos que no se le pasan, así que la
    // foto existente queda intacta si no se cambia.
    if (fotoUrl) {
      data.fotoUrl = fotoUrl;
      data.fotoPath = fotoPath;
    }
    if (isEdit) {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "facturacion", state.editingCierreId), data);
    } else {
      data.creadoEn = state.fbSdk.serverTimestamp();
      await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "facturacion"), data);
    }
    closeModalFacturado();
    if (fotoFallo) {
      showToast(isEdit ? "Cierre actualizado, pero no se pudo subir la foto ⚠️" : "Cierre guardado sin la foto (no se pudo subir) ⚠️");
    } else {
      showToast(isEdit ? "Cierre actualizado ✅" : "Cierre guardado ✅");
    }
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Guardar cambios" : "Guardar";
  }
}

// ---------- Detalle de un cierre (tocar un cierre de la lista) ----------
// Pedido del dueño (2026-11-02, "igual a como hace CyberBIOS"): al tocar un
// cierre se ve el Cierre de Turno tal cual lo muestra FRKiosko (el programa del
// mostrador): A RETIRAR y TOTAL en grande, la tabla de dónde vino la plata
// (Kiosko e Impresiones, con efectivo y digital en columnas), lo cobrado y el
// Cambio Fijo. Ese desglose viene en el campo `detalle` de los cierres que manda
// FRKiosko (origen "frkiosko", ver repositories/envio_pwa_repo.py en el repo
// FRPROGRAMAESCRITORIO); un cierre cargado a mano desde el celular no lo tiene y
// muestra solo lo que hay (efectivo, digital y total).

// Los dibujitos de cada negocio, los mismos de la tarjeta de FRKiosko
// (ui/tarjeta_cierre.py); la clave viene en cada renglón del detalle.
const ICONO_NEGOCIO = { kiosko_solo: "🛒", impresiones: "🖨️" };

function filaDeNegocio(icono, nombre, efectivo, digital) {
  // En cero se ve apagado, así salta a la vista de dónde vino la plata.
  const vacia = !Number(efectivo) && !Number(digital);
  return `<div class="cierre-fila${vacia ? " vacia" : ""}">
    <span class="cierre-fila-icono">${icono}</span>
    <span class="cierre-fila-nombre">${escapeHtml(nombre)}</span>
    <span class="cierre-fila-monto">${money(efectivo)}</span>
    <span class="cierre-fila-monto">${money(digital)}</span>
  </div>`;
}

function horaDe(timestamp) {
  return timestamp && timestamp.toDate
    ? timestamp.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
}

export function openDetalleCierre(cierre) {
  const fecha = fechaDeRegistro(cierre);
  const detalle = cierre.detalle && typeof cierre.detalle === "object" ? cierre.detalle : null;
  const hora = horaDe(cierre.creadoEn);
  const quien = cierre.registradoPor || "?";
  const efectivo = cierre.efectivo != null ? Number(cierre.efectivo) : null;
  const digital = cierre.digital != null ? Number(cierre.digital) : null;

  const caja = cierre.caja != null ? `Caja Nº ${escapeHtml(String(cierre.caja))} de ${escapeHtml(quien)} · ` : "";
  $("#detalle-cierre-sub").innerHTML = `${caja}Turno ${escapeHtml(turnoLabelParaFecha(fecha, cierre.turno) || "?")}`;
  $("#detalle-cierre-pastilla").textContent =
    fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  $("#detalle-cierre-retirar").textContent =
    detalle ? money(detalle.aRetirar) : (efectivo != null ? money(efectivo) : "—");
  $("#detalle-cierre-total").textContent = money(cierre.importe);

  let filas = `<div class="cierre-encabezado"><span></span><span>DE DÓNDE VIENE</span><span>Efectivo</span><span>Digital</span></div>`;
  if (detalle && Array.isArray(detalle.negocios)) {
    detalle.negocios.forEach(negocio => {
      filas += filaDeNegocio(ICONO_NEGOCIO[negocio.clave] || "•", negocio.nombre || negocio.clave, negocio.efectivo, negocio.digital);
    });
  }
  filas += `<div class="cierre-fila cierre-fila-total">
    <span></span><span class="cierre-fila-nombre">Cobrado</span>
    <span class="cierre-fila-monto">${efectivo != null ? money(efectivo) : "—"}</span>
    <span class="cierre-fila-monto">${digital != null ? money(digital) : "—"}</span>
  </div>`;
  if (detalle) {
    filas += `<div class="cierre-fila cierre-fila-cambio">
      <span></span><span class="cierre-fila-nombre">Cambio Fijo<small>Queda en el cajón para el próximo turno</small></span>
      <span class="cierre-fila-monto">${money(detalle.cambioFijo)}</span><span></span>
    </div>`;
  }
  $("#detalle-cierre-tabla").innerHTML = filas;

  // Abajo, cómo se cerró (en rojo si fue forzoso o en ausencia, como en el
  // programa) o, si se cargó a mano, por qué no tiene el desglose.
  const nota = $("#detalle-cierre-nota");
  const aLas = hora ? ` a las ${hora}` : "";
  let texto, alerta = false;
  if (!detalle) {
    texto = `Cargado a mano desde el celular por ${quien}${aLas}. El desglose por negocio lo traen solo los cierres que manda FRKiosko.`;
  } else if (cierre.forzoso) {
    texto = `Cierre forzoso: la caja se cerró sola${aLas}, nadie la cerró (pasó el fin del turno).`;
    alerta = true;
  } else if (cierre.enAusencia) {
    texto = `La cerró ${cierre.cerradoPor || "?"} en ausencia de ${quien}${aLas}.`;
    alerta = true;
  } else {
    texto = `La cerró ${cierre.cerradoPor || quien}${aLas} en FRKiosko.`;
  }
  // Arriba de eso, quién abrió la caja y a qué hora. Lo manda FRKiosko desde el
  // 2026-11-02: un cierre de antes, uno sin caja o uno cargado a mano no lo trae
  // y queda solo la línea del cierre.
  const horaApertura = horaDe(cierre.abiertaEn);
  const apertura = cierre.abiertaPor
    ? `La inició ${cierre.abiertaPor}${horaApertura ? ` a las ${horaApertura}` : ""} en FRKiosko.`
    : "";
  nota.innerHTML = [apertura, texto].filter(Boolean).map(escapeHtml).join("<br>");
  nota.classList.toggle("alerta", alerta);
  dibujarTareasDelCierre(cierre.tareas);
  $("#modal-detalle-cierre").classList.add("active");
}

// Abajo de todo, las TAREAS DEL TURNO que manda FRKiosko con el cierre (desde el
// 2026-11-03): cada una con su hora, hecha (quién y a qué hora) o sin hacer, en
// rojo, con quiénes la pospusieron. Como estaban al cerrar la caja. El resumen de
// caja de arriba no cambia; sin tareas (un cierre de antes, uno cargado a mano o
// un turno sin tareas) el cuadro no aparece.
function dibujarTareasDelCierre(tareas) {
  const caja = $("#detalle-cierre-tareas");
  if (!Array.isArray(tareas) || !tareas.length) {
    caja.hidden = true;
    caja.innerHTML = "";
    return;
  }
  const sinHacer = tareas.filter(t => !t.hecha).length;
  // Un cierre que cubre varios días (se cerró tarde) lleva el día delante de la hora.
  const variosDias = new Set(tareas.map(t => t.dia)).size > 1;
  let html = `<div class="cierre-tareas-cabecera">
    <span class="cierre-tareas-titulo">⏰ TAREAS DEL TURNO</span>
    <span class="cierre-tareas-cuenta${sinHacer ? "" : " todas"}">${sinHacer ? `${sinHacer} sin hacer` : "Todas hechas"}</span>
  </div>`;
  tareas.forEach(t => {
    const dia = variosDias && t.dia ? `${t.dia.slice(8, 10)}/${t.dia.slice(5, 7)} ` : "";
    const detalle = t.hecha
      ? `Hecha por ${t.hechaPor || "?"}${t.hechaA ? ` a las ${t.hechaA}` : ""}`
      : ["Sin hacer", textoPospuesta(t.pospusieron, t.vecesPospuesta)].filter(Boolean).join(" · ");
    html += `<div class="cierre-tarea${t.hecha ? "" : " sin-hacer"}">
      <span class="cierre-tarea-marca">${t.hecha ? "✔" : "✖"}</span>
      <span class="cierre-tarea-hora">${escapeHtml(dia + (t.hora || ""))}</span>
      <span class="cierre-tarea-texto">${escapeHtml(t.texto || "")}<small>${escapeHtml(detalle)}</small></span>
    </div>`;
  });
  caja.innerHTML = html;
  caja.hidden = false;
}

// "la pospuso Carla", "la pospuso Carla 2 veces", "la pospusieron Carla y Mariana 3 veces".
function textoPospuesta(nombres, veces) {
  const quienes = Array.isArray(nombres) ? nombres.filter(Boolean) : [];
  const cuantas = Number(veces) || 0;
  if (!quienes.length || !cuantas) return "";
  const lista = quienes.length > 1
    ? `${quienes.slice(0, -1).join(", ")} y ${quienes[quienes.length - 1]}`
    : quienes[0];
  const vecesTexto = cuantas > 1 ? ` ${cuantas} veces` : "";
  return `${quienes.length > 1 ? "la pospusieron" : "la pospuso"} ${lista}${vecesTexto}`;
}

export function closeModalDetalleCierre() {
  $("#modal-detalle-cierre").classList.remove("active");
}

// Solo accesible desde el botón 🗑️ (esAdmin). Borra también la foto en
// Storage si tenía una (mismo criterio que deleteGasto).
export async function deleteCierre(id) {
  if (!confirm("¿Borrar este cierre? No se puede deshacer.")) return;
  const cierre = state.facturaciones.find(x => x.id === id);
  try {
    if (cierre && cierre.fotoPath) {
      try {
        await state.fbSdk.deleteObject(state.fbSdk.ref(state.storage, cierre.fotoPath));
      } catch (e) {
        console.warn("No se pudo borrar la foto del cierre:", e.message);
      }
    }
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "facturacion", id));
    showToast("Cierre borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}
