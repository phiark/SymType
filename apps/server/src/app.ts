import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  CONTENT_MODES,
  GAME_LEVELS,
  generateGameLevelPlan,
  generatePracticeCandidates,
  generatePracticeText,
  getGameLevelText,
  type PracticeContentModeId
} from "@symtype/content";
import {
  STANDARD_LAYOUT,
  SYMMETRIC_LAYOUT,
  DEFAULT_PRIORITY_WEIGHTS,
  GAME_RULES,
  createFeatureStats,
  findRuntimeApiContract,
  findRuntimeNonJsonApiContract,
  runtimeCreateBackupRequestSchema,
  runtimeCreateCustomTextRequestSchema,
  generateMicroBlock,
  runtimeCompleteSessionRequestSchema,
  runtimeCreateGameRunRequestSchema,
  runtimeCreateLayoutRequestSchema,
  runtimeCreateSessionSchema,
  runtimeCreateTestRequestSchema,
  runtimeCustomTextProgressRequestSchema,
  runtimeEventBatchSchema,
  runtimeGameLevelResultRequestSchema,
  runtimeGoalInputSchema,
  runtimeJsonBackupSchema,
  runtimeLayoutIdParamsSchema,
  runtimeLessonIdParamsSchema,
  runtimeNextBlockSchema,
  runtimePauseSessionRequestSchema,
  runtimePreferencesRequestSchema,
  runtimeRecoverSessionRequestSchema,
  runtimeReplaceLayoutMappingsRequestSchema,
  runtimeSessionFeedbackRequestSchema,
  runtimeSettingsPatchSchema,
  runtimeSettingsSchema,
  runtimeSqliteCommitRequestSchema,
  runtimeStatisticsQuerySchema,
  runtimeCsrfQuerySchema,
  runtimeUuidIdParamsSchema,
  scheduleAdaptiveFeatures,
  scheduleKeybrLikeBaseline,
  type FeatureKind,
  type MicroBlockPhase,
  type PriorityWeights,
  type SchedulableFeature
} from "@symtype/shared";
import type { z } from "zod";

import { requireLoopbackBindHost, type ServerConfig } from "./config.js";
import { ALGORITHM_VERSION, SymTypeDatabase } from "./db/database.js";

function practiceMode(mode: string): PracticeContentModeId | undefined {
  const aliased =
    mode === "calibration"
      ? "smart"
      : mode === "rescue"
        ? "weakness"
        : mode.startsWith("game-") || mode.startsWith("pineapple-")
          ? "smart"
          : mode === "test"
            ? "typing-test"
            : mode;
  return CONTENT_MODES.find((candidate) => candidate.id === aliased)?.id;
}

type CalibrationCategory = "letters" | "bigrams" | "index" | "digits" | "symbols" | "shift";

function repeatSeededTokens(tokens: readonly string[], seed: number, length: number): string {
  const ordered = tokens.map((_, index) => tokens[(index + Math.abs(seed)) % tokens.length] ?? "");
  let text = "";
  let cursor = 0;
  while (text.length < length && cursor < 256) {
    const token = ordered[cursor % ordered.length] ?? "";
    text += text ? ` ${token}` : token;
    cursor += 1;
  }
  return text.slice(0, length).trimEnd();
}

function generateCalibrationText(
  category: CalibrationCategory,
  seed: number,
  length: number
): string {
  if (category === "bigrams") {
    return repeatSeededTokens(
      ["th", "he", "in", "er", "an", "re", "on", "at", "en", "nd", "ct", "tr"],
      seed,
      length
    );
  }
  if (category === "index") {
    return repeatSeededTokens(
      ["ct", "tc", "gb", "bg", "yn", "ny", "hm", "mh", "rf", "ju"],
      seed,
      length
    );
  }
  const mode: PracticeContentModeId =
    category === "digits"
      ? "data-entry"
      : category === "symbols"
        ? "punctuation"
        : category === "shift"
          ? "shift"
          : "common-english";
  return generatePracticeText({ mode, seed, length, focus: [] });
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    /^127(?:\.\d{1,3}){3}(?::\d+)?$/u.test(normalized) ||
    /^localhost(?::\d+)?$/u.test(normalized) ||
    /^\[::1\](?::\d+)?$/u.test(normalized)
  );
}

function requestOriginMatchesHost(
  request: FastifyRequest,
  allowDevelopmentOrigin: boolean
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const isExactSameOrigin =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.toLowerCase() === request.headers.host?.toLowerCase() &&
      isLoopbackHost(parsed.host);
    const isKnownViteOrigin =
      allowDevelopmentOrigin && parsed.origin.toLowerCase() === "http://127.0.0.1:5173";
    return isExactSameOrigin || isKnownViteOrigin;
  } catch {
    return false;
  }
}

function userError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

function parseOrReply<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    void userError(reply, 400, "VALIDATION_ERROR", "提交的数据不完整或格式不正确。");
    return undefined;
  }
  return parsed.data;
}

function blockRationale(phase: string, focus: readonly string[]): string {
  const name = focus.length ? `“${focus.slice(0, 3).join("、")}”` : "当前映射区域";
  const messages: Record<string, string> = {
    warmup: "用熟悉组合建立节奏基线；这个可见微组在开始后保持不变。",
    focus: `${name} 的短期准确率或节奏落后，安排一个短 blocked 组。`,
    retest: `${name} 已间隔一段时间，安排短复测来区分保留与临时波动。`,
    transfer: `把 ${name} 放入可读上下文，检查从集中练习到迁移的差距。`,
    fluency: "插入已掌握内容，控制疲劳并观察舒适节奏。",
    explore: "补充样本不足的键区，避免调度器只看已知弱点。"
  };
  return messages[phase] ?? messages.focus ?? "安排一个可解释的微组。";
}

