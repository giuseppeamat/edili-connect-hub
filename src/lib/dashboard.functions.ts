import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runDashboardOperativa } from "@/lib/dashboard.server";

export const getDashboardOperativa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        periodo: z.enum(["oggi", "7", "30", "mese", "custom"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(runDashboardOperativa);