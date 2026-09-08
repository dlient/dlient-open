/**
 * vite `?inline` CSS 导入的类型声明。
 * modal 组件以 `import css from './x.css?inline'` 把样式打包成字符串运行时注入，
 * vite lib 构建原生支持该查询；此处仅为 tsc 提供模块形状。
 */
declare module '*.css?inline' {
  const content: string
  export default content
}
