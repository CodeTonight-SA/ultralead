// Funnel state machine — vanilla ESM, browser + Node testable.
//
// States: idle → loading → asking → freetext → cta → submitting → done | error
// Transitions are validated; out-of-order calls return { ok: false }.
//
// Persists progress to localStorage (browser) so a refresh doesn't lose
// the chain. The persisted shape is { firm, chain, answers, stage, q_index }.

import { appendDecision, verifyChain, rootId } from "../../lib/idr.js";

export const STAGES = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  ASKING: "asking",
  FREETEXT: "freetext",
  CTA: "cta",
  SUBMITTING: "submitting",
  DONE: "done",
  ERROR: "error",
});

const PERSIST_KEY = "ultralead.v0.state";

export function newSession({ firm = "_default" } = {}) {
  return {
    firm,
    started_at: Date.now(),
    stage: STAGES.IDLE,
    q_index: 0,
    answers: {},
    chain: [],
    freetext: "",
    rating: null,
    email: "",
  };
}

export function load() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function persist(state) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export function clear() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* non-fatal */
  }
}

// Transitions return new state + ok flag. Never mutate.

export async function startQuiz(state, key, questions) {
  if (state.stage !== STAGES.IDLE && state.stage !== STAGES.LOADING) {
    return { ok: false, state, reason: `cannot start from ${state.stage}` };
  }
  const chain = await appendDecision(key, state.chain, {
    actor: "user",
    decision_kind: "quiz_start",
    payload: {
      firm: state.firm,
      question_count: questions.questions.length,
      schema_version: questions._meta?.version || "unknown",
      confidence: 1.0,
      what: "lead began quiz",
      why: "clicked Start CTA",
      how: "stage transition idle→asking",
    },
  });
  return {
    ok: true,
    state: { ...state, stage: STAGES.ASKING, q_index: 0, chain },
  };
}

export async function answerQuestion(state, key, questions, { qid, value }) {
  if (state.stage !== STAGES.ASKING && state.stage !== STAGES.FREETEXT) {
    return { ok: false, state, reason: `cannot answer from ${state.stage}` };
  }
  const q = questions.questions[state.q_index];
  if (!q) return { ok: false, state, reason: "q_index out of range" };
  if (q.id !== qid) return { ok: false, state, reason: `qid mismatch (expected ${q.id}, got ${qid})` };

  const chain = await appendDecision(key, state.chain, {
    actor: "user",
    decision_kind: "quiz_answer",
    payload: {
      qid,
      category: q.category,
      value,
      tempo_ms: q.tempo_ms,
      confidence: 1.0,
      what: `answered ${qid}`,
      why: q.text,
      how: q.input === "textarea" ? "freetext" : "multiple_choice",
    },
  });
  const answers = { ...state.answers, [qid]: value };
  const nextIndex = state.q_index + 1;
  const nextQ = questions.questions[nextIndex];
  let nextStage = STAGES.ASKING;
  if (!nextQ) nextStage = STAGES.CTA;
  else if (nextQ.input === "textarea") nextStage = STAGES.FREETEXT;

  return {
    ok: true,
    state: { ...state, answers, q_index: nextIndex, stage: nextStage, chain },
  };
}

export async function submitCTA(state, key, { email, freetext, rating }) {
  if (state.stage !== STAGES.CTA) {
    return { ok: false, state, reason: `cannot submit from ${state.stage}` };
  }
  // CTA gathers email + (optional) freetext + rating. The actual /api/submit
  // POST happens outside this fn — this records the user's INTENT to submit
  // and the data they provided.
  const chain = await appendDecision(key, state.chain, {
    actor: "user",
    decision_kind: "cta_submit",
    payload: {
      email_provided: Boolean(email),
      freetext_length: (freetext || "").length,
      rating,
      confidence: 1.0,
      what: "lead provided contact + rating",
      why: "completed quiz, decided to receive recommendation",
      how: "CTA form submission",
    },
  });
  return {
    ok: true,
    state: {
      ...state,
      email: email || "",
      freetext: freetext || "",
      rating: rating ?? null,
      stage: STAGES.SUBMITTING,
      chain,
    },
  };
}

export async function recordSystemDecision(state, key, { decision_kind, payload }) {
  // Any non-user actor (ai, system) emitting an IDR — tempo pick, intent
  // classifier verdict, etc. Stage is not advanced by system decisions.
  const chain = await appendDecision(key, state.chain, {
    actor: payload?.actor || "system",
    decision_kind,
    payload,
  });
  return { ok: true, state: { ...state, chain } };
}

export async function finalise(state, key, { root_id, result_summary }) {
  if (state.stage !== STAGES.SUBMITTING) {
    return { ok: false, state, reason: `cannot finalise from ${state.stage}` };
  }
  const verify = await verifyChain(key, state.chain);
  if (!verify.ok) {
    return {
      ok: true,
      state: { ...state, stage: STAGES.ERROR, error: `chain integrity: ${verify.reason}` },
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      stage: STAGES.DONE,
      root_id: root_id || rootId(state.chain),
      result_summary: result_summary || null,
    },
  };
}

// Helpers --------------------------------------------------------------

export function currentQuestion(state, questions) {
  if (state.stage !== STAGES.ASKING && state.stage !== STAGES.FREETEXT) return null;
  return questions.questions[state.q_index] || null;
}

export function progress(state, questions) {
  const total = questions.questions.length;
  return {
    answered: Math.min(state.q_index, total),
    total,
    fraction: total === 0 ? 0 : Math.min(state.q_index / total, 1),
  };
}
