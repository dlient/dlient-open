/**
 * cmd-alias.ts - spawn 命令别名（宿主解析的**封闭集合**）。
 *
 * 插件在 manifest 的 `dlient.spawnCmds` 里声明别名，并在 `child.spawn` / `child.execFile`
 * 的 `cmd` 里传别名本身；宿主把别名解析为真实可执行文件后再启动，并**按别名记账**
 * （spawn-grants / 弹框 / 审计统一用别名）。
 *
 * 语义（docs/specs/plugin-permission.md §5.4）：
 *  - 解析权完全在宿主：别名 → 真实路径由宿主按「内置运行时优先 → PATH → 常见安装路径」决定，
 *    插件传入的 `env.PATH` 不参与解析，因此插件无法把别名指向任意程序；
 *  - 别名是协议常量、大小写敏感；不在集合内的字符串按普通命令走原白名单（不解析）；
 *  - 换机器 / 换 node 版本不改变别名，已授权项继续有效（区别于「按绝对路径记账」——后者换版本即重弹）。
 *
 * 注意：别名**不是**权限。仍需 manifest 声明 `spawnCmds` 含该别名，
 * 且 permissions 含 `child.spawn` / `child.execFile`（方法级门禁不变）。
 */

/** Node.js 可执行文件（内置运行时优先，其次用户 PATH / 常见安装路径） */
export const CMD_NODE = 'CMD_NODE'
/** node 自带的 npm（以 `node <npm-cli.js>` 执行，规避 Windows .cmd 兼容问题） */
export const CMD_NPM = 'CMD_NPM'
/** node 自带的 npx（以 `node <npx-cli.js>` 执行） */
export const CMD_NPX = 'CMD_NPX'
/** 用户环境中的 pnpm（PATH 上的 pnpm / pnpm.exe；否则回落 node + pnpm.cjs） */
export const CMD_PNPM = 'CMD_PNPM'

/** 别名全集（宿主校验 / 文档生成用；顺序稳定） */
export const CMD_ALIASES = [CMD_NODE, CMD_NPM, CMD_NPX, CMD_PNPM] as const

export type CmdAlias = (typeof CMD_ALIASES)[number]

/** 是否为宿主解析的命令别名（大小写敏感：别名是协议常量，不做宽松匹配） */
export function isCmdAlias(value: string): value is CmdAlias {
  return (CMD_ALIASES as readonly string[]).includes(value)
}
