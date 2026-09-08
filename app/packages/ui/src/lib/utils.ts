import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** className 合并：clsx + tailwind-merge（同类工具类后写覆盖前写，供消费者覆盖尺寸/颜色）。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export default cn
