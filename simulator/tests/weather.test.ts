import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFailure } from '../worker/generation';
import { fetchWeather, parseNwsWeather, parseOpenMeteoWeather, WeatherService, weatherDescription } from '../worker/weather';
import { weatherScene, type WeatherCondition } from '../shared/weather';
import { renderScene } from '../shared/render';

const NOW = Date.parse('2026-09-13T23:20:00Z');
const nws = () => ({ properties: { stationId: 'KBOS', timestamp: '2026-09-13T23:05:00+00:00',
  temperature: { value: 19, unitCode: 'wmoUnit:degC', qualityControl: 'V' },
  icon: 'https://api.weather.gov/icons/land/night/fog?size=medium', textDescription: 'Fog/Mist' } });
const modeled = () => ({ latitude: 42.372787, longitude: -71.09674,
  current_units: { time: 'unixtime', temperature_2m: '°F', weather_code: 'wmo code' },
  current: { time: Date.parse('2026-09-13T23:15:00Z') / 1000, temperature_2m: 66.6, weather_code: 3, is_day: 0 } });

test('nearby measured conditions retain station provenance and actual observation time', () => {
  const weather = parseNwsWeather(nws(), NOW);
  assert.equal(weather.temperatureF, 66);
  assert.equal(weather.condition, 'fog');
  assert.equal(weather.isDay, false);
  assert.equal(weather.observedAt, Date.parse('2026-09-13T23:05:00Z'));
  assert.equal(weather.fetchedAt, NOW);
  const description = weatherDescription(weather);
  assert.equal(description.title, '66°F · Fog/Mist');
  assert.match(description.interpretation, /NWS observation at nearby Logan \(KBOS\).*7:05 PM EDT.*stays fixed/);
  for (const value of [null, undefined, NaN, '19', 200]) {
    const bad = nws() as any; bad.properties.temperature.value = value;
    assert.throws(() => parseNwsWeather(bad, NOW), ApiFailure);
  }
  const wrongStation = nws(); wrongStation.properties.stationId = 'KSFO';
  assert.throws(() => parseNwsWeather(wrongStation, NOW), ApiFailure);
  const badQuality = nws(); badQuality.properties.temperature.qualityControl = 'Z';
  assert.throws(() => parseNwsWeather(badQuality, NOW), ApiFailure);
});

test('modeled current weather distinguishes day, night, rain, clouds and uncommon conditions', () => {
  const expected: [number, WeatherCondition, string][] = [[0, 'clear', 'Sunny'], [2, 'partly-cloudy', 'Partly cloudy'], [3, 'cloudy', 'Overcast'],
    [61, 'rain', 'Light rain'], [73, 'snow', 'Moderate snow'], [48, 'fog', 'Rime fog'], [66, 'sleet', 'Light freezing rain'], [99, 'thunderstorm', 'Thunderstorm with heavy hail']];
  for (const [code, condition, label] of expected) {
    const input = modeled(); input.current.weather_code = code; input.current.is_day = 1;
    const result = parseOpenMeteoWeather(input, NOW);
    assert.equal(result.temperatureF, 67);
    assert.equal(result.condition, condition);
    assert.equal(result.conditionLabel, label);
    assert.equal(result.provider, 'open-meteo');
  }
  const night = modeled(); night.current.weather_code = 0;
  assert.equal(parseOpenMeteoWeather(night, NOW).conditionLabel, 'Clear night');
  assert.match(weatherDescription(parseOpenMeteoWeather(modeled(), NOW)).interpretation, /Open-Meteo modeled conditions for Cambridge/);
  for (const value of [null, undefined, NaN, '66.6']) {
    const bad = modeled() as any; bad.current.temperature_2m = value;
    assert.throws(() => parseOpenMeteoWeather(bad, NOW), ApiFailure);
  }
  for (const patch of [{ weather_code: 100 }, { time: '2026-09-13T19:15' }, { is_day: null }]) {
    const bad = modeled() as any; Object.assign(bad.current, patch);
    assert.throws(() => parseOpenMeteoWeather(bad, NOW), ApiFailure);
  }
  const wrongUnits = modeled(); wrongUnits.current_units.temperature_2m = '°C';
  assert.throws(() => parseOpenMeteoWeather(wrongUnits, NOW), ApiFailure);
});

test('stale and future weather cannot become current merely by refetching it', () => {
  for (const offset of [-76 * 60_000, 6 * 60_000]) {
    const input = nws(); input.properties.timestamp = new Date(NOW + offset).toISOString();
    assert.throws(() => parseNwsWeather(input, NOW), ApiFailure);
  }
  for (const offset of [-46 * 60_000, 6 * 60_000]) {
    const input = modeled(); input.current.time = (NOW + offset) / 1000;
    assert.throws(() => parseOpenMeteoWeather(input, NOW), ApiFailure);
  }
});

