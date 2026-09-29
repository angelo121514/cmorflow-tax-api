import { Test, TestingModule } from '@nestjs/testing';
import type { SharpConstructor } from 'sharp';
import { PdfGenerator } from './pdf.generator';

const sharp = require('sharp') as SharpConstructor;

const createLogo = () => sharp({
  create: { width: 12, height: 8, channels: 4, background: { r: 18, g: 52, b: 86, alpha: 1 } },
}).png().toBuffer();

function buildXml(options: {
  lines?: number;
  includeTed?: boolean;
  transport?: boolean;
  reference?: boolean;
  fractionalValues?: boolean;
} = {}): string {
  const lineCount = options.lines ?? 1;
  const unitPrice = options.fractionalValues ? '1234.567890' : '1000';
  const lineAmount = options.fractionalValues ? '1235' : '1000';
  const details = Array.from({ length: lineCount }, (_, index) => (
    `<Detalle><NroLinDet>${index + 1}</NroLinDet><NmbItem>Servicio ${index + 1}</NmbItem><QtyItem>1</QtyItem><PrcItem>${unitPrice}</PrcItem>${index === 0 ? '<DescuentoPct>10</DescuentoPct><RecargoMonto>25</RecargoMonto>' : ''}<MontoItem>${lineAmount}</MontoItem></Detalle>`
  )).join('');
  const total = lineCount * Number(lineAmount);
  const transport = options.transport
    ? '<Transporte><FchSalida>2026-09-20</FchSalida><HraSalida>10:30:00</HraSalida><DirOrigen>Av. Emisor 123</DirOrigen><CmnaOrigen>Santiago</CmnaOrigen><DirDest>Calle Cliente 456</DirDest><CmnaDest>Providencia</CmnaDest><Chofer><RUTChofer>12345678-5</RUTChofer><NombreChofer>Patricio Chofer</NombreChofer></Chofer><Patente>ABCD12</Patente></Transporte>'
    : '';
  const reference = options.reference
    ? '<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>33</TpoDocRef><FolioRef>77</FolioRef><FchRef>2026-09-01</FchRef><RazonRef>Corrección de precio</RazonRef></Referencia>'
    : '';
  const ted = options.includeTed === false
    ? ''
    : `<TED version="1.0"><DD><RE>76111222-3</RE><TD>33</TD><F>15</F><FE>2026-09-20</FE><RR>12345678-9</RR><RSR>Cliente XML</RSR><MNT>${total}</MNT><IT1>Servicio 1</IT1></DD><FRMT algoritmo="SHA1withRSA">firma-simulada</FRMT></TED>`;
  const adjustments = `<DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov><GlosaDR>Descuento comercial</GlosaDR><TpoValor>%</TpoValor><ValorDR>5</ValorDR></DscRcgGlobal><DscRcgGlobal><NroLinDR>2</NroLinDR><TpoMov>R</TpoMov><GlosaDR>Recargo despacho</GlosaDR><TpoValor>$</TpoValor><ValorDR>${options.fractionalValues ? '1.50' : '250'}</ValorDR></DscRcgGlobal>`;
  return `<?xml version="1.0" encoding="ISO-8859-1"?><DTE version="1.0"><Documento ID="DocumentoDTE"><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>15</Folio><FchEmis>2026-09-20</FchEmis></IdDoc><Emisor><RUTEmisor>76111222-3</RUTEmisor><RznSoc>Empresa XML SpA</RznSoc><GiroEmis>Servicios de software</GiroEmis><DirOrigen>Av. Emisor 123</DirOrigen><CmnaOrigen>Santiago</CmnaOrigen><CiudadOrigen>Santiago</CiudadOrigen></Emisor><Receptor><RUTRecep>12345678-9</RUTRecep><RznSocRecep>Cliente XML Ltda.</RznSocRecep><GiroRecep>Comercio</GiroRecep><DirRecep>Calle Cliente 456</DirRecep><CmnaRecep>Providencia</CmnaRecep><CiudadRecep>Santiago</CiudadRecep></Receptor>${transport}<Totales><MntNeto>${total}</MntNeto><TasaIVA>19</TasaIVA><IVA>0</IVA><ImptoReten><NroImpto>1</NroImpto><TipoImp>15</TipoImp><TasaImp>19</TasaImp><MontoImp>0</MontoImp></ImptoReten><MntTotal>${total}</MntTotal></Totales></Encabezado>${details}${adjustments}${reference}${ted}<TmstFirma>2026-09-20T12:00:00</TmstFirma></Documento></DTE>`;
}

