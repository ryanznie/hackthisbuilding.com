# Current weather for the Green Building display

The Weather feature uses a recent National Weather Service observation from Boston Logan (KBOS), with Open-Meteo's modeled Cambridge conditions as a bounded fallback. It displays a condition icon and temperature in Fahrenheit. The preview names the provider, distinguishes an observation from modeled conditions, and shows the data's own timestamp. Accepted previews remain fixed for their display turn.

## Decision and scope

This is a local public-art weather snapshot, not a forecast, warning service, or sensor installed on the building. The fixed target is the MIT Green Building vicinity, approximately 42.3603° N, 71.0893° W. No visitor geolocation, API key, account, payment, or model-generated interpretation is needed.

Nearby observed weather is the first choice because it is a direct measurement. A location-specific model is useful when that observation is missing, old, malformed, or too slow to retrieve. The fallback does not silently retain the observation label. That distinction matters: simultaneously retrieved sources can disagree about fog, cloud cover, or temperature.

The current release is treated as a noncommercial community demonstration without subscriptions or advertising. Open-Meteo's free service is conditional on noncommercial use. A commercial or promotional deployment should use a suitable paid plan or remove that fallback; NWS itself permits use for any purpose. These are provider conditions, not a claim that every future use of this application has been reviewed.[^1][^3]

## Provider comparison

| Provider | Relevant data | Access and operating conditions | Fit for this feature |
|---|---|---|---|
| NOAA / National Weather Service | Station observation, timestamp, measured temperature, descriptive conditions and day/night icon | No fee; identifying User-Agent required; unpublished rate limits. Observations can incur about 20 minutes of upstream quality-control delay. | Primary: direct nearby observation, with explicit KBOS provenance and freshness rejection. |
| Open-Meteo | Coordinate-based current temperature, WMO condition code and `is_day`; current values are based on 15-minute model data | Free API is noncommercial, subject to request limits and attribution. Fahrenheit and Unix timestamps are available directly. | Fallback: compact schema, no credentials, simple condition mapping; explicitly labeled modeled. |
| Norwegian Meteorological Institute / MET Norway | Locationforecast includes instantaneous temperature and weather symbols for forecast periods | Identifying User-Agent, caching, and attribution required. Global forecasts use roughly 9 km ECMWF output and update four times daily. | Viable alternative, but its period-based symbols and global forecast emphasis add interpretation work for a “current weather” button. |

Sources: NWS API documentation; Open-Meteo Forecast API, terms and licence; MET Norway Locationforecast data model and terms.[^1][^2][^3][^4][^5][^6]

NWS is preferred over using only Open-Meteo because the application can present a verifiable observation when one is available. Open-Meteo is preferred over MET Norway as the fallback because its response directly supplies the three required current fields. That is an implementation judgment about schema fit and display semantics, not a demonstrated general accuracy ranking.

No provider is treated as an exact ground-truth measurement at the building. Logan is a nearby station in a different local setting; the model represents a grid cell. Displaying the source and valid time makes that limitation visible without requiring a visitor to understand weather APIs.

## Live response evidence

All three endpoints returned HTTP 200 during a check at approximately **2026-09-13 23:33 UTC**. These are captured examples, not claims about conditions when this document is read.

