import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as bwipjs from 'bwip-js';

@Injectable()
export class PdfGenerator {
  private readonly logger = new Logger(PdfGenerator.name);

  /**
   * Genera el búfer PDF de cualquier Documento Tributario Electrónico (DTE) de Chile.
   * Diseña plantillas dinámicas según el tipo de documento (Facturas, Boletas, Guías, Notas).
   */
  public async generateDtePdf(dte: any, tenant: any): Promise<Buffer> {
    this.logger.log(`Generando PDF A4 de Alta Fidelidad para DTE Folio ${dte.folio} (Tipo ${dte.type})...`);

    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const dteTitle = this.getDteTitle(dte.type);

        // 1. DIBUJAR RECUADRO ROJO REGLAMENTARIO (SII) - ESQUINA SUPERIOR DERECHA
        doc.lineWidth(2.5);
        doc.strokeColor('#D32F2F'); // Rojo Oficial
        doc.rect(340, 40, 220, 100).stroke();

        // Líneas internas del recuadro rojo
        doc.lineWidth(1);
        doc.lineCap('square');
        doc.moveTo(340, 75).lineTo(560, 75).stroke();
        doc.moveTo(340, 110).lineTo(560, 110).stroke();

        // Texto del recuadro rojo
        doc.fillColor('#D32F2F');
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(`R.U.T.: ${this.formatRut(tenant.rut)}`, 345, 50, { width: 210, align: 'center' });
        doc.fontSize(8);
        doc.text(dteTitle, 345, 87, { width: 210, align: 'center' });
        doc.fontSize(11);
        doc.text(`N° ${dte.folio}`, 345, 120, { width: 210, align: 'center' });

        // 2. LOGO / DATOS DEL EMISOR (ESQUINA SUPERIOR IZQUIERDA)
        doc.fillColor('#2C3E50'); // Azul corporativo oscuro
        doc.fontSize(18).font('Helvetica-Bold');
        doc.text(tenant.businessName.toUpperCase(), 40, 40, { width: 280 });
        
        doc.fillColor('#7F8C8D'); // Gris
        doc.fontSize(8.5).font('Helvetica');
        const emitterName = tenant.businessName?.toUpperCase();
        if (!emitterName) {
          throw new Error('El tenant no tiene businessName configurado. No se puede generar PDF tributario válido.');
        }
        doc.text(emitterName, 40, 62);
        doc.text(`Giro: ${tenant.giro || ''}`, 40, 74);
        doc.text(`Dirección: ${tenant.address || ''}`, 40, 86);
        doc.text(`S.I.I.: ${tenant.siiOffice || ''}`, 40, 98);

        // Línea divisoria decorativa
        doc.lineWidth(0.5);
        doc.strokeColor('#BDC3C7');
        doc.moveTo(40, 155).lineTo(560, 155).stroke();

        // 3. DATOS DEL RECEPTOR Y DOCUMENTO
        const fechaEmis = dte.createdAt ? new Date(dte.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        doc.fillColor('#2C3E50');
        doc.fontSize(9.5).font('Helvetica-Bold');
        doc.text('DATOS DEL RECEPTOR', 40, 170);

        doc.lineWidth(0.5).strokeColor('#ECF0F1');
        doc.rect(40, 185, 520, 70).fillAndStroke('#FAFAFA', '#BDC3C7');

        doc.fillColor('#2C3E50');
        doc.font('Helvetica-Bold').fontSize(8.5);
        doc.text('Señor(es):', 50, 195);
        doc.text('R.U.T.:', 50, 210);
        doc.text('Giro:', 50, 225);
        doc.text('Dirección:', 50, 240);

        doc.font('Helvetica').fillColor('#34495E');
        doc.text((dte.receiverName || 'PERSONA NATURAL').toUpperCase(), 110, 195);
        doc.text(this.formatRut(dte.receiverRut || '66666666-6'), 110, 210);
        doc.text((dte.receiverGiro || '').toUpperCase(), 110, 225);
        doc.text(dte.receiverAddress || '', 110, 240);

        // Datos del documento en el mismo cuadro (lado derecho)
        doc.font('Helvetica-Bold').fillColor('#2C3E50');
        doc.text('Fecha de Emisión:', 360, 195);
        doc.text('Tipo de Moneda:', 360, 210);
        doc.text('Forma de Pago:', 360, 225);

        doc.font('Helvetica').fillColor('#34495E');
        doc.text(fechaEmis, 460, 195);
        doc.text('Pesos Chilenos (CLP)', 460, 210);
        doc.text('Crédito / Cuenta Corriente', 460, 225);

        let currentY = 265;

        // 4. SECCIÓN ESPECIAL PARA GUÍAS DE DESPACHO (DTE 52)
        if (dte.type === 52) {
          doc.fillColor('#2C3E50').font('Helvetica-Bold').fontSize(9.5);
          doc.text('DATOS DE DESPACHO Y TRANSPORTE', 40, currentY + 10);
          
          doc.rect(40, currentY + 25, 520, 45).fillAndStroke('#F2F4F4', '#BDC3C7');
          doc.fillColor('#2C3E50').font('Helvetica-Bold').fontSize(8);
          
          doc.text('Patente Camión:', 50, currentY + 33);
          doc.text('Nombre Chofer:', 50, currentY + 45);
          doc.text('RUT Chofer:', 50, currentY + 57);
 
          doc.font('Helvetica').fillColor('#34495E');
          doc.text(dte.truckPlate || '', 140, currentY + 33);
          doc.text((dte.driverName || '').toUpperCase(), 140, currentY + 45);
          doc.text(dte.driverRut || '15.489.123-K', 140, currentY + 57);
 
          doc.font('Helvetica-Bold').fillColor('#2C3E50');
          doc.text('Tipo de Traslado:', 320, currentY + 33);
          doc.text('Dirección Destino:', 320, currentY + 45);
 
          doc.font('Helvetica').fillColor('#34495E');
          doc.text(dte.shippingType || 'Venta de Productos', 410, currentY + 33);
          doc.text(dte.deliveryAddress || 'Av. Providencia 1200, Santiago', 410, currentY + 45);
 
          currentY += 80;
        }
 
        // 5. SECCIÓN ESPECIAL PARA NOTAS DE CRÉDITO / DÉBITO (DTE 61/56)
        const hasReferences = dte.type === 61 || dte.type === 56;
        if (hasReferences) {
          doc.fillColor('#2C3E50').font('Helvetica-Bold').fontSize(9.5);
          doc.text('DOCUMENTOS DE REFERENCIA', 40, currentY + 10);
 
          const refY = currentY + 25;
          doc.rect(40, refY, 520, 15).fill('#34495E');
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
          
          doc.text('Línea', 45, refY + 4, { width: 30, align: 'center' });
          doc.text('Tipo Doc Referenciado', 85, refY + 4, { width: 120 });
          doc.text('Folio Ref', 215, refY + 4, { width: 60 });
          doc.text('Fecha Documento', 285, refY + 4, { width: 85 });
          doc.text('Razón / Motivo de la Referencia', 380, refY + 4, { width: 170 });
 
          // Renderizar referencias reales asociadas o una simulada
          const references = dte.references || [
            {
              lineIndex: 1,
              refDocType: dte.referencedDocType || 33,
              refFolio: dte.referencedFolio || 15,
              refDate: fechaEmis,
              reason: dte.referenceReason || 'Anulación de documento por error de facturación'
            }
          ];
 
          references.forEach((ref: any, idx: number) => {
            const rowY = refY + 15 + (idx * 16);
            if (idx % 2 === 1) {
              doc.rect(40, rowY, 520, 16).fill('#F9FAFC');
            } else {
              doc.rect(40, rowY, 520, 16).fill('#FFFFFF');
            }
            doc.fillColor('#2C3E50').font('Helvetica').fontSize(8);
            
            doc.text(String(ref.lineIndex || idx + 1), 45, rowY + 4, { width: 30, align: 'center' });
            doc.text(this.getDteTitle(Number(ref.refDocType)), 85, rowY + 4, { width: 120 });
            doc.text(String(ref.refFolio), 215, rowY + 4, { width: 60 });
            doc.text(ref.refDate, 285, rowY + 4, { width: 85 });
            doc.text(ref.reason, 380, rowY + 4, { width: 170 });
 
            doc.lineWidth(0.5).strokeColor('#BDC3C7');
            doc.moveTo(40, rowY + 16).lineTo(560, rowY + 16).stroke();
          });
 
          currentY += 40 + (references.length * 16);
        }
 
        // 6. TABLA DE DETALLES DE ÍTEMS
        doc.fillColor('#2C3E50').font('Helvetica-Bold').fontSize(9.5);
        doc.text('DETALLE DE LA TRANSACCIÓN', 40, currentY + 10);
 
        // Cabeceras de la Tabla
        const thY = currentY + 25;
        doc.rect(40, thY, 520, 18).fill('#34495E');
 
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
        doc.text('Línea', 45, thY + 5, { width: 30, align: 'center' });
        doc.text('Descripción del Ítem / Servicio', 85, thY + 5, { width: 220 });
        doc.text('Cant.', 315, thY + 5, { width: 40, align: 'center' });
        doc.text('P. Unitario', 365, thY + 5, { width: 80, align: 'right' });
        doc.text('Descto.', 455, thY + 5, { width: 40, align: 'right' });
        doc.text('Total Ítem', 505, thY + 5, { width: 50, align: 'right' });
 
        // Filas de Ítems
        let itemY = thY + 18;
        
        const items = dte.items || [
          { name: 'Desarrollo de Software B2B Multi-tenant', quantity: 1, price: dte.amount }
        ];
 
        doc.fillColor('#2C3E50').font('Helvetica').fontSize(8);
        items.forEach((item: any, index: number) => {
          if (index % 2 === 1) {
            doc.rect(40, itemY, 520, 16).fill('#F9FAFC');
            doc.fillColor('#2C3E50');
          }
 
          const itemTotal = Math.round(item.quantity * item.price);
 
          doc.text((index + 1).toString(), 45, itemY + 4, { width: 30, align: 'center' });
          doc.text(item.name, 85, itemY + 4, { width: 220 });
          doc.text(item.quantity.toString(), 315, itemY + 4, { width: 40, align: 'center' });
          doc.text(this.formatCurrency(item.price), 365, itemY + 4, { width: 80, align: 'right' });
          doc.text('0%', 455, itemY + 4, { width: 40, align: 'right' });
          doc.text(this.formatCurrency(itemTotal), 505, itemY + 4, { width: 50, align: 'right' });
 
          itemY += 16;
        });
 
        // Dibujar borde inferior de la tabla
        doc.lineWidth(0.5).strokeColor('#BDC3C7');
        doc.moveTo(40, itemY).lineTo(560, itemY).stroke();
 
        // 7. SECCIÓN DE TOTALES (LADO INFERIOR DERECHO)
        const totalY = itemY + 15;
        const totalAmount = Math.round(dte.amount);
        const isExempt = dte.type === 34 || dte.type === 41;
        
        const netAmount = isExempt ? 0 : Math.round(totalAmount / 1.19);
        const ivaAmount = isExempt ? 0 : totalAmount - netAmount;
        const exemptAmount = isExempt ? totalAmount : 0;
 
        doc.fillColor('#2C3E50').font('Helvetica-Bold').fontSize(8.5);
        if (!isExempt) {
          doc.text('Monto Neto:', 380, totalY);
          doc.text('I.V.A. (19%):', 380, totalY + 15);
        } else {
          doc.text('Monto Exento:', 380, totalY);
        }
        doc.fillColor('#D32F2F'); // Resaltar total en rojo
        doc.text('Monto Total:', 380, totalY + (isExempt ? 15 : 30));
 
        doc.fillColor('#34495E').font('Helvetica').fontSize(8.5);
        if (!isExempt) {
          doc.text(this.formatCurrency(netAmount), 480, totalY, { width: 75, align: 'right' });
          doc.text(this.formatCurrency(ivaAmount), 480, totalY + 15, { width: 75, align: 'right' });
        } else {
          doc.text(this.formatCurrency(exemptAmount), 480, totalY, { width: 75, align: 'right' });
        }
        doc.fillColor('#D32F2F').font('Helvetica-Bold');
        doc.text(this.formatCurrency(totalAmount), 480, totalY + (isExempt ? 15 : 30), { width: 75, align: 'right' });
 
        // 8. TIMBRE ELECTRÓNICO DTE (TED) - SECCIÓN INFERIOR
        const tedStartY = 540;
 
        // Extraer de forma estricta y dinámica el nodo <TED> del XML de base de datos.
        // Un DTE sin TED firmado válido NO puede representarse como PDF tributario (Ley 19.983).
        const xmlToEncode = dte.xmlContent || '';
        const tedMatch = /(<TED\b[^>]*>[\s\S]*?<\/TED>)/i.exec(xmlToEncode);
        if (!tedMatch) {
          throw new Error(
            `No se puede generar PDF: el DTE folio ${dte.folio} (tipo ${dte.type}) no tiene un nodo TED firmado válido en su XML. ` +
            `Un documento tributario sin TED no es legalmente válido.`
          );
        }
        const tedData = tedMatch[1].trim();
 
        try {
          this.logger.log('Codificando contenido XML real y firmado del TED en matriz PDF417...');
          const pdf417PngBuffer = await this.generatePdf417(tedData);
 
          // Dibujar el código de barras en el documento
          doc.image(pdf417PngBuffer, 40, tedStartY, { width: 260, height: 95 });
 
          // Dibujar recuadro e instructivo legal al lado del timbre
          doc.strokeColor('#D32F2F').lineWidth(1);
          doc.rect(320, tedStartY, 240, 95).stroke();
 
          doc.fillColor('#D32F2F').font('Helvetica-Bold').fontSize(8.5);
          doc.text('Timbre Electrónico S.I.I.', 330, tedStartY + 10, { width: 220, align: 'center' });
          doc.fillColor('#7F8C8D').font('Helvetica').fontSize(7.2);
          doc.text('Res. N° 80 de 2014 del S.I.I.', 330, tedStartY + 25, { width: 220, align: 'center' });
          doc.text('El acuse de recibo de este documento que se declare en el sitio web del S.I.I. es obligatorio para ejercer el derecho a crédito fiscal.', 330, tedStartY + 40, { width: 220, align: 'justify' });
          doc.text('Verifique documento en www.sii.cl', 330, tedStartY + 75, { width: 220, align: 'center' });
 
        } catch (barcodeError) {
          this.logger.error('Error generando matriz PDF417 para el TED:', barcodeError);
          doc.strokeColor('#E74C3C').rect(40, tedStartY, 260, 95).stroke();
          doc.fillColor('#C0392B').font('Helvetica-Bold').fontSize(8);
          doc.text('[ ERROR AL GENERAR CÓDIGO PDF417 ]', 50, tedStartY + 40, { width: 240, align: 'center' });
        }
 
        // Finalizar el documento
        doc.end();
 
      } catch (error) {
        this.logger.error('Excepción al renderizar el documento PDF:', error);
        reject(error);
      }
    });
  }

  private getDteTitle(type: number): string {
    const titles: Record<number, string> = {
      33: 'FACTURA ELECTRÓNICA',
      34: 'FACTURA EXENTA ELECTRÓNICA',
      39: 'BOLETA ELECTRÓNICA',
      41: 'BOLETA EXENTA ELECTRÓNICA',
      52: 'GUÍA DE DESPACHO ELECTRÓNICA',
      56: 'NOTA DE DÉBITO ELECTRÓNICA',
      61: 'NOTA DE CRÉDITO ELECTRÓNICA',
    };
    return titles[type] || 'DOCUMENTO ELECTRÓNICO';
  }

  private generatePdf417(text: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      bwipjs.toBuffer({
        bcid: 'pdf417',
        text: text,
        scale: 2,
        height: 14,
        includetext: false,
      }, (err, pngBuffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(pngBuffer);
        }
      });
    });
  }

  private formatRut(rut: string): string {
    if (!rut) return '';
    const clean = rut.replace(/[^0-9kK]/g, '');
    if (clean.length < 2) return clean;
    
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();
    
    let formattedBody = '';
    let count = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      formattedBody = body.charAt(i) + formattedBody;
      count++;
      if (count === 3 && i !== 0) {
        formattedBody = '.' + formattedBody;
        count = 0;
      }
    }
    
    return `${formattedBody}-${dv}`;
  }

  private formatCurrency(value: number): string {
    return `$${Math.round(value).toLocaleString('es-CL')}`;
  }
}
