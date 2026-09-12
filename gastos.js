// ============================================================
// Gastos — carga, edición, fotos de factura, "Gastos S/Admin", exportar
// CSV. La pantalla más grande de la app.
// ============================================================
import { state, CATEGORIAS_GASTOS_DEFAULT, MAX_FOTOS_GASTO, FOTO_RETENCION_DIAS } from "./state.js";
import {
  $, $$, showToast, escapeHtml, fechaDeRegistro, fechaLocalISO, fechaLimiteHistorial, mesLabel,
  money, parseMoneyInput, formatMoneyValue, socioInitial, setSyncOffline, conTimeout, csvEscape, downloadCSV
} from "./utils.js";
import { payerColorVar } from "./identidad.js";

export function gastosDelNegocio() {
  return state.gastos.filter(g => g.negocio === state.negocioActual);
}

// onCambio se llama después de cada snapshot con datos nuevos — hoy
// dispara renderBalance()/renderResumen(), que todavía viven en app.js (no
// se movieron en esta etapa). Un callback en vez de importarlas evita una
// dependencia circular gastos.js↔app.js.
export function listenGastos(onCambio) {
  const q = state.fbSdk.query(
    state.fbSdk.collection(state.db, "gastos"),
    state.fbSdk.where("fecha", ">=", fechaLimiteHistorial()),
    state.fbSdk.orderBy("fecha", "desc")
  );
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.gastos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGastos();
    renderGastosAdmin();
    if (onCambio) onCambio();
    setSyncOffline(false);
    if (!state.fotosLimpiezaHecha) {
      state.fotosLimpiezaHecha = true;
      limpiarFotosVencidas();
    }
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// Fecha base del mes elegido en la pantalla de Gastos (ver
// gastosMesOffset) — mismo patrón que resumenFechaBase() para Resumen
// mensual, pero independiente: son dos navegadores de mes separados.
function gastosFechaBase() {
  const d = new Date();
  d.setDate(1); // evita saltos raros de mes al sumar/restar meses
  d.setMonth(d.getMonth() + state.gastosMesOffset);
  return d;
}

// Gastos cargados antes de que existiera "forma de pago" no tienen el
// campo — se muestran como Efectivo por default.
function formaPagoLabel(g) {
  if (g.formaPago === "digital") return "💳 Digital";
  if (g.formaPago === "mixto") return `🔀 ${money(g.montoDigital)} digital · ${money(g.montoEfectivo)} efectivo`;
  return "💵 Efectivo";
}

// Antes mostraba TODOS los gastos sin importar el mes (solo el total de
// arriba estaba filtrado por mes actual, lo cual era inconsistente e
// iba acumulando meses viejos mezclados en la lista). Ahora, igual que
// Resumen mensual, se ve un mes a la vez — por defecto el actual (ver
// selectSeccion()) — con flechas para ir a uno anterior si hace falta
// editar o borrar algo viejo.
// Arma el <li> de un gasto — usado tanto por la lista de Gastos común
// como por la de Gastos S/Admin (ver renderGastosAdmin), que muestran el
// mismo tipo de fila, solo que filtradas a distintas categorías.
function crearGastoLi(g) {
  const fecha = fechaDeRegistro(g);

  const fotoBtn = fotosDeGasto(g).length
    ? `<button type="button" class="foto-link" data-id="${g.id}" aria-label="Ver foto de la factura">📷</button>`
    : "";

  // Editar/borrar solo para el admin — el resto solo puede cargar y ver.
  const adminBtns = state.esAdmin
    ? `<button type="button" class="icon-btn gasto-edit-btn" data-id="${g.id}" aria-label="Editar gasto">✏️</button>
       <button type="button" class="icon-btn danger gasto-delete-btn" data-id="${g.id}" aria-label="Borrar gasto">🗑️</button>`
    : "";

  // Falta abonar: se tildó porque todavía no se le pagó a quien
  // trajo la mercadería (ej. te dejan pagar unos días después) — la
  // fila queda en rojo. Tocar el aviso lo marca como pagado al toque
  // (guarda directo, sin pasar por el modal de Editar).
  const metaFaltaAbonar = g.faltaAbonar
    ? ` · <button type="button" class="meta-falta-abonar" data-id="${g.id}">⚠️ Falta abonar</button>`
    : "";

  // Este gasto está marcado "Gasto Admin" (checkbox del modal) — en la
  // lista de Gastos común (donde el admin ve todo, público y privado
  // mezclado) esta marca es la única forma de distinguirlo a simple
  // vista, ya que la categoría ya no implica privacidad. Solo se muestra
  // al admin: un colaborador nunca llega a ver este gasto de todos modos.
  const metaSoloAdmin = (state.esAdmin && g.soloAdmin) ? ` · 🔒 Solo admin` : "";

  // Notas largas hacían la fila del gasto muy alta en el celular — se
  // recortan a las primeras 2 palabras y el resto se ve tocando "Ver
  // detalle completo" (usa data-id, no el texto de la nota, para no
  // tener que escaparla dentro de un atributo HTML — ver verDetalleGasto()).
  const notaPalabras = g.nota ? g.nota.trim().split(/\s+/) : [];
  const notaLarga = notaPalabras.length > 2;
  const notaCorta = notaPalabras.slice(0, 2).join(" ");
  const notaHtml = g.nota
    ? `<div class="meta gasto-nota">📝 ${escapeHtml(notaCorta)}${notaLarga ? `… <button type="button" class="ver-detalle-btn" data-id="${g.id}">Ver detalle completo</button>` : ""}</div>`
    : "";

  const li = document.createElement("li");
  li.className = "expense-item" + (g.faltaAbonar ? " falta-abonar" : "");
  // Foto/editar/borrar van en su propia fila abajo (ver .expense-item-actions
  // en styles.css) — así el texto de arriba usa todo el ancho disponible
  // en vez de competir con los íconos cuando la descripción/nota es larga.
  const acciones = (fotoBtn || adminBtns)
    ? `<div class="expense-item-actions">${fotoBtn}${adminBtns}</div>`
    : "";
  li.innerHTML = `
    <div class="expense-item-top">
      <div class="avatar" style="background:${payerColorVar(g.pagadoPor)}">${socioInitial(g.pagadoPor)}</div>
      <div class="info">
        <div class="desc">${escapeHtml(g.descripcion || "Sin descripción")}</div>
        <div class="meta">${fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} · ${escapeHtml(g.categoria || "Otros")} · Pagó ${escapeHtml(g.pagadoPor || "?")} · ${formaPagoLabel(g)}${metaFaltaAbonar}${metaSoloAdmin}</div>
        ${notaHtml}
      </div>
      <div class="amount">${money(g.importe)}</div>
    </div>
    ${acciones}
  `;
  return li;
}

// Antes mostraba TODOS los gastos sin importar el mes (solo el total de
// arriba estaba filtrado por mes actual, lo cual era inconsistente e
// iba acumulando meses viejos mezclados en la lista). Ahora, igual que
// Resumen mensual, se ve un mes a la vez — por defecto el actual (ver
// selectSeccion()) — con flechas para ir a uno anterior si hace falta
// editar o borrar algo viejo.
export function renderGastos() {
  const list = $("#expenses-list");
  const empty = $("#expenses-empty");
  list.innerHTML = "";

  const base = gastosFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#gastos-mes-label").textContent = mesLabel(base);
  const now = new Date();
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-gastos-mes-siguiente").disabled = esMesActual;

  const gastosMes = gastosDelNegocio().filter(g => {
    if (!state.esAdmin && g.soloAdmin) return false;
    const f = fechaDeRegistro(g);
    return f.getMonth() === targetMonth && f.getFullYear() === targetYear;
  });

  if (!gastosMes.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
  }

  let totalMes = 0;
  gastosMes.forEach(g => {
    totalMes += Number(g.importe) || 0;
    list.appendChild(crearGastoLi(g));
  });

  $("#total-mes").textContent = money(totalMes);
}

// Gastos S/Admin: mismo formulario/lista/edición/foto que Gastos común,
// solo que filtrado a los gastos marcados soloAdmin (checkbox "🔒 Gasto
// Admin" en el modal, ver openModal — es un flag por gasto individual, no
// por categoría, así cualquier categoría puede tener gastos públicos y
// privados mezclados) — pantalla propia, visible solo para admin (ver
// SECCIONES en renderSeccionCards), para no mezclar lo privado con la
// lista que ven los colaboradores. El total del mes SÍ sigue entrando en
// Resumen mensual (que no filtra nada) — lo único que cambia acá es dónde
// se ve la lista y quién puede verla.
function gastosAdminFechaBase() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + state.gastosAdminMesOffset);
  return d;
}

