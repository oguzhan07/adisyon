import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const CONTROL =
  'w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) ' +
  'bg-(--color-surface-raised) px-3 text-base text-(--color-text) ' +
  'placeholder:text-(--color-text-faint) disabled:opacity-60';

interface LabelProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, children }: LabelProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-(--color-text-faint)">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${className}`} {...rest} />;
}

/** Tutar ve miktar girisleri: rakamlar hizali okunsun */
export function NumberInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="decimal"
      className={`${CONTROL} tabular text-right ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} ${className}`} {...rest}>
      {children}
    </select>
  );
}

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-5 shrink-0 accent-(--color-accent)"
      />
      <span>
        <span className="block text-base">{label}</span>
        {hint && <span className="block text-xs text-(--color-text-faint)">{hint}</span>}
      </span>
    </label>
  );
}
