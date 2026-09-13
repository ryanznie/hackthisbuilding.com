import { ApiFailure } from './generation';
import type { WeatherCondition, WeatherSnapshot } from '../shared/weather';

export const WEATHER_PREVIEW_TTL_MS = 5 * 60_000;
const CACHE_MS = 5 * 60_000;
const MAX_BYTES = 64 * 1024;
const NWS_MAX_AGE_MS = 75 * 60_000;
const MODEL_MAX_AGE_MS = 45 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const NWS_URL = 'https://api.weather.gov/stations/KBOS/observations/latest';
// MIT Green Building vicinity, fixed by the server; no visitor location is sent.
const MODEL_URL = 'https://api.open-meteo.com/v1/forecast?latitude=42.3603&longitude=-71.0893&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timeformat=unixtime&timezone=GMT&forecast_days=1';
type Options = { fetcher?: typeof fetch; timeoutMs?: number; nwsTimeoutMs?: number };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const unavailable = () => new ApiFailure(503, 'WEATHER_UNAVAILABLE', 'Current Cambridge weather could not be verified. Please try again shortly.');
const fresh = (timestamp: number, now: number, maximumAge: number) => Number.isFinite(timestamp) && timestamp <= now + FUTURE_TOLERANCE_MS && timestamp >= now - maximumAge;
function temperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -99 || value > 150) throw unavailable();
  return Math.round(value);
}

const NWS_ICONS: Record<string, WeatherCondition> = {
  skc: 'clear', few: 'partly-cloudy', sct: 'partly-cloudy', bkn: 'cloudy', ovc: 'cloudy',
  wind_skc: 'clear', wind_few: 'partly-cloudy', wind_sct: 'partly-cloudy', wind_bkn: 'cloudy', wind_ovc: 'cloudy',
  rain: 'rain', rain_showers: 'rain', rain_showers_hi: 'rain', snow: 'snow', blizzard: 'snow',
  rain_snow: 'sleet', rain_sleet: 'sleet', snow_sleet: 'sleet', fzra: 'sleet', rain_fzra: 'sleet', snow_fzra: 'sleet', sleet: 'sleet',
  tsra: 'thunderstorm', tsra_sct: 'thunderstorm', tsra_hi: 'thunderstorm', fog: 'fog',
};

/** Nearby measured conditions, labeled as Logan rather than an on-building sensor. */
export function parseNwsWeather(input: unknown, now: number): WeatherSnapshot {
  const properties = object(object(input)?.properties), measurement = object(properties?.temperature);
  if (!properties || properties.stationId !== 'KBOS' || measurement?.unitCode !== 'wmoUnit:degC'
    || typeof measurement.value !== 'number' || !Number.isFinite(measurement.value)
    || measurement.qualityControl === 'Z' || measurement.qualityControl === 'X'
    || typeof properties.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(properties.timestamp)) throw unavailable();
  const observedAt = Date.parse(properties.timestamp);
  if (!fresh(observedAt, now, NWS_MAX_AGE_MS)) throw unavailable();
  if (typeof properties.icon !== 'string') throw unavailable();
  const icon = new URL(properties.icon);
  const match = /^\/icons\/land\/(day|night)\/([a-z_]+)(?:,\d{1,3})?$/.exec(icon.pathname);
  if (icon.origin !== 'https://api.weather.gov' || !match || !Object.hasOwn(NWS_ICONS, match[2])) throw unavailable();
  if (typeof properties.textDescription !== 'string' || !/^[A-Za-z][A-Za-z /(),.-]{0,79}$/.test(properties.textDescription)) throw unavailable();
  const condition = NWS_ICONS[match[2]], isDay = match[1] === 'day';
  return { temperatureF: temperature(measurement.value * 9 / 5 + 32), condition,
    conditionLabel: condition === 'clear' ? (isDay ? 'Sunny' : 'Clear night') : properties.textDescription,
    isDay, observedAt, fetchedAt: now, provider: 'nws' };
}

const WMO: Record<number, [WeatherCondition, string]> = {
  0: ['clear', 'Clear sky'], 1: ['partly-cloudy', 'Mainly clear'], 2: ['partly-cloudy', 'Partly cloudy'], 3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'], 48: ['fog', 'Rime fog'],
  51: ['rain', 'Light drizzle'], 53: ['rain', 'Moderate drizzle'], 55: ['rain', 'Dense drizzle'],
  56: ['sleet', 'Light freezing drizzle'], 57: ['sleet', 'Dense freezing drizzle'],
  61: ['rain', 'Light rain'], 63: ['rain', 'Moderate rain'], 65: ['rain', 'Heavy rain'],
  66: ['sleet', 'Light freezing rain'], 67: ['sleet', 'Heavy freezing rain'],
  71: ['snow', 'Light snow'], 73: ['snow', 'Moderate snow'], 75: ['snow', 'Heavy snow'], 77: ['snow', 'Snow grains'],
  80: ['rain', 'Light rain showers'], 81: ['rain', 'Moderate rain showers'], 82: ['rain', 'Violent rain showers'],
  85: ['snow', 'Light snow showers'], 86: ['snow', 'Heavy snow showers'],
  95: ['thunderstorm', 'Thunderstorm'], 96: ['thunderstorm', 'Thunderstorm with light hail'], 99: ['thunderstorm', 'Thunderstorm with heavy hail'],
};

