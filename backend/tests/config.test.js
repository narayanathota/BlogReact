// The app must refuse to start when its secrets are missing, instead of using built-in defaults.

describe('required secrets', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  test('JWT_SECRET missing -> auth middleware refuses to load', () => {
    delete process.env.JWT_SECRET;
    expect(() => require('../src/middleware/auth')).toThrow('JWT_SECRET is not set');
  });

  test('JWT_SECRET present -> auth middleware loads', () => {
    process.env.JWT_SECRET = 'unit-test-secret';
    const auth = require('../src/middleware/auth');
    expect(auth.JWT_SECRET).toBe('unit-test-secret');
  });

  test('DB_PASSWORD missing -> database config refuses to load', () => {
    delete process.env.DB_PASSWORD;
    expect(() => require('../src/config/db')).toThrow('DB_PASSWORD is not set');
  });

  test('DB_PASSWORD present -> database config loads (pool is created lazily, no connection is made)', () => {
    process.env.DB_PASSWORD = 'unit-test-password';
    const db = require('../src/config/db');
    expect(typeof db.checkDbConnection).toBe('function');
  });
});
