import { Injectable } from '@nestjs/common';
import { DiscountEngine } from './discount.engine';
import * as forge from 'node-forge';
import { CafService } from './caf.service';
import { BuiltDteXml, DteBuildInput, DteLineItem, DteTotals, EnvioDteInput, SupportedDteType, RcofInput } from './dte-types';
import { Iso88591Encoder } from './iso-8859-1.encoder';
import { nowSantiagoDate, nowSantiagoTimestamp } from './santiago-timezone.util';
import {
  BOLETA_GENERIC_RECEIVER,
  BOLETA_ENVELOPE_RECEIVER,
  isBoleta,
  isPurchaseInvoice,
  TAX_TYPE_IVA_RETENTION_TOTAL,
} from './dte-domain-rules';


const DTE_NAMES: Record<SupportedDteType, string> = {
  33: 'Factura Electronica',
  34: 'Factura No Afecta o Exenta Electronica',
  39: 'Boleta Electronica',
  41: 'Boleta Exenta Electronica',
  46: 'Factura de Compra Electronica',
  52: 'Guia de Despacho Electronica',
  56: 'Nota de Debito Electronica',
  61: 'Nota de Credito Electronica',
};

@Injectable()
export class DteXmlEngine {
  constructor(
    private readonly cafService: CafService,
    private readonly discountEngine: DiscountEngine = new DiscountEngine(),
  ) {}

