import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildUpstreamURL, serverTiming } from '../src/index.ts';

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
  for (const query of ['rtMode=UNKNOWN', 'duration=2000', 'passlist=2', 'maxJourneys=-2', 'maxJourneys=1.5']) {
    const response = await worker.fetch(new Request(`https://fixture.invalid/atp/departureBoard?id=stop&${query}`), env);
    assert.equal(response.status, 400);
  }
});

test('unsupported routes and methods do not contact upstream', async () => {
  assert.equal((await worker.fetch(new Request('https://fixture.invalid/atp/journeyDetail'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://fixture.invalid/atp/departureBoard?id=stop', { method: 'POST' }), env)).status, 405);
});

test('departure boards default to all results and accept counts above the old cap', () => {
  for (const count of [null, '-1', '101', '10000']) {
    const url = new URL('https://fixture.invalid/atp/departureBoard?id=stop');
    if (count !== null) url.searchParams.set('maxJourneys', count);
    const upstream = buildUpstreamURL(url, env);
    assert.equal(upstream.searchParams.get('maxJourneys'), count ?? '-1');
  }
});

test('forwarded responses report the wait for the upstream headers in Server-Timing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response('{"Departure":[]}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://fixture.invalid/atp/departureBoard?id=stop'), env);
    assert.equal(response.status, 200);
    const match = /^upstream;dur=(\d+\.\d);desc="headers"$/.exec(response.headers.get('Server-Timing') ?? '');
    assert.ok(match, response.headers.get('Server-Timing') ?? 'missing');
    assert.ok(Number(match[1]) >= 25);
    assert.equal(await response.text(), '{"Departure":[]}');
  } finally {
    globalThis.fetch = original;
  }
});

test('Server-Timing names a valid edge location and never a malformed one', () => {
  assert.equal(serverTiming(812.44, 'LUX'), 'upstream;dur=812.4;desc="headers", edge;desc="LUX"');
  assert.equal(serverTiming(-1, 'lux"; x'), 'upstream;dur=0.0;desc="headers"');
  assert.equal(serverTiming(5), 'upstream;dur=5.0;desc="headers"');
});
