import Image from "next/image";
import darkLogo from "../../public/brand/bmai-logo-dark.png";
import lightLogo from "../../public/brand/bmai-logo-light.png";

type BrandMarkProps = {
  compact?: boolean;
  priority?: boolean;
};

export function BrandMark({ compact = false, priority = false }: BrandMarkProps) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"}>
      <Image
        className="brand-image brand-image-dark"
        src={darkLogo}
        alt="Busted Minds AI"
        width={compact ? 42 : 52}
        height={compact ? 42 : 52}
        priority={priority}
      />
      <Image
        className="brand-image brand-image-light"
        src={lightLogo}
        alt="Busted Minds AI"
        width={compact ? 42 : 52}
        height={compact ? 42 : 52}
        priority={priority}
      />
      {!compact && (
        <span className="brand-copy">
          <strong>Busted Minds</strong>
          <small>Artificial intelligence</small>
        </span>
      )}
    </span>
  );
}
