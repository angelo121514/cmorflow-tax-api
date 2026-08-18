/**
 * Utilidades de zona horaria para fechas del SII.
 *
 * El SII exige que `FchEmis`, `TSTED`, `TmstFirmaEnv` y similares estén en
 * hora de Chile (`America/Santiago`, UTC-3 en verano / UTC-4 en invierno),
 * NO en UTC. Antes se usaba `new Date().toISOString()` que siempre devuelve UTC.
 */

const SANTIAGO_TZ = 'America/Santiago';

/**
 * Retorna la fecha actual en Santiago en formato YYYY-MM-DD (para FchEmis / FE).
 */
export function nowSantiagoDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: SANTIAGO_TZ });
}

/**
 * Retorna el timestamp actual en Santiago en formato ISO 8601 con offset
 * (para TSTED / TmstFirmaEnv), sin milisegundos: `2026-06-28T15:30:00-04:00`.
 *
 * Usa Intl.DateTimeFormat con `formatToParts` para construir el string en la
 * zona horaria correcta, y calcula el offset desde el host para respetar DST.
 */
export function nowSantiagoTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTIAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // Intl puede emitir "24" para medianoche en hour12:false; normalizar a "00".
  const hour = get('hour') === '24' ? '00' : get('hour');
  const minute = get('minute');
  const second = get('second');

  const offset = getSantiagoOffset();
  const sign = offset >= 0 ? '-' : '+';
  const absOffset = Math.abs(offset);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMinutes = String(absOffset % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Calcula el offset de Santiago respecto a UTC en minutos (ej. -180 para UTC-3).
 * Usa dos mediciones (en el instante actual y 6 meses después) para detectar DST.
 */
function getSantiagoOffset(): number {
  const now = new Date();
  const utcMs = now.getTime();
  const santiagoAsUtc = new Date(now.toLocaleString('en-US', { timeZone: SANTIAGO_TZ }));
  const hostAsUtc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((hostAsUtc.getTime() - santiagoAsUtc.getTime()) / 60000);
}
