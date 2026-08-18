/**
 * Constantes de seguridad por defecto del módulo SII.
 *
 * ADVERTENCIA: DEFAULT_SII_MASTER_KEY es un valor de desarrollo únicamente.
 * En producción DEBE setearse la variable de entorno SII_MASTER_KEY con un
 * valor aleatorio de al menos 32 caracteres. Los servicios bloquean la emisión
 * de DTEs y el guardado de firmas si detectan este valor por defecto en producción.
 */
export const DEFAULT_SII_MASTER_KEY = 'default-chilean-sii-saas-master-key-32-characters!';

/**
 * Indica si la master key provista es el valor por defecto de desarrollo.
 * Centraliza la verificación para evitar comparaciones de string dispersas.
 */
export function isDefaultMasterKey(masterKey: string): boolean {
  return masterKey === DEFAULT_SII_MASTER_KEY;
}
