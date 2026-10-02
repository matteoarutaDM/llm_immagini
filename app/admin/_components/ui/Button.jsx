import Link from "next/link";

const VARIANTS = {
  primary: "bg-app-accent text-[#062114] hover:bg-app-accent-bright disabled:bg-app-raised disabled:text-app-muted",
  secondary: "border border-app-border-strong bg-app-raised text-app-text hover:border-white/20 hover:bg-app-hover",
  ghost: "text-app-secondary hover:bg-app-hover hover:text-app-text",
  danger: "bg-red-500/90 text-white hover:bg-red-500 disabled:bg-app-raised disabled:text-app-muted",
};

const SIZES = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
};

export function buttonClass({ variant = "secondary", size = "md", className = "" } = {}) {
  return `inline-flex shrink-0 items-center justify-center font-medium transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

/**
 * @param {{ variant?: keyof VARIANTS, size?: keyof SIZES, loading?: boolean, icon?: React.ComponentType<{className?: string}>, href?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant, size, loading = false, icon: Icon, href, className, children, disabled, type = "button", ...props }) {
  const classes = buttonClass({ variant, size, className });
  const content = (
    <>
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
      ) : Icon ? (
        <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
      ) : null}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  );
}
