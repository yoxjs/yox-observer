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
  callback: (key: string, newValue: any, oldValue: any) => void
): boolean {

  const newIsString = is.string(newValue), oldIsString = is.string(oldValue)
  if (newIsString || oldIsString) {
    callback(
      env.RAW_LENGTH,
      newIsString ? newValue[env.RAW_LENGTH] : env.UNDEFINED,
      oldIsString ? oldValue[env.RAW_LENGTH] : env.UNDEFINED
    )
    return env.TRUE
  }

}