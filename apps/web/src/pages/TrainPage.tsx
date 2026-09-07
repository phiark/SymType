import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCustomTextContent, runtimeCustomTextContentSchema } from "@symtype/shared";
import {
  Braces,
  CaseSensitive,
  CheckCircle2,
  ChevronRight,
  FileText,
  Fingerprint,
  Hash,
  Keyboard,
  Languages,
  LifeBuoy,
  LockKeyhole,
  RotateCcw,
  Sigma,
  TextCursorInput,
  Upload,
  X
} from "lucide-react";
import { useNavigate, useOutletContext } from "react-router-dom";

import { api } from "../api";
import { PageHeader, SegmentedControl } from "../components/ui";
import { userErrorText } from "../error-presentation";
import { activeKeyboardLayout, focusCharactersForScopes } from "../keyboard";
import { trainingModeLabels } from "../training-labels";
import type { BootstrapData, CustomTextRecord, TraditionalProgress } from "../types";

const modes = [
  {
    id: "smart",
    name: trainingModeLabels.get("smart"),
    detail: "根据你的表现安排重点，再用自然文本巩固",
    icon: Sigma,
    recommended: true
  },
  {
    id: "traditional",
    name: trainingModeLabels.get("traditional"),
    detail: "主页键、行区、手指区、数字、符号逐级解锁",
    icon: Keyboard
  },
  {
    id: "rescue",
    name: trainingModeLabels.get("rescue"),
    detail: "选择一个键、组合、手指或区域做 2–5 分钟聚焦",
    icon: LifeBuoy
  },
  {
    id: "common-english",
    name: trainingModeLabels.get("common-english"),
    detail: "按频率与难度组合自然单词和短句",
    icon: Languages
  },
  {
    id: "pseudowords",
    name: trainingModeLabels.get("pseudowords"),
    detail: "可读但明确标注的英文形态伪词",
    icon: Fingerprint
  },
  {
    id: "data-entry",
    name: trainingModeLabels.get("data-entry"),
    detail: "虚构日期、时间、金额、百分比和表格片段",
    icon: Hash
  },
  {
    id: "punctuation",
    name: trainingModeLabels.get("punctuation"),
    detail: "英文标点和可选的代码符号",
    icon: TextCursorInput
  },
  {
    id: "shift",
    name: trainingModeLabels.get("shift"),
    detail: "首字母、缩写、标识符与 Shift 侧别",
    icon: CaseSensitive
  },
  {
    id: "source-code",
    name: trainingModeLabels.get("source-code"),
    detail: "原创 JavaScript、TypeScript、JSON、HTML 与 CSS",
    icon: Braces
  },
  {
    id: "custom",
    name: trainingModeLabels.get("custom"),
    detail: "粘贴或导入受支持纯文本；由本机解析",
    icon: Upload
  },
  {
    id: "long-form",
    name: trainingModeLabels.get("long-form"),
    detail: "原创或公共领域节选；导入的长文可保存阅读位置",
    icon: FileText
  },
  {
    id: "calibration",
    name: trainingModeLabels.get("calibration"),
    detail: "分区域取样，更新建议起点",
    icon: Sigma
  }
] as const;

const filters = [
  "食指区",
  "其他区",
  "左小指",
  "左无名指",
  "左中指",
  "左食指",
  "右食指",
  "右中指",
  "右无名指",
  "右小指",
  "左手",
  "右手",
  "字母",
  "数字",
  "符号",
  "大小写"
];

interface TraditionalStage {
  id: string;
  name: string;
  detail: string;
  scopeLabels: string[];
  characters: (layout: ReturnType<typeof activeKeyboardLayout>) => string[];
}

const fingerOptions = [
  ["left-pinky", "左小指"],
  ["left-ring", "左无名指"],
  ["left-middle", "左中指"],
  ["left-index", "左食指"],
  ["right-index", "右食指"],
  ["right-middle", "右中指"],
  ["right-ring", "右无名指"],
  ["right-pinky", "右小指"]
] as const;