export function renderGastosAdmin() {
  const list = $("#expenses-admin-list");
  const empty = $("#expenses-admin-empty");
  list.innerHTML = "";

  const base = gastosAdminFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#gastos-admin-mes-label").textContent = mesLabel(base);
  const now = new Date();
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-gastos-admin-mes-siguiente").disabled = esMesActual;

  const gastosMes = gastosDelNegocio().filter(g => {
    if (!g.soloAdmin) return false;
    const f = fechaDeRegistro(g);
    return f.getMonth() === targetMonth && f.getFullYear() === targetYear;
  });

  empty.classList.toggle("hidden", gastosMes.length > 0);

  let totalMes = 0;
  gastosMes.forEach(g => {
    totalMes += Number(g.importe) || 0;
    list.appendChild(crearGastoLi(g));
  });

  $("#total-mes-admin").textContent = money(totalMes);
}

// Fotos de un gasto, siempre como lista — único lugar que lo calcula.
// Entiende dos formatos: el nuevo (`fotos: [{url, path}, ...]`, hasta
// MAX_FOTOS_GASTO) y el viejo, de un solo campo fotoUrl/fotoPath (gastos
// cargados antes de este cambio). No hay migración en bloque: un gasto
// viejo pasa solo al formato nuevo la próxima vez que se edita y se
// guarda (ver saveGasto()).
export function fotosDeGasto(g) {
  if (Array.isArray(g.fotos) && g.fotos.length) return g.fotos;
  if (g.fotoUrl) return [{ url: g.fotoUrl, path: g.fotoPath || null }];
  return [];
}

