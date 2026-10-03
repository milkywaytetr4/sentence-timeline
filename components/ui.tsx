import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

/*
 * Nani × Sizu Design System の core コンポーネントを移植したもの。
 * 見た目はDSの値をそのまま使い、ホバーは JS の state ではなく CSS で表現する。
 */

type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "inverse"
  | "success"
  | "danger";
type ButtonSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[14px] gap-1.5",
  md: "h-10 px-4 text-[15px] gap-1.5",
  lg: "h-[52px] px-6 text-[17px] gap-1.5",
  xl: "h-[60px] px-6 text-[18px] gap-2 min-w-[260px]",
};
const ICON_SIZE: Record<ButtonSize, number> = {
  sm: 16,
  md: 18,
  lg: 20,
  xl: 20,
};

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-(--accent) text-white border-transparent hover:enabled:bg-(--accent-hover)",
  secondary:
    "bg-(--surface-card) text-(--text-secondary) border-(--border-subtle) hover:enabled:bg-(--surface-sunken)",
  soft: "bg-(--accent-soft) text-(--sky-700) border-transparent hover:enabled:bg-(--sky-300)",
  ghost:
    "bg-transparent text-(--text-secondary) border-transparent hover:enabled:bg-(--surface-chip)",
  inverse:
    "bg-(--surface-inverse) text-white border-transparent hover:enabled:bg-black",
  success:
    "bg-(--mint-500) text-white border-(--mint-500) shadow-[0_6px_16px_rgba(23,184,132,.32)] hover:enabled:brightness-95",
  danger:
    "bg-(--surface-card) text-(--red-500) border-(--border-subtle) hover:enabled:bg-(--red-100)",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  fullWidth,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`pressable inline-flex items-center justify-center whitespace-nowrap rounded-full border-[1.5px] font-semibold leading-none transition-[background,transform] duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-45 ${SIZE[size]} ${VARIANT[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={ICON_SIZE[size]} aria-hidden />}
      {children}
      {IconRight && <IconRight size={ICON_SIZE[size]} aria-hidden />}
    </button>
  );
}

type IconButtonVariant = "ghost" | "soft" | "inverse" | "accent";

const ICON_VARIANT: Record<IconButtonVariant, string> = {
  ghost:
    "rounded-[10px] bg-transparent text-(--text-tertiary) hover:enabled:bg-(--surface-chip)",
  soft: "rounded-full bg-(--surface-chip) text-(--text-tertiary) hover:enabled:bg-(--ink-200)",
  inverse:
    "rounded-full bg-(--surface-inverse) text-white hover:enabled:bg-black",
  accent:
    "rounded-full bg-(--accent) text-white hover:enabled:bg-(--accent-hover)",
};

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  variant?: IconButtonVariant;
  size?: number;
};

export function IconButton({
  icon: Icon,
  label,
  variant = "ghost",
  size = 44,
  className = "",
  type = "button",
  style,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`pressable inline-flex flex-none items-center justify-center border-none p-0 transition-[background] duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-40 ${ICON_VARIANT[variant]} ${className}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <Icon size={Math.round(size * 0.5)} aria-hidden />
    </button>
  );
}

type BadgeTone = "sky" | "neutral" | "amber" | "mint" | "violet";

const BADGE_TONE: Record<BadgeTone, string> = {
  sky: "bg-(--sky-200) text-(--sky-600)",
  neutral: "bg-(--surface-chip) text-(--text-secondary)",
  amber: "bg-(--amber-100) text-(--amber-700)",
  mint: "bg-(--mint-100) text-(--mint-700)",
  violet: "bg-(--violet-100) text-(--violet-500)",
};

export function Badge({
  tone = "sky",
  size = "md",
  children,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold leading-[1.2] ${BADGE_TONE[tone]} ${size === "sm" ? "rounded-lg px-2 py-[3px] text-[12px]" : "rounded-[10px] px-3 py-1.5 text-[14px]"}`}
    >
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex gap-1 rounded-full border-[1.5px] border-(--border-subtle) bg-(--surface-card) p-1"
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.value)}
            className={`h-[34px] rounded-full border-none px-4 text-[14px] leading-none transition-[background] duration-(--dur-fast) ${on ? "bg-(--sky-100) font-bold text-(--sky-700)" : "bg-transparent font-medium text-(--text-secondary)"}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function Select({
  value,
  options,
  onChange,
  icon: Icon,
  label,
  style,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  icon?: LucideIcon;
  label: string;
  style?: CSSProperties;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <label
      className="relative inline-flex h-10 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-(--border-subtle) bg-(--surface-card) pr-3.5 pl-4 text-[15px] font-medium leading-none text-(--text-secondary) shadow-(--shadow-1)"
      style={style}
    >
      {Icon && <Icon size={18} aria-hidden className="flex-none" />}
      <span className="truncate">{current?.label ?? ""}</span>
      <ChevronDown
        size={16}
        aria-hidden
        className="flex-none text-(--text-tertiary)"
      />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 画面上部の白いバー（高さ64px） */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-16 flex-none items-center gap-3.5 border-b-[1.5px] border-(--border-subtle) bg-(--surface-card) px-4 sm:px-6">
      {children}
    </header>
  );
}

/** 中央に浮かぶ確認ダイアログ */
export function ConfirmDialog({
  icon: Icon,
  iconColor,
  title,
  body,
  okLabel,
  okVariant = "primary",
  okDisabled,
  onOk,
  onCancel,
  children,
}: {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  body: string;
  okLabel: string;
  okVariant?: ButtonVariant;
  okDisabled?: boolean;
  onOk: () => void;
  onCancel: () => void;
  /** 本文の下に置く入力欄など */
  children?: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背景のタップで閉じる操作は、キャンセルボタンと Escape キーでも行える
    <div
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(16,42,67,.22)] p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="frame flex w-[440px] max-w-full flex-col items-center gap-2.5 px-9 pt-9 pb-7 text-center shadow-(--shadow-float)!"
      >
        <span className="flex" style={{ color: iconColor }}>
          <Icon size={36} aria-hidden />
        </span>
        <div className="text-[24px] leading-[1.4] font-bold">{title}</div>
        <div className="text-[14px] leading-[1.7] text-(--text-secondary)">
          {body}
        </div>
        {children}
        <div className="mt-3.5 grid w-full grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" fullWidth onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            variant={okVariant}
            size="lg"
            fullWidth
            onClick={onOk}
            disabled={okDisabled}
            // 入力欄があるときは、入力欄の側でフォーカスを取る
            autoFocus={!children}
          >
            {okLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
