import { createClient, isConfigured } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!isConfigured()) return <AuthScreen configured={false} />;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <AuthScreen configured />;
  return <Dashboard email={user.email || "Sua conta"} />;
}