// ---------- Visor de fotos (una o varias, del mismo gasto) ----------

export function abrirVisorFotos(fotos, indexInicial = 0) {
  if (!fotos.length) return;
  state.visorFotosLista = fotos;
  state.visorFotosIndex = indexInicial;
  renderVisorFotos();
  $("#modal-visor-fotos").classList.add("active");
}

function renderVisorFotos() {
  const foto = state.visorFotosLista[state.visorFotosIndex];
  $("#visor-fotos-img").src = foto.url;
  const varias = state.visorFotosLista.length > 1;
  $("#visor-fotos-contador").textContent = `${state.visorFotosIndex + 1} / ${state.visorFotosLista.length}`;
  $("#visor-fotos-contador").classList.toggle("hidden", !varias);
  $("#btn-visor-anterior").classList.toggle("hidden", !varias);
  $("#btn-visor-siguiente").classList.toggle("hidden", !varias);
}

export function visorFotosMover(delta) {
  const n = state.visorFotosLista.length;
  state.visorFotosIndex = (state.visorFotosIndex + delta + n) % n;
  renderVisorFotos();
}

export function closeModalVisorFotos() {
  $("#modal-visor-fotos").classList.remove("active");
}

// Detalle completo de un gasto (ver botón "Ver detalle completo" en
// renderGastos, para notas largas) — un cartel simple en vez de otro
// modal, ya que es solo para leer, no para editar.
export function verDetalleGasto(id) {
  const g = state.gastos.find(x => x.id === id);
  if (!g) return;
  const fecha = fechaDeRegistro(g).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  // Todo por textContent (no innerHTML) — no hace falta escapeHtml, texto
  // plano nunca se interpreta como HTML.
  $("#detalle-gasto-avatar").textContent = socioInitial(g.pagadoPor);
  $("#detalle-gasto-avatar").style.background = payerColorVar(g.pagadoPor);
  $("#detalle-gasto-monto").textContent = money(g.importe);
  $("#detalle-gasto-desc").textContent = g.descripcion || "Sin descripción";
  $("#detalle-gasto-categoria").textContent = g.categoria || "Otros";
  $("#detalle-gasto-abonar").classList.toggle("hidden", !g.faltaAbonar);
  $("#detalle-gasto-fecha").textContent = fecha;
  $("#detalle-gasto-pagador").textContent = g.pagadoPor || "?";
  $("#detalle-gasto-formapago").textContent = formaPagoLabel(g);

  const notaWrap = $("#detalle-gasto-nota-wrap");
  if (g.nota) {
    $("#detalle-gasto-nota-texto").textContent = g.nota;
    notaWrap.classList.remove("hidden");
  } else {
    notaWrap.classList.add("hidden");
  }

  const fotosG = fotosDeGasto(g);
  const fotoBtn = $("#detalle-gasto-foto-btn");
  if (fotosG.length) {
    $("#detalle-gasto-foto-img").src = fotosG[0].url;
    $("#detalle-gasto-foto-label").textContent = fotosG.length > 1 ? `Ver ${fotosG.length} fotos` : "Ver foto completa";
    fotoBtn.onclick = () => abrirVisorFotos(fotosG);
    fotoBtn.classList.remove("hidden");
  } else {
    fotoBtn.onclick = null;
    fotoBtn.classList.add("hidden");
  }

  $("#modal-detalle-gasto").classList.add("active");
}