function kindForStoredFeature(type: string): FeatureKind {
  if (type === "bigram") return "bigram";
  if (type === "trigram") return "trigram";
  return "character";
}

type ActiveMapping = ReturnType<SymTypeDatabase["getActiveLayoutMappings"]>[number];

const FINGER_SCOPES: Readonly<Record<string, string>> = {
  左小指: "left-pinky",
  左无名指: "left-ring",
  左中指: "left-middle",
  左食指: "left-index",
  右食指: "right-index",
  右中指: "right-middle",
  右无名指: "right-ring",
  右小指: "right-pinky"
};

const SCOPE_LABELS = new Set([
  "食指区",
  "其他区",
  "左手",
  "右手",
  "字母",
  "数字",
  "符号",
  "大小写",
  "letters",
  "index",
  "digits",
  "symbols",
  "shift",
  ...Object.keys(FINGER_SCOPES)
]);

function recognizedScopeLabels(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => SCOPE_LABELS.has(scope));
}

function mappingForCharacter(character: string, mappings: readonly ActiveMapping[]) {
  return mappings.find(
    (mapping) => mapping.unshifted === character || mapping.shifted === character
  );
}

type ScopeDimension = "finger" | "hand" | "character";

function scopeDimension(scope: string): ScopeDimension | null {
  if (scope === "左手" || scope === "右手") return "hand";
  if (scope === "食指区" || scope === "其他区" || scope === "index" || scope in FINGER_SCOPES) {
    return "finger";
  }
  if (["字母", "数字", "符号", "大小写", "letters", "digits", "symbols", "shift"].includes(scope)) {
    return "character";
  }
  return null;
}

function singleScopeAllowsCharacter(
  character: string,
  scope: string,
  binding: ActiveMapping | undefined
): boolean {
  if (scope === "食指区") return binding?.finger.endsWith("index") === true;
  if (scope === "其他区") {
    return binding != null && !binding.finger.endsWith("index") && binding.finger !== "thumb";
  }
  if (scope === "左手") return binding?.hand === "left";
  if (scope === "右手") return binding?.hand === "right";
  if (scope === "字母" || scope === "letters") return /[a-z]/iu.test(character);
  if (scope === "数字" || scope === "digits") return /\d/u.test(character);
  if (scope === "符号" || scope === "symbols") return /[^a-z\d\s]/iu.test(character);
  if (scope === "大小写" || scope === "shift") return /[a-z]/iu.test(character);
  if (scope === "index") {
    return /[cbnm]/iu.test(character) && binding?.finger.endsWith("index") === true;
  }
  if (scope in FINGER_SCOPES) return binding?.finger === FINGER_SCOPES[scope];
  return false;
}

function scopeAllowsCharacter(
  character: string,
  scopes: readonly string[],
  mappings: readonly ActiveMapping[]
): boolean {
  const structured = recognizedScopeLabels(scopes);
  if (structured.length === 0) return true;
  const binding = mappingForCharacter(character, mappings);
  const byDimension = new Map<ScopeDimension, string[]>();
  for (const scope of structured) {
    const dimension = scopeDimension(scope);
    if (!dimension) continue;
    byDimension.set(dimension, [...(byDimension.get(dimension) ?? []), scope]);
  }
  return [...byDimension.values()].every((dimensionScopes) =>
    dimensionScopes.some((scope) => singleScopeAllowsCharacter(character, scope, binding))
  );
}

function allowedCharactersForScopes(
  scopes: readonly string[],
  mappings: readonly ActiveMapping[]
): Set<string> {
  return new Set(
    mappings
      .flatMap((mapping) => [mapping.unshifted, mapping.shifted])
      .filter((character) => character && scopeAllowsCharacter(character, scopes, mappings))
  );
}

function constrainTextToCharacters(text: string, allowed: ReadonlySet<string>): string {
  const replacements = [...allowed].sort();
  if (replacements.length === 0) return text;
  let replacementIndex = 0;
  return [...text]
    .map((character) => {
      if (/\s/u.test(character) || allowed.has(character)) return character;
      const replacement = replacements[replacementIndex % replacements.length] ?? " ";
      replacementIndex += 1;
      return replacement;
    })
    .join("");
}

