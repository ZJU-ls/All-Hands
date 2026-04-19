import { IconBase, type IconProps } from "./Base";

export function ExternalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 3h6v6" />
      <path d="M21 3 10 14" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </IconBase>
  );
}
