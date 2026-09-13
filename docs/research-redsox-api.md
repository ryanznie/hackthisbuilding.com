# Red Sox score API research

MLB's Stats API is the best technical fit for the current Red Sox score feature. Its public schedule response supplies Boston's score, opponent, game status, date, and inning without an API key. Historical results support the required behavior on rest days and during the offseason. The recommendation is based on working first-party responses observed on September 13, 2026; it does not imply a contractual service guarantee or unrestricted redistribution rights.[^1][^2]

The product rule is: show a verified score from an active Boston game; when there is no active game, show the most recent completed Boston game, with its date and a Final label. A scheduled game, warmup, postponed game, cancellation, or suspension must not replace that completed result with a placeholder. In-game rain delays retain the current game's score and its explicit delayed status. This is an application decision, made possible by MLB's more detailed status codes.[^3]

## Provider comparison

| Provider | Access and price | Live score suitability | Historical / off-day support | Assessment |
|---|---|---|---|---|
| MLB Stats API | The checked endpoints answered unauthenticated requests; no key or payment was used. No published price, quota, or latency SLA was established for this public access. | Live score and inning observed in the schedule response. Upstream delay was not measured. | Date-range schedule queries returned final results across the previous season. | Recommended technical adapter for the current feature, subject to deployment and usage constraints below.[^1][^2] |
| SportsDataIO Leagues API | API key required. Commercial live access requires a sales agreement; price depends on the use case, volume, and sports. | Appropriate paid option. The free trial uses scrambled scores; Discovery Lab is delayed to the next day and is unsuitable for live display. | Historical scores can use season parameters, with access enabled by the provider. | Credible commercial alternative; its free trial cannot validate real Boston scores.[^4][^5] |
| Sportradar MLB API | API key required. Real-data trial normally lasts 30 days with 1,000 requests and 1 QPS; production access is for customers. No fixed public production price was established. | Game feeds support frequent updates; Game Boxscore documentation lists a three-second live cache. Cache TTL is not a measured stadium-to-screen latency guarantee. | MLB historical game data begins in 2013; schedules identify games and game feeds supply their results. | Strong option when a licensed commercial service and detailed update documentation are needed.[^6][^7][^8] |

SportsDataIO documents live updates to scores and game state, followed by a verified final result. That is the correct class of paid feed for this feature; a nominally free API with scrambled scores is unsuitable, even if its schema is convenient. No paid key was provisioned and no production score call was tested for either commercial alternative.[^9]

At a 30-second polling interval, a three-hour game requires about 360 requests before schedule discovery and retries. That calculation shows why Sportradar's default trial quota would cover only a few fully polled games. A one-team service should share lookups across visitors rather than let every browser poll upstream independently. These are capacity calculations and design recommendations, not provider pricing claims.

## Recommended MLB requests

Boston's team ID is `111`; the inspected records explicitly identify that team as Boston Red Sox. All score requests are server-side GET requests to `https://statsapi.mlb.com/api/v1/schedule` with `sportId=1`, `teamId=111`, a start/end date, and `hydrate=team,linescore`. Hydration supplies team abbreviations and inning information, while the `fields` parameter keeps the response bounded.[^1][^2]

```text
GET /api/v1/schedule
  ?sportId=1
  &teamId=111
  &startDate=YYYY-MM-DD
  &endDate=YYYY-MM-DD
  &hydrate=team,linescore
```

The adapter retains these fields: schedule dates; `gamePk`, `gameDate`, `officialDate`, `resumedFrom`; abstract, coded, and detailed status; both teams' IDs, names, abbreviations, and scores; and inning number/state. It does not need betting data, player statistics, images, or a second provider to satisfy the score requirement.

The implementation first queries the preceding 30 days through today's date in `America/New_York`. If no active or completed game is found, it makes one additional request from January 1 of the previous year through the day before that first range. This handles ordinary off days, gaps before the season, and the postseason-to-spring interval without an unbounded day-by-day scan. The history bound is explicit: it is not a search of every MLB season.

Selection gives active play priority over completed results. Within each class it sorts by actual `gameDate`, newest first, using `gamePk` only as a deterministic tie breaker. This selects the later completed doubleheader game and keeps Boston in the same display position whether it is home or away. The score is valid only when both teams have actual nonnegative integer scores; absent data never becomes an invented 0–0.

## Status and date handling

MLB's abstract labels alone are insufficient. The official status catalog includes Warmup and Suspended under Live, and Postponed and Cancelled under Final. The adapter uses the following explicit policy.[^3]

