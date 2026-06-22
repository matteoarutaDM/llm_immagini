import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
  const formData = await request.formData();

  try {
    const response = await fetch(`${backendUrl}/api/ask`, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : "Backend Python non raggiungibile. Avvia `npm run backend`.",
      },
      { status: 502 },
    );
  }
}
