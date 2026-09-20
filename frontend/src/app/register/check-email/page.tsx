export default function CheckEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 text-center dark:bg-black">
      <div className="max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          We sent a confirmation link to finish creating your account. Click it to log in.
        </p>
      </div>
    </div>
  );
}
