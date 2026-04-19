import { IconBase, type IconProps } from "./Base";

export function PluginIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 3v4" />
      <path d="M15 3v4" />
      <path d="M7 7h10v5a5 5 0 0 1-10 0Z" />
      <path d="M12 17v4" />
    </IconBase>
  );
}