function scheduleFocus(
  database: SymTypeDatabase,
  strategy: string,
  seed: number,
  scopes: readonly string[]
): { featureIds: string[]; values: string[]; explanations: string[] } {
  const rows = database.listFeatureModelRows();
  const mappings = database.getActiveLayoutMappings();
  const settings = database.getSettings();
  const configured = settings.advancedWeights;
  const weights: PriorityWeights = {
    ...DEFAULT_PRIORITY_WEIGHTS,
    accuracy: configured.accuracy ?? DEFAULT_PRIORITY_WEIGHTS.accuracy,
    speed: configured.speed ?? DEFAULT_PRIORITY_WEIGHTS.speed,
    uncertainty: configured.uncertainty ?? DEFAULT_PRIORITY_WEIGHTS.uncertainty,
    transfer: configured.transfer ?? DEFAULT_PRIORITY_WEIGHTS.transfer,
    userFocus: configured.userFocus ?? DEFAULT_PRIORITY_WEIGHTS.userFocus,
    errorRecovery: configured.recovery ?? DEFAULT_PRIORITY_WEIGHTS.errorRecovery
  };
  const byId = new Map(rows.map((row) => [`${row.feature_type}:${row.feature_value}`, row]));
  const printableKeys = mappings.filter(
    (key) =>
      key.unshifted.trim().length > 0 && scopeAllowsCharacter(key.unshifted, scopes, mappings)
  );
  const featureIds = new Set<string>([
    ...printableKeys.map((key) => `key:${key.unshifted ?? ""}`),
    ...rows
      .filter(
        (row) =>
          row.feature_value.trim().length > 0 &&
          [...row.feature_value].every(
            (character) =>
              /\s/u.test(character) || scopeAllowsCharacter(character, scopes, mappings)
          )
      )
      .map((row) => `${row.feature_type}:${row.feature_value}`)
  ]);
  const candidates: SchedulableFeature[] = Array.from(featureIds).map((id) => {
    const separator = id.indexOf(":");
    const type = id.slice(0, separator);
    const value = id.slice(separator + 1);
    const row = byId.get(id);
    const fresh = createFeatureStats(value, kindForStoredFeature(type));
    const outcomes = row
      ? (JSON.parse(row.recent_window_json) as unknown[]).map((outcome) => Boolean(outcome))
      : [];
    return {
      id,
      kind: kindForStoredFeature(type),
      stats: row
        ? {
            ...fresh,
            shortAccuracy: { alpha: row.short_alpha, beta: row.short_beta },
            longAccuracy: { alpha: row.long_alpha, beta: row.long_beta },
            shortIkiMs: row.short_iki_ms,
            longIkiMs: row.long_iki_ms,
            ikiMadMs: row.iki_mad_ms,
            sampleCount: row.sample_count,
            speedSampleCount: row.short_iki_ms == null ? 0 : row.sample_count,
            lastPracticedAtMs: row.last_practiced_at
              ? new Date(row.last_practiced_at).getTime()
              : null,
            correctStreak: row.current_streak,
            recentOutcomes: outcomes,
            recentIkisMs: []
          }
        : fresh,
      targetIkiMs: 60_000 / settings.targetWpm / 5,
      transferValue: type === "bigram" || type === "trigram" ? 0.9 : 0.55,
      userFocus: scopes.length > 0 ? 1 : 0
    };
  });
  const scheduled =
    strategy === "baseline"
      ? scheduleKeybrLikeBaseline(candidates, {
          seed,
          count: 3,
          targetAccuracy: settings.progressionAccuracy
        })
      : scheduleAdaptiveFeatures(candidates, {
          seed,
          nowMs: Date.now(),
          count: 3,
          targetAccuracy: settings.progressionAccuracy,
          weights
        });
  return {
    featureIds: scheduled.map((feature) => feature.id),
    values: scheduled.map((feature) => feature.id.replace(/^(key|bigram|trigram):/u, "")),
    explanations: scheduled.map(
      (feature) => `${feature.id.replace(/^(key|bigram|trigram):/u, "")}：${feature.explanation}`
    )
  };
}

function typedFocusIds(values: readonly string[]): string[] {
  return [...new Set(values)]
    .filter((value) => value.trim().length > 0 && [...value].length <= 3)
    .map((value) => {
      const length = [...value].length;
      return `${length === 1 ? "key" : length === 2 ? "bigram" : "trigram"}:${value}`;
    });
}

function microBlockPhase(phase: z.infer<typeof runtimeNextBlockSchema>["phase"]): MicroBlockPhase {
  if (phase === "focus") return "blocked";
  if (phase === "retest") return "interleave";
  return phase;
}

const CANDIDATE_SCORED_MODES = new Set<PracticeContentModeId>([
  "smart",
  "traditional",
  "weakness",
  "common-english",
  "pseudowords",
  "punctuation",
  "shift",
  "mixed"
]);

function targetDifficultyForPhase(phase: MicroBlockPhase): number {
  if (phase === "warmup") return 0.35;
  if (phase === "blocked") return 0.5;
  if (phase === "interleave") return 0.58;
  if (phase === "transfer") return 0.65;
  if (phase === "fluency") return 0.55;
  return 0.6;
}

export interface AppContext {
  app: FastifyInstance;
  database: SymTypeDatabase;
  csrfToken: string;
}

export interface AppOptions {
  logStream?: { write(message: string): void };
}

