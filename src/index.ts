interface Env {
  ATP_ACCESS_ID: string;
  JCDECAUX_API_KEY: string;
}

const ATP_API_BASE = "https://cdt.hafas.de/opendata/apiserver";
const JCDECAUX_API_URL = "https://api.jcdecaux.com/vls/v1/stations";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return jsonError("Only GET requests are supported.", 405);
    }

    const url = new URL(request.url);

    try {
      const upstream = buildUpstreamURL(url, env);
      const upstreamResponse = await fetch(upstream, {
        headers: {
          Accept: "application/json"
        }
      });

      return forwardResponse(upstreamResponse);
    } catch (error) {
      if (error instanceof ProxyRequestError) {
        return jsonError(error.message, error.status);
      }

      console.error("Upstream request failed");
      return jsonError("The upstream API request failed.", 502);
    }
  }
};

export function buildUpstreamURL(url: URL, env: Env): URL {
  switch (url.pathname) {
    case "/atp/location.nearbystops": {
      const latitude = requiredCoordinate(url.searchParams.get("originCoordLat"), -90, 90, "originCoordLat");
      const longitude = requiredCoordinate(url.searchParams.get("originCoordLong"), -180, 180, "originCoordLong");
      const upstream = new URL(`${ATP_API_BASE}/location.nearbystops`);

      upstream.searchParams.set("accessId", requiredSecret(env.ATP_ACCESS_ID, "ATP_ACCESS_ID"));
      upstream.searchParams.set("originCoordLat", latitude);
      upstream.searchParams.set("originCoordLong", longitude);
      upstream.searchParams.set("maxNo", boundedInteger(url.searchParams.get("maxNo"), 1, 100, 50, "maxNo"));
      upstream.searchParams.set("r", boundedInteger(url.searchParams.get("r"), 100, 5_000, 1_500, "r"));
      upstream.searchParams.set("type", "SE");
      forwardOptional(upstream, url, "products", productsValue);
      forwardOptional(upstream, url, "lang", languageValue);
      upstream.searchParams.set("format", "json");
      return upstream;
    }

    case "/atp/departureBoard": {
      const stopId = url.searchParams.get("id")?.trim();
      if (!stopId) {
        throw new ProxyRequestError("The id query parameter is required.", 400);
      }

      const upstream = new URL(`${ATP_API_BASE}/departureBoard`);
      upstream.searchParams.set("accessId", requiredSecret(env.ATP_ACCESS_ID, "ATP_ACCESS_ID"));
      forwardOptional(upstream, url, "lang", languageValue, "fr");
      upstream.searchParams.set("id", stopId);
      forwardOptional(upstream, url, "direction", identifierValue);
      forwardOptional(upstream, url, "date", dateValue);
      forwardOptional(upstream, url, "time", timeValue);
      forwardOptional(upstream, url, "duration", durationValue);
      forwardOptional(upstream, url, "maxJourneys", maxJourneysValue, "-1");
      forwardOptional(upstream, url, "products", productsValue);
      forwardOptional(upstream, url, "operators", listValue);
      forwardOptional(upstream, url, "lines", listValue);
      forwardOptional(upstream, url, "platforms", listValue);
      forwardOptional(upstream, url, "rtMode", realtimeModeValue);
      forwardOptional(upstream, url, "passlist", passlistValue);
      forwardOptional(upstream, url, "requestId", requestIDValue);
      upstream.searchParams.set("format", "json");
      return upstream;
    }

    case "/bike-share/stations": {
      const upstream = new URL(JCDECAUX_API_URL);
      upstream.searchParams.set("contract", "luxembourg");
      upstream.searchParams.set("apiKey", requiredSecret(env.JCDECAUX_API_KEY, "JCDECAUX_API_KEY"));
      return upstream;
    }

    default:
      throw new ProxyRequestError("Unknown API route.", 404);
  }
}

type ParameterValidator = (value: string, name: string) => string;

function forwardOptional(
  upstream: URL,
  incoming: URL,
  name: string,
  validator: ParameterValidator,
  fallback?: string
): void {
  const raw = incoming.searchParams.get(name);
  const value = raw === null || raw.trim() === "" ? fallback : validator(raw, name);
  if (value !== undefined) {
    upstream.searchParams.set(name, value);
  }
}

function boundedInteger(
  value: string | null,
  minimum: number,
  maximum: number,
  fallback: number,
  name: string
): string {
  if (value === null || value.trim() === "") return String(fallback);
  if (!/^\d+$/.test(value.trim())) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }

  return String(number);
}

const durationValue: ParameterValidator = (value, name) =>
  boundedInteger(value, 0, 1_439, 120, name);

// ATP defines -1 as all services within the requested duration.
const maxJourneysValue: ParameterValidator = (value, name) => {
  if (value.trim() === "-1") return "-1";
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, -1, name);
};

const productsValue: ParameterValidator = (value, name) => {
  const normalized = boundedInteger(value, 0, 295, 0, name);
  const number = Number(normalized);
  // Documented ATP product bits: express/national/local train, bus, tram.
  if ((number & ~295) !== 0) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const languageValue: ParameterValidator = (value, name) => {
  if (!/^[A-Za-z]{2,5}$/.test(value.trim())) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return value.trim().toLowerCase();
};

const identifierValue: ParameterValidator = (value, name) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || !/^[A-Za-z0-9._:/ -]+$/.test(normalized)) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const listValue: ParameterValidator = (value, name) => {
  const values = value.split(",").map((item) => identifierValue(item, name));
  if (values.length > 50) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return values.join(",");
};

const dateValue: ParameterValidator = (value, name) => {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const timeValue: ParameterValidator = (value, name) => {
  const normalized = value.trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const realtimeModeValue: ParameterValidator = (value, name) => {
  const normalized = value.trim().toUpperCase();
  // Older app versions send FULL. Translate it to ATP's supported default.
  if (normalized === "FULL") return "SERVER_DEFAULT";
  if (normalized !== "SERVER_DEFAULT" && normalized !== "OFF") {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const passlistValue: ParameterValidator = (value, name) => {
  const normalized = value.trim();
  if (normalized !== "0" && normalized !== "1") {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

const requestIDValue: ParameterValidator = (value, name) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }
  return normalized;
};

function requiredCoordinate(
  value: string | null,
  minimum: number,
  maximum: number,
  name: string
): string {
  if (value === null || value.trim() === "") {
    throw new ProxyRequestError(`The ${name} query parameter is required.`, 400);
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new ProxyRequestError(`The ${name} query parameter is invalid.`, 400);
  }

  return value;
}

function requiredSecret(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new ProxyRequestError(`The Worker secret ${name} is not configured.`, 500);
  }

  return value;
}

function forwardResponse(upstreamResponse: Response): Response {
  const headers = new Headers(corsHeaders);
  headers.set(
    "Content-Type",
    upstreamResponse.headers.get("Content-Type") ?? "application/json"
  );
  headers.set("Cache-Control", "no-store");
  headers.set("X-Verkeier-Relay-Version", "passlist-v2");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json"
    }
  });
}

class ProxyRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ProxyRequestError";
  }
}