export function closeModalDetalleGasto() {
  $("#modal-detalle-gasto").classList.remove("active");
}

// ---------- Fotos de facturas: limpieza automática y pantalla de descarga ----------
// Se ejecuta una vez por apertura de la app (ver listenGastos). Borra del
// Storage y del gasto la foto de cualquier gasto con más de 4 meses — el
// gasto en sí (importe, descripción, etc.) NUNCA se toca ni se borra.
async function limpiarFotosVencidas() {
  const limite = Date.now() - FOTO_RETENCION_DIAS * 24 * 60 * 60 * 1000;
  const vencidos = state.gastos.filter(g => fotosDeGasto(g).length && fechaDeRegistro(g).getTime() < limite);

  for (const g of vencidos) {
    for (const f of fotosDeGasto(g)) {
      if (!f.path) continue;
      try {
        await state.fbSdk.deleteObject(state.fbSdk.ref(state.storage, f.path));
      } catch (e) {
        console.warn("No se pudo borrar la foto vencida (puede que ya no exista):", e.message);
      }
    }
    try {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "gastos", g.id), {
        fotos: state.fbSdk.deleteField(),
        fotoUrl: state.fbSdk.deleteField(),
        fotoPath: state.fbSdk.deleteField()
      });
    } catch (e) {
      console.warn("No se pudo limpiar la referencia de la foto:", e.message);
    }
  }
}

// Pantalla "Fotos guardadas": agrupa por mes todos los gastos del negocio
// actual que todavía tienen una foto (los que ya se limpiaron por vencidos
// simplemente no aparecen más, sin necesidad de filtrar por fecha acá).
export function renderFotosGuardadas() {
  const conFoto = gastosDelNegocio()
    .filter(g => fotosDeGasto(g).length)
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a));

  const empty = $("#fotos-empty");
  const wrap = $("#fotos-grupos");
  wrap.innerHTML = "";

  if (!conFoto.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const grupos = new Map(); // "2026-8" -> { label, items: [] }
  conFoto.forEach(g => {
    const f = fechaDeRegistro(g);
    const key = `${f.getFullYear()}-${f.getMonth()}`;
    if (!grupos.has(key)) grupos.set(key, { label: mesLabel(f), items: [] });
    grupos.get(key).items.push(g);
  });

  // Una miniatura por FOTO, no por gasto — un gasto con una factura de
  // varias hojas muestra sus varias páginas acá. Tocar cualquiera abre
  // el visor ya parado en esa foto, con las demás del mismo gasto al lado.
  grupos.forEach(grupo => {
    const section = document.createElement("div");
    section.className = "fotos-grupo";
    let totalFotos = 0;
    const grid = grupo.items.map(g => {
      const fotosG = fotosDeGasto(g);
      totalFotos += fotosG.length;
      return fotosG.map((f, idx) => `
        <button type="button" class="foto-thumb-link" data-id="${g.id}" data-idx="${idx}" aria-label="Ver foto: ${escapeHtml(g.descripcion || "")}">
          <img class="foto-thumb" src="${escapeHtml(f.url)}" alt="Factura: ${escapeHtml(g.descripcion || "")}" loading="lazy">
        </button>
      `).join("");
    }).join("");
    section.innerHTML = `
      <div class="fotos-grupo-titulo">${escapeHtml(grupo.label)} — ${totalFotos} foto${totalFotos === 1 ? "" : "s"}</div>
      <div class="fotos-grid">${grid}</div>
    `;
    wrap.appendChild(section);
  });
}

