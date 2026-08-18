import { Test, TestingModule } from '@nestjs/testing';
import { CafService } from './caf.service';

describe('CafService', () => {
  let service: CafService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CafService],
    }).compile();

    service = module.get<CafService>(CafService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parse()', () => {
    it('acepta una autorización SII completa, separa el CAF para TED y obtiene RSASK en PEM', () => {
      const authorizationXml = service.createSimulationCaf('76.111.222-3', 33, 10, 20);

      const parsed = service.parse(authorizationXml);

      expect(parsed.rawXml).toMatch(/^<CAF version="1.0">/);
      expect(parsed.rawXml).toContain('<FRMA algoritmo="SHA1withRSA">');
      expect(parsed.rawXml).not.toContain('<RSASK>');
      expect(parsed.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(service.extractPrivateKey(authorizationXml)).not.toBeNull();
    });

    it('should successfully parse a structurally valid CAF XML', () => {
      const validCafXml =
        '<CAF version="1.0">' +
        '<DA>' +
        '<RE>76.111.222-3</RE>' +
        '<RS>EMPRESA DE PRUEBA SPA</RS>' +
        '<TD>33</TD>' +
        '<RNG><D>10</D><H>20</H></RNG>' +
        '<FA>2026-05-31</FA>' +
        '<RSAPK><M>modulusBytes</M><E>exponentBytes</E></RSAPK>' +
        '</DA>' +
        '<FRMT algoritmo="SHA1withRSA">signatureBytes</FRMT>' +
        '</CAF>';

      const parsed = service.parse(validCafXml);
      expect(parsed.issuerRut).toBe('76.111.222-3');
      expect(parsed.type).toBe(33);
      expect(parsed.rangeFrom).toBe(10);
      expect(parsed.rangeTo).toBe(20);
      expect(parsed.authorizationDate).toBe('2026-05-31');
    });

    it('should throw error if XML is missing root CAF version="1.0"', () => {
      const invalidXml = '<CAF><DA></DA></CAF>';
      expect(() => service.parse(invalidXml)).toThrow(
        'El archivo no es un CAF válido'
      );
    });

    it('should throw error if XML is missing mandatory nodes', () => {
      // Falta nodo RE
      const missingReCaf =
        '<CAF version="1.0">' +
        '<DA>' +
        '<RS>EMPRESA DE PRUEBA SPA</RS>' +
        '<TD>33</TD>' +
        '<RNG><D>10</D><H>20</H></RNG>' +
        '<FA>2026-05-31</FA>' +
        '<RSAPK><M>mod</M><E>exp</E></RSAPK>' +
        '</DA>' +
        '<FRMT algoritmo="SHA1withRSA">sig</FRMT>' +
        '</CAF>';

      expect(() => service.parse(missingReCaf)).toThrow(
        'El CAF no contiene el nodo obligatorio <RE> o está vacío.'
      );
    });

    it('should throw error if folio range is logically inverted', () => {
      const invertedRangeCaf =
        '<CAF version="1.0">' +
        '<DA>' +
        '<RE>76.111.222-3</RE>' +
        '<RS>EMPRESA DE PRUEBA SPA</RS>' +
        '<TD>33</TD>' +
        '<RNG><D>500</D><H>100</H></RNG>' +
        '<FA>2026-05-31</FA>' +
        '<RSAPK><M>mod</M><E>exp</E></RSAPK>' +
        '</DA>' +
        '<FRMT algoritmo="SHA1withRSA">sig</FRMT>' +
        '</CAF>';

      expect(() => service.parse(invertedRangeCaf)).toThrow(
        'El rango de folios es inválido: el folio inicial (500) es mayor que el folio final (100).'
      );
    });

    it('should throw error if folios in range are <= 0', () => {
      const zeroFolioCaf =
        '<CAF version="1.0">' +
        '<DA>' +
        '<RE>76.111.222-3</RE>' +
        '<RS>EMPRESA DE PRUEBA SPA</RS>' +
        '<TD>33</TD>' +
        '<RNG><D>0</D><H>100</H></RNG>' +
        '<FA>2026-05-31</FA>' +
        '<RSAPK><M>mod</M><E>exp</E></RSAPK>' +
        '</DA>' +
        '<FRMT algoritmo="SHA1withRSA">sig</FRMT>' +
        '</CAF>';

      expect(() => service.parse(zeroFolioCaf)).toThrow(
        'Los folios en el rango CAF deben ser mayores a 0.'
      );
    });

    it('should throw error if authorization date format is invalid', () => {
      const badDateCaf =
        '<CAF version="1.0">' +
        '<DA>' +
        '<RE>76.111.222-3</RE>' +
        '<RS>EMPRESA DE PRUEBA SPA</RS>' +
        '<TD>33</TD>' +
        '<RNG><D>10</D><H>20</H></RNG>' +
        '<FA>31-05-2026</FA>' +
        '<RSAPK><M>mod</M><E>exp</E></RSAPK>' +
        '</DA>' +
        '<FRMT algoritmo="SHA1withRSA">sig</FRMT>' +
        '</CAF>';

      expect(() => service.parse(badDateCaf)).toThrow(
        'El formato de la fecha de autorización <FA> (31-05-2026) es inválido. Debe ser YYYY-MM-DD.'
      );
    });
  });

  describe('assertFolioAllowed()', () => {
    const validCafXml =
      '<CAF version="1.0">' +
      '<DA>' +
      '<RE>76.111.222-3</RE>' +
      '<RS>EMPRESA DE PRUEBA SPA</RS>' +
      '<TD>33</TD>' +
      '<RNG><D>100</D><H>200</H></RNG>' +
      '<FA>2026-05-31</FA>' +
      '<RSAPK><M>mod</M><E>exp</E></RSAPK>' +
      '</DA>' +
      '<FRMT algoritmo="SHA1withRSA">sig</FRMT>' +
      '</CAF>';

    it('should succeed and return CafData if DTE type and folio are allowed', () => {
      const data = service.assertFolioAllowed(validCafXml, 33, 150);
      expect(data).toBeDefined();
      expect(data.rangeFrom).toBe(100);
      expect(data.rangeTo).toBe(200);
    });

    it('should throw error if DTE type does not match CAF DTE type', () => {
      expect(() => service.assertFolioAllowed(validCafXml, 39, 150)).toThrow(
        'El CAF es para tipo 33, no para DTE 39.'
      );
    });

    it('should throw error if folio is out of range', () => {
      expect(() => service.assertFolioAllowed(validCafXml, 33, 99)).toThrow(
        'El folio 99 está fuera del rango CAF 100-200.'
      );
      expect(() => service.assertFolioAllowed(validCafXml, 33, 201)).toThrow(
        'El folio 201 está fuera del rango CAF 100-200.'
      );
    });
  });
});