export async function createApp(
  config: ServerConfig,
  options: AppOptions = {}
): Promise<AppContext> {
  requireLoopbackBindHost(config.host);
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: process.env.SYMTYPE_LOG_LEVEL ?? "info",
          redact: [
            "req.headers.authorization",
            'req.headers["x-symtype-csrf"]',
            "req.query.csrf",
            "req.body.content",
            "req.body.events"
          ],
          serializers: {
            req: (request) => ({
              method: request.method,
              url: request.url.split("?", 1)[0] ?? ""
            })
          },
          ...(options.logStream ? { stream: options.logStream } : {})
        },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_100_000
  });
  app.addContentTypeParser(
    ["application/vnd.sqlite3", "application/x-sqlite3", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body)
  );
  const database = new SymTypeDatabase(config);
  const csrfToken = randomBytes(24).toString("base64url");
  const allowDevelopmentOrigin = !config.isTest && process.env.NODE_ENV !== "production";
  const storedLayouts = database.listLayouts();
  for (const [layoutId, keys] of [
    ["symmetric-default", SYMMETRIC_LAYOUT],
    ["standard-default", STANDARD_LAYOUT]
  ] as const) {
    const stored = storedLayouts.find((layout) => layout.id === layoutId);
    if (!stored || !Array.isArray(stored.mappings) || stored.mappings.length === 0) {
      database.replaceLayoutMappings(
        layoutId,
        keys.map((key) => ({
          code: key.code,
          unshifted: key.unshifted ?? "",
          shifted: key.shifted ?? "",
          hand: key.hand,
          finger: key.finger,
          row: key.row,
          zone: key.zone,
          width: key.width
        }))
      );
    }
  }
  await database.ensureAutomaticBackup();

  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHost(request.headers.host)) {
      return userError(reply, 403, "INVALID_HOST", "SymType 只接受本机浏览器请求。");
    }
    if (!requestOriginMatchesHost(request, allowDevelopmentOrigin)) {
      return userError(reply, 403, "INVALID_ORIGIN", "已阻止来自其他网页的请求。");
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'${allowDevelopmentOrigin ? " ws://127.0.0.1:* ws://localhost:* ws://[::1]:*" : ""}; media-src 'self'`
    );
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });

  app.addHook("preHandler", async (request, reply) => {
    const isRead = ["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (!isRead) {
      const query = runtimeCsrfQuerySchema.safeParse(request.query);
      const token =
        request.headers["x-symtype-csrf"] ?? (query.success ? query.data.csrf : undefined);
      if (token !== csrfToken) {
        return userError(reply, 403, "CSRF_FAILED", "安全令牌已过期，请刷新页面后重试。");
      }
    }

    const jsonContract = findRuntimeApiContract(request.method, request.url);
    const locationContract =
      jsonContract ?? findRuntimeNonJsonApiContract(request.method, request.url);
    if (locationContract?.params && !locationContract.params.safeParse(request.params).success) {
      return userError(reply, 400, "VALIDATION_ERROR", "请求路径参数不正确。");
    }
    if (locationContract?.query && !locationContract.query.safeParse(request.query).success) {
      return userError(reply, 400, "VALIDATION_ERROR", "请求查询参数不正确。");
    }

    if (jsonContract?.requestBody === "binary") {
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
      if (!contentType || !jsonContract.requestContentTypes?.includes(contentType)) {
        return userError(
          reply,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "上传内容的 Content-Type 不符合本地 API 契约。"
        );
      }
    }
  });

  app.addHook("preSerialization", async (request, reply, payload) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    const contract = findRuntimeApiContract(request.method, request.url);
    if (!contract) return payload;
    const parsed = contract.response.safeParse(payload);
    if (!parsed.success) {
      request.log.error(
        {
          contract: contract.id,
          issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code }))
        },
        "runtime API response contract violation"
      );
      throw new Error(`API response contract violation: ${contract.id}`);
    }
    return parsed.data;
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, route: request.routeOptions.url }, "request failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("not exist")) {
      return userError(reply, 404, "NOT_FOUND", "找不到请求的数据。");
    }
    if (
      message.includes("closed") ||
      message.includes("already") ||
      message.includes("does not belong") ||
      message.includes("layout snapshot") ||
      message.includes("not unlocked") ||
      message.includes("Active session")
    ) {
      return userError(reply, 409, "STATE_CONFLICT", "当前状态已变化，请刷新后重试。");
    }
    return userError(reply, 500, "INTERNAL_ERROR", "本地服务遇到问题；数据没有被静默丢弃。");
  });

  app.get("/api/v1/health", (_request, reply) => {
    const integrity = database.integrityCheck();
    const healthy = integrity.ok;
    return reply.status(healthy ? 200 : 503).send({
      ok: healthy,
      service: "symtype",
      version: "0.1.0",
      schemaVersion: database.getSchemaVersion(),
      algorithmVersion: ALGORITHM_VERSION,
      integrity,
      time: new Date().toISOString()
    });
  });

  app.get("/api/v1/bootstrap", () => ({
    csrfToken,
    profile: database.getProfile(),
    settings: database.getSettings(),
    layouts: database.listLayouts(),
    goal: database.getGoal(),
    contentModes: CONTENT_MODES.map((mode) => ({ ...mode, name: mode.label })),
    gameLevels: GAME_LEVELS.map((level, index) => ({
      ...level,
      level: index + 1,
      name: level.title,
      description: level.briefing,
      objective: level.skillFocus.join("、")
    })),
    algorithmVersion: ALGORITHM_VERSION,
    dataLocation: config.databasePath,
    storageAuthority: "server-sqlite"
  }));

  app.get("/api/v1/profile", () => ({ profile: database.getProfile() }));
  app.get("/api/v1/settings", () => ({ settings: database.getSettings() }));
  app.patch("/api/v1/settings", async (request, reply) => {
    const patch = parseOrReply(runtimeSettingsPatchSchema, request.body, reply);
    if (!patch) return;
    const merged = runtimeSettingsSchema.safeParse({ ...database.getSettings(), ...patch });
    if (!merged.success) return userError(reply, 400, "VALIDATION_ERROR", "设置组合不正确。");
    return { settings: database.updateSettings(patch) };
  });
  app.put("/api/v1/preferences", async (request, reply) => {
    const body = parseOrReply(runtimePreferencesRequestSchema, request.body, reply);
    if (!body) return;
    const synchronizedPatch = {
      ...body.settings,
      targetWpm: body.goal.targetWpm,
      minimumAccuracy: body.goal.minimumAccuracy
    };
    const merged = runtimeSettingsSchema.safeParse({
      ...database.getSettings(),
      ...synchronizedPatch
    });
    if (!merged.success) return userError(reply, 400, "VALIDATION_ERROR", "设置组合不正确。");
    return database.updatePreferences(synchronizedPatch, body.goal);
  });

  app.get("/api/v1/layouts", () => ({ layouts: database.listLayouts() }));
  app.post("/api/v1/layouts", async (request, reply) => {
    const body = parseOrReply(runtimeCreateLayoutRequestSchema, request.body, reply);
    if (!body) return;
    const id = database.createCustomLayout(body.name, body.baseLayoutId);
    return reply.status(201).send({ id, layouts: database.listLayouts() });
  });
  app.put("/api/v1/layouts/:id/mappings", async (request, reply) => {
    const params = parseOrReply(runtimeLayoutIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeReplaceLayoutMappingsRequestSchema, request.body, reply);
    if (!params || !body) return;
    const layout = database.listLayouts().find((candidate) => candidate.id === params.id);
    if (!layout) return userError(reply, 404, "LAYOUT_NOT_FOUND", "找不到这份键盘映射。");
    if (layout.preset !== "custom") {
      return userError(reply, 409, "PRESET_READ_ONLY", "内置预设只读；请先复制再编辑。");
    }
    const byCode = new Map(body.mappings.map((mapping) => [mapping.code, mapping]));
    if (byCode.size !== body.mappings.length || byCode.size !== SYMMETRIC_LAYOUT.length) {
      return userError(reply, 400, "INCOMPLETE_MAPPING", "自定义映射必须逐键完整且不能重复。");
    }
    for (const physical of SYMMETRIC_LAYOUT) {
      const mapping = byCode.get(physical.code);
      if (!mapping) {
        return userError(reply, 400, "INCOMPLETE_MAPPING", "自定义映射缺少 ANSI 物理键。");
      }
      const inferredHand = mapping.finger === "thumb" ? "thumb" : mapping.finger.split("-")[0];
      if (
        mapping.unshifted !== (physical.unshifted ?? "") ||
        mapping.shifted !== (physical.shifted ?? "") ||
        mapping.row !== physical.row ||
        mapping.width !== physical.width ||
        mapping.zone !== mapping.finger ||
        mapping.hand !== inferredHand
      ) {
        return userError(
          reply,
          400,
          "INVALID_MAPPING",
          "只能修改建议手指分区；字符、物理键、行、宽度、手与区域必须保持一致。"
        );
      }
    }
    database.replaceLayoutMappings(params.id, body.mappings);
    return { ok: true };
  });

  app.post("/api/v1/sessions", async (request, reply) => {
    const body = parseOrReply(runtimeCreateSessionSchema, request.body, reply);
    if (!body) return;
    const session = database.createSession(body);
    return reply.status(201).send({ session });
  });
  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    if (!params) return;
    const session = database.getSession(params.id);
    if (!session) return userError(reply, 404, "SESSION_NOT_FOUND", "找不到这次训练。");
    return { session };
  });
  app.post("/api/v1/sessions/:id/events", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeEventBatchSchema, request.body, reply);
    if (!params || !body) return;
    const result = database.ingestEvents(
      params.id,
      body.batchId,
      body.events,
      body.lessonId,
      body.blockId
    );
    return { result };
  });
  app.post("/api/v1/sessions/:id/events/beacon", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    let raw: unknown = request.body;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return userError(reply, 400, "INVALID_BEACON", "无法解析页面关闭时的保存数据。");
      }
    }
    const body = parseOrReply(runtimeEventBatchSchema, raw, reply);
    if (!params || !body) return;
    return {
      result: database.ingestEvents(
        params.id,
        body.batchId,
        body.events,
        body.lessonId,
        body.blockId
      )
    };
  });
  app.post("/api/v1/sessions/:id/pause", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimePauseSessionRequestSchema, request.body, reply);
    if (!params || !body) return;
    database.pauseSession(params.id, body.paused);
    return { ok: true, status: body.paused ? "paused" : "active" };
  });
  app.post("/api/v1/sessions/:id/complete", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeCompleteSessionRequestSchema, request.body ?? {}, reply);
    if (!params || !body) return;
    const summary = database.completeSession(params.id, body.activeMs);
    return { saved: true, summary };
  });
  app.post("/api/v1/sessions/:id/feedback", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeSessionFeedbackRequestSchema, request.body, reply);
    if (!params || !body) return;
    return { feedback: database.saveSessionSubjectiveFeedback(params.id, body) };
  });
  app.post("/api/v1/sessions/:id/recover", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeRecoverSessionRequestSchema, request.body ?? {}, reply);
    if (!params || !body) return;
    return database.recoverSession(params.id, body.disposition, body.activeMs);
  });
  app.post("/api/v1/sessions/:id/abandon", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    if (!params) return;
    database.abandonSession(params.id);
    return { ok: true };
  });

  app.post("/api/v1/lessons/:lessonId/blocks/next", async (request, reply) => {
    const params = parseOrReply(runtimeLessonIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeNextBlockSchema, request.body, reply);
    if (!params || !body) return;
    const lessonContext = database.getLessonContext(params.lessonId);
    if (!lessonContext) return userError(reply, 404, "LESSON_NOT_FOUND", "找不到这节课程。");
    const mappings = database.getActiveLayoutMappings();
    const scopeLabels = body.scopeLabels.length
      ? recognizedScopeLabels(body.scopeLabels)
      : recognizedScopeLabels(body.focus);
    if (body.scopeLabels.length > 0 && scopeLabels.length !== body.scopeLabels.length) {
      return userError(reply, 400, "INVALID_SCOPE", "训练范围包含无法识别的标签。");
    }
    const mappedCharacters = new Set(
      mappings.flatMap((mapping) => [mapping.unshifted, mapping.shifted]).filter(Boolean)
    );
    if (
      body.allowedCharacters.some(
        (character) => !/\s/u.test(character) && !mappedCharacters.has(character)
      )
    ) {
      return userError(
        reply,
        400,
        "INVALID_SCOPE_CHARACTER",
        "训练范围包含当前键盘映射之外的字符。"
      );
    }
    const scopeCharacters = allowedCharactersForScopes(scopeLabels, mappings);
    if (
      scopeLabels.length > 0 &&
      body.allowedCharacters.some(
        (character) => !/\s/u.test(character) && !scopeCharacters.has(character)
      )
    ) {
      return userError(reply, 400, "SCOPE_CHARACTER_MISMATCH", "字符范围与所选键区不一致。");
    }
    const allowedCharacters = new Set(
      (body.allowedCharacters.length ? body.allowedCharacters : [...scopeCharacters]).filter(
        (character) => !/\s/u.test(character)
      )
    );
    const shouldConstrain = body.strictScope || scopeLabels.length > 0;
    if (shouldConstrain && allowedCharacters.size === 0) {
      return userError(reply, 400, "EMPTY_SCOPE", "当前键盘映射中没有可用于这个范围的字符。");
    }
    const schedulerScopes = scopeLabels.length ? scopeLabels : body.focus;
    const scheduled =
      (body.mode === "smart" || body.gameRunId != null) && body.phase !== "warmup"
        ? scheduleFocus(database, lessonContext.strategy, body.seed, schedulerScopes)
        : {
            featureIds: typedFocusIds(body.focus),
            values: body.focus,
            explanations: [] as string[]
          };
    const effectiveFocus = scheduled.values.length ? scheduled.values : body.focus;
    const effectiveFeatureIds = scheduled.featureIds.length
      ? scheduled.featureIds
      : typedFocusIds(effectiveFocus);
    const customText = body.customTextId ? database.getCustomText(body.customTextId) : undefined;
    let targetText: string;
    let generatedExplanation: string | undefined;
    let generatedCandidateIds: readonly string[] = [];
    let sourceTextId: string | undefined;
    let sourceStart: number | undefined;
    let builtInSource:
      | {
          title: string;
          sourceId: string;
          sourceName: string;
          sourceType: string;
          progress: string;
        }
      | undefined;
    let blockType: string = body.phase;
    if (body.gameRunId) {
      if (lessonContext.kind !== "game") {
        return userError(reply, 400, "INVALID_GAME_CONTEXT", "游戏文本只能用于游戏训练。");
      }
      const run = database.getGameRun(body.gameRunId);
      if (!run || run.status !== "active") {
        return userError(reply, 404, "RUN_NOT_FOUND", "找不到正在进行的游戏。");
      }
      const levelNumber = Number(run.current_level ?? 1);
      if (lessonContext.mode !== `pineapple-level-${levelNumber}`) {
        return userError(reply, 409, "GAME_LEVEL_MISMATCH", "游戏关卡状态已变化，请重新读取任务。");
      }
      const levelDefinition = GAME_LEVELS[levelNumber - 1];
      if (!levelDefinition) {
        return userError(reply, 500, "GAME_CONTENT_MISSING", "本地游戏内容不完整。");
      }
      if (!body.gameStage) {
        return userError(reply, 400, "GAME_STAGE_REQUIRED", "游戏关卡必须指定第 1–3 阶段。");
      }
      const plan = generateGameLevelPlan({
        levelId: levelDefinition.id,
        difficulty: String(run.difficulty) as "standard" | "hard" | "adaptive",
        seed: body.seed,
        focus: effectiveFocus
      });
      const stage = plan.stages.find((candidate) => candidate.stage === body.gameStage);
      if (!stage) return userError(reply, 500, "GAME_CONTENT_MISSING", "游戏阶段内容不完整。");
      targetText = stage.targets.map((target) => target.text).join("\n");
      blockType = `game-stage-${body.gameStage}`;
    } else if (lessonContext.kind === "calibration" || body.mode === "calibration") {
      if (lessonContext.kind !== "calibration") {
        return userError(reply, 400, "INVALID_CALIBRATION_CONTEXT", "校准文本只能用于校准会话。");
      }
      const category =
        body.calibrationCategory ??
        (["letters", "bigrams", "index", "digits", "symbols", "shift"] as const)[
          body.blockIndex % 6
        ];
      if (!category) {
        return userError(reply, 400, "CALIBRATION_CATEGORY_REQUIRED", "请选择校准类别。");
      }
      targetText = generateCalibrationText(category, body.seed, body.length);
      blockType = `calibration-${category}`;
    } else if (body.customTextId) {
      if (!customText) return userError(reply, 404, "TEXT_NOT_FOUND", "找不到这份本地文本。");
      const content = typeof customText.content === "string" ? customText.content : "";
      const storedPosition = Number(customText.reading_position ?? 0);
      const start = Math.min(Math.max(0, storedPosition), content.length);
      if (start >= content.length) {
        return userError(reply, 409, "TEXT_COMPLETE", "这份本地文本已经练习完毕。");
      }
      targetText = content.slice(start, start + body.length);
      sourceTextId = body.customTextId;
      sourceStart = start;
    } else {
      const compatibleMode = practiceMode(body.mode);
      if (!compatibleMode) {
        return userError(reply, 400, "UNSUPPORTED_CONTENT_MODE", "这项训练内容模式不受支持。");
      }
      if (compatibleMode === "long-form") {
        const slice = database.getBuiltInLongFormSlice(params.lessonId, body.length);
        if (!slice) {
          return userError(
            reply,
            409,
            "LONG_FORM_COMPLETE",
            "内置长文已读完，请选择其他训练模式。"
          );
        }
        targetText = slice.text;
        sourceTextId = slice.textId;
        sourceStart = slice.start;
        generatedExplanation = `继续《${slice.title}》第 ${slice.start + 1}–${slice.end} 个字符；来源：${slice.sourceName}。`;
        builtInSource = {
          title: slice.title,
          sourceId: slice.sourceId,
          sourceName: slice.sourceName,
          sourceType: slice.sourceType,
          progress: `${slice.end}/${slice.total}`
        };
      } else if (CANDIDATE_SCORED_MODES.has(compatibleMode)) {
        const phase = microBlockPhase(body.phase);
        const targetLength = Math.min(60, body.length);
        const generated = generateMicroBlock({
          seed: `${String(body.seed)}:${String(body.blockIndex)}:${compatibleMode}`,
          phase,
          focusFeatures: effectiveFeatureIds,
          candidates: generatePracticeCandidates({
            mode: compatibleMode,
            seed: body.seed,
            length: targetLength,
            focusFeatures: effectiveFeatureIds
          }),
          targetLength,
          minimumLength: 20,
          maximumLength: 60,
          targetDifficulty: targetDifficultyForPhase(phase)
        });
        targetText = generated.text;
        generatedExplanation = generated.explanation;
        generatedCandidateIds = generated.candidateIds;
      } else {
        targetText = generatePracticeText({
          mode: compatibleMode,
          seed: body.seed,
          length: body.length,
          focus: effectiveFocus
        });
      }
    }
    if (shouldConstrain) targetText = constrainTextToCharacters(targetText, allowedCharacters);
    const block = database.addMicroBlock(
      params.lessonId,
      body.blockIndex,
      blockType,
      targetText,
      body.seed,
      scheduled.explanations.length
        ? `${scheduled.explanations.join("；")}。${generatedExplanation ?? blockRationale(body.phase, effectiveFocus)}`
        : blockType.startsWith("calibration-")
          ? `校准取样：${blockType.replace("calibration-", "")}；当前可见文本保持稳定。`
          : blockType.startsWith("game-stage-")
            ? `菠萝公司虚构任务 ${blockType.replace("game-stage-", "阶段 ")}。`
            : (generatedExplanation ?? blockRationale(body.phase, effectiveFocus)),
      sourceTextId,
      sourceStart
    );
    return {
      block,
      adaptiveDebug: {
        strategy: lessonContext.strategy,
        selectedFeatures: effectiveFeatureIds,
        selectedFeatureValues: effectiveFocus,
        explanations: scheduled.explanations,
        candidateIds: generatedCandidateIds,
        ...(builtInSource ? { contentSource: builtInSource } : {}),
        scopeLabels,
        allowedCharacters: [...allowedCharacters],
        strictScope: shouldConstrain
      }
    };
  });

  app.get("/api/v1/dashboard", () => database.getDashboard());
  app.get("/api/v1/statistics", async (request, reply) => {
    const query = parseOrReply(runtimeStatisticsQuerySchema, request.query, reply);
    if (!query) return;
    return database.getStatistics(query.period);
  });
  app.get("/api/v1/goals", () => ({ goal: database.getGoal() }));
  app.get("/api/v1/traditional-progress", () => database.getTraditionalProgress());
  app.put("/api/v1/goals", async (request, reply) => {
    const body = parseOrReply(runtimeGoalInputSchema, request.body, reply);
    if (!body) return;
    database.updateGoal(body);
    return { goal: database.getGoal() };
  });

  app.get("/api/v1/tests", () => ({ tests: database.listTests() }));
  app.post("/api/v1/tests", async (request, reply) => {
    const body = parseOrReply(runtimeCreateTestRequestSchema, request.body, reply);
    if (!body) return;
    const summary = database.completeSession(body.sessionId);
    if (summary.characters === 0) {
      return userError(
        reply,
        409,
        "TEST_NO_EVIDENCE",
        "这次测试没有训练区内的有效输入，因此不会进入本地排行榜或个人最佳。"
      );
    }
    const id = database.saveTest(body.sessionId, body.durationSeconds, summary);
    return reply.status(201).send({ id, summary });
  });

  app.post("/api/v1/game/runs", async (request, reply) => {
    const body = parseOrReply(runtimeCreateGameRunRequestSchema, request.body, reply);
    if (!body) return;
    return reply.status(201).send({ run: database.createGameRun(body.mode, body.difficulty) });
  });
  app.get("/api/v1/game/runs/:id", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    if (!params) return;
    const run = database.getGameRun(params.id);
    if (!run) return userError(reply, 404, "RUN_NOT_FOUND", "找不到这次游戏。");
    const levelNumber = Number(run.current_level ?? 1);
    const levelDefinition = GAME_LEVELS[levelNumber - 1] ?? GAME_LEVELS[0];
    if (!levelDefinition)
      return userError(reply, 500, "GAME_CONTENT_MISSING", "本地游戏内容不完整。");
    const difficulty = String(run.difficulty) as "standard" | "hard" | "adaptive";
    const plan = generateGameLevelPlan({
      levelId: levelDefinition.id,
      difficulty,
      seed: levelNumber * 7919,
      focus: []
    });
    return {
      run,
      level: {
        ...levelDefinition,
        level: levelNumber,
        name: levelDefinition.title,
        description: levelDefinition.briefing,
        objective: levelDefinition.skillFocus.join("、")
      },
      plan,
      targetText: getGameLevelText(levelDefinition.id, difficulty, Number(levelNumber * 7919), [])
    };
  });
  app.post("/api/v1/game/runs/:id/level-result", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeGameLevelResultRequestSchema, request.body, reply);
    if (!params || !body) return;
    const run = database.getGameRun(params.id);
    if (!run || run.status !== "active") {
      return userError(reply, 404, "RUN_NOT_FOUND", "找不到正在进行的游戏。");
    }
    const difficulty = String(run.difficulty) as "standard" | "hard" | "adaptive";
    const levelNumber = Number(run.current_level ?? 1);
    const levelDefinition = GAME_LEVELS[levelNumber - 1];
    if (!levelDefinition) {
      return userError(reply, 500, "GAME_CONTENT_MISSING", "本地游戏内容不完整。");
    }
    const plan = generateGameLevelPlan({
      levelId: levelDefinition.id,
      difficulty,
      seed: levelNumber * 7919,
      focus: []
    });
    try {
      return database.recordVerifiedGameLevelResult({
        runId: params.id,
        sessionId: body.sessionId,
        requestedOutcome: body.outcome,
        ...(body.failureReason ? { failureReason: body.failureReason } : {}),
        alertValue: body.alertValue,
        requiredAccuracy: plan.tuning.requiredKeystrokeAccuracy,
        pointsPerCorrect: GAME_RULES[difficulty].pointsPerCorrect,
        alertRules: GAME_RULES[difficulty]
      });
    } catch (error) {
      request.log.warn({ err: error, runId: params.id }, "rejected game level result");
      return userError(
        reply,
        409,
        "GAME_RESULT_REJECTED",
        error instanceof Error ? error.message : "游戏结果未通过本地验证。"
      );
    }
  });
  app.get("/api/v1/game/achievements", () => ({ achievements: database.listAchievements() }));
  app.get("/api/v1/game/progress", () => database.getGameProgress());

  app.get("/api/v1/custom-texts", () => ({ texts: database.listCustomTexts() }));
  app.get("/api/v1/custom-texts/:id", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    if (!params) return;
    const text = database.getCustomText(params.id);
    if (!text) return userError(reply, 404, "TEXT_NOT_FOUND", "找不到这份本地文本。");
    return { text };
  });
  app.post("/api/v1/custom-texts", async (request, reply) => {
    const body = parseOrReply(runtimeCreateCustomTextRequestSchema, request.body, reply);
    if (!body) return;
    return reply.status(201).send({ text: database.saveCustomText(body) });
  });
  app.patch("/api/v1/custom-texts/:id/progress", async (request, reply) => {
    const params = parseOrReply(runtimeUuidIdParamsSchema, request.params, reply);
    const body = parseOrReply(runtimeCustomTextProgressRequestSchema, request.body, reply);
    if (!params || !body) return;
    const text = database.getCustomText(params.id);
    if (!text) return userError(reply, 404, "TEXT_NOT_FOUND", "找不到这份本地文本。");
    const advanced = database.advanceCustomTextProgressFromBlock(
      params.id,
      body.blockId,
      body.readingPosition
    );
    if (!advanced.ok) {
      if (advanced.reason === "position") {
        return userError(
          reply,
          400,
          "POSITION_BLOCK_MISMATCH",
          "阅读位置与已完成微组的精确终点不一致。"
        );
      }
      if (advanced.reason === "gap") {
        return userError(reply, 409, "PROGRESS_GAP", "必须先保存前一个文本微组。");
      }
      return userError(reply, 409, "BLOCK_CONTEXT_MISMATCH", "这个微组不属于该自定义文本会话。");
    }
    return { ok: true, readingPosition: advanced.readingPosition };
  });

  app.get("/api/v1/export/json", async (_request, reply) => {
    const timestamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Disposition", `attachment; filename="symtype-${timestamp}.json"`)
      .type("application/json")
      .send(database.exportJson());
  });
  app.get("/api/v1/export/csv", async (_request, reply) => {
    const timestamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Disposition", `attachment; filename="symtype-sessions-${timestamp}.csv"`)
      .type("text/csv; charset=utf-8")
      .send(`\uFEFF${database.exportCsv()}`);
  });
  app.get("/api/v1/export/sqlite", async (request, reply) => {
    const query = parseOrReply(runtimeCsrfQuerySchema, request.query, reply);
    if (!query) return;
    const token = request.headers["x-symtype-csrf"] ?? query?.csrf;
    if (token !== csrfToken) {
      return userError(reply, 403, "CSRF_FAILED", "安全令牌已过期，请刷新页面后重试。");
    }
    const backup = await database.createBackup("sqlite-export");
    const path = typeof backup.path === "string" ? backup.path : "";
    const filename = typeof backup.filename === "string" ? backup.filename : "symtype.sqlite3";
    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .type("application/vnd.sqlite3")
      .send(readFileSync(path));
  });
  app.get("/api/v1/backups", () => ({ backups: database.listBackups() }));
  app.post("/api/v1/backups", async (request, reply) => {
    const body = parseOrReply(runtimeCreateBackupRequestSchema, request.body ?? {}, reply);
    if (!body) return;
    return reply.status(201).send({ backup: await database.createBackup(body.reason) });
  });
  app.post("/api/v1/import/preview", { bodyLimit: 100_000_000 }, async (request, reply) => {
    const body = parseOrReply(runtimeJsonBackupSchema, request.body, reply);
    if (!body) return;
    const validation = database.validateJsonBackup(body);
    if (!validation.ok)
      return userError(reply, 400, "INVALID_BACKUP", validation.error ?? "备份无效。");
    return validation;
  });
  app.post("/api/v1/import/commit", { bodyLimit: 100_000_000 }, async (request, reply) => {
    const body = parseOrReply(runtimeJsonBackupSchema, request.body, reply);
    if (!body) return;
    const validation = database.validateJsonBackup(body);
    if (!validation.ok)
      return userError(reply, 400, "INVALID_BACKUP", validation.error ?? "备份无效。");
    return database.restoreJsonBackup(body);
  });
  app.post("/api/v1/import/sqlite/preview", { bodyLimit: 500_000_000 }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return userError(reply, 400, "INVALID_SQLITE_BODY", "请直接上传 SQLite 备份文件。");
    }
    const staged = database.stageSqliteBackup(request.body);
    if (!staged.ok) {
      return userError(reply, 400, "INVALID_BACKUP", staged.error ?? "SQLite 备份无效。");
    }
    return staged;
  });
  app.post("/api/v1/import/sqlite/commit", async (request, reply) => {
    const body = parseOrReply(runtimeSqliteCommitRequestSchema, request.body, reply);
    if (!body) return;
    return database.restoreStagedSqliteBackup(body.token);
  });
  const readDiagnostics = () => ({
    integrity: database.integrityCheck(),
    schemaVersion: database.getSchemaVersion(),
    databaseFile: basename(config.databasePath)
  });
  app.get("/api/v1/diagnostics", readDiagnostics);
  app.post("/api/v1/diagnostics/snapshot", (_request, reply) =>
    reply.status(201).send({
      ...readDiagnostics(),
      diagnosticPath: database.writeDiagnosticSnapshot()
    })
  );

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/",
      wildcard: false,
      decorateReply: true
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return userError(reply, 404, "ROUTE_NOT_FOUND", "接口不存在。");
    }
    if (existsSync(config.webDist)) return reply.type("text/html").sendFile("index.html");
    return userError(reply, 503, "WEB_NOT_BUILT", "前端产物尚未构建，请运行 npm run build。");
  });

  app.addHook("onClose", () => {
    database.close();
  });

  return { app, database, csrfToken };
}