test('fixed NWS endpoint wins when fresh, otherwise a single explicit model fallback is used', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.redirect, 'manual');
    assert.match(new Headers(init?.headers).get('User-Agent')!, /hackthisbuilding.com/);
    return Response.json(nws());
  };
  assert.equal((await fetchWeather(NOW, { fetcher })).provider, 'nws');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].href, 'https://api.weather.gov/stations/KBOS/observations/latest');
  const fallbackCalls: URL[] = [];
  const fallback: typeof fetch = async input => {
    const url = new URL(String(input)); fallbackCalls.push(url);
    if (fallbackCalls.length === 1) return new Response('unavailable', { status: 503 });
    assert.equal(url.origin, 'https://api.open-meteo.com');
    assert.equal(url.pathname, '/v1/forecast');
    assert.equal(url.searchParams.get('latitude'), '42.3603');
    assert.equal(url.searchParams.get('longitude'), '-71.0893');
    assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
    assert.equal(url.searchParams.get('timeformat'), 'unixtime');
    return Response.json(modeled());
  };
  assert.equal((await fetchWeather(NOW, { fetcher: fallback })).provider, 'open-meteo');
  assert.equal(fallbackCalls.length, 2);
});

test('shared cache coalesces clicks, cannot be mutated and expires after five minutes', async () => {
  let calls = 0;
  const service = new WeatherService({ fetcher: async () => { calls++; return Response.json(nws()); } });
  const [a, b] = await Promise.all([service.get(NOW), service.get(NOW)]);
  assert.equal(calls, 1);
  a.temperatureF = 100;
  assert.equal(b.temperatureF, 66);
  await service.get(NOW + 299_999);
  assert.equal(calls, 1);
  await service.get(NOW + 300_000);
  assert.equal(calls, 2);
  let failing = false, failureCalls = 0;
  const unavailableService = new WeatherService({ fetcher: async () => { failureCalls++; return failing ? new Response('private', { status: 503 }) : Response.json(nws()); } });
  await unavailableService.get(NOW);
  failing = true;
  await assert.rejects(unavailableService.get(NOW + 300_000), ApiFailure);
  await assert.rejects(unavailableService.get(NOW + 300_001), ApiFailure);
  assert.equal(failureCalls, 3, 'one failure per provider then short cooldown, without stale cache fallback');
});

test('provider failures and oversized bodies stay private, bounded and deadline-limited', async () => {
  for (const response of [
    () => new Response('private', { status: 503 }),
    () => new Response('private', { status: 302, headers: { Location: 'https://other.test' } }),
    () => new Response('private malformed json'),
    () => new Response('{}', { headers: { 'Content-Length': '100000' } }),
    () => new Response('x'.repeat(70_000)),
    () => Response.json({ current: null }),
  ]) {
    let calls = 0;
    await assert.rejects(fetchWeather(NOW, { fetcher: async () => { calls++; return response(); } }),
      (error: unknown) => error instanceof ApiFailure && error.code === 'WEATHER_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(calls, 2);
  }
  const aborted: string[] = [];
  const hanging: typeof fetch = async (url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => { aborted.push(String(url)); reject(new Error('private')); }));
  await assert.rejects(fetchWeather(NOW, { fetcher: hanging, nwsTimeoutMs: 5, timeoutMs: 20 }), ApiFailure);
  assert.equal(aborted.length, 2, 'the NWS budget and total deadline both abort network work');
  let calls = 0;
  const recovers: typeof fetch = async (url, init) => {
    if (++calls === 2) return Response.json(modeled());
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('slow NWS'))));
  };
  assert.equal((await fetchWeather(NOW, { fetcher: recovers, nwsTimeoutMs: 5, timeoutMs: 100 })).provider, 'open-meteo');
});

test('weather icon stays fixed while Fahrenheit text fits negative and three-digit readings', () => {
  const weather = parseOpenMeteoWeather(modeled(), NOW);
  for (const temperatureF of [-99, -5, 0, 67, 100, 150]) {
    const scene = weatherScene({ ...weather, temperatureF });
    assert.equal(scene.text?.value, `${temperatureF} F`);
    const first = renderScene(scene, 0), later = renderScene(scene, 2500);
    assert.deepEqual(first.slice(0, 5), later.slice(0, 5));
    assert.notDeepEqual(first.slice(6, 11), later.slice(6, 11));
    for (const frame of [first, later]) {
      assert.equal(frame.length, 17);
      assert.ok(frame.every(row => row.length === 9 && row.every(pixel => pixel.length === 3 && pixel.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255))));
    }
  }
  const day = weatherScene({ ...weather, condition: 'clear', isDay: true });
  const night = weatherScene({ ...weather, condition: 'clear', isDay: false });
  assert.notDeepEqual(day.raster?.pixels, night.raster?.pixels);
  const conditions: WeatherCondition[] = ['clear', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'fog', 'thunderstorm', 'sleet'];
  const icons = conditions.map(condition => JSON.stringify(weatherScene({ ...weather, condition }).raster?.pixels));
  assert.equal(new Set(icons).size, conditions.length);
});
