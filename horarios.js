// ============================================================
// Estadísticas → HORARIOS DEL PERSONAL (pedido del dueño, 2026-11-20: "lo más
// parecido posible" a la ventana Horarios del personal de FRKiosko). Por cada
// operador del mes elegido: cuántos días llegó temprano, cuántos llegó tarde,
// cuántos se fue antes y el saldo — si el local le debe tiempo o él le debe al
// local. Debajo, el detalle día por día de la tarjeta elegida.
//
// De dónde sale: de los cierres que manda FRKiosko (origen "frkiosko"). Cada uno
// trae quién abrió la caja y a qué hora (abiertaPor, abiertaEn), quién la tenía
// al cerrarse (registradoPor), quién la cerró (cerradoPor), a qué hora
// (creadoEn) y si la cerró el programa solo (forzoso). Los cierres cargados a
// mano no traen la hora de apertura y no entran.
//
// Las reglas son las de FRKiosko (repositories/horarios_repo.py), en el mismo
// orden, para que los dos digan lo mismo:
// - Llega cuando abre su caja. Se va cuando la cierra ella. La que se queda
//   esperando al reemplazo y cierra cuando llega (el caso de todos los días) se
//   fue a esa hora: lo que se quedó suma a su favor.
// - Si la caja la cerró el programa (forzoso) u otra persona (en su ausencia, o
//   el Admin), no se sabe a qué hora se fue: esa salida queda "sin dato" y no
//   suma ni resta. Lo que llegó temprano o tarde ese día sí cuenta.
// - Una JORNADA es un tramo seguido de una misma persona: si cierra su caja y en
//   menos de MINUTOS_PARA_SEGUIR abre otra (cubre a la que no llegó, o hace
//   doble turno), sigue siendo el mismo día de trabajo.
// - Contra qué horario se compara: el de los turnos de las cajas que tuvo al
//   menos la mitad del turno. Un doble turno se compara con la entrada del
//   primero y la salida del segundo (no suma 8 horas).
// - Única diferencia: cuando una caja pasa de mano (un relevo: la recibe la que
//   llega), FRKiosko no manda a qué hora pasó. La salida de quien la entregó y
//   la llegada de quien la recibió quedan "sin dato" y no suman ni restan.
//
// Solo mira: no graba nada.
// ============================================================
import { $, escapeHtml, fechaDeRegistro, TURNO_LABEL } from "./utils.js";
import { payerColorVar } from "./identidad.js";
import { facturacionesDelNegocio } from "./facturado.js";

// Hasta estos minutos antes o después cuenta como "a horario" (igual que FRKiosko).
const MINUTOS_DE_MARGEN = 2;

// Entre cerrar una caja y abrir la siguiente la misma persona: hasta acá sigue
// siendo la misma jornada.
const MINUTOS_PARA_SEGUIR = 30;

const MINUTO = 60 * 1000;

// Cierres que no cuentan para los horarios (pedido del dueño, 2026-11-20): la
// primera caja de FRKiosko, la Mañana del 04/11, se abrió a las 13:25 porque ese
// día recién se empezó a usar el programa. No es que Zaira llegó 7 h 25 min
// tarde. Va el nombre del documento, que lleva la fecha: si algún día FRKiosko
// vuelve a empezar desde la caja 1, esa no queda afuera.
const CIERRES_QUE_NO_CUENTAN = new Set(["frkiosko-1-2026-11-04"]);

// Cómo terminó el rato de alguien con una caja.
const LA_ENTREGO = "entrego";     // se la pasó a quien llegó (relevo)
const LA_CERRO_ELLA = "cerro";    // hizo su Cierre de Turno
const SE_CERRO_SOLA = "forzoso";  // la cerró el programa
const LA_CERRO_OTRA = "otra";     // la cerró otra persona (en su ausencia, o el Admin)

// Horario del local, todos los días (también el domingo): Mañana 06–14, Tarde
// 14–22 y Noche 22–06 del día siguiente. La Noche va en el día en que empezó.
const HORA_DE_INICIO = { "mañana": 6, "tarde": 14, "noche": 22 };
const HORAS_DEL_TURNO = 8;

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// La persona elegida: su detalle queda abajo. Si cambia el mes y no trabajó, se
// elige la primera.
let elegida = null;