// ---------- Render: chips de pagador (modal) ----------
export function renderPagadorChips() {
  const wrap = $("#pagador-options");
  wrap.innerHTML = "";
  state.socios.concat(state.colaboradores).forEach((nombre) => {
    const chip = document.createElement("div");
    chip.className = "pagador-chip";
    chip.textContent = nombre;
    chip.style.setProperty("--chip-color", payerColorVar(nombre));
    chip.addEventListener("click", () => {
      state.selectedPagador = nombre;
      wrap.querySelectorAll(".pagador-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    wrap.appendChild(chip);
  });
}

// ---------- Exportar datos (CSV) ----------
export function exportGastosCSV() {
  const rows = [["Fecha", "Categoría", "Descripción", "Importe", "Pagado por", "Forma de pago", "Efectivo", "Digital", "Nota"]];
  gastosDelNegocio()
    .filter(g => state.esAdmin || !g.soloAdmin)
    .slice()
    .sort((a, b) => fechaDeRegistro(a) - fechaDeRegistro(b))
    .forEach(g => {
      rows.push([
        fechaDeRegistro(g).toLocaleDateString("es-AR"),
        g.categoria || "Otros",
        g.descripcion || "",
        Number(g.importe) || 0,
        g.pagadoPor || "",
        g.formaPago || "efectivo",
        g.formaPago === "mixto" ? Number(g.montoEfectivo) || 0 : "",
        g.formaPago === "mixto" ? Number(g.montoDigital) || 0 : "",
        g.nota || ""
      ]);
    });
  downloadCSV(`gastos-${state.negocioActual}-${fechaLocalISO(new Date())}.csv`, rows);
}

export function setDefaultFecha() {
  const el = $("#input-fecha");
  const today = new Date();
  el.value = fechaLocalISO(today);
}

// ---------- Modal: agregar gasto ----------

export function resetFotoField() {
  // Las fotos "nueva" tienen un object URL propio (URL.createObjectURL)
  // que hay que liberar a mano o se queda en memoria — las "existente"
  // apuntan a Storage, no hace falta nada con ellas acá.
  state.fotosGastoModal.forEach(f => { if (f.tipo === "nueva") URL.revokeObjectURL(f.previewUrl); });
  state.fotosGastoModal = [];
  state.fotosGastoABorrar = [];
  $("#input-foto").value = "";
  renderFotoStrip();
}

// Único lugar que dibuja la tira de miniaturas del modal de gasto (nuevo
// o edición) — se llama cada vez que cambia fotosGastoModal.
export function renderFotoStrip() {
  const strip = $("#foto-strip");
  strip.innerHTML = state.fotosGastoModal.map((f, idx) => `
    <div class="foto-preview-wrap">
      <img class="foto-preview-img" src="${escapeHtml(f.tipo === "nueva" ? f.previewUrl : f.url)}" alt="Vista previa de la factura ${idx + 1}">
      <button type="button" class="foto-remove-btn" data-idx="${idx}" aria-label="Quitar esta foto">×</button>
    </div>
  `).join("");
  // Al llegar al máximo se esconden los botones de agregar — más simple
  // para quien carga el gasto que un mensaje de error al tocar "Tomar foto".
  $("#foto-btns-row").classList.toggle("hidden", state.fotosGastoModal.length >= MAX_FOTOS_GASTO);
}

// Sin argumento: alta de un gasto nuevo. Con un gasto existente: edición
// (solo accesible para el admin, ver botón ✏️ en renderGastos).
// Forma de pago del gasto: Efectivo, Digital, o Mixto. Solo Mixto muestra
// el desglose Efectivo/Digital, que debe sumar el Importe total.
export function selectFormaPago(forma) {
  state.selectedFormaPago = forma;
  $$("#forma-pago-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.forma === forma));
  $("#campo-mixto").classList.toggle("hidden", forma !== "mixto");
  if (forma !== "mixto") state.mixtoUltimoEditado = null;
}

// Cálculo cruzado del desglose Mixto: al salir de Efectivo o Digital (o de
// Importe), el otro se completa solo para que sume el Importe (mismo
// criterio que el desglose Total/Efectivo/Digital de Facturado, pero acá
// el "total" ya es el campo Importe que está siempre visible arriba). Los
// listeners usan "change", no "input" — ver wireEvents().
export function registrarEdicionMixto(campo) {
  state.mixtoUltimoEditado = campo;
  calcularCampoMixtoFaltante();
}

export function calcularCampoMixtoFaltante() {
  if (!state.mixtoUltimoEditado) return;
  const importe = parseMoneyInput($("#input-importe").value);
  if (!Number.isFinite(importe)) return;
  if (state.mixtoUltimoEditado === "efectivo") {
    const efectivo = parseMoneyInput($("#input-mixto-efectivo").value);
    if (!Number.isFinite(efectivo)) return;
    $("#input-mixto-digital").value = formatMoneyValue(Math.round((importe - efectivo) * 100) / 100);
  } else {
    const digital = parseMoneyInput($("#input-mixto-digital").value);
    if (!Number.isFinite(digital)) return;
    $("#input-mixto-efectivo").value = formatMoneyValue(Math.round((importe - digital) * 100) / 100);
  }
}

// Reconstruye las <option> de "Categoría" — siempre todas las categorías
// disponibles, para admin y colaborador por igual (la privacidad ahora es
// un flag por gasto individual, ver el checkbox "Gasto Admin" en
// openModal, no algo de la categoría). categoriaActual se agrega igual
// aunque ya no exista en la lista (un admin la borró después de cargada),
// para no perder el valor guardado de un gasto viejo al editarlo.
function renderCategoriaOptions(categoriaActual) {
  const sel = $("#input-categoria");
  let cats = state.categoriasGastos.slice();
  if (categoriaActual && !cats.includes(categoriaActual)) {
    cats = cats.concat([categoriaActual]);
  }
  sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  return cats.length;
}

export function openModal(gasto, opts) {
  const cantCategorias = renderCategoriaOptions(gasto ? gasto.categoria : null);
  if (!cantCategorias) {
    showToast("Creá primero una categoría en Ajustes.");
    return;
  }

  state.editingGastoId = gasto ? gasto.id : null;
  // Un gasto nuevo queda a nombre de quien está identificado en este
  // celular — no hace falta preguntar, si ya se identificó al entrar. Al
  // EDITAR uno existente sí se muestra el selector, por si hay que
  // reasignarlo (ver #campo-pagador más abajo).
  state.selectedPagador = gasto ? gasto.pagadoPor : state.usuarioActual;

  $("#input-importe").value = gasto ? formatMoneyValue(gasto.importe) : "";
  $("#input-descripcion").value = gasto ? (gasto.descripcion || "") : "";
  if (gasto) $("#input-categoria").value = gasto.categoria || "Otros";
  $("#input-falta-abonar").checked = gasto ? !!gasto.faltaAbonar : false;
  // "Gasto Admin" (soloAdmin): solo un admin puede ver este checkbox y
  // tildarlo — un colaborador ni siquiera lo tiene en el modal, así que un
  // gasto que carga nunca puede quedar marcado privado por accidente. Al
  // abrir desde "Gastos S/Admin" (ver fab-add-gastos-admin) llega
  // pre-tildado vía opts.soloAdmin, pero el admin lo puede destildar igual.
  $("#campo-gasto-admin").classList.toggle("hidden", !state.esAdmin);
  $("#input-gasto-admin").checked = gasto ? !!gasto.soloAdmin : !!(opts && opts.soloAdmin);
  $("#input-nota").value = gasto ? (gasto.nota || "") : "";

  // Gastos cargados antes de que existiera "forma de pago" no tienen el
  // campo guardado — se muestran como Efectivo por default (no se puede
  // inventar cómo se pagaron los viejos).
  state.mixtoUltimoEditado = null;
  $("#input-mixto-efectivo").value = gasto && gasto.montoEfectivo != null ? formatMoneyValue(gasto.montoEfectivo) : "";
  $("#input-mixto-digital").value = gasto && gasto.montoDigital != null ? formatMoneyValue(gasto.montoDigital) : "";
  selectFormaPago(gasto ? (gasto.formaPago || "efectivo") : "efectivo");

  if (gasto) {
    $("#input-fecha").value = fechaLocalISO(fechaDeRegistro(gasto));
  } else {
    setDefaultFecha();
  }
  resetFotoField(); // limpia la selección de una edición anterior
  if (gasto) {
    // Precarga las fotos que ya tenía para que se puedan ver, sacar o
    // completar hasta el máximo — no se suben de nuevo, solo se muestran
    // (fotosDeGasto ya entiende el formato viejo de una sola foto).
    state.fotosGastoModal = fotosDeGasto(gasto).map(f => ({ tipo: "existente", url: f.url, path: f.path }));
    renderFotoStrip();
  }

  $("#modal-add-title").textContent = gasto ? "Editar gasto" : "Nuevo gasto";
  $("#btn-save-add").textContent = gasto ? "Guardar cambios" : "Guardar gasto";
  $("#campo-pagador").classList.toggle("hidden", !gasto);
  $$("#pagador-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.textContent === state.selectedPagador));
  $("#modal-error").classList.add("hidden");
  $("#modal-add").classList.add("active");
  setTimeout(() => $("#input-importe").focus(), 150);
}

export function closeModal() {
  $("#modal-add").classList.remove("active");
  state.editingGastoId = null;
  resetFotoField(); // libera los object URL de las fotos elegidas, se cancele o se haya guardado
}

export async function saveGasto() {
  const importe = parseMoneyInput($("#input-importe").value);
  const descripcion = $("#input-descripcion").value.trim();
  const categoria = $("#input-categoria").value;
  const nota = $("#input-nota").value.trim();
  const fechaStr = $("#input-fecha").value;
  const errEl = $("#modal-error");

  if (!importe || importe <= 0) {
    errEl.textContent = "Ingresá un importe válido.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!descripcion) {
    errEl.textContent = "Contanos en qué se gastó.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!state.selectedPagador) {
    errEl.textContent = "Elegí quién pagó.";
    errEl.classList.remove("hidden");
    return;
  }

  let montoEfectivo = null, montoDigital = null;
  if (state.selectedFormaPago === "mixto") {
    montoEfectivo = parseMoneyInput($("#input-mixto-efectivo").value);
    montoDigital = parseMoneyInput($("#input-mixto-digital").value);
    if (!Number.isFinite(montoEfectivo) || !Number.isFinite(montoDigital) || montoEfectivo < 0 || montoDigital < 0) {
      errEl.textContent = "Completá el desglose Efectivo y Digital.";
      errEl.classList.remove("hidden");
      return;
    }
    if (Math.abs((montoEfectivo + montoDigital) - importe) > 0.01) {
      errEl.textContent = "Efectivo + Digital debe sumar el Importe total.";
      errEl.classList.remove("hidden");
      return;
    }
  }

  const btn = $("#btn-save-add");
  const isEdit = !!state.editingGastoId;
  const fotosNuevas = state.fotosGastoModal.filter(f => f.tipo === "nueva");
  btn.disabled = true;
  btn.textContent = fotosNuevas.length ? "Subiendo fotos…" : "Guardando…";

  try {
    // Cada foto se sube por separado y se tolera que alguna falle — mejor
    // guardar el gasto con las que sí subieron que perderlo entero por una
    // sola foto que no salió (mismo criterio que antes con una sola foto).
    let fotosFallidas = 0;
    const fotosSubidas = [];
    for (const f of fotosNuevas) {
      try {
        const path = `recibos/${state.negocioActual}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const storageRef = state.fbSdk.ref(state.storage, path);
        const TIMEOUT_MSG = "La subida de una foto tardó demasiado.";
        await conTimeout(
          state.fbSdk.uploadBytes(storageRef, f.blob, { contentType: "image/jpeg" }),
          25000,
          TIMEOUT_MSG
        );
        const url = await conTimeout(state.fbSdk.getDownloadURL(storageRef), 15000, TIMEOUT_MSG);
        fotosSubidas.push({ url, path });
      } catch (fotoErr) {
        console.error("No se pudo subir una foto, se guarda el gasto sin ella:", fotoErr);
        fotosFallidas++;
      }
    }
    if (fotosNuevas.length) btn.textContent = "Guardando…";

    const fotosExistentesConservadas = state.fotosGastoModal
      .filter(f => f.tipo === "existente")
      .map(f => ({ url: f.url, path: f.path }));
    const fotosFinales = fotosExistentesConservadas.concat(fotosSubidas);

    const gastoData = {
      importe,
      descripcion,
      categoria,
      nota,
      pagadoPor: state.selectedPagador,
      negocio: state.negocioActual,
      faltaAbonar: $("#input-falta-abonar").checked,
      // Un colaborador ni ve el checkbox (ver openModal) — esAdmin acá
      // asegura que nunca quede en true por un valor colgado del campo.
      soloAdmin: state.esAdmin ? $("#input-gasto-admin").checked : false,
      fecha: fechaStr ? new Date(fechaStr + "T12:00:00") : state.fbSdk.serverTimestamp(),
      formaPago: state.selectedFormaPago
    };
    // montoEfectivo/montoDigital solo existen si es Mixto — si se edita un
    // gasto y se cambia a Efectivo/Digital "puro", hay que borrar el
    // desglose viejo explícitamente (updateDoc no toca campos que no se
    // le pasan, así que quedaría un desglose stale sin esto).
    if (state.selectedFormaPago === "mixto") {
      gastoData.montoEfectivo = montoEfectivo;
      gastoData.montoDigital = montoDigital;
    } else if (isEdit) {
      gastoData.montoEfectivo = state.fbSdk.deleteField();
      gastoData.montoDigital = state.fbSdk.deleteField();
    }
    // `fotos` reemplaza al formato viejo (fotoUrl/fotoPath, una sola
    // foto) — se escribe cada vez que el gasto queda con alguna foto, así
    // un gasto viejo editado migra solo al formato nuevo, sin necesidad
    // de una migración aparte (ver fotosDeGasto()).
    if (fotosFinales.length) {
      gastoData.fotos = fotosFinales;
      if (isEdit) {
        gastoData.fotoUrl = state.fbSdk.deleteField();
        gastoData.fotoPath = state.fbSdk.deleteField();
      }
    } else if (isEdit && state.fotosGastoABorrar.length) {
      // Se sacaron todas las fotos que tenía, sin agregar ninguna nueva.
      gastoData.fotos = state.fbSdk.deleteField();
      gastoData.fotoUrl = state.fbSdk.deleteField();
      gastoData.fotoPath = state.fbSdk.deleteField();
    }

    if (isEdit) {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "gastos", state.editingGastoId), gastoData);
    } else {
      gastoData.creadoEn = state.fbSdk.serverTimestamp();
      await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "gastos"), gastoData);
    }

    // Recién ahora que el gasto quedó guardado se borran del Storage las
    // fotos que se sacaron en este modal — si algo de arriba falla antes
    // de llegar acá, no se pierde ninguna foto todavía referenciada.
    for (const path of state.fotosGastoABorrar) {
      try {
        await state.fbSdk.deleteObject(state.fbSdk.ref(state.storage, path));
      } catch (e) {
        console.warn("No se pudo borrar una foto quitada:", e.message);
      }
    }

    closeModal();
    if (fotosFallidas) {
      showToast(isEdit
        ? `Gasto actualizado, pero ${fotosFallidas} foto${fotosFallidas === 1 ? "" : "s"} no se pudo subir ⚠️`
        : `Gasto guardado, pero ${fotosFallidas} foto${fotosFallidas === 1 ? "" : "s"} no se pudo subir ⚠️`);
    } else {
      showToast(isEdit ? "Gasto actualizado ✅" : "Gasto guardado ✅");
    }
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Guardar cambios" : "Guardar gasto";
  }
}

// Solo accesible desde el botón 🗑️ (esAdmin). Borra también la foto en
// Storage si tenía una — el gasto en Firestore se elimina por completo
// (a diferencia de limpiarFotosVencidas, que solo borra la foto).
export async function deleteGasto(id) {
  if (!confirm("¿Borrar este gasto? No se puede deshacer.")) return;
  const gasto = state.gastos.find(g => g.id === id);
  try {
    if (gasto) {
      for (const f of fotosDeGasto(gasto)) {
        if (!f.path) continue;
        try {
          await state.fbSdk.deleteObject(state.fbSdk.ref(state.storage, f.path));
        } catch (e) {
          console.warn("No se pudo borrar una foto del gasto:", e.message);
        }
      }
    }
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "gastos", id));
    showToast("Gasto borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}

// Tocar el aviso "⚠️ Falta abonar" en la lista lo marca como pagado
// directo, sin pasar por el modal de Editar.
export async function marcarAbonado(id) {
  try {
    await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "gastos", id), { faltaAbonar: false });
    showToast("Gasto marcado como pagado ✅");
  } catch (e) {
    console.error(e);
    showToast("No se pudo actualizar. Revisá tu conexión.");
  }
}
