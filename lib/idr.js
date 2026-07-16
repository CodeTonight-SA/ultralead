// IDR (Intent Decision Record) — chained, signed decision audit trail.
//
// Pattern lifted from DONNA. ULTRALEAD wraps every quiz answer, every server
// inference (offering match, tone classification), every form-submit step as
// an IDR linked to the previous one. Replay reconstructs the full lead
// journey byte-identically; tampering breaks the chain.
//
// Layered safety: client-signed chain is a HINT. Server re-signs every
// decision on submit using the server-only key — so a forged client chain
// fails verification at the boundary. Per
// rules/untrusted-content-capability-lock.md the chain content is treated
// as untrusted, never used to spawn capability.
//
// Soundness invariants:
//   - canonical JSON (sorted keys, no whitespace) — Python/JS parity
//   - HMAC-SHA256 (Web Crypto API; Node 18+ has globalThis.crypto.subtle)
//   - chain.prev_hash === sha256(prev_record_with_sig) — break-the-chain
//   - each record carries decision_kind, confidence, what, why, how
//   - the actor (user|ai|system) is part of the signed payload
//
// Zero deps. Browser and Node 18+ both run this file unchanged.

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ---------- canonical JSON ----------

export function canonicalise(obj) {
  // Sorted-keys, no whitespace, predictable for hashing. Reject undefined.
  if (obj === undefined) throw new Error("canonicalise: undefined not representable");
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalise).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalise(obj[k])).join(",") + "}";
}

// ---------- crypto primitives ----------

async function importHmacKey(rawKey) {
  // rawKey may be a hex string OR a Uint8Array OR a UTF-8 string.
  let bytes;
  if (rawKey instanceof Uint8Array) {
    bytes = rawKey;
  } else if (typeof rawKey === "string" && /^[0-9a-fA-F]+$/.test(rawKey) && rawKey.length % 2 === 0) {
    bytes = new Uint8Array(rawKey.length / 2);
    for (let i = 0; i < rawKey.length; i += 2) bytes[i / 2] = parseInt(rawKey.slice(i, i + 2), 16);
  } else {
    bytes = ENC.encode(String(rawKey));
  }
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toHex(buf) {
  const arr = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
  return out;
}

export async function hmacHex(key, message) {
  const k = await importHmacKey(key);
  const sig = await crypto.subtle.sign("HMAC", k, ENC.encode(message));
  return toHex(sig);
}

export async function sha256Hex(message) {
  const buf = await crypto.subtle.digest("SHA-256", ENC.encode(message));
  return toHex(buf);
}

// ---------- IDR record shape ----------

// {
//   id: "<idr-uuid>",
//   prev_hash: "<sha256-of-prev-record-or-genesis>",
//   actor: "user" | "ai" | "system",
//   decision_kind: "<short-tag>",
//   payload: { what, why, how, confidence, ... },
//   ts: <epoch-ms>,
//   sig: "<hmac-of-canonical-record-minus-sig>"
// }

const GENESIS_PREV = "00".repeat(32);

export function makeId() {
  // RFC4122-ish v4 via crypto.getRandomValues. Non-crypto-uuid acceptable —
  // soundness is in the sig, not the id.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = toHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------- sign + verify ----------

export async function signRecord(key, record) {
  if (record.sig != null) throw new Error("signRecord: record already signed");
  const required = ["id", "prev_hash", "actor", "decision_kind", "payload", "ts"];
  for (const k of required) if (record[k] == null) throw new Error(`signRecord: missing ${k}`);
  const sig = await hmacHex(key, canonicalise(record));
  return { ...record, sig };
}

export async function verifyRecord(key, record) {
  if (record == null || typeof record !== "object" || record.sig == null) return false;
  const { sig, ...rest } = record;
  const expected = await hmacHex(key, canonicalise(rest));
  return constantTimeEq(sig, expected);
}

function constantTimeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- chain ----------

export async function appendDecision(key, chain, decision) {
  // chain is an ordered array of signed records. decision is the unsigned
  // {actor, decision_kind, payload} for the new record.
  const prevHash = chain.length === 0 ? GENESIS_PREV : await sha256Hex(canonicalise(chain[chain.length - 1]));
  const record = {
    id: makeId(),
    prev_hash: prevHash,
    actor: decision.actor,
    decision_kind: decision.decision_kind,
    payload: decision.payload,
    ts: Date.now(),
  };
  const signed = await signRecord(key, record);
  return [...chain, signed];
}

export async function verifyChain(key, chain) {
  if (!Array.isArray(chain) || chain.length === 0) return { ok: false, reason: "empty" };
  let prevHash = GENESIS_PREV;
  for (let i = 0; i < chain.length; i++) {
    const rec = chain[i];
    if (rec.prev_hash !== prevHash) return { ok: false, reason: `chain break at ${i}` };
    const ok = await verifyRecord(key, rec);
    if (!ok) return { ok: false, reason: `bad sig at ${i}` };
    prevHash = await sha256Hex(canonicalise(rec));
  }
  return { ok: true, length: chain.length, head: prevHash };
}

// ---------- root_id helper ----------

export function rootId(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  return chain[0].id;
}
