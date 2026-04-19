import { IconBase, type IconProps } from "./Base";

export function MarketIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 17 5-5 4 4 7-8" />
      <path d="M20 8v5" />
      <path d="M20 8h-5" />
    </IconBase>
  );
}
