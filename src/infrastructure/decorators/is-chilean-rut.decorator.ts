import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

/**
 * Valida un RUT chileno (con o sin puntos, con guion y dígito verificador).
 * Algoritmo Modulo 11.
 */
export function validateRut(rut: string): boolean {
  if (typeof rut !== 'string') return false;
  
  // Limpiar puntos, espacios y guion
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 8 || clean.length > 9) return false;
  
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  
  // Calcular Dígito Verificador
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  
  const dvr = 11 - (sum % 11);
  let expectedDv = '0';
  if (dvr === 10) expectedDv = 'K';
  else if (dvr === 11) expectedDv = '0';
  else expectedDv = String(dvr);
  
  return expectedDv === dv;
}

/**
 * Decorador class-validator para validar RUT chileno.
 */
export function IsChileanRut(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isChileanRut',
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message: `${propertyName} debe ser un RUT chileno válido (ej. 12345678-9 o 12.345.678-K)`,
        ...validationOptions,
      },
      validator: {
        validate(value: any, args: ValidationArguments) {
          return typeof value === 'string' && validateRut(value);
        },
      },
    });
  };
}
