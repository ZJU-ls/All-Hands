import { IconBase, type IconProps } from "./Base";

export function CockpitIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path d="M12 17 16 9" />
      <circle cx="12" cy="17" r="1.5" />
    </IconBase>
  );
}
