import * as is from 'yox-common/src/util/is'
import * as constant from 'yox-common/src/util/constant'

import createPureObject from 'yox-common/src/function/createPureObject'

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
) {

  const newIsObject = is.object(newValue),

  oldIsObject = is.object(oldValue)

  if (newIsObject || oldIsObject) {

    const diffed = createPureObject(),
    newObject = newIsObject ? newValue : constant.EMPTY_OBJECT,
    oldObject = oldIsObject ? oldValue : constant.EMPTY_OBJECT

    if (newIsObject) {
      for (let key in newObject) {
        const value = newObject[key]
        if (value !== oldObject[key]) {
          // 保证遍历 oldObject 时不会再次触发
          diffed.set(key, constant.TRUE)
          callback(key, value, oldObject[key])
        }
      }
    }

    if (oldIsObject) {
      for (let key in oldObject) {
        const value = oldObject[key]
        if (diffed.get(key) === constant.UNDEFINED && value !== newObject[key]) {
          callback(key, newObject[key], value)
        }
      }
    }

  }

}