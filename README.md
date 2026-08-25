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
cd worker
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add the ATP and JCDecaux credentials.
npm install
npm run dev
```

Point `API_PROXY_URL` in `Config/LocalConfig.xcconfig` at the local Worker URL
when using a simulator. An iOS device needs a reachable HTTPS URL instead of
`localhost`.

## Deploy

```sh
cd worker
npm install
npx wrangler login
npx wrangler deploy --secrets-file .dev.vars
```

The required secret declaration in `wrangler.jsonc` makes deploy-time secret
configuration explicit. For later rotations, use
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
