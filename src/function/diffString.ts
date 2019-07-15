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

  const newIsString = is.string(newValue),

  oldIsString = is.string(oldValue)

  if (newIsString || oldIsString) {
    callback(
      constant.RAW_LENGTH,
      newIsString ? newValue.length : constant.UNDEFINED,
      oldIsString ? oldValue.length : constant.UNDEFINED
    )
    return constant.TRUE
  }

}