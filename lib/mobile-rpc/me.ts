import { z } from "zod";
import { normalizeE164 } from "@/lib/comms/phone";

export const callPhoneInput = z.object({
  phone: z.string().max(100).transform((value, ctx) => {
    const result = normalizeE164(value);
    if (result.ok) return result.e164;
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }).nullable(),
}).strict();
