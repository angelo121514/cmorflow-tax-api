// backend/src/application/integrations/integration-request.service.spec.ts
import { IntegrationRequestService } from './integration-request.service';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import { IntegrationRequestEntity, DteDocumentEntity } from '@domain';


/** Ejecuta y exige IntegrationApiException con el codigo del catalogo (y mensaje opcional). */
async function expectApiError(fn: () => any, code: string, messagePattern?: RegExp) {
  try {
    await fn();
    fail(`Se esperaba IntegrationApiException ${code}`);
  } catch (e: any) {
    const body = e.getResponse?.();
    expect(body.error.code).toBe(code);
    if (messagePattern) {
      expect(body.error.message).toMatch(messagePattern);
    }
  }
}

describe('IntegrationRequestService — idempotencia y validación B2B', () => {
  const tenantId = '22222222-0000-0000-0000-000000000002';
  const otherTenant = '33333333-0000-0000-0000-000000000003';
  let dataServices: any;
  let service: IntegrationRequestService;
  const dteXmlEngine: any = {
    calculateTotals: (_type: number, items: any[]) => {
      const net = items.reduce((s, i) => s + i.quantity * i.price, 0);
      const exemptAll = items.every((i) => i.exempt);
      return {
        netAmount: exemptAll ? 0 : Math.round(net),
        exemptAmount: exemptAll ? Math.round(net) : 0,
        ivaAmount: exemptAll ? 0 : Math.round(net * 0.19),
        totalAmount: exemptAll ? Math.round(net) : Math.round(net * 1.19),
      };
    },
  };

  beforeEach(() => {
    dataServices = {
      integrationRequest: new MemoryGenericRepository<IntegrationRequestEntity>(),
      dteDocument: new MemoryGenericRepository<DteDocumentEntity>(),
      rcofSubmission: new MemoryGenericRepository<any>(),
    };
    service = new IntegrationRequestService(dataServices, dteXmlEngine);
  });

  const body = JSON.stringify({ documentType: 39, items: [{ name: 'Agua', quantity: 1, unitPrice: 1000 }] });
  const enqueueInput = (overrides: any = {}) => ({
    tenantId,
    credentialId: 'cred-1',
    kind: 'dte' as const,
    idempotencyKey: 'idem-1',
    rawBody: body,
    payload: JSON.parse(body),
    ...overrides,
  });

  describe('idempotencia', () => {
    it('misma key + mismo body → replay con la misma solicitud (una sola fila)', async () => {
      const first = await service.enqueue(enqueueInput());
      const second = await service.enqueue(enqueueInput());
      expect(second.replayed).toBe(true);
      expect(second.request.id).toBe(first.request.id);
      const all = await dataServices.integrationRequest.getAll().toPromise();
      expect(all).toHaveLength(1);
    });

    it('misma key + body distinto → 409 IDEMPOTENCY_CONFLICT', async () => {
      await service.enqueue(enqueueInput());
      const other = enqueueInput({ rawBody: body.replace('1000', '2000') });
      await expect(service.enqueue(other)).rejects.toMatchObject({
        response: { error: { code: 'IDEMPOTENCY_CONFLICT' } },
      });
    });

    it('externalReference repetida con otra key → 409 EXTERNAL_REFERENCE_CONFLICT', async () => {
      await service.enqueue(enqueueInput({ externalReference: 'APR-1' }));
      await expect(
        service.enqueue(enqueueInput({ idempotencyKey: 'idem-2', externalReference: 'APR-1' })),
      ).rejects.toMatchObject({
        response: { error: { code: 'EXTERNAL_REFERENCE_CONFLICT' } },
      });
    });

    it('idempotencia y externalReference son POR TENANT', async () => {
      await service.enqueue(enqueueInput({ externalReference: 'APR-1' }));
      const other = await service.enqueue(
        enqueueInput({ tenantId: otherTenant, externalReference: 'APR-1' }),
      );
      expect(other.replayed).toBe(false);
    });
  });

  describe('validación condicional por tipo', () => {
    const payload = (overrides: any = {}) => ({
      documentType: 33,
      receiver: { rut: '76123456-7', name: 'Cliente SpA' },
      items: [{ name: 'Servicio', quantity: 1, unitPrice: 1000 }],
      ...overrides,
    });

    it('rechaza 56/61 en POST /dte (deben usar notas dedicadas)', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ documentType: 61 })),
        'VALIDATION_ERROR',
        /credit-notes/,
      );
    });

    it('notas permitidas con allowNoteTypes y exigen referencias', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ documentType: 61 }), { allowNoteTypes: true }),
        'VALIDATION_ERROR',
        /referencia/,
      );
      expect(() =>
        service.validatePayloadAndTotals(
          payload({ documentType: 61, references: [{ type: 33, folio: 1, date: '2026-08-01' }] }),
          { allowNoteTypes: true },
        ),
      ).not.toThrow();
    });

    it('33/34/46/52 exigen receptor con rut y nombre', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ receiver: undefined })),
        'VALIDATION_ERROR',
        /receiver/,
      );
    });

    it('boletas 39/41 no exigen receptor', async () => {
      expect(() =>
        service.validatePayloadAndTotals(payload({ documentType: 39, receiver: undefined })),
      ).not.toThrow();
    });

    it('exentas 34/41 exigen todos los ítems exentos; 39 no admite exentos', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ documentType: 34 })),
        'VALIDATION_ERROR',
        /exempt/,
      );
      expect(() =>
        service.validatePayloadAndTotals(
          payload({ documentType: 41, items: [{ name: 'x', quantity: 1, unitPrice: 10, exempt: true }] }),
        ),
      ).not.toThrow();
      await expectApiError(
        () =>
          service.validatePayloadAndTotals(
            payload({ documentType: 39, items: [{ name: 'x', quantity: 1, unitPrice: 10, exempt: true }] }),
          ),
        'VALIDATION_ERROR',
        /41/,
      );
    });

    it('guía 52 exige transport.transferType', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ documentType: 52 })),
        'VALIDATION_ERROR',
        /transport/,
      );
    });

    it('rechaza documentType fuera del catálogo', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ documentType: 35 })),
        'VALIDATION_ERROR',
        /documentType/,
      );
    });
  });

  describe('recálculo de totales (no se confía en el integrador)', () => {
    const payload = (overrides: any = {}) => ({
      documentType: 39,
      items: [{ name: 'Agua', quantity: 1, unitPrice: 1000, exempt: false }],
      ...overrides,
    });

    it('devuelve los totales del servidor', async () => {
      const { totals } = service.validatePayloadAndTotals(payload());
      expect(totals).toMatchObject({ netAmount: 1000, ivaAmount: 190, totalAmount: 1190 });
    });

    it('totals declarados que no coinciden → 422 TOTALS_MISMATCH', async () => {
      await expectApiError(
        () => service.validatePayloadAndTotals(payload({ totals: { totalAmount: 999 } })),
        'TOTALS_MISMATCH',
      );
    });

    it('tolerancia de $1 CLP por redondeo', async () => {
      expect(() =>
        service.validatePayloadAndTotals(payload({ totals: { totalAmount: 1190.5 } })),
      ).not.toThrow();
    });
  });

  describe('estado consolidado', () => {
    it('buildStatus refleja el estado SII cuando la solicitud seguía submitted', async () => {
      const { request } = await service.enqueue(enqueueInput());
      const dte = await dataServices.dteDocument
        .create({ tenantId, type: 39, folio: 1, status: 'ACEPTADO', trackId: 'T1', amount: 1190 } as any)
        .toPromise();
      await dataServices.integrationRequest
        .update(request.id!, { dteId: dte.id, state: 'submitted' } as any)
        .toPromise();
      const refreshed = await dataServices.integrationRequest.get(request.id!).toPromise();
      const status = await service.buildStatus(refreshed!);
      expect(status.status).toBe('accepted');
      expect(status.dte.trackId).toBe('T1');
      expect(status.dte.folio).toBe(1);
    });
  });
});