| Endpoint | Returned weather time | Relevant response | Interpretation |
|---|---|---|---|
| [NWS KBOS latest observation](https://api.weather.gov/stations/KBOS/observations/latest) | 2026-09-13 23:10 UTC | 19°C; quality-control flag `V`; `Fog/Mist`; night/fog icon | 66°F, Fog/Mist, observed at nearby Logan at 7:10 PM EDT |
| [Open-Meteo at the configured coordinates](https://api.open-meteo.com/v1/forecast?latitude=42.3603&longitude=-71.0893&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timeformat=unixtime&timezone=GMT&forecast_days=1) | Unix time 1789342200, or 23:30 UTC | 66.4°F; WMO code 3; `is_day: 0` | 66°F, Overcast, modeled Cambridge conditions valid at 7:30 PM EDT |
| [MET Norway Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=42.3603&lon=-71.0893) | First instant 23:00 UTC; model metadata updated 23:16:57 UTC | 20°C; 99.2% cloud cover; next-hour symbol `cloudy`; next-six-hour symbol `fog` | A 68°F instantaneous forecast alongside symbols representing different future periods |

The actual NWS and Open-Meteo payloads also passed the production parsers. Both yielded 66°F after rounding, but their conditions differed. The implementation selects the accepted NWS observation; it does not infer rain from a request's wording or combine a model's temperature with a station's condition.

## Request and freshness policy

The implementation sends requests only to two fixed HTTPS endpoints. The primary station is KBOS; the fallback coordinates are constants. Provider-returned icon URLs are parsed against the NWS origin and known paths, never downloaded. Redirects are rejected. Neither browser input nor provider content can select a new network destination.

One lookup has a nine-second total deadline. NWS receives at most three seconds, leaving time for one Open-Meteo request. There are no automatic provider retries. A request that fails transport, JSON, schema, unit, timestamp, or condition validation is eligible for the single fallback. If both sources fail, the application returns a short `WEATHER_UNAVAILABLE` error and creates no weather preview.

Each body is bounded to 64 KiB, including streamed responses without a Content-Length header. The parsers reject null or nonnumeric temperature, wrong units, unknown conditions, invalid station identity, mismatched model coordinates, and invalid timestamps. Celsius conversion occurs only for NWS's explicitly identified temperature unit. Open-Meteo must identify Fahrenheit; no missing value is converted into zero.

The accepted maximum ages are **75 minutes for NWS** and **45 minutes for Open-Meteo**, with at most five minutes of future clock tolerance. These are application thresholds, not provider service guarantees. The NWS threshold accommodates a recent periodic report plus ingestion delay; the model threshold limits fallback to the current portion of its time series. Metadata always shows the actual observation or model-valid time rather than presenting fetch time as measurement time.

One shared WeatherService instance coalesces simultaneous clicks and caches a successful snapshot for at most five minutes. Cache expiry is shortened when the source age limit would arrive sooner. A ten-second failure cooldown reduces repeated provider traffic. Expired cached data never substitute for a failed fresh lookup.

At continuous successful demand, a five-minute cache implies approximately 288 lookups per day per active shared show. The primary normally requires one request; fallback operation needs one request to each provider per refresh. This is a planning calculation from the implementation. Process restarts, failed requests, or additional independently deployed shows can increase traffic, so it is not a guaranteed account-wide request cap.

## Display and preview semantics

Eight condition families have distinct pixel icons: clear, partly cloudy, cloudy, rain, snow, fog, thunderstorm, and mixed/freezing precipitation. Clear daylight uses a sun; clear night uses a crescent. The title preserves a more specific source label, such as Light rain, Rime fog, or Fog/Mist. Unknown weather codes fail validation rather than becoming sunny by default.

The icon occupies the upper five rows of the 17 × 9 grid. Temperature scrolls through the existing five-row text renderer below it, with an explicit `F`. This accommodates negative readings and three-digit temperatures without squeezing or clipping numerals. Accepted values range from −99°F to 150°F. That is a generous validation bound for this particular local display, not a worldwide meteorological range.

Icons remain fixed. A thunderstorm uses a static symbol and never flashes. The existing deterministic text renderer completes a pass during the five-second clip. The browser's preview metadata uses the ordinary `°F` notation, the complete condition name, and a date/time with the Boston time zone.

Weather preview creation and queue submission remain separate operations. The supplied scene contains ordinary validated raster and text fields, so it needs no new queue contract. Integration should retain normal owner checks and expiry, and should enqueue exactly the scene that was previewed. A new Weather click after cache expiry creates an opportunity to retrieve newer conditions; an already accepted clip does not mutate while someone waits.

## Attribution and operational limits

The public interface should link to NWS and Open-Meteo near the weather feature or in its credits. Open-Meteo attribution should identify the provider and link its CC BY 4.0 licence; the conversion into icons and rounded Fahrenheit values is the application's adaptation. Its free-service limits are fewer than 10,000 calls per day, 5,000 per hour and 600 per minute.[^3][^4]

The source combination was verified from the development environment. A deployed HTTPS preview request is still needed to establish that the production Worker can reach both sources. Provider availability and weather accuracy cannot be inferred from a successful unit test. A frozen weather clip is deliberately a timestamped snapshot; it is not an emergency alert or a promise that conditions will remain unchanged until playback.

## Validation evidence

Seven behavioral tests cover observation provenance, Celsius conversion, day/night and condition mapping, null and malformed values, freshness rejection, fixed destinations and fallback selection, cache sharing and mutation isolation, stale-on-error rejection, body limits, network cancellation, and negative/three-digit rendering. All seven passed. TypeScript type checking also passed.

The deadline tests show that slow NWS work is aborted before fallback and that the total deadline aborts the fallback. The rendering tests verify constant icon pixels, changed text pixels, valid frame dimensions/RGB channels, and different clear-day/clear-night graphics. Live response parsing separately checks compatibility with actual provider data rather than only synthetic fixtures.

## Sources

[^1]: NOAA / National Weather Service. [API Web Service](https://www.weather.gov/documentation/services-web-api). Documentation and upstream-delay notes; accessed September 13, 2026.
[^2]: Open-Meteo. [Weather Forecast API](https://open-meteo.com/en/docs). Current conditions, units, Unix time, WMO condition codes and day/night field; accessed September 13, 2026.
[^3]: Open-Meteo. [Terms & Privacy](https://open-meteo.com/en/terms). Free API use restrictions and request limits; accessed September 13, 2026.
[^4]: Open-Meteo. [Licence](https://open-meteo.com/en/licence). Attribution and data licence; accessed September 13, 2026.
[^5]: Norwegian Meteorological Institute. [Locationforecast data model](https://docs.api.met.no/doc/locationforecast/datamodel). Global model source, resolution, update frequency and instantaneous/period variables; accessed September 13, 2026.
[^6]: Norwegian Meteorological Institute. [Terms of Service](https://docs.api.met.no/doc/TermsOfService). Identification, caching and attribution requirements; page states last revision June 26, 2020; accessed September 13, 2026.
