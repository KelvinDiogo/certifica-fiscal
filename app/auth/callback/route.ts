import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
export async function GET(req: NextRequest) {
  const url = new URL(req.url),
    code = url.searchParams.get("code");
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(
    new URL("/?auth_error=confirmation", url.origin),
  );
}