| MLB abstract state | Coded state | Application behavior |
|---|---|---|
| Live | `I` | Current game; preserve detailed status, including an in-game delay |
| Live | `M`, `N` | Current game during replay/challenge processing |
| Live | `P` | Warmup; retain previous completed result |
| Live | `T`, `U` | Suspended; retain previous completed result |
| Final | `F`, `O` | Completed result / game over |
| Final | `Q`, `R` | Recorded forfeit result; require valid supplied scores and label the forfeit |
| Final | `D`, `C` | Postponed / cancelled; retain previous completed result |
| Preview or unknown | Any | Do not manufacture a score |

An older official date does not prove that a game is inactive. In a real response for August 26, 2024, game `746942` retained `officialDate=2024-06-26` but used `gameDate=2024-08-26T18:05:00Z`, with `resumedFrom` pointing to June 26. The active-date check therefore uses the actual start/resumption timestamp. It permits today's or yesterday's Boston date, accommodating play after midnight, and rejects stale active records from earlier days. A resumed game is displayed with the resumption date.[^10]

This does not reconstruct the exact final out timestamp: the returned schedule provides start/resumption time. A pathological case in which games overlap and finish in a different order would need explicit completion-time data. Normal sequential doubleheaders and the observed resumed game are handled. Provider state can also lag reality; the application cannot infer live play from an old score alone.

## Verified examples

The following are observations from first-party API responses, not illustrative invented scores. Dates refer to Boston local time. Historical queries fetched now contain the provider's current historical record, not a replay of everything the API returned on the original game day.

| Scenario | Evaluation date | Verified result | Evidence |
|---|---|---|---|
| No game on the day | September 10, 2026 | Schedule has no September 10 game. Selector returns September 9, BOS 4–LAA 6, Final; `gamePk=824713`. | September 1–10 response.[^1] |
| Offseason | January 12, 2026 | No January 12 game. Selector returns October 2, 2025, BOS 0–NYY 4, Final; `gamePk=813065`. | Previous-season response through January 12.[^2] |
| Live game | September 13, 2026 | At capture: BOS 4–KC 1, bottom 8th, In Progress; `gamePk=824708`. This is a historical observation, not a claim about the score at reading time. | September 1–13 response.[^11] |
| Resumed historical game | August 26, 2024 | Game `746942` appears on August 26 while retaining its June 26 official date. | August 26 schedule.[^10] |

The condensed final-score records in `simulator/tests/scores.test.ts` preserve the actual teams, scores, IDs, and timestamps of the off-day and offseason examples. Status-regression tests are synthetic cases using real MLB status pairs. The resumption test uses the observed identifiers and date structure, with a simulated active state; it does not claim to be a captured live response from 2024.

For reproduction, the unmodified downloaded JSON bodies were hashed. The first three schedule captures used the field projection in the original adapter, without `resumedFrom`; the resumption and status captures were unprojected. The final implementation adds `resumedFrom` to its projection. Repeating a query may change its bytes as live games progress or historical data is corrected.

| Captured response | SHA-256 |
|---|---|
| September 1–10 schedule | `2d06fcbb192a7613ed233cab9593da9d76016d7de23398c5e5b7b06c638c28ac` |
| January 1, 2025–January 12, 2026 schedule | `c7dcbec83e79c56cf8ada3105e01a59f0245997a27517707971c8798156d1043` |
| September 1–13 schedule | `76bb2cecf5b110317386022388ea10aca9d196af82eeac090b8bfe8f6e1f23b9` |
| August 26, 2024 resumed-game schedule | `2da39f24cf124b2c449d9768649d6835281f141b4932da3e88bd74d50e5604eb` |
| Game-status catalog | `1ea5592c22c65864569adf800de4c04591558f4d4c9c0e212f519ed963d42c0e` |

## Freshness and failure behavior

The current adapter shares one in-flight request and one in-memory cache per show instance. A live response remains reusable for 30 seconds; a final result remains reusable for five minutes. These are application cache durations, not automatic polling intervals or guaranteed source latency. A new request after expiration performs a new lookup. A final cached before first pitch can remain visible for up to five minutes before the next lookup discovers active play.

Each lookup has one nine-second deadline, at most two upstream requests, no redirects, no retries, and a 512 KiB response limit per request. On upstream failures it returns a sanitized unavailable response and uses a short retry cooldown. It does not relabel an expired cached live score as current. With no usable result in the bounded history range, it returns a specific no-score result rather than zeroes.

Therefore “always show the latest previous score” is satisfied for a no-game day when the API is available and supplies a completed result within the supported history range. It cannot be an unconditional uptime promise. An always-visible fallback during an outage would require a separately persisted last-successful result with a clear last-updated/unavailable label; that is not the current behavior and must not silently masquerade as fresh data.

