import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { IDataServices } from '../../../domain';
import { from, Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { TenantConfigService } from './tenant-config.service';

@Injectable()
export class CAFEngine {
  private readonly logger = new Logger(CAFEngine.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  /**
   * Obtiene el siguiente folio electrónico disponible para un tenant y tipo de DTE.
   * Optimizado usando find() con límite de 1 fila en orden descendente.
   */
  public getNextFolio(tenantId: string, dteType: number): Observable<number> {
    this.logger.log(`Solicitando próximo folio para Tenant: ${tenantId}, Tipo DTE: ${dteType}`);
    
    return this.dataServices.dteDocument.find({
      where: { type: dteType },
      order: { folio: 'DESC' },
      take: 1,
    }).pipe(
      map((documents) => {
        if (documents.length === 0) {
          this.logger.log(`No hay folios previos. Asignando Folio Inicial: 1`);
          return 1;
        }

        const maxFolio = documents[0].folio;
        const nextFolio = maxFolio + 1;
        this.logger.log(`Folio máximo previo: ${maxFolio}. Asignando Proximo Folio: ${nextFolio}`);
        return nextFolio;
      })
    );
  }

  /**
   * Reserva el siguiente folio de forma atómica.
   */
  public async reserveFolioAtomic(tenantId: string, dteType: number): Promise<number> {
    return this.tenantConfigService.reserveFolioAtomic(tenantId, dteType);
  }

  /**
   * Genera el XML del nodo CAF de simulación que autoriza los folios.
   */
  public generateSimulatedCafXml(rut: string, dteType: number, fromFolio: number, toFolio: number): string {
    return `
<CAF version="1.0">
  <DA>
    <RE>${rut}</RE>
    <RS>EMPRESA DE PRUEBA SPA</RS>
    <TD>${dteType}</TD>
    <RNG>
      <D>${fromFolio}</D>
      <H>${toFolio}</H>
    </RNG>
    <FA>2026-05-19</FA>
    <RSAPK>
      <M>un9V4...[CAF PUBLIC KEY]...3r==</M>
      <E>AQAB</E>
    </RSAPK>
  </DA>
  <FRMT algoritmo="SHA1withRSA">simulated-caf-signature-token-123456</FRMT>
</CAF>`;
  }
}
