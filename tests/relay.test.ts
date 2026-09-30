import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildUpstreamURL } from '../src/index.ts';

const env = { ATP_ACCESS_ID: 'fixture-atp', JCDECAUX_API_KEY: 'fixture-bike' };

test('departure board forwards live windows, lists and filters without caller credentials', () => {
  const url = new URL('https://fixture.invalid/atp/departureBoard?id=000220402034&date=2026-09-30&time=18:35&duration=15&maxJourneys=20&passlist=1&rtMode=SERVER_DEFAULT&lines=651&products=32&accessId=attacker');
  const upstream = buildUpstreamURL(url, env);
  for (const key of ['id', 'date', 'time', 'duration', 'maxJourneys', 'passlist', 'rtMode', 'lines', 'products']) {
    assert.equal(upstream.searchParams.get(key), url.searchParams.get(key));
  }
  assert.equal(upstream.searchParams.get('accessId'), 'fixture-atp');
  assert.equal(upstream.searchParams.get('format'), 'json');
});

test('legacy FULL translates to the supported ATP mode', () => {
  const upstream = buildUpstreamURL(new URL('https://fixture.invalid/atp/departureBoard?id=stop&rtMode=FULL'), env);
  assert.equal(upstream.searchParams.get('rtMode'), 'SERVER_DEFAULT');
});

test('invalid mode, oversized duration and invalid passlist are rejected', async () => {
  for (const query of ['rtMode=UNKNOWN', 'duration=2000', 'passlist=2', 'maxJourneys=101']) {
    const response = await worker.fetch(new Request(`https://fixture.invalid/atp/departureBoard?id=stop&${query}`), env);
    assert.equal(response.status, 400);
  }
});

test('unsupported routes and methods do not contact upstream', async () => {
  assert.equal((await worker.fetch(new Request('https://fixture.invalid/atp/journeyDetail'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://fixture.invalid/atp/departureBoard?id=stop', { method: 'POST' }), env)).status, 405);
});
