import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Observable, from, forkJoin, throwError, of } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import {
  IDataServices,
  DteDocumentEntity,
  SiiSubmissionEntity,
  AuditLogEntity
} from '@domain';
import { SignatureEngine } from '../../infrastructure/framework/sii/signature.engine';
import { CAFEngine } from '../../infrastructure/framework/sii/caf.engine';
import { SiiSoapClient } from '../../infrastructure/framework/sii/sii-soap.client';
import { DteXmlBuilder } from '../../infrastructure/framework/sii/dte-xml.builder';
import { CertificateUtils } from '../../infrastructure/framework/sii/certificate.utils';
import { SiiAuthTokenService } from '../../infrastructure/framework/sii/sii-auth-token.service';
import { DteXmlEngine } from '../../infrastructure/framework/sii/dte-xml.engine';
import { TenantConfigService } from '../../infrastructure/framework/sii/tenant-config.service';
import { requiresSpecialAuth } from '../../infrastructure/framework/sii/dte-domain-rules';

@Injectable()
export class EmitDteUseCase {
  private readonly logger = new Logger(EmitDteUseCase.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly signatureEngine: SignatureEngine,
    private readonly cafEngine: CAFEngine,
    private readonly siiSoapClient: SiiSoapClient,
    private readonly dteXmlBuilder: DteXmlBuilder,
    private readonly siiAuthTokenService: SiiAuthTokenService,
    private readonly dteXmlEngine: DteXmlEngine,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  public execute(
    dto: any,
    tenantId: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Observable<any> {
    return this.prepare(dto, tenantId, userId).pipe(
      switchMap((savedDte) => {
        return this.transmit(savedDte.id!, tenantId, userId, ipAddress, userAgent, dto.simulatedUser);
      })
    );
  }

  public prepare(
    dto: any,
    tenantId: string,
    userId?: string
  ): Observable<DteDocumentEntity> {
    const { type, receiverRut, receiverName, receiverGiro, receiverAddress, receiverCommune, items, references, simulatedUser } = dto;
    this.logger.log(`Preparando DTE Tipo ${type} para el Tenant ${tenantId}...`);

    return from(this.dataServices.tenant.get(tenantId)).pipe(
      switchMap(async tenant => ({
        tenant,
        taxProfile: await this.tenantConfigService.requireTaxProfileForRealEmission(tenantId),
      })),
      switchMap(({ tenant, taxProfile }) => {
        if (!tenant) {
          return throwError(() => new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`));
        }

        this.logger.log(`Tenant localizado: ${tenant.businessName} (RUT: ${tenant.rut})`);

        // Gate de autorización: T46 (Factura de Compra) requiere autorización especial del SII.
        // Fuente: SII FAQ 6461 — no está habilitada para todos los contribuyentes.
        if (requiresSpecialAuth(type) && !taxProfile?.canIssueT46) {
          return throwError(() => new BadRequestException(
            'Factura de Compra Electrónica (T46) requiere autorización especial del SII. ' +
            'Solicítela mediante petición administrativa online (asunto: "solicitud de folios electrónicos y timbraje Dctos") ' +
            'o presencialmente con el Formulario 2117 en la unidad del SII correspondiente.'
          ));
        }

        return from(this.cafEngine.reserveFolioAtomic(tenantId, type)).pipe(
          switchMap((folio) => {
            return from(this.tenantConfigService.getDecryptedCafForFolio(tenantId, type, folio)).pipe(
              switchMap((cafMaterial) => from(this.tenantConfigService.getDecryptedSignature(tenantId)).pipe(
              switchMap((signatureObj) => {
                let certificatePfxBase64: string;
                let certPassword = '';

                if (signatureObj) {
                  certificatePfxBase64 = signatureObj.pfxBase64;
                  certPassword = signatureObj.passwordString;
                } else {
                  const isProduction = process.env.NODE_ENV === 'production';
                  if (isProduction) {
                    throw new BadRequestException('No se ha configurado una firma digital válida para la empresa en producción.');
                  }
                  
                  this.logger.log('No hay firma digital en DB. Generando certificado digital X.509 de simulación avanzada...');
                  const generated = CertificateUtils.generateMockChileanCertificate(
                    tenant.rut,
                    tenant.businessName,
                    '12345678-9',
                    'JUAN REPRESENTANTE SAAS'
                  );
                  certificatePfxBase64 = generated.pfxBase64;
                  certPassword = generated.password;
                }

                this.logger.log(`Construyendo XML DTE tipo ${type}...`);
                const builtDte = this.dteXmlEngine.buildDte({
                  type,
                  folio,
                  issuer: {
                    rut: tenant.rut,
                    businessName: tenant.businessName,
                    giro: taxProfile?.giro || 'SERVICIOS TECNOLOGICOS',
                    acteco: taxProfile?.activities[0] || '620100',
                    address: taxProfile?.address,
                    commune: taxProfile?.commune,
                    city: taxProfile?.city,
                  },
                  receiver: {
                    rut: receiverRut,
                    businessName: receiverName,
                    giro: receiverGiro || undefined,
                    address: receiverAddress || undefined,
                    commune: receiverCommune || undefined,
                    city: undefined,
                  },
                  items: items.map((item: any) => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    exempt: item.exempt,
                    discountPercentage: item.discountPercentage,
                    discountAmount: item.discountAmount,
                  })),
                  cafXml: cafMaterial.cafXml,
                  cafPrivateKey: cafMaterial.cafPrivateKey,
                  references: references ? references.map((ref: any) => ({
                    type: ref.type,
                    folio: ref.folio,
                    date: ref.date,
                    reasonCode: ref.reasonCode,
                    reason: ref.reason,
                  })) : undefined,
                  indTraslado: dto.indTraslado,
                  globalDiscountPercentage: dto.globalDiscountPercentage,
                  pricingMode: dto.pricingMode,
                  indServicio: dto.indServicio,
                  taxRetentions: dto.taxRetentions,
                  // Modelo de transporte de primera clase (Resolución SII 154/2025).
                  // Mapea los campos del DTO al DteTransport del dominio.
                  transport: dto.transport || (dto.destAddress || dto.destCommune ? {
                    transferType: dto.indTraslado || 1,
                    destinationAddress: dto.destAddress || receiverAddress || 'Direccion no informada',
                    destinationCommune: dto.destCommune || receiverCommune || 'Santiago',
                    originAddress: taxProfile?.address || 'Direccion no informada',
                    originCommune: taxProfile?.commune || 'Santiago',
                    carrierRut: dto.carrierRut,
                    driverRut: dto.driverRut || dto.carrierRut,
                    driverName: dto.driverName,
                    vehiclePlate: dto.vehiclePlate,
                    trailerPlate: dto.trailerPlate,
                    departureDate: dto.departureDate,
                    departureTime: dto.departureTime,
                    arrivalDate: dto.arrivalDate,
                  } : undefined),
                });
                const dteXml = builtDte.xml;

                this.logger.log(`Realizando firmado criptográfico (XMLDSig) del DTE ${type} final...`);
                const { signedXml: signedDteXml, signatureValue } = this.signatureEngine.signXml(
                  dteXml,
                  certificatePfxBase64,
                  certPassword,
                  'DocumentoDTE'
                );

                const dteDoc = new DteDocumentEntity();
                dteDoc.tenantId = tenantId;
                dteDoc.type = type;
                dteDoc.folio = folio;
                dteDoc.receiverRut = receiverRut;
                dteDoc.receiverName = receiverName;
                dteDoc.amount = builtDte.totals.totalAmount;
                dteDoc.xmlContent = signedDteXml;
                dteDoc.signatureValue = signatureValue;
                dteDoc.status = 'FIRMADO';

                const operator = simulatedUser?.name || 'Andrea Muñoz Silva';
                dteDoc.statusHistory = [
                  {
                    status: 'BORRADOR',
                    timestamp: new Date(),
                    user: operator,
                    detail: 'Documento creado y estructurado en memoria.'
                  },
                  {
                    status: 'FIRMADO',
                    timestamp: new Date(),
                    user: operator,
                    detail: 'Documento firmado digitalmente mediante XMLDSig.'
                  }
                ];

                return from(this.dataServices.dteDocument.create(dteDoc));
              }))
            ));
          })
        );
      })
    );
  }

  public transmit(
    dteId: string,
    tenantId: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string,
    simulatedUser?: any
  ): Observable<any> {
    this.logger.log(`Transmitiendo DTE ID ${dteId} al Sandbox del SII...`);

    return from(this.dataServices.dteDocument.get(dteId)).pipe(
      switchMap((savedDte) => {
        if (!savedDte || savedDte.tenantId !== tenantId) {
          return throwError(() => new NotFoundException(`DTE con ID ${dteId} no encontrado.`));
        }

        return from(this.dataServices.tenant.get(tenantId)).pipe(
          switchMap(async tenant => ({
            tenant,
            taxProfile: await this.tenantConfigService.requireTaxProfileForRealEmission(tenantId),
            tenantConfig: await this.tenantConfigService.getConfig(tenantId),
          })),
          switchMap(({ tenant, taxProfile, tenantConfig }) => {
            if (!tenant) {
              return throwError(() => new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`));
            }

            return from(this.tenantConfigService.getDecryptedSignature(tenantId)).pipe(
              switchMap((signatureObj) => {
                let certificatePfxBase64: string;
                let certPassword = '';
                let representativeRut = '12345678-9';

                if (signatureObj) {
                  certificatePfxBase64 = signatureObj.pfxBase64;
                  certPassword = signatureObj.passwordString;
                  representativeRut = signatureObj.metadata.representativeRut || '12345678-9';
                } else {
                  const isProduction = process.env.NODE_ENV === 'production';
                  if (isProduction) {
                    throw new BadRequestException('No se ha configurado una firma digital válida para la empresa en producción.');
                  }
                  const generated = CertificateUtils.generateMockChileanCertificate(
                    tenant.rut,
                    tenant.businessName,
                    '12345678-9',
                    'JUAN REPRESENTANTE SAAS'
                  );
                  certificatePfxBase64 = generated.pfxBase64;
                  certPassword = generated.password;
                }

                const isBoleta = savedDte.type === 39 || savedDte.type === 41;
                const envelopeXml = isBoleta
                  ? this.dteXmlEngine.buildEnvioBoleta({
                      issuerRut: tenant.rut,
                      senderRut: representativeRut,
                      signedDtes: [savedDte.xmlContent],
                      resolutionDate: taxProfile?.resolutionDate,
                      resolutionNumber: taxProfile?.resolutionNumber,
                      softwareProvider: tenantConfig?.softwareProvider,
                    })
                  : this.dteXmlEngine.buildEnvioDte({
                      issuerRut: tenant.rut,
                      senderRut: representativeRut,
                      receiverRut: savedDte.receiverRut,
                      signedDtes: [savedDte.xmlContent],
                      resolutionDate: taxProfile?.resolutionDate,
                      resolutionNumber: taxProfile?.resolutionNumber,
                    });

                const envelopeId = isBoleta ? 'EnvioBOLETA' : 'EnvioDTE';
                const { signedXml: signedEnvelopeXml } = this.signatureEngine.signXml(
                  envelopeXml,
                  certificatePfxBase64,
                  certPassword,
                  envelopeId
                );

                this.logger.log('Obteniendo token SII con cache de 11 horas...');
                return from(this.siiAuthTokenService.getToken(tenantId, {
                  pfxBase64: certificatePfxBase64,
                  password: certPassword,
                })).pipe(
                  switchMap((sessionToken) => {
                    this.logger.log(`Token de Sesión obtenido con éxito: ${sessionToken}`);

                    return this.siiSoapClient.sendDteEnvelope(signedEnvelopeXml, sessionToken).pipe(
                      switchMap((submissionResult) => {
                        const { trackId } = submissionResult;

                        const submission = new SiiSubmissionEntity();
                        submission.tenantId = tenantId;
                        submission.trackId = trackId;
                        submission.status = 'PENDIENTE';
                        submission.responseXml = signedEnvelopeXml;

                        const operator = simulatedUser?.name || 'Andrea Muñoz Silva';
                        savedDte.status = 'ENVIADO';
                        savedDte.trackId = trackId;
                        savedDte.statusHistory = [
                          ...(savedDte.statusHistory || []),
                          {
                            status: 'ENVIADO',
                            timestamp: new Date(),
                            user: operator,
                            detail: `Sobre DTE enviado exitosamente al Sandbox SII. TrackID: ${trackId}`
                          }
                        ];

                        const auditLog = new AuditLogEntity();
                        auditLog.tenantId = tenantId;
                        auditLog.userId = userId;
                        auditLog.action = 'DTE_EMITTED';
                        auditLog.ipAddress = ipAddress;
                        auditLog.userAgent = userAgent;
                        auditLog.payload = { 
                          dteId: savedDte.id, 
                          folio: savedDte.folio, 
                          type: savedDte.type, 
                          amount: savedDte.amount, 
                          trackId, 
                          tokenUsed: sessionToken,
                          repRut: representativeRut,
                          operatorName: operator,
                          operatorRut: simulatedUser?.rut || '17.842.102-5',
                          operatorId: simulatedUser?.id || userId
                        };

                        return forkJoin({
                          updatedDte: from(this.dataServices.dteDocument.update(savedDte.id!, savedDte)),
                          savedSubmission: from(this.dataServices.siiSubmission.create(submission)),
                          savedAudit: from(this.dataServices.auditLog.create(auditLog)),
                        }).pipe(
                          map(() => ({
                            success: true,
                            message: `DTE Folio ${savedDte.folio} emitido, firmado criptográficamente, autenticado vía SOAP y enviado al Sandbox SII exitosamente.`,
                            dteId: savedDte.id,
                            folio: savedDte.folio,
                            type: savedDte.type,
                            trackId,
                            status: 'ENVIADO',
                          }))
                        );
                      }),
                      catchError((transmissionError) => {
                        this.logger.error(`Error en la transmisión de recepción SOAP: ${transmissionError.message}`);
                        const operator = simulatedUser?.name || 'Andrea Muñoz Silva';
                        savedDte.status = 'BORRADOR';
                        savedDte.statusHistory = [
                          ...(savedDte.statusHistory || []),
                          {
                            status: 'BORRADOR',
                            timestamp: new Date(),
                            user: operator,
                            detail: `Fallo en transmisión SII: ${transmissionError.message}. Retornado a estado BORRADOR.`
                          }
                        ];
                        return from(this.dataServices.dteDocument.update(savedDte.id!, savedDte)).pipe(
                          switchMap(() => throwError(() => new Error(`Rechazo del Sandbox SII: ${transmissionError.message}`)))
                        );
                      })
                    );
                  })
                );
              }),
              catchError((soapAuthError) => {
                this.logger.error(`Fallo en el protocolo de autenticación del SII: ${soapAuthError.message}`);
                return throwError(() => new Error(`Fallo de Autenticación SOAP del SII: ${soapAuthError.message}`));
              })
            );
          })
        );
      })
    );
  }
}
