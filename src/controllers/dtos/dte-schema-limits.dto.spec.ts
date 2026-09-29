import { validate } from 'class-validator';
import { CreateIntegrationDteDto, CreateIntegrationNoteDto, IntegrationItemDto } from './create-integration-dte.dto';
import { DteItemDto, EmitDteDto } from './emit-dte.dto';

const oversizedItems = <T>(item: T): T[] => Array.from({ length: 1001 }, () => item);

const hasConstraint = async (dto: object, property: string, constraint: string): Promise<boolean> => {
  const errors = await validate(dto);
  return errors.some((error) => error.property === property && !!error.constraints?.[constraint]);
};

describe('DTOs DTE — límites del esquema', () => {
  it('rechaza nombres de ítem de más de 80 caracteres en ambos contratos', async () => {
    const name = 'x'.repeat(81);
    const direct = Object.assign(new DteItemDto(), { name, quantity: 1, price: 1000 });
    const integration = Object.assign(new IntegrationItemDto(), { name, quantity: 1, unitPrice: 1000 });

    await expect(hasConstraint(direct, 'name', 'maxLength')).resolves.toBe(true);
    await expect(hasConstraint(integration, 'name', 'maxLength')).resolves.toBe(true);
  });

  it('rechaza más de 1000 líneas tanto en emisión directa como en integración', async () => {
    const directItem = Object.assign(new DteItemDto(), { name: 'Servicio', quantity: 1, price: 1000 });
    const integrationItem = Object.assign(new IntegrationItemDto(), { name: 'Servicio', quantity: 1, unitPrice: 1000 });
    const direct = Object.assign(new EmitDteDto(), { type: 33, amount: 1000, items: oversizedItems(directItem) });
    const integration = Object.assign(new CreateIntegrationDteDto(), { documentType: 33, items: oversizedItems(integrationItem) });
    const note = Object.assign(new CreateIntegrationNoteDto(), { reasonCode: 1, reason: 'Anulación', items: oversizedItems(integrationItem) });

    await expect(hasConstraint(direct, 'items', 'arrayMaxSize')).resolves.toBe(true);
    await expect(hasConstraint(integration, 'items', 'arrayMaxSize')).resolves.toBe(true);
    await expect(hasConstraint(note, 'items', 'arrayMaxSize')).resolves.toBe(true);
  });
});
