/**
 * electron-builder `afterAllArtifactBuild` 钩子：给 DMG 做「公证 + 装订」。
 *
 * 为什么需要：electron-builder 只公证 .app（公证后已自动 staple），**DMG 本身不送公证**。
 * 本钩子在产物已生成、**尚未上传 Release 之前**运行（见 app-builder-lib/out/index.js），
 * 因此装订了票据的 DMG 就是最终上传的那一份。
 *
 * 前置条件：
 *  - `dmg.sign: true`（见 electron-builder.json5）：DMG 先被 codesign 签名，notarytool 才接受提交；
 *  - 环境变量 APPLE_API_KEY（.p8 的文件路径）/ APPLE_API_KEY_ID / APPLE_API_ISSUER，CI 由
 *    release.yml 的 "Prepare macOS signing & notarization" 步骤写入。
 *
 * 非 macOS 或缺少凭据时直接跳过，本地构建不受影响。
 */
module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return []

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.log('[notarize-dmg] 跳过：未提供 APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER')
    return []
  }

  const dmgs = buildResult.artifactPaths.filter((p) => p.endsWith('.dmg'))
  if (dmgs.length === 0) return []

  // @electron/notarize 行为：验签 → notarytool 提交并等待 → staple（装订票据）
  const { notarize } = require('@electron/notarize')

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] 开始公证 DMG：${dmg}`)
    await notarize({
      appPath: dmg,
      appleApiKey: APPLE_API_KEY,
      appleApiKeyId: APPLE_API_KEY_ID,
      appleApiIssuer: APPLE_API_ISSUER,
    })
    console.log('[notarize-dmg] 公证完成且已装订票据')
  }
  // 返回新增的需要上传的产物：本次是原地修改，无需额外上传
  return []
}