// ---------- Cuentas ----------

// La hora de un Timestamp de Firestore, sin los segundos: la pantalla muestra
// "06:17" y los minutos tienen que dar con eso. null si no viene.
function momento(ts) {
  if (!ts || typeof ts.toDate !== "function") return null;
  const d = ts.toDate();
  d.setSeconds(0, 0);
  return d;
}

const minutosEntre = (a, b) => Math.round((a - b) / MINUTO);

function inicioDelTurno(dia, turno) {
  const d = new Date(dia);
  d.setHours(HORA_DE_INICIO[turno], 0, 0, 0);
  return d;
}

function finDelTurno(dia, turno) {
  const d = inicioDelTurno(dia, turno);
  d.setHours(d.getHours() + HORAS_DEL_TURNO);
  return d;
}

const mismoTurno = (a, b) => a.dia.getTime() === b.dia.getTime() && a.turno === b.turno;

// Los minutos de una punta del día con el margen aplicado: dentro del margen es
// cero, "a horario".
const conMargen = (minutos) => Math.abs(minutos) <= MINUTOS_DE_MARGEN ? 0 : minutos;

// Cada rato que una persona tuvo una caja, en orden: desde que la abrió hasta que
// la cerró (o se cerró). Si la caja pasó de mano, dos ratos con la hora del pase
// desconocida (null).
function tramosDeLosCierres(cierres) {
  const tramos = [];
  cierres.forEach(f => {
    const desde = momento(f.abiertaEn);
    const hasta = momento(f.creadoEn);
    if (f.origen !== "frkiosko" || !desde || !hasta || !(f.turno in HORA_DE_INICIO) || !f.registradoPor) return;
    if (CIERRES_QUE_NO_CUENTAN.has(f.id)) return;
    const d = fechaDeRegistro(f);
    const turno = { dia: new Date(d.getFullYear(), d.getMonth(), d.getDate()), turno: f.turno };
    const quien = f.registradoPor;
    const abrio = f.abiertaPor || quien;
    const termino = f.forzoso ? SE_CERRO_SOLA : f.cerradoPor === quien ? LA_CERRO_ELLA : LA_CERRO_OTRA;
    if (abrio === quien) {
      tramos.push({ ...turno, quien, desde, hasta, termino, otra: f.cerradoPor, recibioDe: null });
    } else {
      tramos.push({ ...turno, quien: abrio, desde, hasta: null, termino: LA_ENTREGO, otra: quien, recibioDe: null });
      tramos.push({ ...turno, quien, desde: null, hasta, termino, otra: f.cerradoPor, recibioDe: abrio });
    }
  });
  const orden = (t) => (t.desde || t.hasta).getTime();
  return tramos.sort((a, b) => orden(a) - orden(b));
}

// Junta los tramos seguidos de una misma persona (ver MINUTOS_PARA_SEGUIR).
function jornadasDe(tramos) {
  const jornadas = [];
  const ultimaDe = new Map();
  tramos.forEach(t => {
    const anterior = ultimaDe.get(t.quien);
    const finAnterior = anterior ? anterior[anterior.length - 1].hasta : null;
    const pausa = finAnterior && t.desde ? t.desde - finAnterior : null;
    if (t.recibioDe === null && pausa !== null && pausa >= 0 && pausa <= MINUTOS_PARA_SEGUIR * MINUTO) {
      anterior.push(t);
    } else {
      const nueva = [t];
      jornadas.push(nueva);
      ultimaDe.set(t.quien, nueva);
    }
  });
  return jornadas;
}

