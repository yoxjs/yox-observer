import * as constant from 'yox-type/src/constant'
import * as array from 'yox-common/src/util/array'
import * as string from 'yox-common/src/util/string'
import * as keypathUtil from 'yox-common/src/util/keypath'

/**
 * 从 keypath 数组中选择和 keypath 最匹配的那一个
 *
 * @param sorted 经过排序的 keypath 数组
 * @param keypath
 */
export default function (sorted: string[], keypath: string): any {

  let result: any

  array.each(
    sorted,
    function (prefix) {
      const length = keypathUtil.match(keypath, prefix)
      if (length >= 0) {
        result = {
          name: prefix,
          prop: string.slice(keypath, length)
        }
        return constant.FALSE
      }
    }
  )

  return result

}