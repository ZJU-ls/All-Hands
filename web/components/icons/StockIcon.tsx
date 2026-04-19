import { IconBase, type IconProps } from "./Base";

export function StockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 5v14" />
      <path d="M4 8h4v6H4Z" />
      <path d="M12 3v18" />
      <path d="M10 6h4v10h-4Z" />
      <path d="M18 7v10" />
      <path d="M16 9h4v4h-4Z" />
    </IconBase>
  );
}
