import { IconBase, type IconProps } from "./Base";

export function ModelIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 21 7.5V16.5L12 21 3 16.5V7.5Z" />
      <path d="M12 12 21 7.5" />
      <path d="M12 12 3 7.5" />
      <path d="M12 12v9" />
    </IconBase>
  );
}
