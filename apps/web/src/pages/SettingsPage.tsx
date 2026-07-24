import { useMemo, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import {
  runtimeAdvancedWeightKeys,
  runtimeDefaultAdvancedWeights,
  runtimeSettingsLimits
} from "@symtype/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  ChevronRight,
  Database,
  Download,
  Keyboard,
  Palette,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Target,
  Upload,
  Volume2
} from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { api } from "../api";
import { soundEngine } from "../audio";
import { EmptyState, PageHeader } from "../components/ui";
import { userErrorText } from "../error-presentation";
import type { AppSettings, BackupRecord, BootstrapData, KeyboardMappingRecord } from "../types";

const sections = [
  { id: "appearance", label: "外观与辅助", icon: Palette },
  { id: "typing", label: "输入与训练", icon: SlidersHorizontal },
  { id: "sound", label: "声音", icon: Volume2 },
  { id: "keyboard", label: "键盘映射", icon: Keyboard },
  { id: "goals", label: "目标与算法", icon: Target },
  { id: "data", label: "数据与备份", icon: Database }
];

const fingers = [
  "left-pinky",
  "left-ring",
  "left-middle",
  "left-index",
  "right-index",
  "right-middle",
  "right-ring",
  "right-pinky",
  "thumb"
];

function handForFinger(finger: string): "left" | "right" | "thumb" {
  if (finger === "thumb") return "thumb";
  return finger.startsWith("right-") ? "right" : "left";
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <Switch.Root
        className="switch"
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
      >
        <Switch.Thumb />
      </Switch.Root>
    </label>
  );
}