// Los turnos que la jornada cubrió como suyos, en orden: los de las cajas que tuvo
// al menos la mitad del turno. La caja que abrió después de la suya y entregó a
// quien llegó tarde no cuenta: eso es cubrir, y lo que se quedó va a su favor. Si
// ninguno llega a la mitad, el que tuvo más tiempo.
function turnosPropios(jornada) {
  const minutos = new Map();
  jornada.forEach((t, i) => {
    if (i > 0 && t.termino === LA_ENTREGO) return;
    const clave = `${t.dia.getTime()}|${t.turno}`;
    const m = minutos.get(clave) || { dia: t.dia, turno: t.turno, minutos: 0 };
    m.minutos += t.desde && t.hasta ? minutosEntre(t.hasta, t.desde) : 0;
    minutos.set(clave, m);
  });
  const todos = Array.from(minutos.values());
  let propios = todos.filter(m => m.minutos * 2 >= HORAS_DEL_TURNO * 60);
  if (!propios.length) propios = [todos.reduce((a, b) => (b.minutos > a.minutos ? b : a))];
  return propios.sort((a, b) => inicioDelTurno(a.dia, a.turno) - inicioDelTurno(b.dia, b.turno));
}

// Un renglón del detalle: a qué hora llegó y se fue, contra qué horario y cuántos
// minutos de más (+) o de menos (−) en cada punta. null = sin dato.
function diaDeTrabajo(jornada) {
  const propios = turnosPropios(jornada);
  const inicio = inicioDelTurno(propios[0].dia, propios[0].turno);
  const fin = finDelTurno(propios[propios.length - 1].dia, propios[propios.length - 1].turno);
  const primero = jornada[0];
  const ultimo = jornada[jornada.length - 1];
  const llegada = primero.desde;
  const salida = ultimo.termino === LA_ENTREGO || ultimo.termino === LA_CERRO_ELLA ? ultimo.hasta : null;

  const quePaso = [];
  if (primero.recibioDe !== null) {
    quePaso.push(`Recibió la caja de ${primero.recibioDe}: FRKiosko no manda a qué hora`);
  }
  if (propios.length > 1) quePaso.push("Turno doble: " + propios.map(p => TURNO_LABEL[p.turno]).join(" y "));
  if (ultimo.termino === LA_ENTREGO) {
    const cubrio = jornada.length > 1 && !propios.some(p => mismoTurno(p, ultimo));
    const texto = cubrio ? `Cubrió hasta que llegó ${ultimo.otra}` : `Le entregó la caja a ${ultimo.otra}`;
    quePaso.push(ultimo.hasta ? texto : `${texto}: FRKiosko no manda a qué hora`);
  } else if (ultimo.termino === SE_CERRO_SOLA) {
    quePaso.push("La caja la cerró el programa: no se sabe a qué hora se fue");
  } else if (ultimo.termino === LA_CERRO_OTRA) {
    quePaso.push(`La caja la cerró ${ultimo.otra}: no se sabe a qué hora se fue`);
  }

  const alLlegar = llegada ? conMargen(minutosEntre(inicio, llegada)) : null;
  const alIrse = salida ? conMargen(minutosEntre(salida, fin)) : null;
  return {
    dia: propios[0].dia,
    turno: TURNO_LABEL[propios[0].turno],
    turnoLabel: propios.map(p => TURNO_LABEL[p.turno]).join(" y "),
    inicio, fin, llegada, salida, alLlegar, alIrse,
    delDia: (alLlegar || 0) + (alIrse || 0),
    quePaso: quePaso.join(" · ")
  };
}

function resumenDe(nombre, dias) {
  // El turno que más hizo; si empatan, el primero que hizo en el mes.
  const veces = new Map();
  dias.forEach(d => veces.set(d.turno, (veces.get(d.turno) || 0) + 1));
  let habitual = null;
  veces.forEach((n, turno) => { if (habitual === null || n > veces.get(habitual)) habitual = turno; });
  return {
    nombre,
    turnoHabitual: habitual,
    dias: dias.length,
    llegoTemprano: dias.filter(d => d.alLlegar !== null && d.alLlegar > 0).length,
    llegoTarde: dias.filter(d => d.alLlegar !== null && d.alLlegar < 0).length,
    seFueAntes: dias.filter(d => d.alIrse !== null && d.alIrse < 0).length,
    saldo: dias.reduce((s, d) => s + d.delDia, 0),
    detalle: dias
  };
}

