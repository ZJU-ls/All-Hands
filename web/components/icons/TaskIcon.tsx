import { IconBase, type IconProps } from "./Base";

export function TaskIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 6 2 2 4-4" />
      <path d="M13 6h7" />
      <path d="m4 14 2 2 4-4" />
      <path d="M13 14h7" />
      <path d="M4 20h16" />
    </IconBase>
  );
}
