import { IconBase, type IconProps } from "./Base";

export function ObservatoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}
