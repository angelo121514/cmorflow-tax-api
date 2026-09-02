import { Body, Controller, INestApplication, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { json } from 'express';
import * as request from 'supertest';
import { Reflector } from '@nestjs/core';
import { IDataServices } from '../src/domain';
import { IntegrationHmacGuard } from '../src/infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../src/infrastructure/decorators/integration-permission.decorator';
import { IntegrationSignatureUtil } from '../src/infrastructure/framework/integrations/integration-signature.util';
import { Aes256Cipher } from '../src/infrastructure/framework/crypto/aes-256-cipher';
import { FreshMemoryDataServices } from './helpers/fresh-memory-data.service';

@Controller('echo')
class EchoController {
  constructor(private readonly cls: ClsService) {}
  @Post()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  echo(@Body() body: any) { return { tenantId: this.cls.get('tenantId'), body }; }
}

describe('HMAC authentication (e2e)', () => {
  let app: INestApplication;
  let data: FreshMemoryDataServices;
  const secret = 'cmc_e2e_secret';
  const tenantId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    process.env.INTEGRATIONS_API_ENABLED = 'true';
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
      controllers: [EchoController],
      providers: [
        FreshMemoryDataServices,
        { provide: IDataServices, useExisting: FreshMemoryDataServices },
        IntegrationHmacGuard,
        Reflector,
        Aes256Cipher,
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(json({ verify: (req: any, _res, buffer) => { req.rawBody = buffer; } }));
    await app.init();
    data = app.get(FreshMemoryDataServices);
    await data.integrationCredential.create({
      id: 'credential-1', tenantId, keyId: 'cmor_live_e2e', secretHash: IntegrationSignatureUtil.hashSecret(secret),
      secretLast4: 'cret', name: 'e2e', credentialType: 'api', permissions: ['dte:read'], status: 'active',
    } as any).toPromise();
  });

  afterAll(async () => { await app.close(); });

  const signedHeaders = (body: string, nonce: string) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const canonical = IntegrationSignatureUtil.canonicalString('POST', '/echo', IntegrationSignatureUtil.bodyHash(body), timestamp, nonce);
    return {
      'X-Api-Key': 'cmor_live_e2e', 'X-Timestamp': timestamp, 'X-Nonce': nonce,
      'X-Signature': IntegrationSignatureUtil.sign(IntegrationSignatureUtil.hashSecret(secret), canonical),
      'Content-Type': 'application/json',
    };
  };

  it('authenticates, derives tenant from credential and blocks replay', async () => {
    const body = JSON.stringify({ value: 42 });
    const headers = signedHeaders(body, 'nonce-e2e-1');
    await request(app.getHttpServer()).post('/echo').set(headers).send(body).expect(201)
      .expect(({ body: response }) => expect(response.tenantId).toBe(tenantId));
    await request(app.getHttpServer()).post('/echo').set(headers).send(body).expect(401);
  });

  it('rejects a tenant header that disagrees with the credential', async () => {
    const body = JSON.stringify({ value: 43 });
    await request(app.getHttpServer()).post('/echo')
      .set({ ...signedHeaders(body, 'nonce-e2e-2'), 'X-Tenant-Id': '22222222-2222-4222-8222-222222222222' })
      .send(body).expect(403);
  });
});
