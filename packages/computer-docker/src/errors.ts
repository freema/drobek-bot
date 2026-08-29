import { ComputerError, type ComputerErrorKind } from "@drobek-bot/core";
import { z } from "zod";

/**
 * Docker failures mapped onto `ComputerError`. Nothing dockerode throws is
 * allowed to escape this package, and no detail ever carries a command's
 * arguments or a box's environment — only what the daemon said about itself.
 */

const dockerErrorSchema = z.object({
  statusCode: z.number().int().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

/** Socket-level failures: the daemon is not there, or we may not talk to it. */
const UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES", "ECONNRESET", "EPIPE"]);

/** The daemon's own status code, when the failure came from the API. */
export function dockerStatusCode(error: unknown): number | undefined {
  return dockerErrorSchema.safeParse(error).data?.statusCode;
}

/**
 * `error` as a `ComputerError`. A 404 means different things per call, so the
 * caller names its kind; everything else maps here.
 */
export function toComputerError(error: unknown, notFound: ComputerErrorKind): ComputerError {
  if (error instanceof ComputerError) return error;
  const parsed = dockerErrorSchema.safeParse(error);
  if (!parsed.success) return new ComputerError("runtime");
  const { statusCode, code, message } = parsed.data;
  const detail = message?.trim().split("\n")[0];
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) {
    return new ComputerError("unavailable", `docker socket: ${code}`);
  }
  if (statusCode === 404) return new ComputerError(notFound, detail);
  return new ComputerError("runtime", detail);
}
