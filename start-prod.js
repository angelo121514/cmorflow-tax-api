// start-prod.js — arranca la app compilada resolviendo los paths @domain/@application/etc.
// Con rootDir=src, el JS compilado queda en dist/ (main.js, domain/, application/, ...).
// Registramos tsconfig-paths con baseUrl=dist y paths que apuntan directo a las carpetas.
const tsConfigPaths = require('tsconfig-paths');

tsConfigPaths.register({
  baseUrl: `${__dirname}/dist`,
  paths: {
    '@domain/*': ['domain/*'],
    '@domain': ['domain/index'],
    '@application/*': ['application/*'],
    '@application': ['application/index'],
    '@infrastructure/*': ['infrastructure/*'],
    '@infrastructure': ['infrastructure/index'],
    '@controllers/*': ['controllers/*'],
    '@controllers': ['controllers/index'],
  },
});

require('./dist/main');