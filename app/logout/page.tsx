"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { getAuthClient } from "@/lib/auth/client";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getAuthClient();
    supabase.auth.signOut().then(() => {
      router.push("/login");
      router.refresh();
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b12]">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
          <Zap className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <p className="text-sm">Signing out…</p>
      </div>
    </div>
  );
}
