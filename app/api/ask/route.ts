import http from "node:http";
import https from "node:https";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Node's built-in fetch (undici) gives up with "fetch failed" when the backend
// takes more than 5 minutes to send the response headers, which happens on the
// first request (model loading) or on slow analyses. This route therefore uses
// node:http directly with its own, much longer limit. ASK_TIMEOUT_SECONDS=0
// disables the limit entirely.
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_SECONDS ?? 30 * 60) * 1000;

type BackendResponse = { status: number; contentType: string; body: Buffer };

function forwardToBackend(url: URL, body: Buffer, headers: Record<string, string>, signal: AbortSignal): Promise<BackendResponse> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      { method: "POST", headers: { ...headers, "content-length": String(body.length) }, signal },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 502,
            contentType: response.headers["content-type"] ?? "application/json",
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    if (ASK_TIMEOUT_MS > 0) {
      request.setTimeout(ASK_TIMEOUT_MS, () => request.destroy(new Error("timeout")));
    }
    request.on("error", reject);
    request.end(body);
  });
}

export async function POST(request: NextRequest) {
  const backendUrl = new URL("/api/ask", process.env.BACKEND_URL ?? "http://127.0.0.1:8000");

  // Forward the multipart body as-is (same boundary), no re-encoding.
  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  if (contentType) headers["content-type"] = contentType;
  if (authorization) headers.authorization = authorization;

  try {
    const body = Buffer.from(await request.arrayBuffer());
    // If the user closes the page, stop waiting for the backend too.
    const response = await forwardToBackend(backendUrl, body, headers, request.signal);
    return new NextResponse(new Uint8Array(response.body), {
      status: response.status,
      headers: { "content-type": response.contentType },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "timeout";
    return NextResponse.json(
      {
        detail: timedOut
          ? "L'analisi sta richiedendo troppo tempo. Riprova tra qualche minuto."
          : "Backend Python non raggiungibile. Avvia `npm run backend`.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}
