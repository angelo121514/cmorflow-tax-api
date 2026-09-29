import { CafService } from './caf.service';
import { DiscountEngine } from './discount.engine';
import { DteXmlEngine } from './dte-xml.engine';

describe('DteXmlEngine — descuentos XML estándar', () => {
  it('emite descuentos de detalle directos y descuento global con unidad monetaria coherente', () => {
    const cafService = {
      parse: jest.fn().mockReturnValue({ rawXml: '<CAF version="1.0" />' }),
      assertFolioAllowed: jest.fn(),
    } as unknown as CafService;
    const cafPrivateKey = { sign: jest.fn().mockReturnValue('firma-caf-de-prueba') };
    const engine = new DteXmlEngine(cafService, new DiscountEngine());

    const result = engine.buildDte({
      type: 33,
      folio: 42,
      issueDate: '2026-09-20',
      issuer: {
        rut: '76111222-3',
        businessName: 'Emisor de prueba SpA',
        giro: 'Servicios',
        address: 'Av. Emisor 123',
        commune: 'Santiago',
        city: 'Santiago',
      },
      receiver: {
        rut: '12345678-9',
        businessName: 'Cliente de prueba Ltda.',
        giro: 'Comercio',
        address: 'Calle Cliente 456',
        commune: 'Providencia',
        city: 'Santiago',
      },
      items: [
        { name: 'Servicio porcentual', quantity: 2, price: 1000, discountPercentage: 10 },
        { name: 'Servicio por monto', quantity: 1, price: 1000, discountAmount: 200 },
      ],
      globalDiscountPercentage: 5,
      cafXml: '<AUTORIZACION />',
      cafPrivateKey: cafPrivateKey as any,
    });

    expect(result.xml).toContain(
      '<Detalle><NroLinDet>1</NroLinDet><NmbItem>Servicio porcentual</NmbItem><QtyItem>2</QtyItem><PrcItem>1000</PrcItem><DescuentoPct>10</DescuentoPct><MontoItem>1800</MontoItem></Detalle>',
    );
    expect(result.xml).toContain(
      '<Detalle><NroLinDet>2</NroLinDet><NmbItem>Servicio por monto</NmbItem><QtyItem>1</QtyItem><PrcItem>1000</PrcItem><DescuentoMonto>200</DescuentoMonto><MontoItem>800</MontoItem></Detalle>',
    );
    expect(result.xml).not.toContain('<DscItem>');

    // El motor calcula un descuento monetario de $130 sobre el neto de $2.600,
    // pero el contrato de entrada expresa el ajuste global como porcentaje.
    // Por eso el XML debe conservar la unidad % y el valor 5.
    expect(result.totals.globalDiscountAmount).toBe(130);
    expect(result.xml).toContain(
      '<DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov><GlosaDR>Descuento global afectos</GlosaDR><TpoValor>%</TpoValor><ValorDR>5</ValorDR></DscRcgGlobal>',
    );
    expect(result.xml.indexOf('<DscRcgGlobal>')).toBeGreaterThan(result.xml.lastIndexOf('</Detalle>'));
    expect(result.xml.indexOf('<DscRcgGlobal>')).toBeLessThan(result.xml.indexOf('<TED'));
    expect(result.xml).not.toContain('<DscRcgloGlobal>');
  });
});
