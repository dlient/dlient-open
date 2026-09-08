import * as React from "react"
import { Toaster as SonnerToaster, toast, type ToasterProps } from "sonner"

// shadcn radix-mira Sonner Toast。
// 注意：原版用 next-themes 取主题，@dlient-open/ui 不引入 next-themes —— theme 直接由 props 透传，
// 宿主不传时依赖 --popover/--border/--radius 等包内变量自动跟随亮/暗。

// 单例守卫：同一份 sonner/@dlient-open/ui 实例内全局只渲染一个 Toaster 容器。
// 宿主根组件挂载一次即可；message 兜底（无宿主 Toaster 时自建 root）渲染本组件也会被守卫去重，
// 防止「宿主挂一个 + message 兜底再挂一个」导致同一条 toast 渲染两次。
let sonnerToasterMounted = false

function Toaster({ theme, ...props }: ToasterProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    // 本模块已挂载过（宿主根或 message 兜底），或页面上已存在其它来源的 sonner 容器 → 不再挂第二个
    if (sonnerToasterMounted || document.querySelector("[data-sonner-toaster]")) return
    sonnerToasterMounted = true
    setMounted(true)
    return () => {
      sonnerToasterMounted = false
    }
  }, [])
  if (!mounted) return null
  return (
    <SonnerToaster
      theme={theme}
      className="dui:toaster dui:group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
export { toast }
export default Toaster
