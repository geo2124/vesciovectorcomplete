import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dbStore } from "@/lib/data-store";

export const TableContext = createContext<boolean>(false);

export function Pagination({
  page,
  pageSize,
  total,
  setPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  setPage: (p: number) => void;
}) {
  const maxPage = Math.ceil(total / pageSize) || 1;
  return (
    <div className="flex items-center justify-between text-[11px] font-mono text-ink-400">
      <div>
        SHOWING {(page - 1) * pageSize + 1} TO {Math.min(page * pageSize, total)} OF {total}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded px-2 py-1 transition-colors hover:bg-ink-800 disabled:opacity-50"
        >
          PREV
        </button>
        <span>
          {page} / {maxPage}
        </span>
        <button
          type="button"
          onClick={() => setPage(Math.min(maxPage, page + 1))}
          disabled={page === maxPage}
          className="rounded px-2 py-1 transition-colors hover:bg-ink-800 disabled:opacity-50"
        >
          NEXT
        </button>
      </div>
    </div>
  );
}

export function PageHeader({
  crumb,
  title,
  action,
  children,
}: {
  crumb: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div>
        <div className="label-mono">{crumb}</div>
        <h1 className="font-display mt-1 text-2xl tracking-tight text-ink-100">{title}</h1>
        {children}
      </div>
      {action ? <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title?: ReactNode | undefined;
  meta?: string | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="font-display text-base tracking-tight text-ink-100">{title}</h2>
            {meta ? <div className="label-mono mt-0.5">{meta}</div> : null}
          </div>
          {action ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  sub,
  accent,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  sub?: string | undefined;
  accent?: boolean | undefined;
}) {
  const valStr = String(value ?? "");
  const subtitle = note ?? sub;
  const textSize =
    valStr.length > 20
      ? "text-base sm:text-lg"
      : valStr.length > 14
        ? "text-lg sm:text-xl"
        : valStr.length > 10
          ? "text-xl sm:text-2xl"
          : "text-2xl sm:text-3xl lg:text-4xl";

  return (
    <div className="panel tick-diag relative overflow-hidden p-4 sm:p-5 min-w-0">
      <div className="label-mono truncate">{label}</div>
      <div
        className={`font-display mt-2 tabular-nums ${textSize} leading-tight tracking-tight text-ink-100 font-bold break-words`}
        title={valStr}
      >
        {value}
      </div>
      {subtitle ? (
        <div
          className={`mt-2 font-mono text-[11px] truncate ${accent ? "text-court-400" : "text-ink-300"}`}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  type = "button",
  disabled = false,
  className = "",
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger" | "emerald";
  size?: "xs" | "sm" | "md" | "lg";
  onClick?: (() => void) | ((e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>);
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center whitespace-nowrap font-sans font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-court-500 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-950 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

  const sizes = {
    xs: "h-7 px-2.5 text-xs gap-1 rounded",
    sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
    md: "h-9 px-3.5 text-sm gap-2 rounded-md",
    lg: "h-10 px-4 text-sm gap-2 rounded-md font-semibold",
  };

  const variants = {
    primary:
      "bg-court-500 text-ink-950 hover:bg-court-400 font-semibold shadow-sm border border-transparent",
    secondary: "bg-ink-850 text-ink-200 border border-ink-750 hover:bg-ink-800 hover:text-ink-100",
    outline: "bg-ink-850/60 text-ink-200 border border-ink-700 hover:bg-ink-800 hover:text-ink-100",
    ghost:
      "bg-transparent text-ink-300 hover:bg-ink-800/70 hover:text-ink-100 border border-transparent",
    danger:
      "bg-red-600 text-white hover:bg-red-500 border border-red-500/30 font-semibold shadow-sm",
    emerald:
      "bg-emerald-600/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25",
  };

  return (
    <button
      type={type}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(base, sizes[size], variants[variant] || variants.primary, className)}
    >
      {children}
    </button>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    "U-10": { bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-400" },
    "U-12": { bg: "bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-400" },
    "U-14": { bg: "bg-blue-500/15", text: "text-blue-700 dark:text-blue-400" },
    "U-16": { bg: "bg-indigo-500/15", text: "text-indigo-700 dark:text-indigo-400" },
    "U-18": { bg: "bg-fuchsia-500/15", text: "text-fuchsia-700 dark:text-fuchsia-400" },
    Senior: { bg: "bg-rose-500/15", text: "text-rose-700 dark:text-rose-400" },
  };
  const fallback = { bg: "bg-ink-800/20", text: "text-ink-600 dark:text-ink-300" };
  const color = map[category] || fallback;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${color.bg} ${color.text}`}
    >
      {category}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?:
    "neutral" | "accent" | "court" | "info" | "good" | "ok" | "warn" | "bad" | "danger" | undefined;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-800 text-ink-200",
    accent: "bg-court-500/15 text-court-400",
    court: "bg-court-500/15 text-court-300",
    info: "bg-sky-500/15 text-sky-300",
    good: "bg-good/15 text-good",
    ok: "bg-emerald-500/15 text-emerald-300",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/20 text-bad",
    danger: "bg-red-500/20 text-red-300",
  };
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10px] tracking-wide ${tones[tone] ?? "bg-ink-800 text-ink-200"}`}
    >
      {children}
    </span>
  );
}

export function Filters({ items }: { items: string[] }) {
  return (
    <>
      {items.map((f) => (
        <span
          key={f}
          className="label-mono inline-block rounded bg-ink-850 px-2.5 py-1.5 ring-1 ring-ink-700"
        >
          {f} ▾
        </span>
      ))}
    </>
  );
}

export function SearchField({ placeholder }: { placeholder: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <input
        className="w-full rounded-md bg-ink-850 py-2 pl-9 pr-3 font-ui text-sm text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-400 focus:outline-none focus:ring-court-500/60"
        placeholder={placeholder}
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-400">
        ⌕
      </span>
    </div>
  );
}

export function Table({
  head,
  children,
  footer,
}: {
  head?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
}) {
  return (
    <>
      <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-sm">
          {head ? (
            <>
              <thead>
                <tr className="border-b border-ink-800 text-left font-mono text-[10px] tracking-[0.12em] text-ink-400">
                  {head}
                </tr>
              </thead>
              <TableContext.Provider value={true}>
                <tbody className="divide-y divide-ink-800/70">{children}</tbody>
              </TableContext.Provider>
            </>
          ) : (
            <TableContext.Provider value={true}>{children}</TableContext.Provider>
          )}
        </table>
      </div>
      {footer ? (
        <div className="label-mono flex items-center justify-between border-t border-ink-800 px-4 py-2.5">
          <span>{footer}</span>
          <span className="flex items-center gap-3">
            <span>‹ PREV</span>
            <span>NEXT ›</span>
          </span>
        </div>
      ) : null}
    </>
  );
}

export function Th({
  children,
  className = "",
}: {
  children: ReactNode;
  hide?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-left font-mono text-[10px] tracking-[0.12em] text-ink-400 font-medium whitespace-nowrap sm:whitespace-normal ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right,
  strong,
  className = "",
}: {
  children: ReactNode;
  hide?: boolean | undefined;
  right?: boolean | undefined;
  strong?: boolean | undefined;
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 ${right ? "text-right" : ""} ${
        strong ? "font-medium text-ink-100" : "text-ink-200"
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Row({ children, className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`cursor-pointer transition-colors hover:bg-ink-850/60 ${className || ""}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function FieldGrid({ fields }: { fields: { label: string; hint?: string }[] }) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.label} className="block">
          <span className="label-mono">{f.label}</span>
          <div className="mt-1.5 rounded-md bg-ink-850 px-3 py-2 text-sm text-ink-400 ring-1 ring-ink-700">
            {f.hint ?? "—"}
          </div>
        </label>
      ))}
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  LBP: "LBP ",
  AED: "AED ",
  SAR: "SAR ",
  QAR: "QAR ",
  KWD: "KWD ",
  CAD: "CA$",
  AUD: "AU$",
  CHF: "CHF ",
  JPY: "¥",
  CNY: "¥",
};

export function getCurrencySymbol(customCurrency?: string): string {
  let curr = customCurrency;
  if (!curr) {
    try {
      const academy = dbStore?.getSlice?.("academy") as
        { currency?: string; currencies?: string[] } | undefined;
      curr = academy?.currency || academy?.currencies?.[0];
    } catch {
      // fallback
    }
  }

  if (!curr) return "$";
  const trimmed = curr.trim();
  const upper = trimmed.toUpperCase();
  if (CURRENCY_SYMBOLS[upper]) {
    return CURRENCY_SYMBOLS[upper];
  }
  if (trimmed.length <= 2 && !/^[A-Za-z]+$/.test(trimmed)) {
    return trimmed;
  }
  return `${upper} `;
}

export function money(n: number, currencyOverride?: string) {
  const val = typeof n === "number" && !isNaN(n) ? n : 0;
  const sign = val < 0 ? "-" : "";
  const symbol = getCurrencySymbol(currencyOverride);
  return `${sign}${symbol}${Math.abs(val).toLocaleString()}`;
}

export function Field({
  label,
  hint,
  error,
  labelClassName,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  labelClassName?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className={cn("label-mono", labelClassName)}>{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block font-mono text-[10px] text-warn">{error}</span>
      ) : hint ? (
        <span className="mt-1 block font-mono text-[10px] text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

const controlCls =
  "mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-400 focus:outline-none focus:ring-court-500/60";

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  list,
  autoComplete,
  autoFocus,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  list?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      placeholder={placeholder ?? ""}
      onChange={(e) => onChange(e.target.value)}
      list={list}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      disabled={disabled}
      className={cn(controlCls, className)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  labels,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<string | { label: string; value: string }>;
  labels?: Record<string, string> | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(controlCls, className)}
    >
      {options.map((o) => {
        const optValue = typeof o === "string" ? o : o.value;
        const optLabel = typeof o === "string" ? (labels?.[o] ?? o) : o.label;
        return (
          <option key={optValue} value={optValue} className="bg-ink-900 text-ink-100">
            {optLabel}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  note,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ring-1 transition-colors ${
        on ? "bg-court-500/10 ring-court-500/40" : "bg-ink-850 ring-ink-700"
      }`}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? "bg-court-500" : "bg-ink-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-all ${
            on ? "left-4.5" : "left-0.5"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink-100">{label}</span>
        {note ? <span className="block font-mono text-[10px] text-ink-400">{note}</span> : null}
      </span>
    </button>
  );
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value ?? ""}
      placeholder={placeholder ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={controlCls}
    />
  );
}

export function Modal({
  open,
  title,
  meta,
  onClose,
  onSubmit,
  submitLabel = "Save",
  wide,
  children,
}: {
  open: boolean;
  title: string;
  meta?: string | undefined;
  onClose: () => void;
  onSubmit?: ((e?: React.FormEvent) => void) | undefined;
  submitLabel?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-2 backdrop-blur-sm sm:p-6">
      <div
        className={`panel max-h-[90dvh] overflow-y-auto overflow-x-hidden box-border w-[95vw] sm:w-full max-w-full rounded-lg pb-[env(safe-area-inset-bottom)] ${
          wide ? "sm:max-w-4xl" : "sm:max-w-xl"
        }`}
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink-800 bg-ink-900/95 px-4 py-3 backdrop-blur min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base tracking-tight text-ink-100 truncate">{title}</h2>
            {meta ? <div className="label-mono mt-0.5 truncate">{meta}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-9 w-9 min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg font-mono text-sm text-ink-300 hover:bg-ink-850"
          >
            ✕
          </button>
        </header>
        {onSubmit ? (
          <form
            className="min-w-0 max-w-full overflow-x-hidden box-border"
            onSubmit={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                await onSubmit(e);
              } catch (err) {
                console.error("Modal submission error:", err);
              }
            }}
          >
            <div className="min-w-0 max-w-full overflow-x-hidden box-border">{children}</div>
            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-ink-800 bg-ink-900/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
              <Button
                type="submit"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await onSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
                  } catch (err) {
                    console.error("Modal button submission error:", err);
                  }
                }}
              >
                {submitLabel}
              </Button>
              <Button variant="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="min-w-0 max-w-full overflow-x-hidden box-border">{children}</div>
        )}
      </div>
    </div>
  );
}

export function RowActions({
  onEdit,
  onDelete,
  extra,
}: {
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  extra?: ReactNode | undefined;
}) {
  return (
    <span className="flex items-center justify-end gap-1 shrink-0 whitespace-nowrap">
      {extra}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="rounded px-2 py-1 font-mono text-[10px] tracking-wide text-ink-300 ring-1 ring-ink-700 hover:bg-ink-850 hover:text-ink-100"
        >
          EDIT
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-1 font-mono text-[10px] tracking-wide text-bad ring-1 ring-ink-700 hover:bg-bad/10"
        >
          DEL
        </button>
      ) : null}
    </span>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="rounded bg-ink-850 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-200 ring-1 ring-ink-700 focus:outline-none focus:ring-court-500/60"
    >
      <option value="">{label}: ALL</option>
      {options.map((o) => (
        <option key={o} value={o} className="bg-ink-900">
          {o}
        </option>
      ))}
    </select>
  );
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-ink-850 py-2 pl-9 pr-3 font-ui text-sm text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-400 focus:outline-none focus:ring-court-500/60"
        placeholder={placeholder}
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-400">
        ⌕
      </span>
    </div>
  );
}

export function EmptyState({
  children,
  title,
  description,
  hint,
  action,
  className = "",
  asTableRow,
}: {
  children?: ReactNode | undefined;
  title?: ReactNode | undefined;
  description?: ReactNode | undefined;
  hint?: ReactNode | undefined;
  action?: ReactNode | undefined;
  className?: string | undefined;
  asTableRow?: boolean | undefined;
}) {
  const inTable = useContext(TableContext);
  const renderAsRow = asTableRow !== undefined ? asTableRow : inTable;
  const descContent = description ?? hint;

  const content = (
    <div className={`px-4 py-10 text-center font-mono text-[11px] text-ink-400 ${className}`}>
      {title ? (
        <div className="font-display text-sm font-semibold text-ink-200 mb-1">{title}</div>
      ) : null}
      {descContent ? <div className="text-xs text-ink-400 mb-3">{descContent}</div> : null}
      {children}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );

  if (renderAsRow) {
    return (
      <tr>
        <td colSpan={100} className="p-0">
          {content}
        </td>
      </tr>
    );
  }

  return content;
}
