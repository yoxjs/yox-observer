import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'

/**
 * 对比新旧对象
 *
 * @param newValue
 * @param oldValue
 * @param callback
 */
export default function (
  newValue: any,
  oldValue: any,
  callback: (key: string, newValue: any, oldValue: any) => void
): boolean {

  let keys: string[]

  const newIsObject = is.object(newValue), oldIsObject = is.object(oldValue)
  if (oldIsObject) {
    keys = object.keys(
      newIsObject ? object.extend({}, oldValue, newValue) : oldValue
    )
  }
  else if (newIsObject) {
    keys = object.keys(newValue)
  }

  if (keys) {
    array.each(
      keys,
      function (key) {
        callback(
          key,
          newIsObject ? newValue[key] : env.UNDEFINED,
          oldIsObject ? oldValue[key] : env.UNDEFINED
        )
      }
    )
    return env.TRUE
  }
}