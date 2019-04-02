import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'

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
  callback: (key: string | number, newValue: any, oldValue: any) => void
): boolean | void {

  const newIsArray = is.array(newValue), oldIsArray = is.array(oldValue)
  if (newIsArray || oldIsArray) {

    const newLength = newIsArray ? newValue[env.RAW_LENGTH] : env.UNDEFINED,
      oldLength = oldIsArray ? oldValue[env.RAW_LENGTH] : env.UNDEFINED

    callback(
      env.RAW_LENGTH,
      newLength,
      oldLength
    )

    for (let i = 0, length = Math.max(newLength || 0, oldLength || 0); i < length; i++) {
      callback(
        i,
        newValue ? newValue[i] : env.UNDEFINED,
        oldValue ? oldValue[i] : env.UNDEFINED
      )
    }

    return env.TRUE

  }

}