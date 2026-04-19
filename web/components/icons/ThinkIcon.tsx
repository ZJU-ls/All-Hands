import { IconBase, type IconProps } from "./Base";

export function ThinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 13.5 10 20 12 13.5 14 12 21 10.5 14 4 12 10.5 10Z" />
      <path d="m19 4 .7 1.8L21.5 6.5l-1.8.7L19 9l-.7-1.8L16.5 6.5l1.8-.7Z" />
    </IconBase>
  );
}
