import { SiiSoapClient } from './sii-soap.client';
import { SiiConnectionError } from './sii-validation.error';

describe('SiiSoapClient — fetchWithRetry (ISSUE-012)', () => {
  let client: SiiSoapClient;
  let fetchMock: jest.Mock;
  let mockEnvConfig: any;
  let mockXsdValidator: any;
  let mockMockSoap: any;

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    mockEnvConfig = {
      requestTimeoutMs: 5000,
      integrationMode: 'real',
      environment: 'certification',
      senderRut: '76123456-7',
      xsdValidationEnabled: false,
      trackWorkerEnabled: false,
      baseUrl: 'https://maullin.sii.cl',
      seedUrl: 'https://maullin.sii.cl/DTEWS/CrSeed.jws',
      tokenUrl: 'https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws',
      uploadUrl: 'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload',
    };
    mockXsdValidator = { validate: jest.fn().mockReturnValue({ valid: true }) };
    mockMockSoap = {};

    client = new SiiSoapClient(mockMockSoap, mockEnvConfig, mockXsdValidator);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debe reintentar ante timeout de conexión y eventualmente tener éxito', async () => {
    // AbortController abort => fetch rechaza con AbortError => fetchWithTimeout lanza SiiConnectionError(TIMEOUT)
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls++;
      if (calls < 3) {
        // Simula timeout: el AbortController se dispara inmediatamente
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<resp>ok</resp>'),
      } as Response);
    });

    // getRealSeed llama a postSoap internamente; lo probamos indirectamente via reflection
    // accediendo al método privado postSoap.
    const postSoap = (client as any).postSoap.bind(client);
    const result = await postSoap('https://maullin.sii.cl/DTEWS/CrSeed.jws', '<soap/>');

    expect(calls).toBe(3);
    expect(result).toBe('<resp>ok</resp>');
  });

  it('no debe reintentar ante error HTTP de negocio (4xx/5xx del cuerpo SOAP)', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls++;
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      } as Response);
    });

    const postSoap = (client as any).postSoap.bind(client);
    await expect(postSoap('https://x', '<soap/>')).rejects.toThrow(/HTTP 500/);
    // Solo 1 intento: el error HTTP no es de conexión, no reintenta.
    expect(calls).toBe(1);
  });

  it('debe propagar el error tras agotar los reintentos', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls++;
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const postSoap = (client as any).postSoap.bind(client);
    await expect(postSoap('https://x', '<soap/>')).rejects.toThrow();
    // 3 intentos (maxAttempts default).
    expect(calls).toBe(3);
  });
});
