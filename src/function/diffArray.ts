import * as constant from 'yox-type/src/constant'
import * as is from 'yox-common/src/util/is'

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
      constant.RAW_LENGTH,
      newLength,
      oldLength
    )

    for (let i = 0, length = Math.max(newLength || 0, oldLength || 0); i < length; i++) {
      callback(
        '' + i,
        newValue ? newValue[i] : constant.UNDEFINED,
        oldValue ? oldValue[i] : constant.UNDEFINED
      )
    }

    return constant.TRUE

  }

}