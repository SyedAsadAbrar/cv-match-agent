import { z } from "zod";

export const groundedWritingSchema = z.object({
  recommendations: z.array(z.string().trim().min(1)).length(3),
  recruiterMessage: z.string().trim().min(1)
});

export type GroundedWritingOutput = z.infer<typeof groundedWritingSchema>;
