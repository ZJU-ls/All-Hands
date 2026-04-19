import { IconBase, type IconProps } from "./Base";

export function SkillIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5a7 4 0 0 0-9-1v14a7 4 0 0 1 9 1Z" />
      <path d="M12 5a7 4 0 0 1 9-1v14a7 4 0 0 0-9 1Z" />
    </IconBase>
  );
}
