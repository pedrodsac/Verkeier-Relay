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

      console.error("Upstream request failed", error);
      return jsonError("The upstream API request failed.", 502);
    }
  }
};

function buildUpstreamURL(url: URL, env: Env): URL {
  switch (url.pathname) {
    case "/atp/location.nearbystops": {
      const latitude = requiredCoordinate(url.searchParams.get("originCoordLat"), -90, 90, "originCoordLat");
      const longitude = requiredCoordinate(url.searchParams.get("originCoordLong"), -180, 180, "originCoordLong");
      const upstream = new URL(`${ATP_API_BASE}/location.nearbystops`);

      upstream.searchParams.set("accessId", requiredSecret(env.ATP_ACCESS_ID, "ATP_ACCESS_ID"));
      upstream.searchParams.set("originCoordLat", latitude);
      upstream.searchParams.set("originCoordLong", longitude);
      upstream.searchParams.set("maxNo", "50");
      upstream.searchParams.set("r", "1500");
      upstream.searchParams.set("type", "SE");
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
      upstream.searchParams.set("lang", "fr");
      upstream.searchParams.set("id", stopId);
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
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ProxyRequestError";
  }
}
