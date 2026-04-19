import { IconBase, type IconProps } from "./Base";

export function ChatIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-4 3v-3H7a3 3 0 0 1-3-3Z" />
    </IconBase>
  );
}
