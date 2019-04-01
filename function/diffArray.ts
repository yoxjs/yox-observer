import * as env from 'yox-common/util/env'

/**
 * 对比新旧数组
 *
 * @param newArray
 * @param oldArray
 * @param callback
 */
export default function diffArray(newArray: any[] | void, oldArray: any[] | void, callback: (newValue: any, oldValue: any, key: string | number) => void) {

  if (newArray || oldArray) {

    const newLength = newArray ? newArray.length : 0
    const oldLength = oldArray ? oldArray.length : 0

    callback(
      newArray ? newLength : env.UNDEFINED,
      oldArray ? oldLength : env.UNDEFINED,
      env.RAW_LENGTH
    )

    for (let i = 0, length = Math.max(newLength, oldLength); i < length; i++) {
      callback(
        newArray ? newArray[i] : env.UNDEFINED,
        oldArray ? oldArray[i] : env.UNDEFINED,
        i
      )
    }

  }

}