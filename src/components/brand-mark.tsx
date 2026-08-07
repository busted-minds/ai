import Image from "next/image";
import darkLogo from "../../public/brand/bmai-logo-dark.png";
import lightLogo from "../../public/brand/bmai-logo-light.png";

type BrandMarkProps = {
  compact?: boolean;
  priority?: boolean;
};

type ThemeLogoProps = {
  className?: string;
  priority?: boolean;
  size: number;
};

export function ThemeLogo({ className = "", priority = false, size }: ThemeLogoProps) {
  const classes = ["theme-logo", className].filter(Boolean).join(" ");

  return (
    <span className={classes} role="img" aria-label="Busted Minds AI">
      <Image
        className="theme-logo-image theme-logo-image-dark"
        src={darkLogo}
        alt=""
        width={size}
        height={size}
        priority={priority}
      />
      <Image
        className="theme-logo-image theme-logo-image-light"
        src={lightLogo}
        alt=""
        width={size}
        height={size}
        priority={priority}
      />
    </span>
  );
}

export function BrandMark({ compact = false, priority = false }: BrandMarkProps) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"}>
      <ThemeLogo className="brand-image" size={compact ? 42 : 52} priority={priority} />
      {!compact && (
        <span className="brand-copy">
          <strong>Busted Minds</strong>
          <small>Artificial intelligence</small>
        </span>
      )}
    </span>
  );
}
