import { COLS, ROWS, type RGB, type Scene } from './contracts';
import { validateScene } from './render';

export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'thunderstorm' | 'sleet';
export interface WeatherSnapshot {
  temperatureF: number;
  condition: WeatherCondition;
  conditionLabel: string;
  isDay: boolean;
  /** Observation time for NWS; model valid time for Open-Meteo. */
  observedAt: number;
  fetchedAt: number;
  provider: 'nws' | 'open-meteo';
}

const ICONS: Record<WeatherCondition | 'night', string[]> = {
  clear: ['001010100', '000111000', '011111110', '000111000', '001010100'],
  night: ['000111000', '001100000', '001100000', '001110010', '000111100'],
  'partly-cloudy': ['010100000', '001001100', '011011110', '001111111', '000111110'],
  cloudy: ['000110000', '001111100', '011111110', '111111111', '011111110'],
  rain: ['000111000', '011111110', '111111111', '001001000', '010010010'],
  snow: ['000010000', '001010100', '000111000', '001010100', '000010000'],
  fog: ['011111110', '000000000', '111111111', '000000000', '011111110'],
  thunderstorm: ['001111100', '111111111', '000110000', '001100000', '000100000'],
  sleet: ['001111100', '111111111', '000000000', '010010100', '001010010'],
};

/** A fixed condition icon with one readable Fahrenheit text pass per five seconds. */
export function weatherScene(weather: WeatherSnapshot): Scene {
  if (!Number.isInteger(weather.temperatureF) || weather.temperatureF < -99 || weather.temperatureF > 150) throw new Error('Weather temperature is outside the supported Fahrenheit range.');
  if (!Object.hasOwn(ICONS, weather.condition) || typeof weather.isDay !== 'boolean') throw new Error('Unknown weather condition.');
  const icon = ICONS[weather.condition === 'clear' && !weather.isDay ? 'night' : weather.condition];
  const ink: RGB = weather.condition === 'clear' && weather.isDay ? [250, 202, 76]
    : weather.condition === 'rain' || weather.condition === 'sleet' ? [105, 193, 250]
    : weather.condition === 'thunderstorm' ? [244, 199, 79] : [216, 232, 247];
  const pixels: RGB[][] = Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col): RGB => icon[row]?.[col] === '1' ? [...ink] : [2, 4, 11]));
  // Existing text rendering handles minus signs and three digits without clipping.
  // F is explicit because the facade's ASCII font has no degree-symbol glyph.
  return validateScene({ version: 1, background: '#02040b', layers: [], raster: { motion: 'still', pixels }, text: { value: `${weather.temperatureF} F`, color: '#f5f3e6' } });
}
