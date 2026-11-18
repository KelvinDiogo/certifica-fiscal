import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
export async function GET(req: NextRequest) {
  const url = new URL(req.url),
    token_hash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type && ["signup", "email", "recovery"].includes(type)) {
    const sb = await createClient();
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(
    new URL("/?auth_error=confirmation", url.origin),
  );
}
