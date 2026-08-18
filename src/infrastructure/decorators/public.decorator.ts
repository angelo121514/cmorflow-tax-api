import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata para marcar rutas como públicas.
 * El JwtAuthGuard global omite la verificación de token en rutas marcadas.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorador para marcar un controller o método como público (sin JWT).
 *
 * Uso:
 *   @Public()
 *   @Post('login')
 *   login() { ... }
 *
 *   @Public()
 *   @Controller('health')
 *   class HealthController { ... }
 *
 * Necesario desde que JwtAuthGuard se registró como guard global (ISSUE-011),
 * para que endpoints como /auth/login, /auth/register-tenant, /health y los
 * webhooks de pago sigan siendo accesibles sin autenticación.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
