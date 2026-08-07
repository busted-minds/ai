import type { CSSProperties } from "react";

type BreakOpenMarkProps = {
  className?: string;
  size?: number;
};

/**
 * The Busted Minds "break-open" mark: two thought fragments split by an
 * orange fault line. It is intentionally built from CSS so it stays crisp at
 * every size and automatically follows the active theme.
 */
export function BreakOpenMark({ className = "", size = 18 }: BreakOpenMarkProps) {
  const classes = ["break-open-mark", className].filter(Boolean).join(" ");
  const style = { "--break-open-size": `${size}px` } as CSSProperties;

  return (
    <span className={classes} style={style} aria-hidden="true">
      <span className="break-open-shard break-open-shard-left" />
      <span className="break-open-shard break-open-shard-right" />
      <span className="break-open-fault" />
    </span>
  );
}
