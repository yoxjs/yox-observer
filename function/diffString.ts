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
  callback: (newValue: any, oldValue: any, key: string) => void
): boolean {

  const newIsString = is.string(newValue), oldIsString = is.string(oldValue)
  if (newIsString || oldIsString) {
    callback(
      newIsString ? newValue[env.RAW_LENGTH] : env.UNDEFINED,
      oldIsString ? oldValue[env.RAW_LENGTH] : env.UNDEFINED,
      env.RAW_LENGTH
    )
    return env.TRUE
  }

}