/** Model valid time is an epoch value, so browser/server DST cannot shift it. */
export function parseOpenMeteoWeather(input: unknown, now: number): WeatherSnapshot {
  const data = object(input), current = object(data?.current), units = object(data?.current_units);
  if (!data || !current || units?.temperature_2m !== '°F' || units.time !== 'unixtime' || units.weather_code !== 'wmo code'
    || typeof data.latitude !== 'number' || !Number.isFinite(data.latitude) || Math.abs(data.latitude - 42.3603) > 0.1
    || typeof data.longitude !== 'number' || !Number.isFinite(data.longitude) || Math.abs(data.longitude + 71.0893) > 0.1
    || typeof current.time !== 'number' || !Number.isSafeInteger(current.time)
    || typeof current.weather_code !== 'number' || !Number.isInteger(current.weather_code) || !Object.hasOwn(WMO, current.weather_code)
    || (current.is_day !== 0 && current.is_day !== 1)) throw unavailable();
  const observedAt = current.time * 1000;
  if (!fresh(observedAt, now, MODEL_MAX_AGE_MS)) throw unavailable();
  const [condition, label] = WMO[current.weather_code], isDay = current.is_day === 1;
  return { temperatureF: temperature(current.temperature_2m), condition,
    conditionLabel: condition === 'clear' ? (isDay ? 'Sunny' : 'Clear night') : label,
    isDay, observedAt, fetchedAt: now, provider: 'open-meteo' };
}

async function boundedJson(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { headers: { Accept: 'application/geo+json, application/json', 'User-Agent': 'HackThisBuilding/1.0 (https://www.hackthisbuilding.com)' }, redirect: 'manual', signal });
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > MAX_BYTES) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** At most one request per provider; NWS failure leaves time for a labeled model fallback. */
export async function fetchWeather(now: number, options: Options = {}): Promise<WeatherSnapshot> {
  const controller = new AbortController(), nwsController = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined, nwsDeadline: ReturnType<typeof setTimeout> | undefined;
  const abortNws = () => nwsController.abort();
  controller.signal.addEventListener('abort', abortNws, { once: true });
  const fetcher = options.fetcher ?? fetch;
  try {
    return await Promise.race([
      (async () => {
        try {
          return await Promise.race([
            boundedJson(NWS_URL, fetcher, nwsController.signal).then(data => parseNwsWeather(data, now)),
            new Promise<never>((_, reject) => { nwsDeadline = setTimeout(() => { nwsController.abort(); reject(unavailable()); }, options.nwsTimeoutMs ?? 3000); }),
          ]);
        } catch {
          if (controller.signal.aborted) throw unavailable();
          return parseOpenMeteoWeather(await boundedJson(MODEL_URL, fetcher, controller.signal), now);
        } finally { if (nwsDeadline) clearTimeout(nwsDeadline); }
      })(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => { controller.abort(); reject(unavailable()); }, options.timeoutMs ?? 9000); }),
    ]);
  } catch { throw unavailable(); }
  finally {
    if (deadline) clearTimeout(deadline);
    if (nwsDeadline) clearTimeout(nwsDeadline);
    controller.signal.removeEventListener('abort', abortNws);
  }
}

/** Shared five-minute cache and in-flight lookup; expired snapshots never mask failure. */
export class WeatherService {
  private cached?: { value: WeatherSnapshot; expiresAt: number };
  private pending?: Promise<WeatherSnapshot>;
  private retryAt = 0;
  constructor(private options: Options = {}) {}
  async get(now: number): Promise<WeatherSnapshot> {
    if (this.cached && this.cached.expiresAt > now) return structuredClone(this.cached.value);
    if (this.retryAt > now) throw unavailable();
    if (!this.pending) this.pending = fetchWeather(now, this.options).then(value => {
      const maximumAge = value.provider === 'nws' ? NWS_MAX_AGE_MS : MODEL_MAX_AGE_MS;
      this.cached = { value, expiresAt: Math.min(now + CACHE_MS, value.observedAt + maximumAge) };
      return value;
    }).catch(error => { this.retryAt = now + 10_000; throw error; }).finally(() => { this.pending = undefined; });
    return structuredClone(await this.pending);
  }
}

export function weatherDescription(weather: WeatherSnapshot): { title: string; interpretation: string } {
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(weather.observedAt);
  const provenance = weather.provider === 'nws' ? 'NWS observation at nearby Logan (KBOS)' : 'Open-Meteo modeled conditions for Cambridge';
  return { title: `${weather.temperatureF}°F · ${weather.conditionLabel}`,
    interpretation: `${provenance}, ${time}. ${weather.conditionLabel}, ${weather.temperatureF}°F. This weather snapshot stays fixed for your turn.` };
}
