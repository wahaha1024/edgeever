import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "solid" | "soft" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClassName: Record<ButtonVariant, string> = {
  solid: "bg-[#627f58] text-white hover:bg-[#526d49] border-[#627f58]",
  soft: "bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-transparent",
  outline: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
  danger: "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-100",
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3 text-sm",
  icon: "h-8 w-8 justify-center p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "soft", size = "md", ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center rounded-md border font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#627f58]/70 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      variantClassName[variant],
      sizeClassName[size],
      className
    )}
    {...props}
  />
));

Button.displayName = "Button";
