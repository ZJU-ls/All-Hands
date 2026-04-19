import { IconBase, type IconProps } from "./Base";

export function SendIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </IconBase>
  );
}
