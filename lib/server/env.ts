import "server-only";
import { z } from "zod";

const envSchema = z
  .object({
    TEACHER_PASSPHRASE: z.string().min(8, "合言葉は8文字以上にしてください"),
    STUDENT_PASSPHRASE: z.string().min(8, "合言葉は8文字以上にしてください"),
    SESSION_SECRET: z.string().min(32),
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    // 未設定でも PDF 取り込み以外は動くようにする
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
  })
  .refine((e) => e.TEACHER_PASSPHRASE !== e.STUDENT_PASSPHRASE, {
    message: "先生用と生徒用の合言葉は別にしてください",
  });

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // 値そのものはログに出さず、どの変数が不正かだけを示す
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`環境変数が不足しているか不正です\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
