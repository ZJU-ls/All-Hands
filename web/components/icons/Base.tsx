import type { SVGProps } from "react";

/**
 * Custom icon base (Raycast-style, 2px stroke, round caps).
 *
 * This is the ONLY accepted icon surface in allhands besides the 1-line SVG
 * set in `web/components/ui/icons.tsx` (those predate this system and are
 * kept for backward compatibility inside the theme toggle + logo).
 *
 * Rules — see product/03-visual-design.md §2:
 *   - viewBox 0 0 24 24
 *   - stroke-width 2 (round linecap + linejoin)
 *   - fill none (pure stroke; no duotone / no solid shapes)
 *   - stroke="currentColor" only — never inline color
 *
 * Third-party icon libraries (lucide, heroicons, phosphor, tabler) remain
 * forbidden. If an icon is missing from this set, add a new file here + a
 * rationale in the PR — do not reach for a package.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  strokeWidth?: number;
};

type Props = IconProps & { children: React.ReactNode };

export function IconBase({
  size = 20,
  strokeWidth = 2,
  children,
  ...rest
}: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}