// Los horarios de cada operador en el mes de `base` (el día en que empezó el
// turno): una tarjeta por persona que trabajó, por nombre. El saldo va en
// minutos: positivo = el local le debe tiempo; negativo = le debe al local.
export function horariosDelMes(base, cierres = facturacionesDelNegocio()) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const diasDe = new Map();
  jornadasDe(tramosDeLosCierres(cierres)).forEach(jornada => {
    const dia = diaDeTrabajo(jornada);
    if (dia.dia.getFullYear() !== y || dia.dia.getMonth() !== m) return;
    const quien = jornada[0].quien;
    if (!diasDe.has(quien)) diasDe.set(quien, []);
    diasDe.get(quien).push(dia);
  });
  return Array.from(diasDe.entries())
    .map(([nombre, dias]) => resumenDe(nombre, dias))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

// ---------- Textos (los mismos de FRKiosko) ----------

// 80 → "1 h 20 min"; sin el signo.
function duracion(minutos) {
  const horas = Math.floor(Math.abs(minutos) / 60);
  const resto = Math.abs(minutos) % 60;
  if (horas && resto) return `${horas} h ${resto} min`;
  return horas ? `${horas} h` : `${resto} min`;
}

// El saldo mirado desde el dueño: positivo = el local le debe tiempo.
function fraseDelSaldo(saldo) {
  if (saldo > 0) return { texto: `LE DEBÉS ${duracion(saldo)}`, tono: "verde" };
  if (saldo < 0) return { texto: `TE DEBE ${duracion(saldo)}`, tono: "rojo" };
  return { texto: "ESTÁN A MANO", tono: "gris" };
}

function textoAlLlegar(min) {
  if (min > 0) return { texto: `${duracion(min)} antes`, tono: "verde" };
  if (min < 0) return { texto: `${duracion(min)} tarde`, tono: "rojo" };
  return { texto: "a horario", tono: "gris" };
}

function textoAlIrse(min) {
  if (min > 0) return { texto: `se quedó ${duracion(min)}`, tono: "verde" };
  if (min < 0) return { texto: `${duracion(min)} antes`, tono: "rojo" };
  return { texto: "a horario", tono: "gris" };
}

function textoDelDia(min) {
  if (min > 0) return { texto: `+${duracion(min)}`, tono: "verde" };
  if (min < 0) return { texto: `−${duracion(min)}`, tono: "rojo" };
  return { texto: "0", tono: "gris" };
}

