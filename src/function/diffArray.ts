import * as is from 'yox-common/src/util/is'
import * as constant from 'yox-common/src/util/constant'

/**
 * 对比新旧数组
 *
 * @param newValue
 * @param oldValue
 * @param callback
 */
export default function (
  newValue: any,
  oldValue: any,
  callback: (key: string, newValue: any, oldValue: any) => void
): true | void {

  const newIsArray = is.array(newValue),

  oldIsArray = is.array(oldValue)

  if (newIsArray || oldIsArray) {

    const newLength = newIsArray ? newValue.length : constant.UNDEFINED,

    oldLength = oldIsArray ? oldValue.length : constant.UNDEFINED

    callback(
      'length',
      newLength,
      oldLength
    )

    for (let i = 0, length = Math.max(newLength || 0, oldLength || 0); i < length; i++) {
      callback(
        // 把 number 转成 string
        constant.EMPTY_STRING + i,
        newIsArray ? newValue[i] : constant.UNDEFINED,
        oldIsArray ? oldValue[i] : constant.UNDEFINED
      )
    }

    return constant.TRUE

  }

}