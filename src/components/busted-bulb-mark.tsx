import type { CSSProperties } from "react";

type BustedBulbMarkProps = {
  className?: string;
  size?: number;
};

/** A compact, hand-drawn bulb distilled from the Busted Minds logo. */
export function BustedBulbMark({ className = "", size = 18 }: BustedBulbMarkProps) {
  const classes = ["busted-bulb-mark", className].filter(Boolean).join(" ");
  const style = { "--busted-bulb-size": `${size}px` } as CSSProperties;

  return (
    <span className={classes} style={style} aria-hidden="true">
      <span className="busted-bulb-ray busted-bulb-ray-top" />
      <span className="busted-bulb-ray busted-bulb-ray-upper" />
      <span className="busted-bulb-ray busted-bulb-ray-side" />
      <span className="busted-bulb-glass">
        <span className="busted-bulb-filament" />
      </span>
      <span className="busted-bulb-base" />
    </span>
  );
}
