import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness. Answers as long as the Node process can serve HTTP, which is what
 * an orchestrator restart policy needs. It deliberately does not touch the
 * database so that a Supabase outage cannot cause a restart loop.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "savebite-web",
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
