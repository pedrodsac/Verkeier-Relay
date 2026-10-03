# Verkéier API Worker

This Cloudflare Worker is the only API entry point used by the app for keyed
third-party requests. It is deliberately allowlisted rather than acting as a
general-purpose proxy:

- `GET /atp/location.nearbystops`
- `GET /atp/departureBoard?id=...`
- `GET /bike-share/stations`

The Worker adds the upstream credentials from Cloudflare secrets. Callers
cannot provide or override those credentials.

## Local development

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add the ATP and JCDecaux credentials.
npm ci
npm run dev
```

Point `API_PROXY_URL` in `Config/LocalConfig.xcconfig` at the local Worker URL
when using a simulator. An iOS device needs a reachable HTTPS URL instead of
`localhost`.

## Deploy

```sh
npm ci
npx wrangler login
npm run typecheck
npm test
npx wrangler deploy --keep-vars
```

Configure the two secrets before the first deploy. For initial setup and later
rotations, use
`npx wrangler secret put ATP_ACCESS_ID` and
`npx wrangler secret put JCDECAUX_API_KEY`; secret values are never committed
to this repository.

After deployment, set this non-secret URL in
`Config/LocalConfig.xcconfig`:

```xcconfig
API_PROXY_URL = https:/$()/verkeier-api.<your-subdomain>.workers.dev
```

The Worker endpoint is publicly callable because the iOS app must be able to
reach it. The proxy hides the credentials, but it is not an authentication
boundary. Add a Cloudflare rate-limiting/WAF rule for the Worker before a
public release, and monitor upstream quota usage.

## Departure-board contract

The relay forwards validated `date`, `time`, `duration`, `maxJourneys`,
`passlist`, `rtMode`, destination and product/line/operator/platform filters.
Omitted `maxJourneys` defaults to `-1` (all services in the requested window);
explicit nonnegative counts have no relay-imposed upper cap. ATP limits
`duration` to 0–1,439 minutes.
ATP supports `SERVER_DEFAULT` and `OFF`; the legacy `FULL` value is translated
to `SERVER_DEFAULT` for older clients. A `passlist=1` request returns the
upstream per-stop prediction fields without rewriting the response. Successful
upstream responses include `X-Verkeier-Relay-Version: passlist-v2` and are not
cached by the relay. App and package caches manage freshness.

Run `npm test` for deterministic allowlist/validation tests and `npm run
typecheck` before deploying. Live contract checks should confirm an unrestricted
journey count (`maxJourneys=-1`) and a nonempty `Stops.Stop` passlist.
