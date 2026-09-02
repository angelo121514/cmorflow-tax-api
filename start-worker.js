const tsConfigPaths = require('tsconfig-paths');

tsConfigPaths.register({
  baseUrl: `${__dirname}/dist`,
  paths: {
    '@domain/*': ['domain/*'], '@domain': ['domain/index'],
    '@application/*': ['application/*'], '@application': ['application/index'],
    '@infrastructure/*': ['infrastructure/*'], '@infrastructure': ['infrastructure/index'],
    '@controllers/*': ['controllers/*'], '@controllers': ['controllers/index'],
  },
});

require('./dist/worker');
