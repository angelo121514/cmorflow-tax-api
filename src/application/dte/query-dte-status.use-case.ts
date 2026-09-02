import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Observable, from, forkJoin, throwError } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { IDataServices, AuditLogEntity } from '@domain';
import { SiiSoapClient } from '../../infrastructure/framework/sii/sii-soap.client';
import { SiiAuthTokenService } from '../../infrastructure/framework/sii/sii-auth-token.service';
import { SiiEnvironmentConfig } from '../../infrastructure/framework/sii/sii-environment.config';
import { TenantConfigService } from '../../infrastructure/framework/sii/tenant-config.service';

/** Token placeholder: el SII mock ignora el valor; el real lo reemplaza por sesión firmada. */
const MOCK_SESSION_TOKEN = 'simulated-sii-session-token-999';

@Injectable()
export class QueryDteStatusUseCase {
  private readonly logger = new Logger(QueryDteStatusUseCase.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly siiSoapClient: SiiSoapClient,
    private readonly siiEnvironmentConfig: SiiEnvironmentConfig,
    private readonly tenantConfigService: TenantConfigService,
    private readonly siiAuthTokenService: SiiAuthTokenService,
  ) {}

  /**
   * En modo real el query de TrackID exige un token de sesión firmado con el
   * certificado del tenant (mismo mecanismo que la transmisión). El token
   * placeholder sólo vale para el mock.
   */
  private async resolveSessionToken(tenantId: string): Promise<string> {
    if (this.siiEnvironmentConfig.integrationMode !== 'real') {
      return MOCK_SESSION_TOKEN;
    }
    const signature = await this.tenantConfigService.getDecryptedSignature(tenantId);
    if (!signature) {
      throw new BadRequestException(
        `El tenant ${tenantId} no tiene firma digital cargada; no se puede consultar el estado ante el SII.`,
      );
    }
    return this.siiAuthTokenService.getToken(tenantId, {
      pfxBase64: signature.pfxBase64,
      password: signature.passwordString,
    });
  }

  public execute(trackId: string, tenantId: string, userId?: string, ipAddress?: string, userAgent?: string): Observable<any> {
    this.logger.log(`Consultando estado en BD para trackId: ${trackId}...`);

    return from(this.dataServices.siiSubmission.findOne({ where: { trackId } })).pipe(
      map((submission) => {
        if (!submission) {
          throw new NotFoundException(`No se encontró ningún envío asociado al trackId: ${trackId}`);
        }
        return submission;
      }),
      switchMap((submission) =>
        from(this.resolveSessionToken(tenantId)).pipe(
          switchMap((sessionToken) =>
            // Llamar al cliente SOAP para consultar el estado actual ante el SII
            this.siiSoapClient.queryTrackStatus(trackId, sessionToken).pipe(
              switchMap((result) => {
                const { status } = result;

                // Actualizar la sumisión local
                submission.status = status === 'PROCESANDO' ? 'PENDIENTE' : (status === 'RECHAZADO' ? 'RECHAZADO' : 'PROCESADO');

                // Buscar y actualizar el DTE correspondiente usando trackId
                return from(this.dataServices.dteDocument.findOne({ where: { trackId } })).pipe(
                  map((relevantDte) => {
                    return { submission, relevantDte };
                  }),
                  switchMap(({ submission, relevantDte }) => {
                    const updates: Observable<any>[] = [
                      from(this.dataServices.siiSubmission.update(submission.id!, submission))
                    ];

                    if (relevantDte) {
                      if (status === 'ACEPTADO' || status === 'RECHAZADO' || status === 'REPARO') {
                        relevantDte.status = status;
                        relevantDte.statusHistory = [
                          ...(relevantDte.statusHistory || []),
                          {
                            status,
                            timestamp: new Date(),
                            user: userId || 'Sistema',
                            detail: `Consulta de TrackID: SII responde con estado ${status}.`
                          }
                        ];
                      }
                      updates.push(from(this.dataServices.dteDocument.update(relevantDte.id!, relevantDte)));
                    }

                    // Loguear auditoría
                    const auditLog = new AuditLogEntity();
                    auditLog.tenantId = tenantId;
                    auditLog.userId = userId;
                    auditLog.action = 'DTE_STATUS_CHECKED';
                    auditLog.ipAddress = ipAddress;
                    auditLog.userAgent = userAgent;
                    auditLog.payload = { trackId, status };
                    updates.push(from(this.dataServices.auditLog.create(auditLog)));

                    return forkJoin(updates).pipe(
                      map(() => ({
                        trackId,
                        status: status,
                        dteFolio: relevantDte ? relevantDte.folio : null,
                        message: `Estado del trackId ${trackId} actualizado correctamente.`,
                      }))
                    );
                  })
                );
              })
            )
          )
        )
      )
    );
  }
}