  buildDte(input: DteBuildInput): BuiltDteXml {
    this.assertSupportedType(input.type);
    const issueDate = input.issueDate || nowSantiagoDate();
    const totals = this.discountEngine.calculateTotals(input.type, input.items, {
      globalDiscountPercentage: input.globalDiscountPercentage,
      pricingMode: input.pricingMode,
    });
    const cafAuthorizationXml = input.cafXml || this.cafService.createSimulationCaf(input.issuer.rut, input.type);
    const cafData = this.cafService.parse(cafAuthorizationXml);
    this.cafService.assertFolioAllowed(cafAuthorizationXml, input.type, input.folio);
    // El TED sólo admite el bloque <CAF>, nunca el envoltorio <AUTORIZACION>
    // ni la llave privada RSASK.
    const cafXml = cafData.rawXml;

    // Resolver la clave privada del CAF para firmar el TED.
    // Prioridad: (1) clave provista por el vault del tenant, (2) clave RSASK
    // del archivo de autorización. La segunda ruta cubre sólo simulación/local.
    const cafPrivateKey = input.cafPrivateKey || this.cafService.extractPrivateKey(cafAuthorizationXml);
    if (!cafPrivateKey) {
      throw new Error(
        'No se pudo obtener la clave privada del CAF para firmar el TED. ' +
        'Carga el archivo <AUTORIZACION> completo y conserva RSASK cifrado para proveerlo en cafPrivateKey.',
      );
    }

    // Recalcular MntTotal considerando retenciones tributarias (T46).
    // MntTotal = Neto + Exento + IVA - Retenciones.
    // En retención total de IVA (TipoImp=15), MntTotal = Neto + Exento.
    let computedTotal = totals.totalAmount;
    let retentionAmount = 0;
    if (input.taxRetentions && input.taxRetentions.length > 0) {
      retentionAmount = input.taxRetentions.reduce((sum, r) => sum + r.amount, 0);
      computedTotal = totals.netAmount + totals.exemptAmount + totals.ivaAmount - retentionAmount;
    }
    const totalsWithRetention: DteTotals = {
      ...totals,
      totalAmount: computedTotal,
      ...(retentionAmount > 0 ? { retentionAmount } : {}),
    };

    const tedXml = this.buildTed(input, totalsWithRetention, issueDate, cafXml, cafPrivateKey);
    const detailsXml = input.items.map((item, index) => this.buildDetail(item, index + 1)).join('');

    // Referencia al SET del SII (boletas de certificación): <TpoDocRef>SET</TpoDocRef>
    // Se renderiza como primera referencia antes de las referencias normales.
    const setRefXml = input.setRef
      ? `<Referencia>` +
        `<NroLinRef>1</NroLinRef>` +
        `<TpoDocRef>${this.escapeXml(input.setRef)}</TpoDocRef>` +
        `${input.setRefReason ? `<RazonRef>${this.escapeXml(input.setRefReason)}</RazonRef>` : ''}` +
        `</Referencia>`
      : '';
    const setRefOffset = input.setRef ? 1 : 0;

    const referencesXml = (input.references || []).map((reference, index) =>
      `<Referencia>` +
      `<NroLinRef>${index + 1 + setRefOffset}</NroLinRef>` +
      `<TpoDocRef>${reference.type}</TpoDocRef>` +
      `<FolioRef>${this.escapeXml(String(reference.folio))}</FolioRef>` +
      `<FchRef>${reference.date}</FchRef>` +
      `${reference.reasonCode ? `<CodRef>${reference.reasonCode}</CodRef>` : ''}` +
      `${reference.reason ? `<RazonRef>${this.escapeXml(reference.reason)}</RazonRef>` : ''}` +
      `</Referencia>`,
    ).join('');

    let transportXml = '';
    if (input.transport) {
      // Modelo de transporte de primera clase (Resolución SII N.º 154 de 2025).
      // Renderiza todos los campos del bloque <Transporte> para T52.
      const t = input.transport;
      transportXml = `<Transporte>` +
        `${t.departureDate ? `<FchSalida>${t.departureDate}</FchSalida>` : ''}` +
        `${t.departureTime ? `<HraSalida>${t.departureTime}</HraSalida>` : ''}` +
        `${t.arrivalDate ? `<FchLlegada>${t.arrivalDate}</FchLlegada>` : ''}` +
        `${t.carrierRut ? `<RUTTrans>${t.carrierRut}</RUTTrans>` : ''}` +
        `<DirOrigen>${this.escapeXml(t.originAddress)}</DirOrigen>` +
        `<CmnaOrigen>${this.escapeXml(t.originCommune)}</CmnaOrigen>` +
        `${t.driverRut || t.driverName ?
          `<Chofer>` +
          `${t.driverRut ? `<RUTChofer>${t.driverRut}</RUTChofer>` : ''}` +
          `${t.driverName ? `<NombreChofer>${this.escapeXml(t.driverName)}</NombreChofer>` : ''}` +
          `</Chofer>` : ''}` +
        `${t.vehiclePlate ? `<Patente>${this.escapeXml(t.vehiclePlate)}</Patente>` : ''}` +
        `${t.trailerPlate ? `<PatenteAcoplado>${this.escapeXml(t.trailerPlate)}</PatenteAcoplado>` : ''}` +
        `<DirDest>${this.escapeXml(t.destinationAddress)}</DirDest>` +
        `<CmnaDest>${this.escapeXml(t.destinationCommune)}</CmnaDest>` +
        `</Transporte>`;
    } else if (input.type === 52) {
      // Fallback: T52 sin transporte explícito usa datos del receptor como destino.
      transportXml = `<Transporte>` +
        `<DirDest>${this.escapeXml(input.receiver.address || 'Direccion no informada')}</DirDest>` +
        `<CmnaDest>${this.escapeXml(input.receiver.commune || 'Santiago')}</CmnaDest>` +
        `</Transporte>`;
    }

    // Bloque <Totales>: renderiza nodos de descuento global e ImptoReten cuando aplica
    const globalDiscountXml = totals.globalDiscountAmount && totals.globalDiscountAmount > 0
      ? `<DscRcgloGlobal>` +
        `<NroLinea>1</NroLinea>` +
        `<TpoMov>D</TpoMov>` +
        `<Glosa>Descuento global afectos</Glosa>` +
        `<ValorCF>${totals.globalDiscountAmount}</ValorCF>` +
        `</DscRcgloGlobal>`
      : '';

    // ImptoReten: retenciones tributarias (ej. T46 con IVA retenido total, TipoImp=15).
    const imptoRetenXml = (input.taxRetentions || []).map((retention, index) =>
      `<ImptoReten>` +
      `<NroImpto>${index + 1}</NroImpto>` +
      `<TipoImp>${retention.type}</TipoImp>` +
      `${retention.rate != null ? `<TasaImp>${retention.rate}</TasaImp>` : ''}` +
      `<MontoImp>${retention.amount}</MontoImp>` +
      `</ImptoReten>`,
    ).join('');

    // IdDoc: IndMntNeto para boletas NET, IndServicio para boletas, IndTraslado para T52.
    const isBoletaType = isBoleta(input.type);
    const isNetPricing = input.pricingMode === 'NET' && isBoletaType;
    const indMntNetoXml = isNetPricing ? `<IndMntNeto>2</IndMntNeto>` : '';
    const indServicioXml = isBoletaType && input.indServicio ? `<IndServicio>${input.indServicio}</IndServicio>` : '';
    const indTrasladoXml = input.type === 52 ? `<IndTraslado>${input.indTraslado || input.transport?.transferType || 1}</IndTraslado>` : '';

    // Receptor de boleta: si no se especifica RUT, usar consumidor final genérico.
    const receiverRut = isBoletaType && !input.receiver.rut
      ? BOLETA_GENERIC_RECEIVER
      : input.receiver.rut;

    const xml = Iso88591Encoder.normalizeXmlDeclaration(
      `<DTE version="1.0">` +
      `<Documento ID="DocumentoDTE">` +
      `<Encabezado>` +
      `<IdDoc><TipoDTE>${input.type}</TipoDTE><Folio>${input.folio}</Folio><FchEmis>${issueDate}</FchEmis>${indServicioXml}${indMntNetoXml}${indTrasladoXml}</IdDoc>` +
      `<Emisor>` +
      `<RUTEmisor>${input.issuer.rut}</RUTEmisor>` +
      `<RznSoc>${this.escapeXml(input.issuer.businessName)}</RznSoc>` +
      `<GiroEmis>${this.escapeXml(input.issuer.giro || 'SERVICIOS TECNOLOGICOS')}</GiroEmis>` +
      `${input.issuer.acteco ? `<Acteco>${input.issuer.acteco}</Acteco>` : ''}` +
      `<DirOrigen>${this.escapeXml(input.issuer.address || 'Direccion no informada')}</DirOrigen>` +
      `<CmnaOrigen>${this.escapeXml(input.issuer.commune || 'Santiago')}</CmnaOrigen>` +
      `<CiudadOrigen>${this.escapeXml(input.issuer.city || 'Santiago')}</CiudadOrigen>` +
      `</Emisor>` +
      `<Receptor>` +
      `<RUTRecep>${receiverRut}</RUTRecep>` +
      `<RznSocRecep>${this.escapeXml(input.receiver.businessName)}</RznSocRecep>` +
      `${input.receiver.giro ? `<GiroRecep>${this.escapeXml(input.receiver.giro)}</GiroRecep>` : ''}` +
      `${input.receiver.address ? `<DirRecep>${this.escapeXml(input.receiver.address)}</DirRecep>` : ''}` +
      `${input.receiver.commune ? `<CmnaRecep>${this.escapeXml(input.receiver.commune)}</CmnaRecep>` : ''}` +
      `${input.receiver.city ? `<CiudadRecep>${this.escapeXml(input.receiver.city)}</CiudadRecep>` : ''}` +
      `</Receptor>` +
      transportXml +
      `<Totales>` +
      `${totals.netAmount > 0 ? `<MntNeto>${totals.netAmount}</MntNeto><TasaIVA>19</TasaIVA><IVA>${totals.ivaAmount}</IVA>` : ''}` +
      `${totals.exemptAmount > 0 ? `<MntExe>${totals.exemptAmount}</MntExe>` : ''}` +
      imptoRetenXml +
      globalDiscountXml +
      `<MntTotal>${computedTotal}</MntTotal>` +
      `</Totales>` +
      `</Encabezado>` +
      detailsXml +
      setRefXml +
      referencesXml +
      tedXml +
      `</Documento>` +
      `</DTE>`,
    );

    Iso88591Encoder.encode(xml);
    return { xml, tedXml, totals: totalsWithRetention, type: input.type, folio: input.folio };
  }

