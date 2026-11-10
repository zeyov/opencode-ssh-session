import { randomBytes } from "node:crypto"

/**
 * Markers delimit command output on the shared stdout stream.
 *
 * Every command gets a frame: a begin marker echoed before the command runs and a
 * done marker (with the exit code) echoed afterwards. Anything that arrives before
 * the begin marker belongs to an earlier, already finished command — for example a
 * background job that kept writing — and is dropped instead of being reported as
 * this command's output.
 *
 * Both markers carry a per-process nonce, so remote output cannot forge a frame
 * boundary by printing an obvious literal.
 */
const NONCE = randomBytes(6).toString("hex")

export const MARKER_PREFIX = `<<__OC_SSH_DONE__${NONCE}_`
export const MARKER_BEGIN_PREFIX = `<<__OC_SSH_BEGIN__${NONCE}_`
export const MARKER_SUFFIX = ">>"

/** Random frame id. Only hex characters, so it is safe to interpolate into shell code. */
export function newMarkerId(): string {
  return randomBytes(8).toString("hex")
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function markerRegex(id: string): RegExp {
  return new RegExp(`${escapeRegex(MARKER_PREFIX + id)}_(\\d+)${escapeRegex(MARKER_SUFFIX)}`)
}

export function beginMarkerRegex(id: string): RegExp {
  return new RegExp(`${escapeRegex(MARKER_BEGIN_PREFIX + id)}${escapeRegex(MARKER_SUFFIX)}`)
}
