import type { Instrumentation } from "next";

// Records every unhandled server error as one structured line in the platform logs, with the route pattern (never the real
// address, which can hold ids or tokens), the error type and a shortened message. The digest matches the reference code shown
// to visitors on the error page, so a report from a user leads straight to the log entry.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const e = error as { digest?: string; name?: string; message?: string };
  console.error(
    JSON.stringify({
      evt: "request_error",
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      kind: context.routerKind,
      digest: e.digest,
      name: e.name,
      message: String(e.message ?? "").slice(0, 300),
    }),
  );
};
