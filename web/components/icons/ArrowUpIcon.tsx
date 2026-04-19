import { IconBase, type IconProps } from "./Base";

export function ArrowUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </IconBase>
  );
}
