import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';
import { buildDtePrintModel, DtePrintAdjustment, DtePrintModel } from './dte-print.model';
import {
  DEFAULT_INVOICE_PRIMARY_COLOR,
  DEFAULT_INVOICE_SECONDARY_COLOR,
} from './invoice-branding.defaults';

export interface PdfBrandProfile {
  logoData?: Buffer | null;
  logoMimeType?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
}

interface PrintColors {
  primary: string;
  secondaryTint: string;
  text: string;
  muted: string;
  line: string;
  legal: string;
}

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;
const PAGE_BOTTOM = 790;
const BODY_BOTTOM = 675;

/**
 * Generador A4 de representación gráfica. Todos los datos tributarios que se
 * imprimen provienen del XML firmado del DTE; la marca sólo cambia elementos
 * visuales y queda fijada por la versión asociada al documento emitido.
 */
@Injectable()
export class PdfGenerator {
  private readonly logger = new Logger(PdfGenerator.name);

  public async generateDtePdf(
    dte: { type?: number; folio?: number; xmlContent?: string },
    _tenant?: unknown,
    brandProfile?: PdfBrandProfile | null,
  ): Promise<Buffer> {
    const model = buildDtePrintModel(dte.xmlContent || '');
    if (dte.type !== undefined && Number(dte.type) !== model.type) {
      throw new Error('El tipo almacenado del DTE no coincide con el XML firmado; se bloquea la generación del PDF.');
    }
    if (dte.folio !== undefined && Number(dte.folio) !== model.folio) {
      throw new Error('El folio almacenado del DTE no coincide con el XML firmado; se bloquea la generación del PDF.');
    }

    this.logger.log(`Generando PDF A4 para DTE ${model.type}/${model.folio} desde su XML firmado.`);
    // Si el TED no puede convertirse a PDF417, no se entrega un PDF que parezca
    // válido pero que carezca de su timbre electrónico.
    const barcode = await this.generatePdf417(model.tedXml);
    const colors = this.resolveColors(brandProfile);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_LEFT, autoFirstPage: true });
      const chunks: Buffer[] = [];
      let settled = false;
      const finishReject = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', finishReject);
      doc.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      });

      try {
        let page = 1;
        let currentY = this.drawPageHeader(doc, model, brandProfile, colors, page);
        const nextPage = () => {
          doc.addPage({ size: 'A4', margin: PAGE_LEFT });
          page += 1;
          return this.drawPageHeader(doc, model, brandProfile, colors, page);
        };

        currentY = this.drawReceiver(doc, model, currentY, colors);
        currentY = this.drawTransport(doc, model, currentY, colors);

        if (model.references.length > 0) {
          currentY = this.drawReferences(doc, model, currentY, colors, nextPage).currentY;
        }

        currentY = this.drawDetails(doc, model, currentY, colors, nextPage).currentY;

        const totalsHeight = this.totalsHeight(model);
        if (currentY + totalsHeight + 130 > PAGE_BOTTOM) {
          currentY = nextPage();
        }
        currentY = this.drawTotals(doc, model, currentY, colors);

        if (currentY + 120 > PAGE_BOTTOM) {
          currentY = nextPage();
        }
        this.drawTed(doc, barcode, currentY, colors);
        doc.end();
      } catch (error) {
        this.logger.error('No se pudo renderizar el PDF tributario.', error instanceof Error ? error.stack : String(error));
        finishReject(error);
        doc.end();
      }
    });
  }

  /** Expuesto para pruebas de fidelidad entre el XML firmado y el PDF. */
  public buildPrintModel(xml: string): DtePrintModel {
    return buildDtePrintModel(xml);
  }

  private drawPageHeader(
    doc: PDFKit.PDFDocument,
    model: DtePrintModel,
    profile: PdfBrandProfile | null | undefined,
    colors: PrintColors,
    page: number,
  ): number {
    const hasLogo = !!profile?.logoData?.length;
    if (hasLogo) {
      doc.image(profile!.logoData!, PAGE_LEFT, 38, { fit: [220, 58], valign: 'center' });
    } else {
      doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(16);
      doc.text(model.emitter.businessName.toUpperCase(), PAGE_LEFT, 40, { width: 278, height: 34 });
    }

    const companyInfoY = hasLogo ? 102 : 74;
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(8.5);
    doc.text(model.emitter.businessName.toUpperCase(), PAGE_LEFT, companyInfoY, { width: 280, height: 11 });
    doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted);
    const issuerLines = [
      model.emitter.giro,
      [model.emitter.address, model.emitter.commune, model.emitter.city].filter(Boolean).join(', '),
    ].filter(Boolean);
    doc.text(issuerLines.join('\n'), PAGE_LEFT, companyInfoY + 12, { width: 280, height: 28 });

    // Recuadro tributario reservado: color legal y datos sólo desde el XML.
    const legalX = 340;
    const legalY = 38;
    doc.lineWidth(1.7).strokeColor(colors.legal).rect(legalX, legalY, 215, 94).stroke();
    doc.lineWidth(0.7).moveTo(legalX, legalY + 32).lineTo(legalX + 215, legalY + 32).stroke();
    doc.moveTo(legalX, legalY + 63).lineTo(legalX + 215, legalY + 63).stroke();
    doc.fillColor(colors.legal).font('Helvetica-Bold').fontSize(10);
    doc.text(`R.U.T.: ${this.formatRut(model.emitter.rut)}`, legalX + 4, legalY + 10, { width: 207, align: 'center' });
    doc.fontSize(7.2);
    doc.text(this.getDteTitle(model.type), legalX + 7, legalY + 43, { width: 201, align: 'center' });
    doc.fontSize(10.5);
    doc.text(`N° ${model.folio}`, legalX + 4, legalY + 72, { width: 207, align: 'center' });

    doc.lineWidth(1.4).strokeColor(colors.primary).moveTo(PAGE_LEFT, 146).lineTo(PAGE_RIGHT, 146).stroke();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(6.5);
    doc.text(`Página ${page}`, PAGE_RIGHT - 52, 138, { width: 52, align: 'right' });
    return 160;
  }

  private drawReceiver(doc: PDFKit.PDFDocument, model: DtePrintModel, startY: number, colors: PrintColors): number {
    this.drawSectionTitle(doc, 'DATOS DEL RECEPTOR', startY, colors);
    const boxY = startY + 16;
    const boxHeight = 86;
    doc.fillColor(colors.secondaryTint).strokeColor(colors.line).lineWidth(0.6).rect(PAGE_LEFT, boxY, PAGE_WIDTH, boxHeight).fillAndStroke();

    const leftRows: Array<[string, string]> = [
      ['Señor(es):', model.receiver.businessName],
      ['R.U.T.:', this.formatRut(model.receiver.rut)],
      ['Giro:', model.receiver.giro || '—'],
      ['Dirección:', [model.receiver.address, model.receiver.commune, model.receiver.city].filter(Boolean).join(', ') || '—'],
    ];
    const rightRows: Array<[string, string]> = [
      ['Fecha de emisión:', model.issueDate],
      ['Tipo de documento:', this.getDteTitle(model.type)],
      ['Folio:', String(model.folio)],
    ];
    this.drawRows(doc, leftRows, PAGE_LEFT + 10, boxY + 9, 290, colors);
    this.drawRows(doc, rightRows, 350, boxY + 9, 195, colors);
    return boxY + boxHeight + 16;
  }

  private drawTransport(doc: PDFKit.PDFDocument, model: DtePrintModel, startY: number, colors: PrintColors): number {
    const transport = model.transport;
    if (!transport) return startY;
    const transportRows: Array<[string, string]> = [
      ['Salida:', [transport.departureDate, transport.departureTime].filter(Boolean).join(' ')],
      ['Llegada:', transport.arrivalDate || ''],
      ['Transportista:', transport.carrierRut ? this.formatRut(transport.carrierRut) : ''],
      ['Origen:', [transport.originAddress, transport.originCommune].filter(Boolean).join(', ')],
      ['Destino:', [transport.destinationAddress, transport.destinationCommune].filter(Boolean).join(', ')],
      ['Chofer:', [transport.driverName, transport.driverRut && this.formatRut(transport.driverRut)].filter(Boolean).join(' · ')],
      ['Patente:', transport.vehiclePlate || ''],
      ['Acoplado:', transport.trailerPlate || ''],
    ];
    const values = transportRows.filter(([, value]) => !!value);
    if (values.length === 0) return startY;

    this.drawSectionTitle(doc, 'DATOS DE DESPACHO Y TRANSPORTE', startY, colors);
    const boxY = startY + 16;
    const rowsPerColumn = Math.ceil(values.length / 2);
    const boxHeight = 12 + rowsPerColumn * 15;
    doc.fillColor(colors.secondaryTint).strokeColor(colors.line).lineWidth(0.6).rect(PAGE_LEFT, boxY, PAGE_WIDTH, boxHeight).fillAndStroke();
    this.drawRows(doc, values.slice(0, rowsPerColumn), PAGE_LEFT + 10, boxY + 7, 235, colors, 7.3);
    this.drawRows(doc, values.slice(rowsPerColumn), 305, boxY + 7, 240, colors, 7.3);
    return boxY + boxHeight + 16;
  }

  private drawReferences(
    doc: PDFKit.PDFDocument,
    model: DtePrintModel,
    startY: number,
    colors: PrintColors,
    nextPage: () => number,
  ): { currentY: number } {
    let currentY = startY;
    const drawHeader = () => {
      this.drawSectionTitle(doc, 'DOCUMENTOS DE REFERENCIA', currentY, colors);
      const tableY = currentY + 16;
      doc.fillColor(colors.primary).rect(PAGE_LEFT, tableY, PAGE_WIDTH, 17).fill();
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.1);
      doc.text('Línea', 44, tableY + 5, { width: 32, align: 'center' });
      doc.text('Tipo', 80, tableY + 5, { width: 70 });
      doc.text('Folio', 155, tableY + 5, { width: 57 });
      doc.text('Fecha', 218, tableY + 5, { width: 80 });
      doc.text('Razón de referencia', 305, tableY + 5, { width: 245 });
      currentY = tableY + 17;
    };

    if (currentY + 45 > BODY_BOTTOM) currentY = nextPage();
    drawHeader();
    for (const reference of model.references) {
      const reason = reference.reason || '—';
      doc.font('Helvetica').fontSize(7.2);
      const height = Math.max(18, doc.heightOfString(reason, { width: 240 }) + 7);
      if (currentY + height > BODY_BOTTOM) {
        currentY = nextPage();
        drawHeader();
      }
      doc.fillColor(colors.secondaryTint).rect(PAGE_LEFT, currentY, PAGE_WIDTH, height).fill();
      doc.fillColor(colors.text).font('Helvetica').fontSize(7.2);
      doc.text(reference.line, 44, currentY + 4, { width: 32, align: 'center' });
      doc.text(reference.documentType ? this.getReferenceTitle(reference.documentType) : '—', 80, currentY + 4, { width: 70 });
      doc.text(reference.folio || '—', 155, currentY + 4, { width: 57 });
      doc.text(reference.date || '—', 218, currentY + 4, { width: 80 });
      doc.text(reason, 305, currentY + 4, { width: 240, height: height - 7 });
      doc.strokeColor(colors.line).lineWidth(0.4).moveTo(PAGE_LEFT, currentY + height).lineTo(PAGE_RIGHT, currentY + height).stroke();
      currentY += height;
    }
    return { currentY: currentY + 15 };
  }

  private drawDetails(
    doc: PDFKit.PDFDocument,
    model: DtePrintModel,
    startY: number,
    colors: PrintColors,
    nextPage: () => number,
  ): { currentY: number } {
    let currentY = startY;
    const drawHeader = () => {
      this.drawSectionTitle(doc, 'DETALLE DE LA TRANSACCIÓN', currentY, colors);
      const tableY = currentY + 16;
      doc.fillColor(colors.primary).rect(PAGE_LEFT, tableY, PAGE_WIDTH, 18).fill();
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.1);
      doc.text('Línea', 43, tableY + 5, { width: 28, align: 'center' });
      doc.text('Descripción del ítem / servicio', 75, tableY + 5, { width: 225 });
      doc.text('Cant.', 305, tableY + 5, { width: 46, align: 'center' });
      doc.text('P. unitario', 356, tableY + 5, { width: 71, align: 'right' });
      doc.text('Ajuste', 432, tableY + 5, { width: 55, align: 'right' });
      doc.text('Total', 492, tableY + 5, { width: 59, align: 'right' });
      currentY = tableY + 18;
    };

    if (currentY + 48 > BODY_BOTTOM) currentY = nextPage();
    drawHeader();
    model.items.forEach((item, index) => {
      doc.font('Helvetica').fontSize(7.5);
      const descriptionHeight = doc.heightOfString(item.name, { width: 225 });
      const rowHeight = Math.max(19, descriptionHeight + 7);
      if (currentY + rowHeight > BODY_BOTTOM) {
        currentY = nextPage();
        drawHeader();
      }
      doc.fillColor(index % 2 === 0 ? '#FFFFFF' : colors.secondaryTint).rect(PAGE_LEFT, currentY, PAGE_WIDTH, rowHeight).fill();
      doc.fillColor(colors.text).font('Helvetica').fontSize(7.5);
      doc.text(item.line, 43, currentY + 4, { width: 28, align: 'center' });
      doc.text(item.name, 75, currentY + 4, { width: 225, height: rowHeight - 7 });
      doc.text(item.quantity || '—', 305, currentY + 4, { width: 46, align: 'center' });
      doc.text(this.formatCurrency(item.unitPrice, item.unitPriceText), 356, currentY + 4, { width: 71, align: 'right' });
      doc.fontSize(6.5);
      doc.text(this.formatAdjustments(item.adjustments), 432, currentY + 4, { width: 55, align: 'right', height: rowHeight - 7 });
      doc.fontSize(7.5);
      doc.text(this.formatCurrency(item.amount), 492, currentY + 4, { width: 59, align: 'right' });
      doc.strokeColor(colors.line).lineWidth(0.4).moveTo(PAGE_LEFT, currentY + rowHeight).lineTo(PAGE_RIGHT, currentY + rowHeight).stroke();
      currentY += rowHeight;
    });
    return { currentY: currentY + 16 };
  }

  private totalsHeight(model: DtePrintModel): number {
    let rows = 1;
    if (model.totals.netAmount !== undefined) rows += 1;
    if (model.totals.exemptAmount !== undefined) rows += 1;
    if (model.totals.ivaAmount !== undefined) rows += 1;
    rows += model.totals.adjustments.length + model.totals.retentions.length;
    return 18 + rows * 16 + 12;
  }

  private drawTotals(doc: PDFKit.PDFDocument, model: DtePrintModel, startY: number, colors: PrintColors): number {
    const rows: Array<{ label: string; value: string; emphasis?: boolean }> = [];
    if (model.totals.netAmount !== undefined) rows.push({ label: 'Monto neto', value: this.formatCurrency(model.totals.netAmount) });
    if (model.totals.exemptAmount !== undefined) rows.push({ label: 'Monto exento', value: this.formatCurrency(model.totals.exemptAmount) });
    if (model.totals.ivaAmount !== undefined) rows.push({
      label: `I.V.A.${model.totals.ivaRate ? ` (${model.totals.ivaRate}%)` : ''}`,
      value: this.formatCurrency(model.totals.ivaAmount),
    });
    for (const adjustment of model.totals.adjustments) {
      rows.push({
        label: adjustment.label || (adjustment.movement === 'D' ? 'Descuento global' : 'Recargo global'),
        value: this.formatAdjustment(adjustment),
      });
    }
    for (const retention of model.totals.retentions) {
      rows.push({
        label: `Retención${retention.type ? ` tipo ${retention.type}` : ''}${retention.rate ? ` (${retention.rate}%)` : ''}`,
        value: `−${this.formatCurrency(retention.amount)}`,
      });
    }
    rows.push({ label: 'MONTO TOTAL', value: this.formatCurrency(model.totals.totalAmount), emphasis: true });

    const boxWidth = 230;
    const boxX = PAGE_RIGHT - boxWidth;
    const boxHeight = 12 + rows.length * 16;
    doc.fillColor(colors.secondaryTint).strokeColor(colors.line).lineWidth(0.6).rect(boxX, startY, boxWidth, boxHeight).fillAndStroke();
    let y = startY + 7;
    for (const row of rows) {
      doc.fillColor(row.emphasis ? colors.legal : colors.text).font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.emphasis ? 8.7 : 8);
      doc.text(row.label, boxX + 10, y, { width: 130 });
      doc.text(row.value, boxX + 145, y, { width: 75, align: 'right' });
      y += 16;
    }
    return startY + boxHeight + 16;
  }

  private drawTed(doc: PDFKit.PDFDocument, barcode: Buffer, startY: number, colors: PrintColors): void {
    const height = 108;
    doc.image(barcode, PAGE_LEFT, startY + 4, { fit: [265, 99], valign: 'center' });
    const infoX = 320;
    doc.strokeColor(colors.legal).lineWidth(0.8).rect(infoX, startY, PAGE_RIGHT - infoX, height).stroke();
    doc.fillColor(colors.legal).font('Helvetica-Bold').fontSize(8.8);
    doc.text('Timbre Electrónico S.I.I.', infoX + 8, startY + 14, { width: 220, align: 'center' });
    doc.fillColor(colors.text).font('Helvetica').fontSize(7.1);
    doc.text('Código PDF417 generado desde el TED incluido en el XML firmado.', infoX + 13, startY + 34, { width: 210, align: 'center' });
    doc.text('Verifique este documento en www.sii.cl', infoX + 13, startY + 72, { width: 210, align: 'center' });
  }

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number, colors: PrintColors): void {
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(9);
    doc.text(title, PAGE_LEFT, y, { width: PAGE_WIDTH });
    doc.strokeColor(colors.primary).lineWidth(0.9).moveTo(PAGE_LEFT, y + 12).lineTo(PAGE_RIGHT, y + 12).stroke();
  }

  private drawRows(
    doc: PDFKit.PDFDocument,
    rows: Array<[string, string]>,
    x: number,
    startY: number,
    width: number,
    colors: PrintColors,
    size = 7.5,
  ): void {
    rows.forEach(([label, value], index) => {
      const y = startY + index * 16;
      doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(size);
      doc.text(label, x, y, { width: 76 });
      doc.fillColor(colors.text).font('Helvetica').fontSize(size);
      doc.text(value, x + 78, y, { width: width - 78, height: 13 });
    });
  }

  private getDteTitle(type: number): string {
    const titles: Record<number, string> = {
      33: 'FACTURA ELECTRÓNICA',
      34: 'FACTURA EXENTA ELECTRÓNICA',
      39: 'BOLETA ELECTRÓNICA',
      41: 'BOLETA EXENTA ELECTRÓNICA',
      46: 'FACTURA DE COMPRA ELECTRÓNICA',
      52: 'GUÍA DE DESPACHO ELECTRÓNICA',
      56: 'NOTA DE DÉBITO ELECTRÓNICA',
      61: 'NOTA DE CRÉDITO ELECTRÓNICA',
    };
    return titles[type] || `DOCUMENTO ELECTRÓNICO T${type}`;
  }

  private getReferenceTitle(type: string): string {
    const asNumber = Number(type);
    return Number.isFinite(asNumber) ? this.getDteTitle(asNumber) : type;
  }

  private generatePdf417(text: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      bwipjs.toBuffer({ bcid: 'pdf417', text, scale: 2, height: 14, includetext: false }, (error, pngBuffer) => {
        if (error) reject(error);
        else resolve(pngBuffer);
      });
    });
  }

  private resolveColors(profile: PdfBrandProfile | null | undefined): PrintColors {
    const primary = this.isHexColor(profile?.primaryColor) ? profile!.primaryColor!.toUpperCase() : DEFAULT_INVOICE_PRIMARY_COLOR;
    const secondary = this.isHexColor(profile?.secondaryColor) ? profile!.secondaryColor!.toUpperCase() : DEFAULT_INVOICE_SECONDARY_COLOR;
    return {
      primary,
      secondaryTint: this.tint(secondary, 0.92),
      text: '#1F2937',
      muted: '#4B5563',
      line: '#CBD5E1',
      legal: '#C62828',
    };
  }

  private isHexColor(value: string | undefined): value is string {
    return !!value && /^#[0-9A-F]{6}$/i.test(value);
  }

  private tint(hex: string, whiteRatio: number): string {
    const components = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    const blended = components.map((value) => Math.round(value + (255 - value) * whiteRatio));
    return `#${blended.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  private formatRut(rut: string): string {
    const clean = (rut || '').replace(/[^0-9kK]/g, '');
    if (clean.length < 2) return rut || '—';
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();
    const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${grouped}-${dv}`;
  }

  private formatCurrency(value: number | undefined, rawValue?: string): string {
    if (value === undefined || !Number.isFinite(value)) return '—';
    if (rawValue && /^\d+(?:\.\d+)?$/.test(rawValue)) {
      const [integerPart, fractionalPart] = rawValue.split('.');
      const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
      const groupedInteger = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `$${groupedInteger}${fractionalPart === undefined ? '' : `,${fractionalPart}`}`;
    }
    return `$${value.toLocaleString('es-CL', { maximumFractionDigits: 6 })}`;
  }

  private formatAdjustment(adjustment: DtePrintAdjustment): string {
    const prefix = adjustment.movement === 'D' ? '−' : '+';
    if (adjustment.valueType === '%') {
      if (/^\d+(?:\.\d+)?$/.test(adjustment.rawValue)) {
        return `${prefix}${adjustment.rawValue.replace('.', ',')}%`;
      }
      return `${prefix}${adjustment.value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
    }
    return `${prefix}${this.formatCurrency(adjustment.value, adjustment.rawValue)}`;
  }

  private formatAdjustments(adjustments: DtePrintAdjustment[]): string {
    return adjustments.map((adjustment) => this.formatAdjustment(adjustment)).join(' · ');
  }
}
