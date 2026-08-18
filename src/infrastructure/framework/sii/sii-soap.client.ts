import { Injectable, Logger } from '@nestjs/common';
import { Observable, from, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { SiiMockSoap } from './sii-mock.soap';
import { SiiEnvironmentConfig } from './sii-environment.config';
import { Iso88591Encoder } from './iso-8859-1.encoder';
import { SiiConnectionError } from './sii-validation.error';
import { SiiXsdValidator } from './sii-xsd.validator';

@Injectable()
export class SiiSoapClient {
  private readonly logger = new Logger(SiiSoapClient.name);

  constructor(
    private readonly siiMockSoap: SiiMockSoap,
    private readonly siiEnvironmentConfig: SiiEnvironmentConfig,
    private readonly siiXsdValidator: SiiXsdValidator,
  ) {}

  /**
   * Solicita una semilla aleatoria de autenticación al SII.
   */
  public getSeed(): Observable<string> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(this.getRealSeed());
    }

    this.logger.log('Solicitando semilla (getSeed) al servidor mock del SII...');
    
    return of(null).pipe(
      delay(500), // Simular latencia de red
      map(() => {
        const envelope = this.siiMockSoap.getSeed();
        // Extraer la semilla del XML
        const match = /<semilla>([^<]+)<\/semilla>/.exec(envelope);
        if (!match) {
          throw new Error('Respuesta getSeed inválida del SII.');
        }
        return match[1];
      })
    );
  }

  /**
   * Intercambia la semilla firmada por un token de sesión oficial del SII (getToken).
   */
  public getToken(signedSeedXml: string): Observable<string> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(this.getRealToken(signedSeedXml));
    }

    this.logger.log('Intercambiando semilla firmada (getToken) ante el mock del SII...');
    
    return of(null).pipe(
      delay(800), // Simular procesamiento de autenticación
      map(() => {
        const { xmlResponse, token } = this.siiMockSoap.getToken(signedSeedXml);
        if (!token) {
          throw new Error('No se pudo autenticar ante el SII: Firma digital de semilla inválida.');
        }
        return token;
      })
    );
  }

  /**
   * Envía un sobre DTE firmado al Web Service de Recepción del SII.
   */
  public sendDteEnvelope(signedXml: string, token: string): Observable<{ trackId: string; status: string }> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(this.uploadRealDte(signedXml, token));
    }

    this.logger.log('Enviando sobre DTE firmado (sendDte) al mock de recepción del SII...');
    
    return of(null).pipe(
      delay(1200), // Simular latencia de transmisión de archivos
      map(() => {
        const result = this.siiMockSoap.receiveDte(signedXml, token);
        if (!result.success || !result.trackId) {
          throw new Error(`Rechazo del SII: ${result.errorMsg}`);
        }
        
        this.logger.log(`Transmisión exitosa. DTE aceptado con TrackID: ${result.trackId}`);
        return {
          trackId: result.trackId,
          status: 'ENVIADO'
        };
      })
    );
  }

  public sendLibroCompraVenta(signedXml: string, token: string): Observable<{ trackId: string; status: string }> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(Promise.reject(new Error('La transmisión IECV real todavía no está habilitada; usa el flujo de certificación cuando se valide el contrato SII.')));
    }
    return of(null).pipe(delay(150), map(() => {
      const result = this.siiMockSoap.receiveLibro(signedXml, token);
      if (!result.success || !result.trackId) throw new Error(result.errorMsg || 'El mock IECV rechazó el libro.');
      return { trackId: result.trackId, status: 'ENVIADO' };
    }));
  }

  public queryLibroCompraVentaStatus(trackId: string, token: string): Observable<{ status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' }> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(Promise.reject(new Error('La consulta IECV real todavía no está habilitada.')));
    }
    return of({ status: this.siiMockSoap.queryLibro(trackId, token) }).pipe(delay(100));
  }

  /**
   * Consulta el estado de procesamiento de un envío por su trackId.
   */
  public queryTrackStatus(trackId: string, token: string): Observable<{ status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' }> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(this.queryRealTrackStatus(trackId, token));
    }

    this.logger.log(`Consultando estado de TrackID: ${trackId} ante el mock del SII...`);
    
    // Determinar un estado basado en los últimos dígitos del trackId para que sea determinista en pruebas
    const lastDigit = parseInt(trackId.slice(-1));
    let status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' = 'ACEPTADO';
    
    if (lastDigit === 9) {
      status = 'RECHAZADO';
    } else if (lastDigit === 8 || lastDigit === 7) {
      status = 'REPARO';
    } else if (lastDigit === 0) {
      status = 'PROCESANDO';
    }

    return of({ status }).pipe(
      delay(600),
      map((res) => {
        this.logger.log(`Respuesta del SII obtenida para TrackID ${trackId}: Estado = ${res.status}`);
        return res;
      })
    );
  }

  public queryDteAdvancedStatus(
    issuerRut: string,
    receiverRut: string,
    type: number,
    folio: number,
    issueDate: string,
    totalAmount: number,
    token: string,
  ): Observable<{ status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' }> {
    if (this.siiEnvironmentConfig.integrationMode === 'real') {
      return from(this.queryRealDteAdvancedStatus(
        issuerRut,
        receiverRut,
        type,
        folio,
        issueDate,
        totalAmount,
        token,
      ));
    }

    return of({ status: 'ACEPTADO' as const }).pipe(delay(300));
  }

  private async getRealSeed(): Promise<string> {
    this.siiEnvironmentConfig.assertRealModeReady();

    const { seedUrl } = this.siiEnvironmentConfig.endpoints;
    const body =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Body><getSeed/></soapenv:Body>' +
      '</soapenv:Envelope>';

    this.logger.log(`Solicitando semilla real SII (${this.siiEnvironmentConfig.environment}) en ${seedUrl}`);
    const responseText = await this.postSoap(seedUrl, body);
    const seed = this.extractFirst(responseText, ['SEMILLA', 'semilla']);
    if (!seed) {
      throw new Error('Respuesta getSeed del SII no contiene SEMILLA.');
    }

    return seed;
  }

  private async getRealToken(signedSeedXml: string): Promise<string> {
    this.siiEnvironmentConfig.assertRealModeReady();

    const { tokenUrl } = this.siiEnvironmentConfig.endpoints;
    const escapedSeed = this.escapeXml(signedSeedXml);
    const body =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      `<soapenv:Body><getToken><pszXml>${escapedSeed}</pszXml></getToken></soapenv:Body>` +
      '</soapenv:Envelope>';

    this.logger.log(`Intercambiando semilla firmada por token real SII en ${tokenUrl}`);
    const responseText = await this.postSoap(tokenUrl, body);
    const token = this.extractFirst(responseText, ['TOKEN', 'token']);
    if (!token) {
      throw new Error('Respuesta getToken del SII no contiene TOKEN.');
    }

    return token;
  }

  private async uploadRealDte(
    signedXml: string,
    token: string,
  ): Promise<{ trackId: string; status: string }> {
    const isBoleta = signedXml.includes('<EnvioBOLETA');
    const uploadUrl = isBoleta
      ? this.siiEnvironmentConfig.endpoints.uploadBoletaUrl
      : this.siiEnvironmentConfig.endpoints.uploadUrl;

    const senderRutValue = this.extractFirst(signedXml, ['RutEnvia']) || this.siiEnvironmentConfig.senderRut;
    if (!senderRutValue) {
      throw new Error('El sobre a transmitir no contiene RutEnvia y no se configuró SII_SENDER_RUT como respaldo.');
    }
    const senderRut = this.parseRut(senderRutValue);
    const companyRut = this.parseRut(this.extractFirst(signedXml, ['RUTEmisor']) || senderRut.full);
    const boundary = `----sii-dte-${Date.now().toString(16)}`;
    const envioXml = Iso88591Encoder.normalizeXmlDeclaration(signedXml);
    
    if (!isBoleta) {
      await this.siiXsdValidator.validateEnvioDte(envioXml);
    } else {
      await this.siiXsdValidator.validateEnvioBoleta(envioXml);
    }

    const xmlBuffer = Iso88591Encoder.encode(envioXml);

    const fields = [
      ['rutSender', senderRut.body],
      ['dvSender', senderRut.dv],
      ['rutCompany', companyRut.body],
      ['dvCompany', companyRut.dv],
    ];

    const chunks: Buffer[] = [];
    for (const [name, value] of fields) {
      chunks.push(Buffer.from(`--${boundary}\r\n`, 'latin1'));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'latin1'));
      chunks.push(Buffer.from(`${value}\r\n`, 'latin1'));
    }
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'latin1'));
    chunks.push(
      Buffer.from(
        'Content-Disposition: form-data; name="archivo"; filename="envio-dte.xml"\r\n' +
          'Content-Type: text/xml; charset=ISO-8859-1\r\n\r\n',
        'latin1',
      ),
    );
    chunks.push(xmlBuffer);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'));

    this.logger.log(`Subiendo DTE real por multipart/form-data a ${uploadUrl}`);
    const response = await this.fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        Cookie: `TOKEN=${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Accept: 'text/xml, text/plain, */*',
      },
      body: Buffer.concat(chunks) as unknown as BodyInit,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Upload SII HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const trackId = this.extractFirst(responseText, ['TRACKID', 'trackid', 'TrackId', 'TRACK_ID']);
    if (!trackId) {
      throw new Error(`Respuesta upload SII sin TrackId: ${responseText.slice(0, 500)}`);
    }

    return { trackId, status: 'ENVIADO' };
  }

  private async queryRealTrackStatus(
    trackId: string,
    token: string,
  ): Promise<{ status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' }> {
    this.siiEnvironmentConfig.assertRealModeReady();

    const { queryUploadStatusUrl } = this.siiEnvironmentConfig.endpoints;
    const senderRut = this.parseRut(this.siiEnvironmentConfig.senderRut!);
    const body =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Body>' +
      `<getEstUp><RutCompania>${senderRut.body}</RutCompania><DvCompania>${senderRut.dv}</DvCompania>` +
      `<TrackId>${trackId}</TrackId><Token>${token}</Token></getEstUp>` +
      '</soapenv:Body></soapenv:Envelope>';

    this.logger.log(`Consultando estado real de envío SII en ${queryUploadStatusUrl}`);
    const responseText = await this.postSoap(queryUploadStatusUrl, body);
    const status = this.extractFirst(responseText, ['ESTADO', 'STATUS', 'estado', 'status']);
    return { status: this.mapSiiStatus(status) };
  }

  private async queryRealDteAdvancedStatus(
    issuerRut: string,
    receiverRut: string,
    type: number,
    folio: number,
    issueDate: string,
    totalAmount: number,
    token: string,
  ): Promise<{ status: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' }> {
    this.siiEnvironmentConfig.assertRealModeReady();

    const { queryDteAdvancedStatusUrl } = this.siiEnvironmentConfig.endpoints;
    const issuer = this.parseRut(issuerRut);
    const receiver = this.parseRut(receiverRut);
    const body =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Body>' +
      '<getEstDteAv>' +
      `<Token>${token}</Token>` +
      `<RutCompania>${issuer.body}</RutCompania><DvCompania>${issuer.dv}</DvCompania>` +
      `<RutReceptor>${receiver.body}</RutReceptor><DvReceptor>${receiver.dv}</DvReceptor>` +
      `<TipoDte>${type}</TipoDte><FolioDte>${folio}</FolioDte>` +
      `<FechaEmisionDte>${issueDate}</FechaEmisionDte><MontoDte>${totalAmount}</MontoDte>` +
      '</getEstDteAv>' +
      '</soapenv:Body></soapenv:Envelope>';

    this.logger.log(`Consultando estado avanzado DTE real en ${queryDteAdvancedStatusUrl}`);
    const responseText = await this.postSoap(queryDteAdvancedStatusUrl, body);
    const status = this.extractFirst(responseText, ['ESTADO', 'STATUS', 'estado', 'status']);
    return { status: this.mapSiiStatus(status) };
  }

  private async postSoap(url: string, body: string): Promise<string> {
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=ISO-8859-1',
        SOAPAction: '',
        Accept: 'text/xml, text/plain, */*',
      },
      body: Iso88591Encoder.encode(Iso88591Encoder.normalizeXmlDeclaration(body)) as unknown as BodyInit,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`SOAP SII HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    return responseText;
  }

  private extractFirst(xml: string, tagNames: string[]): string | undefined {
    for (const tagName of tagNames) {
      const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private parseRut(rut: string): { full: string; body: string; dv: string } {
    const normalized = rut.replace(/\./g, '').toUpperCase().trim();
    const match = /^(\d+)-?([0-9K])$/.exec(normalized);
    if (!match) {
      throw new Error(`RUT inválido para integración SII: ${rut}`);
    }

    return {
      full: `${match[1]}-${match[2]}`,
      body: match[1],
      dv: match[2],
    };
  }

  private mapSiiStatus(status?: string): 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' {
    const normalized = (status || '').toUpperCase();
    if (normalized.includes('RECH') || normalized === 'RCH') {
      return 'RECHAZADO';
    }
    if (normalized.includes('REPARO') || normalized === 'RPR') {
      return 'REPARO';
    }
    if (normalized.includes('ACEP') || normalized === 'EPR' || normalized === 'OK') {
      return 'ACEPTADO';
    }

    return 'PROCESANDO';
  }

  private escapeXml(value: string): string {
    return value.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        case '"':
          return '&quot;';
        default:
          return char;
      }
    });
  }

  /**
   * fetch con retry/backoff exponencial ante errores de conexión o timeout.
   *
   * ISSUE-012: el SII ocasionalmente rechaza conexiones o timeoutea bajo carga.
   * Antes, un único fallo abortaba la emisión. Ahora se reintenta hasta 3 veces
   * con backoff exponencial (500ms, 1000ms). Solo reintenta ante
   * `SiiConnectionError` (TIMEOUT / CONNECTION_ERROR); los errores HTTP de
   * negocio (4xx/5xx del cuerpo SOAP) se propagan sin reintentar.
   */
  private async fetchWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.fetchWithTimeout(url, init);
      } catch (error) {
        lastError = error;
        const isConnectionError = error instanceof SiiConnectionError;
        if (!isConnectionError || attempt === maxAttempts) {
          throw error;
        }
        const backoffMs = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms
        this.logger.warn(
          `SII intento ${attempt}/${maxAttempts} fallido (${(error as Error).message}), reintentando en ${backoffMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.siiEnvironmentConfig.requestTimeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SiiConnectionError(
          `Timeout conectando con SII (${url}) después de ${this.siiEnvironmentConfig.requestTimeoutMs}ms.`,
          'TIMEOUT',
        );
      }

      const message = error instanceof Error ? error.message : 'Error de conexión desconocido.';
      throw new SiiConnectionError(`No se pudo conectar con SII (${url}): ${message}`, 'CONNECTION_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }
}
