import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SiiIntegrationMode = 'mock' | 'real';
export type SiiEnvironment = 'certification' | 'production';

export interface SiiEndpoints {
  baseUrl: string;
  seedUrl: string;
  tokenUrl: string;
  uploadUrl: string;
  uploadBoletaUrl: string;
  queryUploadStatusUrl: string;
  queryDteAdvancedStatusUrl: string;
}

@Injectable()
export class SiiEnvironmentConfig {
  constructor(private readonly configService: ConfigService) {}

  get integrationMode(): SiiIntegrationMode {
    const mode = this.configService.get<string>('SII_INTEGRATION_MODE', 'mock');
    return mode === 'real' ? 'real' : 'mock';
  }

  get environment(): SiiEnvironment {
    const environment = this.configService.get<string>('SII_ENVIRONMENT', 'certification');
    return environment === 'production' ? 'production' : 'certification';
  }

  get endpoints(): SiiEndpoints {
    const defaultBaseUrl =
      this.environment === 'production'
        ? 'https://palena.sii.cl'
        : 'https://maullin.sii.cl';

    const baseUrl = this.configService.get<string>('SII_BASE_URL', defaultBaseUrl).replace(/\/$/, '');

    const defaultBoletaUploadUrl =
      this.environment === 'production'
        ? 'https://wspapel.sii.cl/cgi_dte/UPL/DTEUpload'
        : `${baseUrl}/cgi_dte/UPL/DTEUpload`;

    return {
      baseUrl,
      seedUrl: this.configService.get<string>('SII_SEED_URL', `${baseUrl}/DTEWS/CrSeed.jws`),
      tokenUrl: this.configService.get<string>('SII_TOKEN_URL', `${baseUrl}/DTEWS/GetTokenFromSeed.jws`),
      uploadUrl: this.configService.get<string>('SII_UPLOAD_URL', `${baseUrl}/cgi_dte/UPL/DTEUpload`),
      uploadBoletaUrl: this.configService.get<string>('SII_UPLOAD_BOLETA_URL', defaultBoletaUploadUrl),
      queryUploadStatusUrl: this.configService.get<string>(
        'SII_QUERY_UPLOAD_STATUS_URL',
        `${baseUrl}/DTEWS/QueryEstUp.jws`,
      ),
      queryDteAdvancedStatusUrl: this.configService.get<string>(
        'SII_QUERY_DTE_ADVANCED_STATUS_URL',
        `${baseUrl}/DTEWS/QueryEstDteAv.jws`,
      ),
    };
  }


  get senderRut(): string | undefined {
    return this.configService.get<string>('SII_SENDER_RUT');
  }

  get requestTimeoutMs(): number {
    return Number(this.configService.get<string>('SII_REQUEST_TIMEOUT_MS', '30000'));
  }

  assertRealModeReady(): void {
    if (this.integrationMode !== 'real') {
      return;
    }

    // RutEnvia se obtiene del sobre firmado para soportar múltiples empresas.
    // SII_SENDER_RUT queda sólo como respaldo para integraciones heredadas.
  }
}