export function SettingsPage() {
  const { bootstrap } = useOutletContext<{ bootstrap: BootstrapData }>();
  const [settings, setSettings] = useState<AppSettings>(bootstrap.settings);
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState("appearance");
  const [editRevision, setEditRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const editRevisionRef = useRef(0);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"status" | "error">("status");
  const [goal, setGoal] = useState({
    dailyMinutes: bootstrap.goal.daily_minutes,
    targetWpm: bootstrap.goal.target_wpm,
    minimumAccuracy: bootstrap.goal.minimum_accuracy
  });
  const [layoutName, setLayoutName] = useState("我的 Symmetric 映射");
  const [selectedLayoutId, setSelectedLayoutId] = useState(settings.activeLayoutId);
  const [mappingDraft, setMappingDraft] = useState<KeyboardMappingRecord[] | null>(null);
  const [backupCandidate, setBackupCandidate] = useState<unknown>(null);
  const [sqliteRestoreToken, setSqliteRestoreToken] = useState<string | null>(null);
  const [backupPreview, setBackupPreview] = useState<{
    profiles: number;
    sessions: number;
    events: number;
  } | null>(null);
  const [downloadingSqlite, setDownloadingSqlite] = useState(false);
  const queryClient = useQueryClient();
  const backupsQuery = useQuery({
    queryKey: ["backups"],
    queryFn: () => api.get<{ backups: BackupRecord[] }>("/api/v1/backups")
  });
  const showMessage = (text: string, tone: "status" | "error" = "status") => {
    setMessage(text);
    setMessageTone(tone);
  };
  const markDirty = () => {
    const nextRevision = editRevisionRef.current + 1;
    editRevisionRef.current = nextRevision;
    setEditRevision(nextRevision);
  };
  const saved = editRevision === savedRevision;
  const saveMutation = useMutation({
    mutationFn: (draft: { settings: AppSettings; goal: typeof goal; revision: number }) =>
      api.put<{ settings: AppSettings }>("/api/v1/preferences", {
        settings: draft.settings,
        goal: draft.goal
      }),
    onSuccess: async (_response, draft) => {
      setSavedRevision(draft.revision);
      showMessage(
        editRevisionRef.current === draft.revision
          ? "设置与目标已安全保存在本机。"
          : "本次保存已完成；保存期间的新更改仍未保存。"
      );
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
    onError: (error) => showMessage(userErrorText(error, "save"), "error")
  });

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      soundEngine.configure(next);
      if (key === "theme") document.documentElement.dataset.theme = next.theme;
      if (key === "reducedMotion")
        document.documentElement.dataset.motion = next.reducedMotion ? "reduced" : "full";
      return next;
    });
    markDirty();
  };

  const visibleSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sections;
    const keywordMap: Record<string, string> = {
      appearance: "主题 动态 虚拟键盘 focus 光标 字号 行距",
      typing: "错误 backspace 平滑 准确 速度 训练",
      sound: "声音 音量 soft mechanical terminal 错误音 按键音",
      keyboard: "symmetric standard 映射 手指 qwerty shift",
      goals: "目标 wpm 准确率 算法 权重 实验",
      data: "sqlite csv json 导出 备份 恢复 数据"
    };
    return sections.filter((section) =>
      `${section.label} ${keywordMap[section.id] ?? ""}`.toLowerCase().includes(query)
    );
  }, [search]);

  const layouts = bootstrap.layouts;
  const selectedLayout = layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0];
  const mappings = mappingDraft ?? selectedLayout?.mappings ?? [];

  const createLayout = async () => {
    if (!selectedLayout) return;
    try {
      const result = await api.post<{ id: string }>("/api/v1/layouts", {
        name: layoutName,
        baseLayoutId: selectedLayout.id
      });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      setSelectedLayoutId(result.id);
      patch("activeLayoutId", result.id);
      showMessage("已复制为可编辑的自定义映射；完成逐键修改后，请保存映射和页面设置。");
    } catch (error) {
      showMessage(userErrorText(error, "save"), "error");
    }
  };

  const saveMappings = async () => {
    if (!selectedLayout || selectedLayout.preset !== "custom" || !mappingDraft) return;
    const normalized = mappingDraft.map((item) => {
      const finger = String(item.finger ?? "left-pinky");
      return {
        code: String(item.physical_code ?? item.code ?? ""),
        unshifted: String(item.unshifted ?? ""),
        shifted: String(item.shifted ?? ""),
        hand: handForFinger(finger),
        finger,
        row: String(item.keyboard_row ?? item.row ?? "home"),
        zone: finger,
        width: Number(item.key_width ?? item.width ?? 1)
      };
    });
    try {
      await api.put(`/api/v1/layouts/${selectedLayout.id}/mappings`, { mappings: normalized });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      setMappingDraft(null);
      showMessage("自定义映射内容已保存；再点击页面顶部“保存更改”即可启用并持久化选择。");
    } catch (error) {
      showMessage(userErrorText(error, "save"), "error");
    }
  };

  const previewFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 100_000_000) {
      showMessage("备份文件超过 100 MB 安全上限。", "error");
      return;
    }
    try {
      const isSqlite = /\.(sqlite3?|db)$/iu.test(file.name);
      if (isSqlite) {
        const result = await api.postRaw<{
          ok: true;
          token: string;
          summary: { profiles: number; sessions: number; events: number };
        }>("/api/v1/import/sqlite/preview", await file.arrayBuffer(), "application/vnd.sqlite3");
        setBackupCandidate(null);
        setSqliteRestoreToken(result.token);
        setBackupPreview(result.summary);
      } else {
        const candidate = JSON.parse(await file.text()) as unknown;
        const result = await api.post<{
          ok: true;
          summary: { profiles: number; sessions: number; events: number };
        }>("/api/v1/import/preview", candidate);
        setBackupCandidate(candidate);
        setSqliteRestoreToken(null);
        setBackupPreview(result.summary);
      }
      showMessage("备份校验通过。恢复前会自动备份当前数据。");
    } catch (error) {
      setBackupCandidate(null);
      setSqliteRestoreToken(null);
      setBackupPreview(null);
      showMessage(
        error instanceof SyntaxError
          ? "无法读取所选备份。当前数据未改变；请选择有效的 SymType 备份后重试。"
          : userErrorText(error, "restore"),
        "error"
      );
    }
  };

  const restore = async () => {
    if (!backupCandidate && !sqliteRestoreToken) return;
    const confirmation = window.confirm(
      "恢复会替换当前 SymType 数据。系统将先自动备份当前数据库。是否继续？"
    );
    if (!confirmation) return;
    try {
      if (sqliteRestoreToken) {
        await api.post("/api/v1/import/sqlite/commit", { token: sqliteRestoreToken });
      } else {
        await api.post("/api/v1/import/commit", backupCandidate);
      }
      showMessage("恢复完成；正在重新读取本机数据。 ");
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (error) {
      showMessage(userErrorText(error, "restore"), "error");
    }
  };

  const downloadSqlite = async () => {
    setDownloadingSqlite(true);
    try {
      const { blob, filename } = await api.download("/api/v1/export/sqlite");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename ?? "symtype.sqlite3";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      showMessage("完整备份已生成并开始下载。");
    } catch (error) {
      showMessage(userErrorText(error, "backup"), "error");
    } finally {
      setDownloadingSqlite(false);
    }
  };

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="设置"
        title="让 SymType 适合你的手与节奏"
        description="设置、映射与算法参数都安全保存在这台电脑。"
        action={
          <button
            className="button button--primary"
            type="button"
            disabled={saved || saveMutation.isPending}
            onClick={() =>
              saveMutation.mutate({
                settings,
                goal,
                revision: editRevisionRef.current
              })
            }
          >
            {saveMutation.isPending ? (
              "正在保存…"
            ) : saved ? (
              <>
                <Check size={16} />
                已保存
              </>
            ) : (
              "保存更改"
            )}
          </button>
        }
      />
      <div className="settings-search">
        <Search size={18} />
        <input
          type="search"
          placeholder="搜索设置，例如 Shift、声音、备份…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="搜索设置"
        />
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {search.trim()
          ? `找到 ${visibleSections.length} 个设置分组。`
          : `显示全部 ${sections.length} 个设置分组。`}
      </div>
      <div
        className="sr-only"
        role={messageTone === "error" ? "alert" : "status"}
        aria-live={messageTone === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {message}
      </div>
      {message ? (
        <button
          className="settings-message"
          type="button"
          aria-label={`关闭通知：${message}`}
          onClick={() => {
            setMessage("");
            setMessageTone("status");
          }}
        >
          <span>{message}</span>
          <small>点击关闭</small>
        </button>
      ) : null}
      {visibleSections.length ? (
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分组">
            {visibleSections.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                className={activeSection === id ? "is-active" : ""}
                key={id}
                onClick={() => {
                  setActiveSection(id);
                  document
                    .getElementById(`settings-${id}`)
                    ?.scrollIntoView({ behavior: settings.reducedMotion ? "auto" : "smooth" });
                }}
              >
                <Icon size={17} />
                <span>{label}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </nav>
          <div className="settings-sections">
            {visibleSections.some((item) => item.id === "appearance") ? (
              <section id="settings-appearance" className="settings-section">
                <div className="settings-section__header">
                  <Palette size={20} />
                  <div>
                    <h2>外观与辅助</h2>
                    <p>清晰焦点、系统字体和可控动态。</p>
                  </div>
                </div>
                <div className="settings-list">
                  <div className="setting-row">
                    <span>
                      <strong>主题</strong>
                      <small>浅色、深色或跟随系统</small>
                    </span>
                    <select
                      aria-label="主题"
                      value={settings.theme}
                      onChange={(event) =>
                        patch("theme", event.target.value as AppSettings["theme"])
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                  <ToggleRow
                    label="减少动态效果"
                    detail="尊重 prefers-reduced-motion，并关闭非必要移动"
                    checked={settings.reducedMotion}
                    onChange={(value) => patch("reducedMotion", value)}
                  />
                  <ToggleRow
                    label="显示虚拟键盘"
                    detail="训练中提示下一个物理键"
                    checked={settings.keyboardVisible}
                    onChange={(value) => patch("keyboardVisible", value)}
                  />
                  <ToggleRow
                    label="按手指着色"
                    detail="颜色之外始终保留文字提示"
                    checked={settings.keyboardFingerColors}
                    onChange={(value) => patch("keyboardFingerColors", value)}
                  />
                  <div className="setting-row">
                    <span>
                      <strong>训练字号</strong>
                      <small>{settings.fontSize}px</small>
                    </span>
                    <input
                      aria-label="训练字号"
                      type="range"
                      min={18}
                      max={52}
                      value={settings.fontSize}
                      onChange={(event) => patch("fontSize", Number(event.target.value))}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>行距</strong>
                      <small>{settings.lineHeight.toFixed(2)}</small>
                    </span>
                    <input
                      aria-label="训练行距"
                      type="range"
                      min={1.2}
                      max={2.2}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(event) => patch("lineHeight", Number(event.target.value))}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>光标样式</strong>
                      <small>训练文字中的当前位置</small>
                    </span>
                    <select
                      aria-label="光标样式"
                      value={settings.caretStyle}
                      onChange={(event) =>
                        patch("caretStyle", event.target.value as AppSettings["caretStyle"])
                      }
                    >
                      <option value="bar">竖线</option>
                      <option value="block">方块</option>
                      <option value="underline">下划线</option>
                    </select>
                  </div>
                </div>
              </section>
            ) : null}
            {visibleSections.some((item) => item.id === "typing") ? (
              <section id="settings-typing" className="settings-section">
                <div className="settings-section__header">
                  <SlidersHorizontal size={20} />
                  <div>
                    <h2>输入与训练</h2>
                    <p>错误处理不会改变已经显示的微组。</p>
                  </div>
                </div>
                <div className="settings-list">
                  <ToggleRow
                    label="遇错停止"
                    detail="错误时留在当前字符，直到键入正确"
                    checked={settings.stopOnError}
                    onChange={(value) => patch("stopOnError", value)}
                  />
                  <div className="setting-row">
                    <span>
                      <strong>Backspace 行为</strong>
                      <small>是否允许修正已输入字符</small>
                    </span>
                    <select
                      aria-label="Backspace 行为"
                      value={settings.backspaceMode}
                      onChange={(event) =>
                        patch("backspaceMode", event.target.value as AppSettings["backspaceMode"])
                      }
                    >
                      <option value="enabled">逐字符</option>
                      <option value="words">逐词</option>
                      <option value="disabled">禁用</option>
                    </select>
                  </div>
                  <ToggleRow
                    label="平滑滚动"
                    detail="关闭后使用即时滚动"
                    checked={settings.smoothScroll}
                    onChange={(value) => patch("smoothScroll", value)}
                  />
                  <div className="setting-row">
                    <span>
                      <strong>默认训练时长</strong>
                      <small>{settings.defaultDurationMinutes} 分钟</small>
                    </span>
                    <input
                      aria-label="默认训练时长"
                      type="range"
                      min={runtimeSettingsLimits.defaultDurationMinutes.min}
                      max={runtimeSettingsLimits.defaultDurationMinutes.max}
                      step={runtimeSettingsLimits.defaultDurationMinutes.step}
                      value={settings.defaultDurationMinutes}
                      onChange={(event) =>
                        patch("defaultDurationMinutes", Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>训练取向</strong>
                      <small>速度挑战仍保护最低准确率</small>
                    </span>
                    <select
                      aria-label="训练取向"
                      value={settings.trainingBias}
                      onChange={(event) =>
                        patch("trainingBias", event.target.value as AppSettings["trainingBias"])
                      }
                    >
                      <option value="accuracy">准确优先</option>
                      <option value="balanced">平衡</option>
                      <option value="speed">速度挑战</option>
                    </select>
                  </div>
                </div>
              </section>
            ) : null}
            {visibleSections.some((item) => item.id === "sound") ? (
              <section id="settings-sound" className="settings-section">
                <div className="settings-section__header">
                  <Volume2 size={20} />
                  <div>
                    <h2>声音</h2>
                    <p>复用一个 AudioContext，在本机实时合成短 envelope。</p>
                  </div>
                </div>
                <div className="settings-list">
                  <ToggleRow
                    label="声音反馈"
                    detail="Safari 需要在点击后解锁"
                    checked={settings.soundEnabled}
                    onChange={(value) => patch("soundEnabled", value)}
                  />
                  <div className="setting-row">
                    <span>
                      <strong>音色</strong>
                      <small>三套克制的本地合成音</small>
                    </span>
                    <select
                      aria-label="音色"
                      value={settings.soundTheme}
                      onChange={(event) =>
                        patch("soundTheme", event.target.value as AppSettings["soundTheme"])
                      }
                    >
                      <option value="soft">Soft</option>
                      <option value="mechanical">Mechanical</option>
                      <option value="terminal">Terminal</option>
                    </select>
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>播放范围</strong>
                      <small>可只保留需要的反馈</small>
                    </span>
                    <select
                      aria-label="声音播放范围"
                      value={settings.soundMode}
                      onChange={(event) =>
                        patch("soundMode", event.target.value as AppSettings["soundMode"])
                      }
                    >
                      <option value="all">全部声音</option>
                      <option value="keys">仅按键音</option>
                      <option value="errors">仅错误/警报</option>
                    </select>
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>音量</strong>
                      <small>{Math.round(settings.volume * 100)}%</small>
                    </span>
                    <input
                      aria-label="音量"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={settings.volume}
                      onChange={(event) => patch("volume", Number(event.target.value))}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>试听</strong>
                      <small>点击同时尝试解锁 Safari 音频</small>
                    </span>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() =>
                        void soundEngine.unlock().then((ok) => {
                          if (ok) {
                            soundEngine.play("key");
                            setTimeout(() => soundEngine.play("error"), 130);
                          } else showMessage("浏览器未允许声音，请检查页面声音权限。 ", "error");
                        })
                      }
                    >
                      <Volume2 size={16} />
                      播放示例
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
            {visibleSections.some((item) => item.id === "keyboard") ? (
              <section id="settings-keyboard" className="settings-section settings-section--wide">
                <div className="settings-section__header">
                  <Keyboard size={20} />
                  <div>
                    <h2>键盘映射</h2>
                    <p>字符布局始终是 ANSI US QWERTY；这里只编辑建议手指分区。</p>
                  </div>
                </div>
                <div className="layout-selector">
                  {layouts.map((layout) => (
                    <button
                      type="button"
                      key={layout.id}
                      className={selectedLayoutId === layout.id ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedLayoutId(layout.id);
                        setMappingDraft(null);
                        patch("activeLayoutId", layout.id);
                      }}
                    >
                      <strong>{layout.name}</strong>
                      <small>
                        {layout.preset === "custom" ? "自定义" : `${layout.preset} 预设`}
                      </small>
                      {selectedLayoutId === layout.id ? <Check size={16} /> : null}
                    </button>
                  ))}
                </div>
                <div className="copy-layout">
                  <input
                    value={layoutName}
                    onChange={(event) => setLayoutName(event.target.value)}
                    aria-label="自定义映射名称"
                  />
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void createLayout()}
                  >
                    复制当前预设后编辑
                  </button>
                </div>
                {selectedLayout?.preset === "custom" ? (
                  <>
                    <div className="mapping-table">
                      <div className="mapping-row mapping-row--head">
                        <span>物理键</span>
                        <span>字符</span>
                        <span>手</span>
                        <span>手指</span>
                        <span>区域</span>
                      </div>
                      {mappings.map((mapping, index) => {
                        const mappingCode =
                          mapping.physical_code ??
                          (typeof mapping.code === "string" ? mapping.code : String(index));
                        return (
                          <div className="mapping-row" key={String(mapping.physical_code ?? index)}>
                            <strong>{mappingCode}</strong>
                            <code>
                              {String(mapping.unshifted ?? "")}
                              {mapping.shifted ? ` / ${String(mapping.shifted)}` : ""}
                            </code>
                            <span
                              className="mapping-derived"
                              aria-label={`${mappingCode} 的建议手`}
                            >
                              {handForFinger(String(mapping.finger ?? "left-pinky")) === "left"
                                ? "左手"
                                : handForFinger(String(mapping.finger ?? "left-pinky")) === "right"
                                  ? "右手"
                                  : "拇指"}
                            </span>
                            <select
                              aria-label={`${mappingCode} 的建议手指`}
                              value={String(mapping.finger ?? "left-pinky")}
                              onChange={(event) => {
                                const finger = event.target.value;
                                setMappingDraft(
                                  mappings.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          finger,
                                          zone: finger,
                                          hand: handForFinger(finger)
                                        }
                                      : item
                                  )
                                );
                              }}
                            >
                              {fingers.map((finger) => (
                                <option value={finger} key={finger}>
                                  {finger}
                                </option>
                              ))}
                            </select>
                            <span
                              className="mapping-derived"
                              aria-label={`${mappingCode} 的训练区域`}
                            >
                              {String(mapping.finger ?? "left-pinky")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={!mappingDraft}
                      onClick={() => void saveMappings()}
                    >
                      保存逐键映射
                    </button>
                  </>
                ) : (
                  <p className="inline-notice">
                    内置预设只读。先复制，再逐键修改；C、B、N、M、数字和 Shift 边界都有回归测试。
                  </p>
                )}
              </section>
            ) : null}
            {visibleSections.some((item) => item.id === "goals") ? (
              <section id="settings-goals" className="settings-section">
                <div className="settings-section__header">
                  <Target size={20} />
                  <div>
                    <h2>目标与算法</h2>
                    <p>阈值和权重是可检验的工程假设，不是科学最优常数。</p>
                  </div>
                </div>
                <div className="settings-list">
                  <div className="setting-row">
                    <span>
                      <strong>每日目标</strong>
                      <small>{goal.dailyMinutes} 分钟</small>
                    </span>
                    <input
                      aria-label="每日训练目标"
                      type="range"
                      min={runtimeSettingsLimits.dailyMinutes.min}
                      max={runtimeSettingsLimits.dailyMinutes.max}
                      step={runtimeSettingsLimits.dailyMinutes.step}
                      value={goal.dailyMinutes}
                      onChange={(event) => {
                        setGoal((current) => ({
                          ...current,
                          dailyMinutes: Number(event.target.value)
                        }));
                        markDirty();
                      }}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>目标速度</strong>
                      <small>{goal.targetWpm} WPM</small>
                    </span>
                    <input
                      aria-label="目标速度"
                      type="range"
                      min={runtimeSettingsLimits.targetWpm.min}
                      max={runtimeSettingsLimits.targetWpm.max}
                      step={runtimeSettingsLimits.targetWpm.step}
                      value={goal.targetWpm}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setGoal((current) => ({ ...current, targetWpm: value }));
                        patch("targetWpm", value);
                      }}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>最低准确率</strong>
                      <small>{Math.round(goal.minimumAccuracy * 1000) / 10}%</small>
                    </span>
                    <input
                      aria-label="最低准确率"
                      type="range"
                      min={runtimeSettingsLimits.accuracy.min}
                      max={runtimeSettingsLimits.accuracy.max}
                      step={runtimeSettingsLimits.accuracy.step}
                      value={goal.minimumAccuracy}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setGoal((current) => ({ ...current, minimumAccuracy: value }));
                        setSettings((current) => ({
                          ...current,
                          minimumAccuracy: value,
                          progressionAccuracy: Math.max(current.progressionAccuracy, value)
                        }));
                        markDirty();
                      }}
                    />
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>提高难度阈值</strong>
                      <small>{Math.round(settings.progressionAccuracy * 1000) / 10}%</small>
                    </span>
                    <input
                      aria-label="提高难度准确率阈值"
                      type="range"
                      min={settings.minimumAccuracy}
                      max={runtimeSettingsLimits.accuracy.max}
                      step={runtimeSettingsLimits.accuracy.step}
                      value={settings.progressionAccuracy}
                      onChange={(event) => patch("progressionAccuracy", Number(event.target.value))}
                    />
                  </div>
                  <ToggleRow
                    label="本地训练算法交替试验"
                    detail="开启后按日期整日交替 adaptive 与本地 baseline；至少两周且两组样本充足前只显示尚无结论"
                    checked={settings.experimentEnabled}
                    onChange={(value) => patch("experimentEnabled", value)}
                  />
                  <details className="advanced-settings">
                    <summary>高级权重</summary>
                    {runtimeAdvancedWeightKeys.map((key) => (
                      <label key={key}>
                        <span>
                          {key}
                          <small>{settings.advancedWeights[key].toFixed(2)}</small>
                        </span>
                        <input
                          aria-label={`算法权重 ${key}`}
                          type="range"
                          min={runtimeSettingsLimits.advancedWeight.min}
                          max={runtimeSettingsLimits.advancedWeight.max}
                          step={runtimeSettingsLimits.advancedWeight.step}
                          value={settings.advancedWeights[key]}
                          onChange={(event) =>
                            patch("advancedWeights", {
                              ...settings.advancedWeights,
                              [key]: Number(event.target.value)
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => patch("advancedWeights", { ...runtimeDefaultAdvancedWeights })}
                    >
                      <RotateCcw size={15} />
                      恢复默认权重
                    </button>
                  </details>
                </div>
              </section>
            ) : null}
            {visibleSections.some((item) => item.id === "data") ? (
              <section id="settings-data" className="settings-section settings-section--wide">
                <div className="settings-section__header">
                  <Database size={20} />
                  <div>
                    <h2>数据与备份</h2>
                    <p>SQLite 是权威数据源；CSV 仅用于分析，JSON/SQLite 用于备份。</p>
                  </div>
                </div>
                <div className="data-location">
                  <Database size={18} />
                  <span>
                    <strong>当前数据库</strong>
                    <code>{bootstrap.dataLocation}</code>
                  </span>
                </div>
                <div className="data-action-grid">
                  <a className="data-action" href="/api/v1/export/csv" download>
                    <Download size={20} />
                    <span>
                      <strong>导出 CSV</strong>
                      <small>课程与测试指标表</small>
                    </span>
                  </a>
                  <a className="data-action" href="/api/v1/export/json" download>
                    <Download size={20} />
                    <span>
                      <strong>导出完整 JSON</strong>
                      <small>带 schema 与算法版本</small>
                    </span>
                  </a>
                  <button
                    className="data-action"
                    type="button"
                    disabled={downloadingSqlite}
                    onClick={() => void downloadSqlite()}
                  >
                    <Download size={20} />
                    <span>
                      <strong>{downloadingSqlite ? "正在生成 SQLite…" : "下载 SQLite 备份"}</strong>
                      <small>带本页安全令牌的一致性快照，可用于完整恢复</small>
                    </span>
                  </button>
                  <button
                    className="data-action"
                    type="button"
                    onClick={() =>
                      void api
                        .post("/api/v1/backups", { reason: "manual" })
                        .then(() => backupsQuery.refetch())
                        .then(() => showMessage("已创建本机备份，并按保留规则整理旧备份。"))
                        .catch((error: unknown) =>
                          showMessage(userErrorText(error, "backup"), "error")
                        )
                    }
                  >
                    <Archive size={20} />
                    <span>
                      <strong>创建 SQLite 快照</strong>
                      <small>自动保留最近 7 个有效快照</small>
                    </span>
                  </button>
                  <label className="data-action">
                    <Upload size={20} />
                    <span>
                      <strong>校验恢复文件</strong>
                      <small>SymType JSON 或 SQLite 完整备份</small>
                    </span>
                    <input
                      className="sr-only"
                      type="file"
                      accept="application/json,application/vnd.sqlite3,.json,.sqlite,.sqlite3,.db"
                      onChange={(event) => void previewFile(event.target.files?.[0])}
                    />
                  </label>
                </div>
                {backupPreview ? (
                  <div className="restore-preview">
                    <div>
                      <strong>恢复摘要</strong>
                      <span>
                        {backupPreview.profiles} 个用户档案 · {backupPreview.sessions} 次训练 ·{" "}
                        {backupPreview.events.toLocaleString()} 个按键记录
                      </span>
                    </div>
                    <button
                      className="button button--danger"
                      type="button"
                      onClick={() => void restore()}
                    >
                      自动备份当前数据并恢复
                    </button>
                  </div>
                ) : null}
                <div className="backup-list">
                  <h3>最近快照</h3>
                  {backupsQuery.isLoading ? (
                    <p role="status">正在读取最近快照…</p>
                  ) : backupsQuery.isError ? (
                    <div role="alert">
                      <span>{userErrorText(backupsQuery.error, "backup")}</span>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void backupsQuery.refetch()}
                      >
                        重试读取
                      </button>
                    </div>
                  ) : backupsQuery.data?.backups.length ? (
                    backupsQuery.data.backups.map((backup) => (
                      <div key={backup.id}>
                        <Archive size={16} />
                        <span>
                          <strong>{backup.filename ?? backup.path.split("/").at(-1)}</strong>
                          <small>
                            {new Intl.DateTimeFormat("zh-CN", {
                              dateStyle: "medium",
                              timeStyle: "short"
                            }).format(new Date(backup.created_at))}{" "}
                            · {(backup.byte_size / 1024).toFixed(1)} KB · {backup.reason}
                          </small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>还没有手动快照；恢复前仍会自动创建一个。</p>
                  )}
                </div>
                <p className="safety-note">
                  不要把真实密码、API key、私钥、钱包助记词或恢复短语粘贴到自定义训练文本。
                </p>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState
          title="没有匹配的设置"
          description={`没有找到与“${search.trim()}”相关的设置。请尝试 Shift、声音、键盘或备份。`}
          action={
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setSearch("")}
            >
              清除搜索
            </button>
          }
        />
      )}
    </div>
  );
}