const hora = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fechaCorta = (d) => `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

// ---------- Pantalla ----------

function avatarHtml(nombre) {
  return `<span class="cmp-av hor-av" style="background:${payerColorVar(nombre)}" aria-hidden="true">${escapeHtml(nombre.trim().charAt(0).toUpperCase())}</span>`;
}

function tarjetaHtml(p) {
  const saldo = fraseDelSaldo(p.saldo);
  const numero = (valor, rotulo, tono) => `
      <span class="hor-num"><b class="${valor ? `hor-${tono}` : ""}">${valor}</b><small>${rotulo}</small></span>`;
  return `
    <button type="button" class="hor-tarjeta" data-persona="${escapeHtml(p.nombre)}" aria-pressed="${p.nombre === elegida}">
      <span class="hor-tarjeta-cab">${avatarHtml(p.nombre)}
        <span class="hor-tarjeta-nombre"><b>${escapeHtml(p.nombre.toUpperCase())}</b><small>${escapeHtml(p.turnoHabitual)} · ${p.dias === 1 ? "1 día trabajado" : `${p.dias} días trabajados`}</small></span>
      </span>
      <span class="hor-nums">${numero(p.llegoTemprano, "llegó<br>temprano", "verde")}${numero(p.llegoTarde, "llegó<br>tarde", "rojo")}${numero(p.seFueAntes, "se fue<br>antes", "rojo")}</span>
      <span class="hor-saldo hor-saldo-${saldo.tono}">${saldo.texto}</span>
    </button>`;
}

const SIN_DATO = `<span class="hor-pastilla">SIN DATO</span>`;

function diaHtml(d) {
  const delDia = textoDelDia(d.delDia);
  const punta = (rotulo, cuando, min, texto) => cuando === null
    ? `<span class="hor-punta">${rotulo} <b>—</b> ${SIN_DATO}</span>`
    : `<span class="hor-punta">${rotulo} <b>${hora(cuando)}</b> ${min === null ? SIN_DATO : `<em class="hor-${texto(min).tono}">${texto(min).texto}</em>`}</span>`;
  return `
    <li class="hor-dia">
      <div class="hor-dia-cab">
        <b class="hor-dia-fecha">${fechaCorta(d.dia)}</b>
        <span class="hor-dia-turno">${escapeHtml(d.turnoLabel)} <small>${hora(d.inicio)} a ${hora(d.fin)}</small></span>
        <b class="hor-dia-total hor-${delDia.tono}">${delDia.texto}</b>
      </div>
      <div class="hor-dia-puntas">
        ${punta("Llegó", d.llegada, d.alLlegar, textoAlLlegar)}
        ${punta("Se fue", d.salida, d.alIrse, textoAlIrse)}
      </div>
      ${d.quePaso ? `<p class="hor-dia-paso">${escapeHtml(d.quePaso)}</p>` : ""}
    </li>`;
}

function detalleHtml(p) {
  const saldo = fraseDelSaldo(p.saldo);
  return `
    <div class="cmp-card hor-detalle">
      <div class="hor-detalle-cab">
        <h3 class="cmp-card-titulo">${escapeHtml(p.nombre.toUpperCase())} — DÍA POR DÍA</h3>
        <span class="hor-saldo hor-saldo-${saldo.tono}">${saldo.texto}</span>
      </div>
      <ul class="hor-dias">${p.detalle.map(diaHtml).join("")}</ul>
    </div>`;
}

const AYUDA = `Llegada = cuando abrió su caja en FRKiosko. Salida = cuando la cerró. Si la caja la cerró el programa u otra persona, la salida queda "sin dato" y no suma ni resta. Si la caja pasó de mano (la recibió la que llegó), FRKiosko no manda a qué hora: esa salida y esa llegada también quedan "sin dato". Solo entran los cierres que manda FRKiosko (los cargados a mano no traen la hora en que se abrió la caja). Tocá una tarjeta para ver el detalle de esa persona.`;

// Dibuja la vista en `cont` para el mes de `base`.
export function renderHorarios(cont, base, nombreMes) {
  const personas = horariosDelMes(base);
  const cabecera = `
    <div class="cmp-card hor-cabecera">
      <h3 class="cmp-card-titulo">Horarios del personal</h3>
      <p class="cmp-card-sub">Cuándo abrió y cerró su caja cada operador en FRKiosko, comparado con el horario de su turno. Hasta ${MINUTOS_DE_MARGEN} minutos antes o después cuenta como "a horario".</p>
    </div>`;
  if (!personas.length) {
    cont.innerHTML = `${cabecera}<div class="cmp-card"><p class="cmp-vacio-chico">No hay cierres de FRKiosko en ${nombreMes}.</p></div>`;
    return;
  }
  if (!personas.some(p => p.nombre === elegida)) elegida = personas[0].nombre;
  const persona = personas.find(p => p.nombre === elegida);
  cont.innerHTML = `${cabecera}
    <div class="hor-tarjetas">${personas.map(tarjetaHtml).join("")}</div>
    ${detalleHtml(persona)}
    <p class="cmp-nota-mes">${AYUDA}</p>`;
}

// El dato de la ficha: cuántas veces se llegó tarde en el mes (de todos).
export function fichaHorariosHtml(base) {
  const personas = horariosDelMes(base);
  if (!personas.length) return `<small class="cmp-ficha-nada">Sin cierres de FRKiosko</small>`;
  const tarde = personas.reduce((s, p) => s + p.llegoTarde, 0);
  const antes = personas.reduce((s, p) => s + p.seFueAntes, 0);
  return `<span class="hor-ficha"><b class="${tarde ? "hor-rojo" : ""}">${tarde}</b><small>${tarde === 1 ? "llegada tarde" : "llegadas tarde"}</small>`
    + `<b class="${antes ? "hor-rojo" : ""}">${antes}</b><small>${antes === 1 ? "salida antes" : "salidas antes"}</small></span>`;
}

// Tocar una tarjeta muestra el detalle de esa persona. `redibujar` vuelve a
// pintar la vista.
export function initHorarios(redibujar) {
  $("#cmp-horario-contenido").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-persona]");
    if (!b) return;
    elegida = b.dataset.persona;
    redibujar();
  });
}
