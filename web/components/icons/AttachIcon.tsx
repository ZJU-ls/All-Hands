import { IconBase, type IconProps } from "./Base";

export function AttachIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
    </IconBase>
  );
}
