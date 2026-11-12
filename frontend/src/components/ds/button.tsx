import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// Buttons and button-links. Variants, not dozens of style props: primary (the one main action), secondary, text (inline, low emphasis).
// All share focus, hover, disabled and loading behaviour; focus rings come from the global rule in globals.css.

export type ButtonVariant = "primary" | "secondary" | "text";
export type ButtonSize = "sm" | "md" | "lg";

const BASE = "inline-flex items-center justify-center gap-2 font-medium transition-colors select-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 rounded-control px-3 text-sm",
  md: "min-h-11 rounded-control px-5 text-sm",
  lg: "min-h-12 rounded-control px-6 text-base",
};
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-card hover:bg-primary-hover disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none aria-disabled:bg-disabled-bg aria-disabled:text-disabled-ink aria-disabled:shadow-none",
  secondary: "border border-line-strong bg-surface text-ink hover:border-primary hover:text-primary disabled:border-line disabled:bg-disabled-bg disabled:text-disabled-ink aria-disabled:border-line aria-disabled:bg-disabled-bg aria-disabled:text-disabled-ink",
  text: "rounded-control px-1 text-primary hover:underline disabled:text-disabled-ink aria-disabled:text-disabled-ink",
};

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") =>
  `${BASE} ${variant === "text" ? "" : SIZE[size]} ${VARIANT[variant]} ${className}`;

type Common = { variant?: ButtonVariant; size?: ButtonSize; icon?: "arrow" | null; children: ReactNode; className?: string };

/** A real <button>. `loading` disables it, announces the busy state and shows a spinner. */
export function Button({ variant = "primary", size = "md", icon = null, loading = false, className = "", children, disabled, type = "button", ...rest }: Common & { loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
      {icon === "arrow" && !loading && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

/** A link that looks like a button. With `disabled` it renders as non-interactive text, not a dead link. */
export function ButtonLink({ href, variant = "primary", size = "md", icon = null, disabled = false, className = "", children, external = false }: Common & { href: string; disabled?: boolean; external?: boolean }) {
  const cls = buttonClass(variant, size, className);
  const content = (<>{children}{icon === "arrow" && <ArrowRight className="h-4 w-4" aria-hidden="true" />}</>);
  if (disabled) return <span role="link" aria-disabled="true" className={cls}>{content}</span>;
  return external ? (
    <a href={href} className={cls} rel="noopener noreferrer" target="_blank">{content}</a>
  ) : (
    <Link href={href} className={cls}>{content}</Link>
  );
}

type Flexible = Common & ({ href: string; disabled?: boolean; external?: boolean } | ({ href?: undefined; loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">));
function make(variant: ButtonVariant) {
  return function Variant(props: Omit<Flexible, "variant">) {
    if ("href" in props && props.href !== undefined) { const { href, ...p } = props as Common & { href: string; disabled?: boolean; external?: boolean }; return <ButtonLink href={href} variant={variant} {...p} />; }
    return <Button variant={variant} {...(props as Common & { loading?: boolean })} />;
  };
}
export const PrimaryButton = make("primary");
export const SecondaryButton = make("secondary");
export const TextButton = make("text");
