import { useEffect, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Database, Keyboard, Volume2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { soundEngine } from "../audio";
import { activeKeyboardLayout, focusCharactersForScopes } from "../keyboard";
import type { AppSettings, BootstrapData } from "../types";

const calibrationCategories = [
  { id: "letters", label: "字母", detail: "常见字母与键区基线" },
  { id: "bigrams", label: "常见二元组合", detail: "左右交替与高频字母过渡" },
  { id: "index", label: "食指边界", detail: "C / B / N / M 等映射边界" },
  { id: "digits", label: "数字", detail: "ANSI 数字行" },
  { id: "symbols", label: "标点与符号", detail: "常用标点和 Shift 符号" },
  { id: "shift", label: "大小写", detail: "单侧 Shift 与切换" }
];

const calibrationScopes: Record<string, string> = {
  letters: "字母",
  bigrams: "字母",
  index: "食指区",
  digits: "数字",
  symbols: "符号",
  shift: "大小写"
};

export function OnboardingPage({ bootstrap }: { bootstrap: BootstrapData }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(bootstrap.settings);
  const [categories, setCategories] = useState(
    () => new Set(calibrationCategories.map((item) => item.id))
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [audioNotice, setAudioNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const patchSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    soundEngine.configure(next);
  };

  const finish = async (startCalibration: boolean) => {
    setSaving(true);
    setSaveError("");
    try {
      await api.patch("/api/v1/settings", { ...settings, onboardingComplete: true });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      if (startCalibration) {
        const selectedCategories = Array.from(categories);
        const scopes = [
          ...new Set(selectedCategories.flatMap((category) => calibrationScopes[category] ?? []))
        ];
        const focus = focusCharactersForScopes(
          scopes,
          activeKeyboardLayout({ ...bootstrap, settings })
        ).join("");
        void navigate(
          `/train/session?mode=calibration&duration=4&focus=${encodeURIComponent(focus)}&scope=${encodeURIComponent(scopes.join(","))}&calibrationCategories=${encodeURIComponent(selectedCategories.join(","))}`
        );
      } else void navigate("/");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "无法保存首次设置。你的选择仍保留，可以立即重试。"
      );
    } finally {
      setSaving(false);
    }
  };

  const unlockSound = async () => {
    soundEngine.configure(settings);
    const ok = await soundEngine.unlock();
    if (ok) {
      soundEngine.play(settings.soundMode === "errors" ? "error" : "key");
      setAudioNotice("声音已解锁。Safari 之后会沿用本次页面手势。 ");
    } else {
      setAudioNotice("浏览器未允许声音；训练仍可继续，可稍后在设置中再次启用。");
    }
  };

  return (
    <main className="onboarding-shell">
      <div
        className="onboarding-progress"
        role="progressbar"
        aria-label="首次设置进度"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step + 1}
        aria-valuetext={`第 ${step + 1} 步，共 3 步`}
      >
        {[0, 1, 2].map((value) => (
          <span className={value <= step ? "is-active" : ""} key={value} />
        ))}
      </div>

      {step === 0 ? (
        <section className="onboarding-card onboarding-card--welcome">
          <div className="wordmark wordmark--center">
            <span className="wordmark__symbol">S</span>
            <span>SymType</span>
          </div>
          <p className="eyebrow">欢迎</p>
          <h1 ref={headingRef} tabIndex={-1}>
            为 Symmetric 指法建立一套自己的证据。
          </h1>
          <p className="onboarding-lead">
            ANSI US QWERTY 字符布局不变；SymType
            只改变按键的建议手指分区，并根据你在训练区里的可观测表现调整下一微组。
          </p>
          <div className="trust-list">
            <div>
              <Database size={20} />
              <span>
                <strong>只在这台电脑</strong>
                <small>历史与设置保存在服务端本地 SQLite；清浏览器数据不会删除。</small>
              </span>
            </div>
            <div>
              <Keyboard size={20} />
              <span>
                <strong>Symmetric 默认映射</strong>
                <small>食指区、其他手指、数字、符号与 Shift 都能独立练习。</small>
              </span>
            </div>
            <div>
              <Check size={20} />
              <span>
                <strong>不检测真实手指</strong>
                <small>手指分析始终指“按当前映射推断的键区表现”。</small>
              </span>
            </div>
          </div>
          <button
            className="button button--primary button--large"
            type="button"
            onClick={() => setStep(1)}
          >
            开始设置 <ArrowRight size={18} />
          </button>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="onboarding-card">
          <p className="eyebrow">体验偏好</p>
          <h1 ref={headingRef} tabIndex={-1}>
            先让训练适合你的环境。
          </h1>
          <p className="onboarding-lead">这些选项之后都能在设置中修改。</p>
          <div className="settings-list settings-list--onboarding">
            <label className="setting-row">
              <span>
                <strong>声音反馈</strong>
                <small>本地 Web Audio 合成，不加载远程音频</small>
              </span>
              <Switch.Root
                className="switch"
                checked={settings.soundEnabled}
                onCheckedChange={(value) => patchSetting("soundEnabled", value)}
                aria-label="声音反馈"
              >
                <Switch.Thumb />
              </Switch.Root>
            </label>
            <label className="setting-row">
              <span>
                <strong>减少动态效果</strong>
                <small>保留状态变化，移除非必要位移</small>
              </span>
              <Switch.Root
                className="switch"
                checked={settings.reducedMotion}
                onCheckedChange={(value) => patchSetting("reducedMotion", value)}
                aria-label="减少动态效果"
              >
                <Switch.Thumb />
              </Switch.Root>
            </label>
            <label className="setting-row">
              <span>
                <strong>虚拟键盘提示</strong>
                <small>显示下一物理键与建议映射手指</small>
              </span>
              <Switch.Root
                className="switch"
                checked={settings.keyboardVisible}
                onCheckedChange={(value) => patchSetting("keyboardVisible", value)}
                aria-label="虚拟键盘提示"
              >
                <Switch.Thumb />
              </Switch.Root>
            </label>
            <div className="setting-row">
              <span>
                <strong>主题</strong>
                <small>系统主题、浅色或深色</small>
              </span>
              <select
                value={settings.theme}
                onChange={(event) =>
                  patchSetting("theme", event.target.value as AppSettings["theme"])
                }
                aria-label="主题"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
          </div>
          {settings.soundEnabled ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void unlockSound()}
            >
              <Volume2 size={17} />
              试听并解锁声音
            </button>
          ) : null}
          {audioNotice ? (
            <p className="inline-notice" role="status">
              {audioNotice}
            </p>
          ) : null}
          <div className="onboarding-actions">
            <button className="button button--ghost" type="button" onClick={() => setStep(0)}>
              <ArrowLeft size={17} />
              返回
            </button>
            <button className="button button--primary" type="button" onClick={() => setStep(2)}>
              继续 <ArrowRight size={17} />
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="onboarding-card">
          <p className="eyebrow">3–5 分钟基线</p>
          <h1 ref={headingRef} tabIndex={-1}>
            选择这次想取样的区域。
          </h1>
          <p className="onboarding-lead">
            结果会分别展示速度、准确率、节奏稳定性、左右键区平衡与慢组合，不会只给一个总 WPM。
          </p>
          <div className="check-grid">
            {calibrationCategories.map((category) => {
              const checked = categories.has(category.id);
              return (
                <button
                  type="button"
                  className={`check-card${checked ? " is-selected" : ""}`}
                  aria-pressed={checked}
                  key={category.id}
                  onClick={() =>
                    setCategories((current) => {
                      const next = new Set(current);
                      if (next.has(category.id)) next.delete(category.id);
                      else next.add(category.id);
                      return next;
                    })
                  }
                >
                  <span className="check-card__box">{checked ? <Check size={15} /> : null}</span>
                  <strong>{category.label}</strong>
                  <small>{category.detail}</small>
                </button>
              );
            })}
          </div>
          <p className="safety-note">
            自定义文本时不要输入真实密码、API key、私钥、钱包助记词或恢复短语。
          </p>
          {saveError ? (
            <p className="error-notice" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="onboarding-actions">
            <button className="button button--ghost" type="button" onClick={() => setStep(1)}>
              <ArrowLeft size={17} />
              返回
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={saving}
              onClick={() => void finish(false)}
            >
              稍后校准
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={saving || categories.size === 0}
              onClick={() => void finish(true)}
            >
              {saving ? "正在保存…" : "开始基线"} <ArrowRight size={17} />
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
