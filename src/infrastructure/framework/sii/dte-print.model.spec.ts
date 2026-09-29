import { buildDtePrintModel } from './dte-print.model';

function buildXml(detailCount: number, name = 'Servicio'): string {
  const details = Array.from({ length: detailCount }, (_, index) => (
    `<Detalle><NroLinDet>${index + 1}</NroLinDet><NmbItem>${name}</NmbItem><QtyItem>1</QtyItem><PrcItem>1000</PrcItem><MontoItem>1000</MontoItem></Detalle>`
  )).join('');
  return `<?xml version="1.0" encoding="ISO-8859-1"?><DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>2026-09-20</FchEmis></IdDoc><Emisor><RUTEmisor>76111222-3</RUTEmisor><RznSoc>Emisor SpA</RznSoc></Emisor><Receptor><RUTRecep>12345678-9</RUTRecep><RznSocRecep>Receptor SpA</RznSocRecep></Receptor><Totales><MntTotal>1000</MntTotal></Totales></Encabezado>${details}<TED version="1.0"><DD /></TED></Documento></DTE>`;
}

describe('buildDtePrintModel — límites del esquema DTE', () => {
  it('rechaza más de 1000 líneas de detalle', () => {
    expect(() => buildDtePrintModel(buildXml(1001))).toThrow('más de 1000 líneas de detalle');
  });

  it('rechaza nombres de ítem de más de 80 caracteres', () => {
    expect(() => buildDtePrintModel(buildXml(1, 'x'.repeat(81)))).toThrow('NmbItem de más de 80 caracteres');
  });
});
