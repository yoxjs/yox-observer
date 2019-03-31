import * as env from 'yox-common/util/env'

/**
 * 对比新旧数组
 *
 * @param {?Array} newArray
 * @param {?Array} oldArray
 * @param {Function} callback
 */
function diffArray(newArray?: any[], oldArray?: any[], callback?: (newValue: any, oldValue: any, key: string | number) => void) {

  if (newArray || oldArray) {

    let newLength = newArray ? newArray.length : 0
    let oldLength = oldArray ? oldArray.length : 0

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