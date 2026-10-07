process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), execute: jest.fn() },
  checkDbConnection: jest.fn().mockResolvedValue(true),
}));

const request = require('supertest');
const app = require('../src/server');

test('GET /healthz returns ok', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('GET /readyz returns ready when the DB is up', async () => {
  const res = await request(app).get('/readyz');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ready');
});

test('GET /metrics exposes Prometheus metrics', async () => {
  const res = await request(app).get('/metrics');
  expect(res.status).toBe(200);
  expect(res.text).toContain('http_request_duration_seconds');
});

test('unknown route returns 404', async () => {
  const res = await request(app).get('/nope');
  expect(res.status).toBe(404);
});
