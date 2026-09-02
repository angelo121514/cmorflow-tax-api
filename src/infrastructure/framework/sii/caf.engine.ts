import { Injectable } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

@Injectable()
export class CAFEngine {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  /**
   * Reserva el siguiente folio de forma atómica.
   */
  public async reserveFolioAtomic(tenantId: string, dteType: number): Promise<number> {
    return this.tenantConfigService.reserveFolioAtomic(tenantId, dteType);
  }
}
