import { validateRuntimeConfig } from '../src/infrastructure/config/runtime-config';

describe('production startup contract', () => {
  it('rejects incomplete production configuration before opening an HTTP listener', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'production' })).toThrow(/incompleta/);
  });
});
