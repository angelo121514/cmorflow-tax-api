import { validate } from 'class-validator';
import {
  DteItemDto,
  EmitDteDto,
} from './emit-dte.dto';
import {
  CreateIntegrationDteDto,
  IntegrationItemDto,
} from './create-integration-dte.dto';

const hasDecimalPrecisionError = async (dto: object, property: string): Promise<boolean> => {
  const errors = await validate(dto);
  return errors.some((error) => error.property === property && error.constraints?.isNumber);
};

describe('DTOs de descuentos — precisión porcentual', () => {
  it('rechaza más de dos decimales en descuentos por línea de ambas APIs', async () => {
    const directItem = Object.assign(new DteItemDto(), {
      name: 'Servicio',
      quantity: 1,
      price: 1000,
      discountPercentage: 10.123,
    });
    const integrationItem = Object.assign(new IntegrationItemDto(), {
      name: 'Servicio',
      quantity: 1,
      unitPrice: 1000,
      discountPercentage: 10.123,
    });

    await expect(hasDecimalPrecisionError(directItem, 'discountPercentage')).resolves.toBe(true);
    await expect(hasDecimalPrecisionError(integrationItem, 'discountPercentage')).resolves.toBe(true);
  });

  it('rechaza más de dos decimales en descuentos globales de ambas APIs', async () => {
    const direct = Object.assign(new EmitDteDto(), {
      type: 33,
      amount: 1000,
      items: [Object.assign(new DteItemDto(), { name: 'Servicio', quantity: 1, price: 1000 })],
      globalDiscountPercentage: 10.123,
    });
    const integration = Object.assign(new CreateIntegrationDteDto(), {
      documentType: 33,
      items: [Object.assign(new IntegrationItemDto(), { name: 'Servicio', quantity: 1, unitPrice: 1000 })],
      globalDiscountPercentage: 10.123,
    });

    await expect(hasDecimalPrecisionError(direct, 'globalDiscountPercentage')).resolves.toBe(true);
    await expect(hasDecimalPrecisionError(integration, 'globalDiscountPercentage')).resolves.toBe(true);
  });
});