const zoneOptions = [
  ["index-zone", "食指区"],
  ["other-zone", "其他手指区"],
  ["left-hand", "左手区"],
  ["right-hand", "右手区"],
  ["top-row", "上排字母"],
  ["home-row", "主页排"],
  ["bottom-row", "下排字母"],
  ["number-row", "数字行"],
  ["symbol-zone", "标点与符号"],
  ["case-zone", "大小写 / Shift"]
] as const;

function printable(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

const traditionalStages: TraditionalStage[] = [
  {
    id: "home",
    name: "主页键",
    detail: "从 ASDF、JKL 与分号建立稳定回位。",
    scopeLabels: ["字母", "符号"],
    characters: (layout) =>
      printable(
        layout
          .filter(
            (key) =>
              key.row === "home" &&
              key.unshifted != null &&
              ["a", "s", "d", "f", "j", "k", "l", ";"].includes(key.unshifted)
          )
          .map((key) => key.unshifted)
      )
  },
  {
    id: "index",
    name: "食指区",
    detail: "集中覆盖 Symmetric 左右食指边界键。",
    scopeLabels: ["食指区", "字母"],
    characters: (layout) =>
      printable(
        layout
          .filter((key) => key.category === "letter" && key.finger.endsWith("index"))
          .map((key) => key.unshifted)
      )
  },
  {
    id: "other",
    name: "其他手指",
    detail: "练习除左右食指以外的字母键区。",
    scopeLabels: ["其他区", "字母"],
    characters: (layout) =>
      printable(
        layout
          .filter((key) => key.category === "letter" && !key.finger.endsWith("index"))
          .map((key) => key.unshifted)
      )
  },
  {
    id: "top",
    name: "上排",
    detail: "在完整上排字母中保持手指分区与节奏。",
    scopeLabels: ["字母"],
    characters: (layout) =>
      printable(
        layout
          .filter((key) => key.row === "top" && key.category === "letter")
          .map((key) => key.unshifted)
      )
  },
  {
    id: "bottom",
    name: "下排",
    detail: "巩固下排跨行移动与食指边界。",
    scopeLabels: ["字母"],
    characters: (layout) =>
      printable(
        layout
          .filter((key) => key.row === "bottom" && key.category === "letter")
          .map((key) => key.unshifted)
      )
  },
  {
    id: "numbers",
    name: "数字",
    detail: "按 Symmetric 数字行分区输入 0–9。",
    scopeLabels: ["数字"],
    characters: (layout) =>
      printable(layout.filter((key) => key.category === "number").map((key) => key.unshifted))
  },
  {
    id: "symbols",
    name: "符号",
    detail: "覆盖标点及数字行 Shift 符号。",
    scopeLabels: ["符号"],
    characters: (layout) =>
      printable(
        layout.flatMap((key) =>
          key.category === "symbol"
            ? [key.unshifted, key.shifted]
            : key.category === "number"
              ? [key.shifted]
              : []
        )
      )
  },
  {
    id: "shift",
    name: "Shift / 大小写",
    detail: "用目标字母相反侧 Shift 完成大小写切换。",
    scopeLabels: ["大小写"],
    characters: (layout) =>
      printable(layout.filter((key) => key.category === "letter").map((key) => key.shifted))
  }
];

function validProgress(
  data: TraditionalProgress | undefined
): Map<string, TraditionalProgress["stages"][number]> {
  const result = new Map<string, TraditionalProgress["stages"][number]>();
  if (!Array.isArray(data?.stages)) return result;
  for (const stage of data.stages) {
    if (
      traditionalStages.some((definition) => definition.id === stage.id) &&
      typeof stage.completed === "boolean" &&
      typeof stage.unlocked === "boolean"
    ) {
      result.set(stage.id, stage);
    }
  }
  return result;
}

export function TrainPage() {
  const { bootstrap } = useOutletContext<{ bootstrap: BootstrapData }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState("10");
  const [bias, setBias] = useState<"accuracy" | "balanced" | "speed">(
    bootstrap.settings.trainingBias
  );
  const [selectedFilters, setSelectedFilters] = useState(new Set<string>());
  const [customOpen, setCustomOpen] = useState(false);
  const [traditionalOpen, setTraditionalOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("我的本地文本");
  const [customContent, setCustomContent] = useState("");
  const [customType, setCustomType] = useState<"txt" | "md" | "json" | "js" | "ts">("txt");
  const [includeInModel, setIncludeInModel] = useState(false);
  const [customError, setCustomError] = useState("");
  const [customSaving, setCustomSaving] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueKind, setRescueKind] = useState<"key" | "bigram" | "finger" | "zone">("key");
  const [rescueValue, setRescueValue] = useState("c");
  const [rescueDuration, setRescueDuration] = useState(3);
  const [rescueError, setRescueError] = useState("");
  const layout = activeKeyboardLayout(bootstrap);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (traditionalOpen || rescueOpen || customOpen) {
      panelRef.current
        ?.querySelector<HTMLElement>(
          ".traditional-panel h2, .rescue-panel h2, .custom-text-panel h2"
        )
        ?.focus();
    }
  }, [traditionalOpen, rescueOpen, customOpen]);

  const customTextsQuery = useQuery({
    queryKey: ["custom-texts"],
    queryFn: () => api.get<{ texts: CustomTextRecord[] }>("/api/v1/custom-texts"),
    enabled: customOpen,
    retry: false
  });
  const traditionalQuery = useQuery({
    queryKey: ["traditional-progress"],
    queryFn: () => api.get<TraditionalProgress>("/api/v1/traditional-progress"),
    enabled: traditionalOpen,
    retry: false
  });
  const progress = validProgress(traditionalQuery.data);

  const closePanelsExcept = (panel: "custom" | "rescue" | "traditional") => {
    setCustomOpen(panel === "custom");
    setRescueOpen(panel === "rescue");
    setTraditionalOpen(panel === "traditional");
  };

  const closePanels = () => {
    setCustomOpen(false);
    setRescueOpen(false);
    setTraditionalOpen(false);
    panelTriggerRef.current?.focus();
  };

  const start = (mode: string, trigger: HTMLButtonElement) => {
    panelTriggerRef.current = trigger;
    if (mode === "custom") {
      closePanelsExcept("custom");
      return;
    }
    if (mode === "rescue") {
      setRescueError("");
      closePanelsExcept("rescue");
      return;
    }
    if (mode === "traditional") {
      closePanelsExcept("traditional");
      return;
    }
    const scopes = Array.from(selectedFilters);
    const focus = focusCharactersForScopes(scopes, layout).join("");
    void navigate(
      `/train/session?mode=${mode}&duration=${duration}&bias=${bias}&focus=${encodeURIComponent(focus)}&scope=${encodeURIComponent(scopes.join(","))}`
    );
  };

  const startTraditional = (stage: TraditionalStage) => {
    const characters = [...new Set(stage.characters(layout))].join("");
    if (!characters) return;
    void navigate(
      `/train/session?mode=traditional&stage=${stage.id}&duration=${duration}&bias=${bias}&focus=${encodeURIComponent(characters)}&scope=${encodeURIComponent(stage.scopeLabels.join(","))}&label=${encodeURIComponent(`传统课程 ${traditionalStages.indexOf(stage) + 1}/8 · ${stage.name}`)}`
    );
  };

  const startRescue = () => {
    let focusValue = rescueValue.trim();
    if (rescueKind === "finger") {
      focusValue = layout
        .filter((key) => key.finger === rescueValue)
        .map((key) => key.unshifted ?? "")
        .filter(Boolean)
        .join("");
    } else if (rescueKind === "zone") {
      focusValue = layout
        .flatMap((key) => {
          const included =
            (rescueValue === "index-zone" && key.finger.endsWith("index")) ||
            (rescueValue === "other-zone" &&
              key.finger !== "thumb" &&
              !key.finger.endsWith("index")) ||
            (rescueValue === "left-hand" && key.hand === "left") ||
            (rescueValue === "right-hand" && key.hand === "right") ||
            (rescueValue === "top-row" && key.row === "top" && key.category === "letter") ||
            (rescueValue === "home-row" && key.row === "home") ||
            (rescueValue === "bottom-row" && key.row === "bottom" && key.category === "letter") ||
            (rescueValue === "number-row" && key.category === "number") ||
            (rescueValue === "symbol-zone" &&
              (key.category === "symbol" || key.category === "number")) ||
            (rescueValue === "case-zone" && key.category === "letter");
          if (!included) return [];
          if (rescueValue === "symbol-zone") {
            return [key.unshifted, key.shifted].filter((character): character is string =>
              Boolean(character && !/[a-z]/iu.test(character))
            );
          }
          if (rescueValue === "case-zone") return [key.unshifted, key.shifted];
          return [key.unshifted];
        })
        .filter((character): character is string => Boolean(character && character.trim()))
        .join("");
    }
    if (!focusValue) {
      setRescueError("请选择一个有可打印字符的聚焦目标。");
      return;
    }
    setRescueError("");
    void navigate(
      `/train/session?mode=rescue&duration=${rescueDuration}&bias=accuracy&focus=${encodeURIComponent(focusValue)}&label=${encodeURIComponent(`急救：${rescueKind} ${rescueValue}`)}`
    );
  };

  const updateCustomContent = (content: string) => {
    const normalized = normalizeCustomTextContent(content);
    setCustomContent(normalized);
    if (!normalized) {
      setCustomError("");
      return;
    }
    const parsed = runtimeCustomTextContentSchema.safeParse(normalized);
    setCustomError(parsed.success ? "" : (parsed.error.issues[0]?.message ?? "文本内容不受支持。"));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (!extension || !["txt", "md", "json", "js", "ts"].includes(extension)) {
      setCustomError("仅支持 .txt、.md、.json、.js 和 .ts 纯文本文件。");
      return;
    }
    if (file.size > 1_000_000) {
      setCustomError("文件超过 1 MB 上限；请拆分后再导入。");
      return;
    }
    setCustomTitle(file.name.replace(/\.[^.]+$/u, ""));
    setCustomType(extension as typeof customType);
    updateCustomContent(await file.text());
  };

  const customSessionUrl = (text: CustomTextRecord) =>
    `/train/session?mode=custom&duration=${duration}&bias=${bias}&customTextId=${text.id}&includeInModel=${text.include_in_model ? "1" : "0"}`;

  const continueCustom = (text: CustomTextRecord) => {
    if (text.reading_position >= text.character_count) return;
    setCustomError("");
    void navigate(customSessionUrl(text));
  };

  const startCustom = async () => {
    const parsedContent = runtimeCustomTextContentSchema.safeParse(customContent);
    if (!parsedContent.success) {
      setCustomError(parsedContent.error.issues[0]?.message ?? "请粘贴或导入至少一个可练习字符。");
      return;
    }
    setCustomSaving(true);
    try {
      const response = await api.post<{ text: CustomTextRecord }>("/api/v1/custom-texts", {
        title: customTitle,
        content: parsedContent.data,
        fileType: customType,
        includeInModel
      });
      await queryClient.invalidateQueries({ queryKey: ["custom-texts"] });
      void navigate(customSessionUrl(response.text));
    } catch (error) {
      setCustomError(userErrorText(error, "save"));
    } finally {
      setCustomSaving(false);
    }
  };

  return (
    <div className="page" ref={panelRef}>
      <PageHeader
        eyebrow="训练"
        title="选择今天的训练方式"
        description="从智能课程开始，或选择你想练习的内容。"
      />
      <section className="training-controls panel">
        <SegmentedControl
          label="时长"
          value={duration}
          onChange={setDuration}
          options={[5, 10, 15, 20].map((value) => ({
            value: String(value),
            label: `${value} 分钟`
          }))}
        />
        <SegmentedControl
          label="训练取向"
          value={bias}
          onChange={setBias}
          options={[
            { value: "accuracy", label: "准确优先" },
            { value: "balanced", label: "平衡" },
            { value: "speed", label: "速度挑战" }
          ]}
        />
        <details className="scope-disclosure">
          <summary>
            练习范围{" "}
            <span>
              {selectedFilters.size
                ? Array.from(selectedFilters).join(" · ")
                : "全部键区 · 按需缩小范围"}
            </span>
          </summary>
          <fieldset className="filter-field">
            <legend>可选范围</legend>
            <div className="filter-chips">
              {filters.map((filter) => (
                <button
                  type="button"
                  key={filter}
                  aria-pressed={selectedFilters.has(filter)}
                  className={selectedFilters.has(filter) ? "is-active" : ""}
                  onClick={() =>
                    setSelectedFilters((current) => {
                      const next = new Set(current);
                      if (next.has(filter)) next.delete(filter);
                      else next.add(filter);
                      return next;
                    })
                  }
                >
                  {filter}
                </button>
              ))}
            </div>
          </fieldset>
        </details>
      </section>

      {traditionalOpen ? (
        <section className="traditional-panel panel" aria-labelledby="traditional-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Keyboard size={15} />8 阶传统课程
              </p>
              <h2 id="traditional-title" tabIndex={-1}>
                按顺序建立键区，再迁移到完整输入
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭传统课程"
              onClick={closePanels}
            >
              <X size={17} />
            </button>
          </div>
          {traditionalQuery.isError ? (
            <div className="progress-read-error" role="alert">
              <p>无法读取课程解锁进度。为避免伪造完成状态，现在只开放第 1 阶。</p>
              <button
                type="button"
                className="text-button"
                onClick={() => void traditionalQuery.refetch()}
              >
                <RotateCcw size={15} />
                重试读取
              </button>
            </div>
          ) : traditionalQuery.isLoading ? (
            <p className="progress-read-note" role="status">
              正在读取本机解锁进度…
            </p>
          ) : null}
          <ol className="traditional-ladder" aria-label="传统课程阶梯">
            {traditionalStages.map((stage, index) => {
              const saved = progress.get(stage.id);
              const completed = saved?.completed === true;
              const unlocked = completed || (saved ? saved.unlocked : index === 0);
              const characters = [...new Set(stage.characters(layout))].join("");
              return (
                <li
                  key={stage.id}
                  data-state={completed ? "complete" : unlocked ? "open" : "locked"}
                >
                  <span className="traditional-step">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{stage.name}</strong>
                    <p>{stage.detail}</p>
                    <small>{characters || "当前映射没有可用字符"}</small>
                  </div>
                  <span className="traditional-status">
                    {completed ? (
                      <>
                        <CheckCircle2 size={16} />
                        已完成
                      </>
                    ) : unlocked ? (
                      <>可开始</>
                    ) : (
                      <>
                        <LockKeyhole size={15} />
                        完成上一阶后解锁
                      </>
                    )}
                  </span>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={!unlocked || !characters}
                    onClick={() => startTraditional(stage)}
                  >
                    {completed ? "再练一次" : "开始"}
                    <ChevronRight size={15} />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {rescueOpen ? (
        <section className="rescue-panel panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <LifeBuoy size={15} />
                弱点急救
              </p>
              <h2 tabIndex={-1}>定义一个 2–5 分钟聚焦目标</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭弱点急救"
              onClick={closePanels}
            >
              <X size={17} />
            </button>
          </div>
          <div className="rescue-fields">
            <label>
              <span>目标类型</span>
              <select
                value={rescueKind}
                onChange={(event) => {
                  const value = event.target.value as typeof rescueKind;
                  setRescueKind(value);
                  setRescueError("");
                  setRescueValue(
                    value === "finger"
                      ? "left-index"
                      : value === "zone"
                        ? "index-zone"
                        : value === "bigram"
                          ? "ct"
                          : "c"
                  );
                }}
              >
                <option value="key">单键</option>
                <option value="bigram">二元组合</option>
                <option value="finger">映射手指</option>
                <option value="zone">映射区域</option>
              </select>
            </label>
            <label>
              <span>聚焦目标</span>
              {rescueKind === "finger" || rescueKind === "zone" ? (
                <select
                  value={rescueValue}
                  onChange={(event) => {
                    setRescueValue(event.target.value);
                    setRescueError("");
                  }}
                >
                  {(rescueKind === "finger" ? fingerOptions : zoneOptions).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={rescueValue}
                  maxLength={rescueKind === "bigram" ? 2 : 1}
                  onChange={(event) => {
                    setRescueValue(event.target.value);
                    setRescueError("");
                  }}
                />
              )}
            </label>
            <label>
              <span>时长：{rescueDuration} 分钟</span>
              <input
                type="range"
                min={2}
                max={5}
                value={rescueDuration}
                onChange={(event) => setRescueDuration(Number(event.target.value))}
              />
            </label>
            <button className="button button--primary" type="button" onClick={startRescue}>
              开始急救组 <ChevronRight size={16} />
            </button>
          </div>
          {rescueError ? (
            <p className="error-notice" role="alert">
              {rescueError}
            </p>
          ) : null}
          <p>该范围会被严格保留；系统会在范围内轮换组合并安排短间隔，避免连续轰炸同一个目标。</p>
        </section>
      ) : null}

      {customOpen ? (
        <section className="custom-text-panel panel" aria-labelledby="custom-text-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Upload size={15} />
                本地自定义文本
              </p>
              <h2 id="custom-text-title" tabIndex={-1}>
                继续本地文本，或导入一份新内容
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭自定义文本"
              onClick={closePanels}
            >
              <X size={17} />
            </button>
          </div>
          <div className="saved-texts" aria-label="已保存的自定义文本">
            <div className="saved-texts__heading">
              <strong>已保存文本</strong>
              <span>进度已保存在本机</span>
            </div>
            {customTextsQuery.isLoading ? (
              <p className="progress-read-note" role="status">
                正在读取本地文本进度…
              </p>
            ) : customTextsQuery.isError ? (
              <div className="progress-read-error" role="alert">
                <p>{userErrorText(customTextsQuery.error, "load")}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void customTextsQuery.refetch()}
                >
                  <RotateCcw size={15} />
                  重试读取
                </button>
              </div>
            ) : customTextsQuery.data?.texts.length ? (
              <ul className="saved-text-list">
                {customTextsQuery.data.texts.map((text) => {
                  const total = Math.max(0, Number(text.character_count) || 0);
                  const position = Math.min(total, Math.max(0, Number(text.reading_position) || 0));
                  const percentage = total ? Math.round((position / total) * 100) : 0;
                  const complete = total > 0 && position >= total;
                  return (
                    <li key={text.id}>
                      <div className="saved-text-meta">
                        <strong>{text.title}</strong>
                        <span>
                          {String(text.file_type || "txt").toUpperCase()} · {total.toLocaleString()}{" "}
                          字符 · {Number(text.word_count || 0).toLocaleString()} 词
                        </span>
                      </div>
                      <div className="saved-text-progress">
                        <span>
                          {complete
                            ? "已读完"
                            : `${position.toLocaleString()} / ${total.toLocaleString()} 字符`}
                        </span>
                        <strong>{percentage}%</strong>
                        <i aria-hidden="true">
                          <b style={{ width: `${percentage}%` }} />
                        </i>
                      </div>
                      <span className="model-status" data-enabled={Boolean(text.include_in_model)}>
                        {text.include_in_model ? "计入模型" : "不计入模型"}
                      </span>
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={total === 0 || complete}
                        onClick={() => continueCustom(text)}
                      >
                        {complete ? "已完成" : "继续训练"}
                        <ChevronRight size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="saved-text-empty">
                还没有保存的文本。下面导入的第一份内容会保存在本机。
              </p>
            )}
          </div>
          <div className="custom-text-fields">
            <label>
              <span>标题</span>
              <input
                value={customTitle}
                maxLength={160}
                onChange={(event) => setCustomTitle(event.target.value)}
              />
            </label>
            <label className="file-drop">
              <Upload size={18} />
              <span>导入 .txt / .md / .json / .js / .ts</span>
              <input
                className="sr-only"
                type="file"
                accept=".txt,.md,.json,.js,.ts,text/plain,application/json"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
            </label>
            <label className="custom-textarea">
              <span>内容</span>
              <textarea
                value={customContent}
                maxLength={1_000_000}
                rows={9}
                spellCheck={false}
                onChange={(event) => updateCustomContent(event.target.value)}
                placeholder="Paste local training text here…"
              />
              <small>
                {customContent.length.toLocaleString()} 字符 ·{" "}
                {customContent.trim()
                  ? customContent.trim().split(/\s+/u).length.toLocaleString()
                  : 0}{" "}
                词 · {customType.toUpperCase()}
              </small>
            </label>
            <label className="model-opt-in">
              <input
                type="checkbox"
                checked={includeInModel}
                onChange={(event) => setIncludeInModel(event.target.checked)}
              />
              <span>
                <strong>计入长期能力模型</strong>
                <small>关闭时仍保存课程事件，但不用于长期弱点调度。</small>
              </span>
            </label>
            <p className="safety-note">
              不要输入真实密码、API
              key、私钥、钱包助记词或恢复短语。内容只在本机按纯文本解析和显示。
            </p>
            {customError ? (
              <p className="error-notice" role="alert">
                {customError}
              </p>
            ) : null}
            <div className="custom-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setCustomContent("");
                  setCustomError("");
                }}
              >
                清空
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={customSaving || !customContent.trim()}
                onClick={() => void startCustom()}
              >
                {customSaving ? "正在保存…" : "保存并开始训练"}
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {[
        {
          title: "跟着计划练",
          detail: "让每轮练习有一个明确目标",
          ids: ["smart", "traditional", "rescue"]
        },
        {
          title: "选择练习内容",
          detail: "把键区能力用到日常输入",
          ids: [
            "common-english",
            "pseudowords",
            "data-entry",
            "punctuation",
            "shift",
            "source-code",
            "custom",
            "long-form",
            "calibration"
          ]
        }
      ].map((group) => (
        <section className="mode-section" key={group.title} aria-label={group.title}>
          <div className="panel-heading">
            <h2>{group.title}</h2>
            <p>{group.detail}</p>
          </div>
          <div className="mode-grid">
            {modes
              .filter((mode) => group.ids.includes(mode.id))
              .map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    className={`mode-card${mode.id === "smart" ? " mode-card--recommended" : ""}`}
                    type="button"
                    key={mode.id}
                    onClick={(event) => start(mode.id, event.currentTarget)}
                  >
                    <span className="mode-card__icon">
                      <Icon size={21} />
                    </span>
                    <span>
                      <span className="mode-card__title">
                        {mode.name}
                        {"recommended" in mode && mode.recommended ? <small>推荐</small> : null}
                      </span>
                      <span className="mode-card__detail">{mode.detail}</span>
                    </span>
                    <ChevronRight className="mode-card__arrow" size={18} />
                  </button>
                );
              })}
          </div>
        </section>
      ))}
      <p className="safety-note">
        导入或粘贴内容时，请勿输入真实密码、API key、私钥、钱包助记词或恢复短语。
      </p>
    </div>
  );
}
