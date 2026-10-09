import { Avatar, AvatarFallback } from "@web/components/ui/avatar"
import { avatarToneClass } from "@web/features/processes/display"
import { cn } from "@web/lib/utils"

type ProcessAvatarProps = {
  name: string
  size?: "sm" | "default" | "lg"
  className?: string
}

/** 进程图标：用 shadcn Avatar 显示名字首字母，底色由进程名决定。 */
export const ProcessAvatar = (props: ProcessAvatarProps) => {
  const { name, size = "sm", className } = props
  return (
    <Avatar
      size={size}
      className={cn("rounded-md after:rounded-md", className)}
    >
      <AvatarFallback
        className={cn(
          "rounded-md text-[0.625rem] font-semibold",
          avatarToneClass(name)
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
