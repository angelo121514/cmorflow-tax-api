// src/controllers/artifacts.controller.ts
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { Response } from 'express';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IntegrationArtifactsService } from '../application/integrations/integration-artifacts.service';

@ApiTags('artifacts')
@Controller('artifacts')
export class ArtifactsController {
  constructor(
    private readonly cls: ClsService,
    private readonly artifactsService: IntegrationArtifactsService,
  ) {}

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Descargar artefacto con URL firmada (sin headers HMAC)' })
  async download(@Param('token') token: string, @Res() res: Response) {
    const payload = this.artifactsService.verifySignedUrl(token);
    this.cls.set('tenantId', payload.tenantId);
    if (payload.kind === 'xml') {
      const { xml, dte } = await this.artifactsService.getXml(payload.tenantId, payload.dteId);
      res.set({ 'Content-Type': 'application/xml', 'Content-Disposition': `attachment; filename="DTE_${dte.type}_Folio_${dte.folio}.xml"` });
      return res.end(xml);
    }
    const { pdf, dte } = await this.artifactsService.getPdf(payload.tenantId, payload.dteId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="DTE_${dte.type}_Folio_${dte.folio}.pdf"`, 'Content-Length': pdf.length });
    res.end(pdf);
  }
}