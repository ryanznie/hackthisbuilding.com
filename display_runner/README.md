Run the organizer simulator bridge with `python -m pip install -r requirements.txt` and `python runner.py` from this directory. Copy `.env.example` to `.env` and configure the same private runner token on the Worker. Keep the runner machine's clock synchronized with the server.

The runner obtains authenticated `/api/display/frame` snapshots, checks their dimensions, integer RGB values and generation timestamp, and sends exactly 459 bytes to the organizer's frame endpoint. Each send waits for HTTP 204 before the frame is considered accepted by the simulator. Source and target each reuse a persistent HTTP connection, with bounded response bodies and no hidden POST retries. Static frames are deduplicated after successful delivery and re-acknowledged once per second for connection health; requests are limited to 30 FPS and slow networks reduce the sampling rate. HTTP operations have a two-second socket timeout. Source frames older than 750ms or more than 250ms in the future are rejected.

The runner posts `{ "connected": true }` to `/api/display/status` after the first frame is accepted by the simulator API and about once per second. A source, target or status failure sends a black fallback where possible, reports `{ "connected": false, "error": "..." }`, and retries. Five consecutive failures stop the process. Shutdown also blanks the display and reports disconnected. The Worker must expire missing heartbeats and pause affected dispatch; it must not assume that missing status reports mean continued delivery. Use the organizer's local fallback when a target cannot receive the blank frame.

A local file lock prevents simultaneous runners for the same configured endpoint on one machine. Run one authorized runner host per instance; this is not a distributed lease. Only start with an organizer-authorized instance. This adapter targets the organizer simulator API; it does not establish a physical-building connection.

Run regressions with `python -m unittest discover -s display_runner -v` from the repository root. Tests mock HTTP and never contact an organizer instance.

The organizer queues an accepted frame for its next 33ms tick; HTTP 204 is not proof of physical-building delivery. Its stored clip resumes after two seconds without live frames, so static output is refreshed every second. [Pinned organizer API source](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#api-reference).

## Supervised local operation

The event bridge can run as a macOS LaunchAgent named `com.hackthisbuilding.display-runner`, using a private local `.env`. Its property list is installed in the operator's `~/Library/LaunchAgents/`; logs and the source property list live in the ignored `.runtime/` directory. No credentials belong in the property list or repository. `caffeinate -i` prevents idle system sleep while the process runs; the host still needs power and network access, and closing the laptop or logging out interrupts delivery.

Use `launchctl print gui/$(id -u)/com.hackthisbuilding.display-runner` to inspect the service, and `launchctl bootout gui/$(id -u)/com.hackthisbuilding.display-runner` to stop it. Start a stopped service with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hackthisbuilding.display-runner.plist`. After verifying recovery frames and a fresh Worker heartbeat, resume through the authenticated operator API. Process restart alone does not resume a paused show.

Retry logs report the failing stage and exception type without logging request headers or credentials. The original uploaded organizer clip is retained and may resume after live sending stops.