describe('PdfGenerator', () => {
  let generator: PdfGenerator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfGenerator],
    }).compile();
    generator = module.get(PdfGenerator);
  });

  it('construye el modelo visible exclusivamente desde el XML firmado', () => {
    const model = generator.buildPrintModel(buildXml({ transport: true, reference: true }));

    expect(model.emitter.businessName).toBe('Empresa XML SpA');
    expect(model.receiver.businessName).toBe('Cliente XML Ltda.');
    expect(model.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Servicio 1',
        amount: 1000,
        adjustments: expect.arrayContaining([
          expect.objectContaining({ movement: 'D', valueType: '%', value: 10 }),
          expect.objectContaining({ movement: 'R', valueType: '$', value: 25 }),
        ]),
      }),
    ]));
    expect(model.totals).toEqual(expect.objectContaining({ netAmount: 1000, totalAmount: 1000 }));
    expect(model.totals.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ movement: 'D', valueType: '%', value: 5 }),
      expect.objectContaining({ movement: 'R', valueType: '$', value: 250 }),
    ]));
    expect(model.references[0]).toEqual(expect.objectContaining({ folio: '77', reason: 'Corrección de precio' }));
    expect(model.transport).toEqual(expect.objectContaining({ vehiclePlate: 'ABCD12', destinationCommune: 'Providencia' }));
  });

  it('preserva los decimales firmados en precios unitarios y ajustes monetarios', () => {
    const model = generator.buildPrintModel(buildXml({ fractionalValues: true }));

    expect(model.items[0]).toEqual(expect.objectContaining({ unitPrice: 1234.56789, unitPriceText: '1234.567890' }));
    expect(model.totals.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 1.5, rawValue: '1.50', valueType: '$' }),
    ]));
    expect((generator as any).formatCurrency(model.items[0].unitPrice, model.items[0].unitPriceText)).toBe('$1.234,567890');
    expect((generator as any).formatAdjustment(model.totals.adjustments[1])).toBe('+$1,50');
  });

  it('genera un PDF A4 usando una marca normalizada sin usar campos simulados del DTE', async () => {
    const logo = await createLogo();
    const pdfBuffer = await generator.generateDtePdf(
      {
        type: 33,
        folio: 15,
        // Estos datos no forman parte del modelo de impresión y no deben
        // alterar los valores extraídos del XML.
        receiverName: 'CLIENTE FALSO',
        amount: 999999,
        xmlContent: buildXml(),
      } as any,
      { businessName: 'Tenant falso' },
      { logoData: logo, logoMimeType: 'image/png', primaryColor: '#123456', secondaryColor: '#ABCDEF' },
    );

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfBuffer.length).toBeGreaterThan(1_000);
  });

  it('continúa el detalle en páginas adicionales en un documento de 60 líneas', async () => {
    const pdfBuffer = await generator.generateDtePdf({ type: 33, folio: 15, xmlContent: buildXml({ lines: 60 }) });
    const pages = (pdfBuffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

    expect(pages).toBeGreaterThan(1);
  });

  it('rechaza un DTE sin TED en vez de entregar un PDF sin timbre', async () => {
    await expect(
      generator.generateDtePdf({ type: 33, folio: 15, xmlContent: buildXml({ includeTed: false }) }),
    ).rejects.toThrow('no contiene un TED');
  });
});
