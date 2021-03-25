import * as is from 'yox-common/src/util/is'
import * as constant from 'yox-common/src/util/constant'

/**
 * 对比新旧字符串
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
      'length',
      newIsString ? newValue.length : constant.UNDEFINED,
      oldIsString ? oldValue.length : constant.UNDEFINED
    )
    return constant.TRUE
  }

}