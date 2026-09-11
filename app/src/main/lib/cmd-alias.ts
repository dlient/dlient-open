/**
 * lib/cmd-alias.ts - spawn 命令别名解析（宿主侧**唯一**解析点）。
 *
 * 插件只传别名（CMD_NODE / CMD_NPM / CMD_NPX / CMD_PNPM，见 @dlient-open/plugin-sdk cmd-alias），
 * 真实可执行文件由宿主在此决定：内置运行时优先 → PATH → 常见安装路径。插件的 env.PATH
 * 不参与解析（解析只读宿主 process.env + 内置目录），因此别名无法被指向任意程序。
 *
 * 解析结果：
 *  - cmd：实际传给 spawn/execFile 的可执行文件绝对路径；
 *  - args：前置参数（npm/npx/pnpm 以 `node <cli.js>` 执行时放 cli 脚本路径，规避 Windows .cmd）。
 *
 * 授权记账仍按**别名**（spawn-grants / 弹框 / 审计），换机器 / 换 node 版本不重弹。
 * 解析失败（如 PATH 无 node 且未装内置运行时）返回 null → 调用方报错，不静默降级为任意命令。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CMD_NODE, CMD_NPM, CMD_NPX, CMD_PNPM, isCmdAlias, type CmdAlias } from '@dlient-open/core'
import { locateNodeExe, npmCliPathFor, whichSync } from '../nodejs'

/** 别名解析结果（真实命令 + 前置参数） */
export interface ResolvedCmdAlias {
  alias: CmdAlias
  /** 真实可执行文件（spawn/execFile 的 cmd） */
  cmd: string
  /** 前置参数（cli 脚本路径等） */
  args: string[]
}

/** pnpm：PATH 上的 pnpm/pnpm.exe 优先；仅 .cmd/.bat 或未命中时回落 `node <pnpm.cjs>` */
function resolvePnpm(nodeExe: string): { cmd: string; args: string[] } | null {
  const hit = whichSync(['pnpm'])
  if (hit && !/\.(cmd|bat)$/i.test(hit)) return { cmd: hit, args: [] }
  // .cmd/.bat 不经 shell 无法直接启动 → 回落 node + pnpm.cjs（npm i -g pnpm 的真实 JS 入口）
  const nodeDir = dirname(nodeExe)
  const candidates = [
    ...(hit ? [join(dirname(hit), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')] : []), // 全局 bin 同级 node_modules
    join(nodeDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), // node prefix 全局目录（Windows / 内置运行时）
    join(nodeDir, '..', 'lib', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), // POSIX（/usr/local/bin → /usr/local/lib/...）
  ]
  for (const cjs of candidates) {
    if (existsSync(cjs)) return { cmd: nodeExe, args: [cjs] }
  }
  return null
}

/**
 * 解析命令别名（非别名 / 解析失败 → null；纯 fs 检查，不启动子进程）。
 * 返回 null 但 `isCmdAlias(cmd)` 为真时，调用方应报「别名不可解析」而不是走弹框。
 */
export function resolveCmdAlias(cmd: string): ResolvedCmdAlias | null {
  if (!isCmdAlias(cmd)) return null
  const node = locateNodeExe()
  if (!node) return null
  if (cmd === CMD_NODE) return { alias: CMD_NODE, cmd: node.cmd, args: [] }
  if (cmd === CMD_NPM || cmd === CMD_NPX) {
    const cli = npmCliPathFor(node.cmd, cmd === CMD_NPM ? 'npm-cli.js' : 'npx-cli.js')
    return cli ? { alias: cmd, cmd: node.cmd, args: [cli] } : null
  }
  if (cmd === CMD_PNPM) {
    const pnpm = resolvePnpm(node.cmd)
    return pnpm ? { alias: CMD_PNPM, cmd: pnpm.cmd, args: pnpm.args } : null
  }
  return null
}
