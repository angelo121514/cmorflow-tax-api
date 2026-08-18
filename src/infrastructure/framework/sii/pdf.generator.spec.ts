import { Test, TestingModule } from '@nestjs/testing';
import { PdfGenerator } from './pdf.generator';
import { DteDocumentEntity, TenantEntity } from '@domain';

describe('PdfGenerator', () => {
  let generator: PdfGenerator;

  const mockTenant: TenantEntity = {
    id: 'tenant-123',
    rut: '76111222-3',
    businessName: 'Mi Empresa SpA',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfGenerator],
    }).compile();

    generator = module.get<PdfGenerator>(PdfGenerator);
  });

  it('should be defined', () => {
    expect(generator).toBeDefined();
  });

  it('should generate a PDF buffer for Factura DTE 33', async () => {
    const mockDte = {
      type: 33,
      folio: 15,
      amount: 11900,
      receiverRut: '12345678-9',
      receiverName: 'Cliente Demo',
      xmlContent: '<DTE><TED version="1.0"><DD><RE>76111222-3</RE><TD>33</TD><F>15</F></DD><FRMT>Signed-Data</FRMT></TED></DTE>',
    };

    const pdfBuffer = await generator.generateDtePdf(mockDte, mockTenant);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should generate a PDF buffer for Guia DTE 52 with transport details', async () => {
    const mockDte = {
      type: 52,
      folio: 200,
      amount: 5000,
      receiverRut: '12345678-9',
      receiverName: 'Cliente Transportado',
      truckPlate: 'AB-CD-12',
      driverName: 'Pedro Perez',
      driverRut: '9876543-2',
      shippingType: 'Traslado por Venta',
      deliveryAddress: 'Av Principal 500',
      xmlContent: '<DTE><TED version="1.0"><DD><RE>76111222-3</RE><TD>52</TD><F>200</F></DD><FRMT>Signed-Data</FRMT></TED></DTE>',
    };

    const pdfBuffer = await generator.generateDtePdf(mockDte, mockTenant);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  it('should generate a PDF buffer for Nota de Credito DTE 61 with reference details', async () => {
    const mockDte = {
      type: 61,
      folio: 5,
      amount: 11900,
      receiverRut: '12345678-9',
      receiverName: 'Cliente Referenciado',
      references: [
        {
          lineIndex: 1,
          refDocType: 33,
          refFolio: 15,
          refDate: '2026-05-25',
          reason: 'Devolucion de mercaderia',
        }
      ],
      xmlContent: '<DTE><TED version="1.0"><DD><RE>76111222-3</RE><TD>61</TD><F>5</F></DD><FRMT>Signed-Data</FRMT></TED></DTE>',
    };

    const pdfBuffer = await generator.generateDtePdf(mockDte, mockTenant);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });
});
