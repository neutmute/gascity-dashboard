// Strip ANSI escape sequences (OSC + CSI), C0/DEL/C1 control characters, and
// Unicode bidi/RTL controls from operator-influenced strings before they reach
// a subprocess argument or the audit log. The shared helper for any path that
// embeds attacker-influenced text into a single-line operator/audit record.
//
// Threat model: log-injection / terminal-escape forgery. A browser-supplied
// string carrying `\x1b[31m... [admin] CRITICAL ...\x1b[0m`, bidi overrides, or
// embedded newlines could otherwise forge a fake operator log line or audit
// row, or smuggle a trojan-source sequence (CVE-2021-42574) into a stored
// record. Mirrors backend/src/exec.ts::sanitiseTerminalOutput, but this strip
// is total: \t/\n/\r are dropped too, because these consumers (close-reason
// argv, audit JSON values) are single-line and never want embedded whitespace
// control bytes. Stripping all control bytes up front keeps the invariant
// uniform regardless of which control class the input carries.

const OSC_RE = /\x1b\][^\x07]*\x07/g;
const CSI_RE = /\x1b\[[?0-9;]*[a-zA-Z]/g;
// All control chars: C0 (<0x20, incl. \t/\n/\r), DEL (\x7f), and C1
// (\x80-\x9f). C1 are legacy 8-bit controls some terminals still interpret as
// alternative escape introducers — same threat class as C0.
const CTRL_RE = /[\x00-\x1f\x7f-\x9f]/g;
// All 12 Unicode bidi/RTL control codepoints from CVE-2021-42574
// (Boucher/Anderson 2021): U+061C, U+200E, U+200F, U+202A-202E, U+2066-2069.
const BIDI_RE = /[؜‎‏‪-‮⁦-⁩]/g;

export function stripNonPrintable(value: string): string {
  return value
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(CTRL_RE, '')
    .replace(BIDI_RE, '');
}
