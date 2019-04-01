import * as string from 'yox-common/util/string'

/**
 * 是否模糊匹配
 *
 * @param keypath
 */
export default function isFuzzyKeypath(keypath: string): boolean {
  return string.has(keypath, '*')
}