## Snapshot and continuous-display scope

The existing interaction is a score preview: a visitor clicks **Red Sox score**, the server fetches or reuses a current score, and the visitor may submit that rendered clip to the shared queue. The clip includes the game date, Live/Final state, capture time, Boston/opponent mapping, and a statement that the score stays fixed for that turn. The preview expires after five minutes; a submitted clip preserves the exact approved pixels throughout its turn.

This implementation connects to a live data source but does not continuously update an already approved animation. A persistent live scoreboard would need a distinct server-controlled display mode, scheduled refreshes, visible freshness metadata, and explicit behavior when a game ends or a provider fails. Replacing an accepted queue item's contents on every score update would change the established preview/submit contract. That product extension is separate from correcting live-versus-previous-game selection.

## Access, rights, and deployment boundaries

MLB's terms restrict automated collection and public display without applicable permission.[^12] Public endpoint accessibility does not establish a license for this installation. No API-specific grant of unrestricted reuse, production support agreement, or numeric public rate limit was established. The recommendation is technical; rights for a public building display should be established separately with the relevant data provider before treating the feature as a licensed production feed.

SportsDataIO explicitly excludes commercial redistribution from Discovery Lab and directs commercial live uses to its Leagues API agreement. Sportradar distinguishes trial access from customer production access; the trial is an evaluation path, not evidence of a perpetual public-display license. Neither a provider's partnership claim nor possession of a working API key alone establishes the deployment's precise contractual rights.[^4][^6]

The code and regression tests establish local behavior. They do not establish that the revised feature has been published, that a physical building receives its frames, or that provider licensing has been completed. Deployment and physical-display acceptance belong in the deployment evidence, with the actual released revision identified.

## Validation

All nine targeted tests passed on September 13, 2026 using `cd simulator && ./node_modules/.bin/tsx --test tests/scores.test.ts`. The suite checks actual-play selection, inactive MLB statuses, resumed games, verified historical score fixtures, date handling, response validation, bounded history lookup, shared caching, transport failure, and server-owned preview/queue behavior. The corrected selector was also run directly against the complete captured off-day, offseason, and resumed-game responses: all returned the expected result, including BOS 1–TOR 4 for the August 26 resumption. Full integration validation also includes the repository's typecheck and complete test suite.

## Sources

All sources below were accessed September 13, 2026. API entries are first-party JSON observations; documentation pages are provider statements, generally undated. No paid-provider credentials were used.

[^1]: MLB, [Boston schedule, September 1–10, 2026](https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=111&startDate=2026-09-01&endDate=2026-09-10&hydrate=team,linescore). Off-day, team identity, and final-result evidence.
[^2]: MLB, [Boston schedule, January 1, 2025–January 12, 2026](https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=111&startDate=2025-01-01&endDate=2026-01-12&hydrate=team,linescore). Offseason and postseason-result evidence.
[^3]: MLB, [Game-status catalog](https://statsapi.mlb.com/api/v1/gameStatus). Abstract, coded, and detailed state definitions.
[^4]: SportsDataIO, [Developer access methods](https://sportsdata.io/developers). Trial quality, Discovery Lab limits, commercial access, and pricing approach.
[^5]: SportsDataIO, [MLB API documentation](https://sportsdata.io/developers/api-documentation/mlb). API-key authentication.
[^6]: Sportradar, [Your account](https://developer.sportradar.com/getting-started/docs/your-account). Key, trial, production access, and default quotas.
[^7]: Sportradar, [MLB update frequencies](https://developer.sportradar.com/baseball/docs/mlb-ig-update-frequencies). Live Game Boxscore TTL and distinction between cache and data updates.
[^8]: Sportradar, [MLB historical data](https://developer.sportradar.com/baseball/docs/mlb-ig-historical-data). Coverage beginning in 2013 and historical game access.
[^9]: SportsDataIO, [MLB workflow guide](https://sportsdata.io/developers/workflow-guide/mlb). Live game-state and verified final-score behavior.
[^10]: MLB, [Boston schedule, August 26, 2024](https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=111&startDate=2024-08-26&endDate=2024-08-26&hydrate=team,linescore). Resumed-game date evidence.
[^11]: MLB, [Boston schedule, September 1–13, 2026](https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=111&startDate=2026-09-01&endDate=2026-09-13&hydrate=team,linescore). Captured live-score observation.
[^12]: MLB, [Terms of use](https://www.mlb.com/official-information/terms-of-use), section 1. General usage restrictions; no API-specific license conclusion is asserted.
