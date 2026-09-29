import { DiscountEngine } from './discount.engine';

describe('DiscountEngine — precisión de porcentajes SII', () => {
  const engine = new DiscountEngine();

  it('rechaza descuentos por línea con más de dos decimales', () => {
    expect(() => engine.applyItemDiscount({
      name: 'Servicio',
      quantity: 1,
      price: 1000,
      discountPercentage: 12.345,
    })).toThrow('máximo 2 decimales');
  });

  it('rechaza descuentos globales con más de dos decimales', () => {
    expect(() => engine.applyGlobalDiscount(1000, 5.123)).toThrow('máximo 2 decimales');
  });

  it('admite porcentajes con hasta dos decimales', () => {
    expect(engine.applyItemDiscount({
      name: 'Servicio',
      quantity: 1,
      price: 1000,
      discountPercentage: 12.34,
    }).discountAmount).toBe(123);
    expect(engine.applyGlobalDiscount(1000, 5.55).discountAmount).toBe(56);
  });
});
