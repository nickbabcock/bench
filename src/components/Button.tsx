import { clsx } from "clsx";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one action (Run), teal; secondary: hairline outline (Cancel, exports); quiet: a text link. */
  variant?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md";
}

export const buttonClass = ({ variant = "primary", size = "md" }: Pick<ButtonProps, "variant" | "size"> = {}) =>
  clsx(
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[4px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter] duration-150 ease-out select-none disabled:cursor-not-allowed [&_svg]:shrink-0",
    size === "md" && "h-10 px-[18px] text-[0.9375rem]",
    size === "sm" && "h-8 px-3 text-sm",
    variant === "primary" &&
      "border border-accent bg-accent text-on-accent hover:brightness-110 active:brightness-95 disabled:border-rule disabled:bg-band disabled:text-ink-3 disabled:hover:brightness-100",
    variant === "secondary" &&
      "border border-ink-3 bg-transparent text-ink hover:border-ink hover:bg-hl disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent",
    variant === "quiet" &&
      "px-1 font-normal text-accent underline decoration-1 underline-offset-[3px] hover:decoration-2 disabled:text-ink-3 disabled:no-underline",
  );

export const Button = ({ className, variant, size, type = "button", ...props }: ButtonProps) => (
  <button type={type} className={clsx(buttonClass({ variant, size }), className)} {...props} />
);
