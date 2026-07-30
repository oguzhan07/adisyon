import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/**
 * Temel buton.
 *
 * Tum boyutlar dokunmatik hedef alt sinirini (48px) karsilar - plandaki
 * tasarim kurali. Yogun serviste kucuk butona isabet ettirmek zaman kaybi ve
 * yanlis islem sebebidir.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-(--color-accent) text-(--color-accent-fg) hover:bg-(--color-accent-hover) disabled:bg-(--color-border-strong)',
  secondary:
    'bg-(--color-surface-raised) text-(--color-text) border border-(--color-border-strong) hover:bg-(--color-surface-sunken)',
  ghost: 'bg-transparent text-(--color-text-muted) hover:bg-(--color-surface-sunken)',
  danger:
    'bg-(--color-status-alert) text-white hover:brightness-110 disabled:bg-(--color-border-strong)',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-12 px-4 text-base',
  lg: 'min-h-16 px-6 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center gap-2 rounded-(--radius-control) font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