  /** Cálculo tributario centralizado utilizado por el endpoint de previsualización. */
  calculateTotals(type: SupportedDteType, items: DteLineItem[]): DteTotals {
    this.assertSupportedType(type);
    return this.discountEngine.calculateTotals(type, items);
  }

  buildEnvioDte(input: EnvioDteInput): string {
    const resolutionDate = input.resolutionDate || nowSantiagoDate();
    const resolutionNumber = input.resolutionNumber || 0;
    const dtes = input.signedDtes.map((xml) => this.stripXmlDeclaration(xml)).join('');

    return Iso88591Encoder.normalizeXmlDeclaration(
      `<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0" ID="EnvioDTE">` +
      `<SetDTE ID="SetDoc">` +
      `<Caratula version="1.0">` +
      `<RutEmisor>${input.issuerRut}</RutEmisor>` +
      `<RutEnvia>${input.senderRut}</RutEnvia>` +
      `<RutReceptor>${input.receiverRut || '60803000-K'}</RutReceptor>` +
      `<FchResol>${resolutionDate}</FchResol>` +
      `<NroResol>${resolutionNumber}</NroResol>` +
      `<TmstFirmaEnv>${nowSantiagoTimestamp()}</TmstFirmaEnv>` +
      `</Caratula>` +
      dtes +
      `</SetDTE>` +
      `</EnvioDTE>`,
    );
  }

