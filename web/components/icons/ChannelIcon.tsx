import { IconBase, type IconProps } from "./Base";

export function ChannelIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 16h12l-2-2v-3a4 4 0 0 0-8 0v3Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </IconBase>
  );
}
