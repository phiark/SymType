/* global AbortSignal, Headers, URL, fetch */

import { performance } from "node:perf_hooks";

export async function requestJson(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.csrfToken) headers.set("x-symtype-csrf", options.csrfToken);
  if (options.method && options.method !== "GET") headers.set("origin", new URL(baseUrl).origin);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned non-JSON status ${response.status}.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${JSON.stringify(body)}`
    );
  }
  return body;
}

export async function timedJsonRequest(baseUrl, path, options = {}) {
  const startedAt = performance.now();
  const body = await requestJson(baseUrl, path, options);
  return { elapsedMs: performance.now() - startedAt, body };
}

export async function createTrainingSession(baseUrl, csrfToken, seed) {
  const body = await requestJson(baseUrl, "/api/v1/sessions", {
    method: "POST",
    csrfToken,
    body: {
      kind: "training",
      mode: "smart",
      strategy: "adaptive",
      seed,
      focus: [],
      includeInModel: true
    }
  });
  return body.session;
}

export function nextBlockRequest(blockIndex, seed, length = 60) {
  return {
    blockIndex,
    seed,
    mode: "smart",
    length,
    focus: [],
    scopeLabels: [],
    allowedCharacters: [],
    strictScope: false,
    phase: blockIndex === 0 ? "warmup" : "focus"
  };
}

export function eventForTarget(targetText, index, mappings) {
  const targetChar = targetText[index];
  if (targetChar === undefined) throw new Error(`Target text has no character at ${index}.`);
  const mapping = mappings.find(
    (candidate) => candidate.unshifted === targetChar || candidate.shifted === targetChar
  );
  if (!mapping)
    throw new Error(`No active physical mapping exists for ${JSON.stringify(targetChar)}.`);
  const shifted = mapping.shifted === targetChar && mapping.unshifted !== targetChar;
  return {
    sequence: index,
    clientTimeMs: 10_000 + index * 200,
    targetChar,
    actualChar: targetChar,
    physicalCode: mapping.physical_code,
    shiftSide: shifted ? (mapping.hand === "left" ? "right" : "left") : "none",
    modifiers: { shift: shifted, capsLock: false },
    isCorrect: true,
    isCorrection: false,
    backspaceCount: 0,
    ikiMs: index === 0 ? null : 200,
    featureChar: targetChar,
    bigram: index > 0 ? targetText.slice(index - 1, index + 1) : null,
    trigram: index > 1 ? targetText.slice(index - 2, index + 1) : null,
    mappedHand: mapping.hand,
    mappedFinger: mapping.finger,
    keyboardRow: mapping.keyboard_row,
    zone: mapping.zone,
    characterClass: characterClass(targetChar),
    contentMode: "smart",
    textPosition: index,
    isWordBoundary: /\s/u.test(targetChar),
    isAfterError: false,
    wasRefocus: false,
    wasPaused: false,
    wasLongPause: false,
    wasThrottled: false,
    wasRepeat: false
  };
}

export function deterministicBatchUuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function characterClass(character) {
  if (/\s/u.test(character)) return "space";
  if (/\p{L}/u.test(character))
    return character === character.toUpperCase() ? "uppercase" : "letter";
  if (/\d/u.test(character)) return "digit";
  return "symbol";
}
