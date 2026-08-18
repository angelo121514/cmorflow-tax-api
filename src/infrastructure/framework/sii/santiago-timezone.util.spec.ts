import { nowSantiagoDate, nowSantiagoTimestamp } from './santiago-timezone.util';

describe('Santiago timezone (ISSUE-008)', () => {
  it('nowSantiagoDate debe retornar formato YYYY-MM-DD', () => {
    const date = nowSantiagoDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('nowSantiagoTimestamp debe retornar ISO con offset de Chile (-03:00 o -04:00)', () => {
    const ts = nowSantiagoTimestamp();
    // Formato: YYYY-MM-DDTHH:MM:SS-03:00 (verano) o -04:00 (invierno)
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-(03|04):00$/);
    // No debe contener 'Z' (que indicaría UTC)
    expect(ts).not.toMatch(/Z$/);
  });

  it('nowSantiagoTimestamp no debe incluir milisegundos', () => {
    const ts = nowSantiagoTimestamp();
    expect(ts).not.toMatch(/\.\d+/);
  });

  it('la fecha y timestamp deben ser consistentes (mismo día en Santiago)', () => {
    const date = nowSantiagoDate();
    const ts = nowSantiagoTimestamp();
    expect(ts.startsWith(date)).toBe(true);
  });
});