  buildEnvioBoleta(input: EnvioDteInput): string {
    const resolutionDate = input.resolutionDate || nowSantiagoDate();
    const resolutionNumber = input.resolutionNumber || 0;
    const dtes = input.signedDtes.map((xml) => this.stripXmlDeclaration(xml)).join('');

    // RutProvSW / RznSocProvSW: identificación del proveedor de software SaaS.
    // Relevante para trazabilidad tributaria del SII en boletas electrónicas.
    const softwareProviderXml = input.softwareProvider?.rut
      ? `<RutProvSW>${input.softwareProvider.rut}</RutProvSW>` +
        `<RznSocProvSW>${this.escapeXml(input.softwareProvider.businessName)}</RznSocProvSW>`
      : '';

    return Iso88591Encoder.normalizeXmlDeclaration(
      `<EnvioBOLETA xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioBOLETA_v11.xsd" version="1.0" ID="EnvioBOLETA">` +
      `<SetDTE ID="SetDoc">` +
      `<Caratula version="1.0">` +
      `<RutEmisor>${input.issuerRut}</RutEmisor>` +
      `<RutEnvia>${input.senderRut}</RutEnvia>` +
      `<RutReceptor>${BOLETA_ENVELOPE_RECEIVER}</RutReceptor>` +
      `<FchResol>${resolutionDate}</FchResol>` +
      `<NroResol>${resolutionNumber}</NroResol>` +
      softwareProviderXml +
      `<TmstFirmaEnv>${nowSantiagoTimestamp()}</TmstFirmaEnv>` +
      `</Caratula>` +
      dtes +
      `</SetDTE>` +
      `</EnvioBOLETA>`,
    );
  }

  buildRcof(input: RcofInput): string {
    const resolutionDate = input.resolutionDate || nowSantiagoDate();
    const resolutionNumber = input.resolutionNumber || 0;
    const now = nowSantiagoTimestamp();
    const uniqueId = `RCOF_${Date.now()}`;

    const summariesXml = input.summaries.map((summary) => {
      const rangesXml = summary.ranges.map((range) =>
        `<RangoUtilizado>` +
        `<Inicial>${range.start}</Inicial>` +
        `<Final>${range.end}</Final>` +
        `</RangoUtilizado>`,
      ).join('');

      return (
        `<Resumen>` +
        `<TipoDocumento>${summary.type}</TipoDocumento>` +
        `<MntNeto>${Math.round(summary.netAmount)}</MntNeto>` +
        `<MntIVA>${Math.round(summary.ivaAmount)}</MntIVA>` +
        `<MntExento>${Math.round(summary.exemptAmount)}</MntExento>` +
        `<MntTotal>${Math.round(summary.totalAmount)}</MntTotal>` +
        `<FoliosEmitidos>${summary.foliosEmitidos}</FoliosEmitidos>` +
        `<FoliosAnulados>${summary.foliosAnulados}</FoliosAnulados>` +
        `<FoliosUtilizados>${summary.foliosUtilizados}</FoliosUtilizados>` +
        rangesXml +
        `</Resumen>`
      );
    }).join('');

    return Iso88591Encoder.normalizeXmlDeclaration(
      `<ConsumoFolio xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte ConsumoFolio_v10.xsd" version="1.0" ID="${uniqueId}">` +
      `<DocumentoConsumoFolio ID="Doc_RCOF">` +
      `<Caratula version="1.0">` +
      `<RutEmisor>${input.issuerRut}</RutEmisor>` +
      `<RutEnvia>${input.senderRut}</RutEnvia>` +
      `<FchResol>${resolutionDate}</FchResol>` +
      `<NroResol>${resolutionNumber}</NroResol>` +
      `<FchInicio>${input.startDate}</FchInicio>` +
      `<FchFinal>${input.endDate}</FchFinal>` +
      `<Secuencia>${input.sequenceNumber}</Secuencia>` +
      `<TmstFirmaConsumo>${now}</TmstFirmaConsumo>` +
      `</Caratula>` +
      summariesXml +
      `</DocumentoConsumoFolio>` +
      `</ConsumoFolio>`,
    );
  }



