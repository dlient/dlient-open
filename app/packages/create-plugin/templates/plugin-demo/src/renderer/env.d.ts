/** __PLUGIN_ID__ 渲染层环境声明 */

/** ?raw 导入（样式打进 JS 手动注入 <style>） */
declare module '*.css?raw' {
  const content: string
  export default content
}
