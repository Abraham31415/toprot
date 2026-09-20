import type { EmailOtpType } from "@supabase/supabase-js";
import { ConfirmForm } from "./confirm-form";

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          One more step
        </h1>
        {tokenHash && type ? (
          <div className="mt-8">
            <ConfirmForm tokenHash={tokenHash} type={type as EmailOtpType} />
          </div>
        ) : (
          <p className="mt-8 text-sm text-red-600">
            This link is missing its confirmation code. Please use the link from your email
            directly, or request a new one.
          </p>
        )}
      </div>
    </div>
  );
}