  private buildTed(input: DteBuildInput, totals: DteTotals, issueDate: string, cafXml: string, cafPrivateKey: forge.pki.rsa.PrivateKey): string {
    const firstItem = input.items[0]?.name || DTE_NAMES[input.type];
    const ddXml =
      `<DD>` +
      `<RE>${input.issuer.rut}</RE>` +
      `<TD>${input.type}</TD>` +
      `<F>${input.folio}</F>` +
      `<FE>${issueDate}</FE>` +
      `<RR>${input.receiver.rut}</RR>` +
      `<RSR>${this.escapeXml(input.receiver.businessName.slice(0, 40))}</RSR>` +
      `<MNT>${totals.totalAmount}</MNT>` +
      `<IT1>${this.escapeXml(firstItem.slice(0, 40))}</IT1>` +
      cafXml +
      `<TSTED>${nowSantiagoTimestamp()}</TSTED>` +
      `</DD>`;

    return `<TED version="1.0">${ddXml}<FRMT algoritmo="SHA1withRSA">${this.signTedData(ddXml, cafPrivateKey)}</FRMT></TED>`;
  }

  private buildDetail(item: DteLineItem, lineNumber: number): string {
    // El cálculo de montos lo hace el DiscountEngine; aquí solo se renderiza.
    const lineResult = this.discountEngine.applyItemDiscount(item);
    let dscItemXml = '';
    if (lineResult.discountAmount > 0) {
      if (lineResult.isPercentage) {
        dscItemXml =
          `<DscItem>` +
          `<TipoMov>D</TipoMov>` +
          `<Glosa>Descuento linea ${lineNumber}</Glosa>` +
          `<ValorCF>${lineResult.discountAmount}</ValorCF>` +
          `<DescuentoPct>${lineResult.percentage}</DescuentoPct>` +
          `</DscItem>`;
      } else {
        dscItemXml =
          `<DscItem>` +
          `<TipoMov>D</TipoMov>` +
          `<Glosa>Descuento linea ${lineNumber}</Glosa>` +
          `<ValorCF>${lineResult.discountAmount}</ValorCF>` +
          `</DscItem>`;
      }
    }

    return (
      `<Detalle>` +
      `<NroLinDet>${lineNumber}</NroLinDet>` +
      `${item.exempt ? '<IndExe>1</IndExe>' : ''}` +
      `<NmbItem>${this.escapeXml(item.name)}</NmbItem>` +
      `<QtyItem>${item.quantity}</QtyItem>` +
      `<PrcItem>${item.price}</PrcItem>` +
      dscItemXml +
      `<MontoItem>${lineResult.netAmount}</MontoItem>` +
      `</Detalle>`
    );
  }

  /**
   * Firma RSA-SHA1 de la estructura <DD> (Datos del Documento) del TED.
   * Usa la CLAVE PRIVADA DEL CAF del tenant (no un par efímero).
   * El SII rechaza el 100% de los DTEs firmados con una clave que no corresponde
   * al CAF autorizado. ISSUE-001.
   */
  private signTedData(ddXml: string, cafPrivateKey: forge.pki.rsa.PrivateKey): string {
    const md = forge.md.sha1.create();
    md.update(ddXml, 'utf8');
    return forge.util.encode64(cafPrivateKey.sign(md));
  }

  private stripXmlDeclaration(xml: string): string {
    return xml.replace(/^<\?xml[^>]*\?>\s*/i, '');
  }

  private assertSupportedType(type: number): asserts type is SupportedDteType {
    if (![33, 34, 39, 41, 46, 52, 56, 61].includes(type)) {
      throw new Error(`Tipo DTE no soportado por el motor XML: ${type}`);
    }
  }


  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
        default: return char;
      }
    });
  }
}
