import { memo, type CSSProperties } from "react";
import { KEYBOARD_ROWS, SYMMETRIC_LAYOUT, type KeyDefinition } from "@symtype/shared";

interface VirtualKeyboardProps {
  layout?: readonly KeyDefinition[];
  nextCode?: string;
  nextShiftCode?: "ShiftLeft" | "ShiftRight";
  pressedCode?: string;
  showFingerColors: boolean;
  compact?: boolean;
}

const fingerLabels: Record<string, string> = {
  leftPinky: "左小指",
  leftRing: "左无名指",
  leftMiddle: "左中指",
  leftIndex: "左食指",
  rightIndex: "右食指",
  rightMiddle: "右中指",
  rightRing: "右无名指",
  rightPinky: "右小指",
  thumb: "拇指"
};

function normalizeFinger(finger: string): string {
  return finger.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}

function keyLabel(key: KeyDefinition): string {
  if (key.code === "Space") return "Space";
  if (key.code === "Tab") return "Tab";
  if (key.code === "CapsLock") return "Caps";
  if (key.code.startsWith("Shift")) return "Shift";
  if (key.code === "Backspace") return "Delete";
  if (key.code === "Enter") return "Return";
  return key.unshifted || key.code.replace(/^(Key|Digit)/u, "");
}

const ANSI_GRID_SUBDIVISIONS = 8;
const ANSI_LEFT_EDGE = -0.5;

function keyGridPosition(key: KeyDefinition): CSSProperties {
  const leftEdge = key.column - key.width / 2;
  const start = Math.round((leftEdge - ANSI_LEFT_EDGE) * ANSI_GRID_SUBDIVISIONS) + 1;
  const span = Math.round(key.width * ANSI_GRID_SUBDIVISIONS);
  return { gridColumn: `${start} / span ${span}` };
}

export const VirtualKeyboard = memo(function VirtualKeyboard({
  layout = SYMMETRIC_LAYOUT,
  nextCode,
  nextShiftCode,
  pressedCode,
  showFingerColors,
  compact = false
}: VirtualKeyboardProps) {
  return (
    <div
      className={`virtual-keyboard${compact ? " virtual-keyboard--compact" : ""}`}
      aria-label="ANSI US QWERTY 虚拟键盘"
    >
      {KEYBOARD_ROWS.map((rowName) => {
        const row = layout.filter((key) => key.row === rowName);
        if (row.length === 0) return null;
        return (
          <div className="keyboard-row" data-row={rowName} key={rowName}>
            {row.map((key, index) => {
              const finger = normalizeFinger(key.finger);
              const fingerLabel = fingerLabels[finger] ?? key.finger;
              const isNext = key.code === nextCode || key.code === nextShiftCode;
              const isPressed = key.code === pressedCode;
              const previousFinger =
                index === 0 ? undefined : normalizeFinger(row[index - 1]!.finger);
              const startsZone = previousFinger !== undefined && previousFinger !== finger;
              const isHomeKey = key.code === "KeyF" || key.code === "KeyJ";
              return (
                <div
                  className={`keyboard-key${isNext ? " is-next" : ""}${isPressed ? " is-pressed" : ""}`}
                  data-code={key.code}
                  data-column={key.column}
                  data-finger={showFingerColors ? finger : "neutral"}
                  data-hand={key.hand}
                  data-home-key={isHomeKey ? "true" : undefined}
                  data-zone-start={startsZone ? "true" : undefined}
                  data-width={key.width}
                  key={key.code}
                  style={keyGridPosition(key)}
                  aria-current={isNext ? "true" : undefined}
                  title={`${keyLabel(key)} · ${fingerLabel}${isHomeKey ? " · 定位键" : ""}`}
                >
                  <span>{keyLabel(key)}</span>
                  {isNext ? (
                    <small>
                      {key.code === nextShiftCode ? `相反手 · ${fingerLabel}` : fingerLabel}
                    </small>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="keyboard-caption">
        同类手指使用同色，分区边界与文字共同表示建议指法；应用不检测真实手指动作。
      </p>
    </div>
  );
});
